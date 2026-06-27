---
tags:
  - specs/downloader
  - integrations/acquisition
status: draft
date created: 2026-06-27
date modified: 2026-06-27
---

# Epic: Audio Acquisition Hardening

**Status**: Draft
**GitHub**: #45, #46
**Depends on**: none
**Source audit**: [[report-260627-mvp-state-of-the-union]] §4

> The sourcing layer is the newest and most mature of the MVP's three pillars: local import, yt-dlp, and spotDL all ship with a solid subprocess lifecycle (process-tree kill, inactivity timeout, kill-all on quit) and infra-level tests over parsers, mappers, the dedup store, and purchase resolution. But the one thing that actually touches the outside world — invoking the external CLIs — is **entirely untested**, and all three binaries are **assumed present in `PATH`** with no bundling and no custom-path configuration. This epic is the hardening follow-through on the already-accepted design spec [[audio-acquisition-service]]: it closes the execution-test gap (#45) and the binary-discoverability gap (#46) without re-deriving the architecture.

## Problem & Current State

The download engine lives in the standalone `/service/downloader/` workspace (pure Node, no Electron deps), invoked from the Electron main process via the thin bridge `app/src/main/downloader/downloader-ipc.ts`. The architecture matches [[audio-acquisition-service]] §3–§5 closely. What's solid today:

- **Three backends** implementing the `DownloadBackend` interface (`service/downloader/backend.ts`): `service/downloader/backends/ytdlp-backend.ts`, `spotdl-backend.ts`, `spytify-backend.ts`.
- **Subprocess lifecycle** (`service/downloader/subprocess.ts`) is genuinely robust: process-tree kill via `taskkill /T /F` on Windows / SIGTERM→SIGKILL (2 s grace) on POSIX (`killProcess`, lines 237–255); an *inactivity* timeout that resets on every stdout/stderr chunk (`spawnLines`, `DEFAULT_TIMEOUT_MS = 300_000`, lines 87–136); and a global active-process registry with `killAll()` (lines 15–33) wired to the app `will-quit` handler (`main.ts:679–690`, per [[report-260627-mvp-state-of-the-union]] §4).
- **IPC bridge** lazy-loads the service, validates `outputDir` containment against the AudioStore base (symlink-aware via `fs.realpathSync`, Windows case-fold), threads a `downloadId` through events, and does a dedup short-circuit before spawning (`downloader-ipc.ts:160–235`).
- **Track schema** carries the acquisition fields — `localFilePath`, `source`, `audioFormat`, `purchaseLinks`, etc. The migration is **v1→v3** (not v2 as the design spec text says), all new fields optional and backward-compatible (`app/src/renderer/db/schemas.ts:139–246`).

What's missing — the gap this epic exists to close:

- **No backend-execution tests.** The only tests in `service/downloader/__tests__/` are `mapper.test.ts`, `audio-store.test.ts`, and `purchase-resolver.test.ts` — parsers, the dedup store, and purchase links. (The filename parser *is* tested, but in `app/src/main/media/__tests__/filename-parser.test.ts`, not the service workspace.) The actual yt-dlp/spotDL/Spytify invocation paths — progress parsing, JSON fallback, cache-skip, cancellation, `checkInstalled()` — have **zero coverage**.
- **Binaries assumed in `PATH`.** All three backends call the bare command name (`runCommand('yt-dlp', …)`, `'spotdl'`, `'spytify'`). There is no bundling and no custom-path setting. `DownloadSettings.tsx:225–230` explicitly acknowledges this: *"Custom path configuration is planned for a future release."*

## Goals

- Give every external-binary code path a deterministic, offline, fixture-driven test so regressions in progress parsing / completion detection / error classification are caught in CI.
- Let users point WhatNext at a binary that isn't on `PATH` (custom path), and surface presence + version clearly when one is missing.
- Make missing-backend UX honest and actionable in both `BackendGate` and `DownloadSettings`, including the cross-platform reality that Spytify is Windows-only.
- Do all of the above *without* changing the public `DownloadBackend` contract or the IPC surface defined in [[audio-acquisition-service]] §3.2 / §5 more than necessary.

## Non-Goals

- **Bundling the binaries.** [[audio-acquisition-service]] §9 is explicit: WhatNext never ships yt-dlp/spotDL/Spytify (the Pandoc/Obsidian model). #46 is *discovery and configuration*, not vendoring. Auto-download/installer is out of scope.
- Rewriting the subprocess lifecycle — it is already sound; tests should pin its behaviour, not replace it.
- New backends, new sources, or the artist-attribution pipeline (covered by [[audio-acquisition-service]] §7).
- Real network/live-CLI tests in CI (those are inherently flaky); recorded fixtures only. A manually-run "smoke" tier against real binaries is allowed but must be opt-in.

## Proposed Approach

Two independent workstreams, sequenceable in either order but ideally #45 first so #46's path-config changes land against a tested baseline.

**#45** introduces a test seam around `spawn`/`runCommand` so backends can be driven with recorded CLI output (fixture files captured from real yt-dlp/spotDL/Spytify runs). Tests assert on the *typed `DownloadEvent` stream* a backend emits given a known stdout/stderr/exit-code, plus `checkInstalled()` and cancellation behaviour.

**#46** adds a resolved-path layer: a per-backend configurable executable path (persisted setting) that the backends consult instead of the bare command name, plus a startup/first-use presence+version probe whose results drive `BackendGate` and `DownloadSettings`. Keep Spytify platform-gated exactly as today (`spytify-backend.ts:27–33`).

## Work Breakdown

### #45 — Backend-execution integration tests

**Rationale.** The execution paths are where reality bites: yt-dlp/spotDL change output formats across versions, and the backends parse that output with regexes and heuristics that have never been exercised by a test. Several are visibly fragile and deserve pinning:

- **yt-dlp progress vs. path heuristic.** `parseYtdlpProgress` (`subprocess.ts:261–288`) gates on the literal `[download]` substring, so it won't false-positive on arbitrary lines — good. The riskier code is the *completed-path* heuristic in `ytdlp-backend.ts:96–105`: any non-empty line that doesn't start with `[`/`ERROR` and contains no `%` is treated as the `--print after_move:filepath` output. A stray informational line could be mis-captured as the file path. The progress yield itself is at `ytdlp-backend.ts:107–116`.
- **spotDL JSON-fallback.** When `spotdl save … --save-file -` doesn't emit parseable JSON, `resolve()` falls back to a minimal stub track (`spotdl-backend.ts:58–78`). Both the happy JSON path (`_mapEntry`) and the fallback need fixtures.
- **spotDL cache-skip.** Already-downloaded tracks are detected via the `"Skipping" … outputDir` line match (`spotdl-backend.ts:123–127`); this must map to a `complete` event with the existing path, not a re-download.
- **Error classification.** yt-dlp treats `exitCode !== 0` *or* `stderr.includes('ERROR:')` as failure (`ytdlp-backend.ts:127`); spotDL deliberately ignores stderr and relies on exit code only, because spotDL writes benign warnings containing "error" (`spotdl-backend.ts:130–134`). Both rules need a regression test so they don't silently invert.
- **`checkInstalled()` version validation.** All three trust a clean exit and take `stdout.trim()` verbatim as the version (`ytdlp-backend.ts:17–21`, `spotdl-backend.ts:26–29`, `spytify-backend.ts:34–41`) — spotDL's relies on exit code *only*, with no shape check on the version string. Tests should cover installed, not-installed (spawn `error`), and non-zero-exit.
- **Cancellation/cleanup.** `cancel()` calls `killProcess(activeProcess)` and nulls it (`*-backend.ts`); a test should confirm an in-flight `download()` generator terminates and emits no further events after cancel.

**Approach.** Add a test seam so `spawn`/`runCommand`/`spawnLines` can be backed by a fixture. Spytify builds its own line generator inline (`spytify-backend.ts:81–123`) rather than using `spawnLines`, so it needs the seam at the `child_process.spawn` import boundary. Capture real CLI output once into `service/downloader/__tests__/fixtures/` (yt-dlp progress + `after_move` print; spotDL JSON + non-JSON + Skipping; Spytify `Saving to:` / `Recording... XX%`). Drive each backend's `download()`/`resolve()`/`checkInstalled()` against fixtures and assert the emitted event sequence.

**Acceptance criteria.**
- [ ] A documented test seam lets backends run against recorded `spawn` output with no real binary present; default (un-seamed) behaviour is unchanged.
- [ ] yt-dlp: fixtures cover progress parsing, `after_move:filepath` capture, `Destination:` fallback, and an `ERROR:`-in-stderr failure → `error` event.
- [ ] yt-dlp: a regression test pins that an informational stdout line is *not* mis-captured as `completedPath` (covers the `:96–105` heuristic).
- [ ] spotDL: fixtures cover the JSON `resolve` path, the non-JSON fallback stub, cache-skip → `complete`, and exit-code-only error classification (benign "error" in stderr does **not** fail).
- [ ] Spytify: fixtures cover `Saving to:` capture and `Recording... XX%` progress; the non-Windows early-return path is asserted.
- [ ] `checkInstalled()` for all three: installed (version parsed), spawn-error (not installed), and non-zero exit are each covered.
- [ ] `cancel()` mid-download is tested: process kill is invoked and no events are emitted after cancellation.
- [ ] All new tests are offline and deterministic (no network, no live CLI) and run in the existing `service` test command in CI.

### #46 — Binary bundling / custom-path config

**Rationale.** Today a user whose binary lives outside `PATH` (common on Windows, or for pyenv/pipx installs) simply gets "Not found" with no recourse — and `DownloadSettings.tsx:225–230` admits the gap in plain text. Discoverability is the difference between "feature works" and "feature mysteriously broken." Per [[audio-acquisition-service]] §8.6, settings should expose per-backend paths with auto-detect + manual override.

**Approach.** Introduce a resolved-executable layer: a persisted per-backend path setting (`ytdlp` / `spotdl` / `spytify`) that, when set, is used in place of the bare command name in every `runCommand`/`spawnLines`/`spawn` call. Probe presence + version at startup and on first use, exposing the result (including the configured path) through the existing `download:check-backends` channel (`BackendStatusResult` already has an optional `path` field per [[audio-acquisition-service]] §3.2). Wire the richer status into `BackendGate.tsx` (currently shows static install instructions per missing backend) and `DownloadSettings.tsx` (currently static `BACKEND_INFO` with a Re-check button). Keep Spytify gated to Windows + note its real-time-only PoC status in the UI copy.

**Approach — open design point.** The default executable path could be persisted in `localStorage` (as the format/purchase toggles already are, `DownloadSettings.tsx:8–9`) or via a main-process settings store. Since the path is consumed in the main process and `localStorage` is renderer-only, a main-process-readable persisted setting (passed into the backend constructors or a path-config singleton) is the cleaner fit. To confirm with the maintainer.

**Acceptance criteria.**
- [ ] A per-backend custom executable path can be set, persisted, and is read by the main process before invoking each backend.
- [ ] When a custom path is set, all three backends invoke that path (`checkInstalled`, `resolve`, `download`) instead of the bare command name.
- [ ] Presence + version are probed at startup/first-use; results (installed, version, resolved path, error) flow through `download:check-backends`.
- [ ] `DownloadSettings.tsx` lets the user set/clear a path per backend and shows the resolved path + version on success; the "planned for a future release" note at `:225–230` is removed/updated.
- [ ] `BackendGate.tsx` distinguishes "not installed" from "installed at a non-default path" and offers the path-config entry point.
- [ ] Spytify remains Windows-gated and its UI copy notes it is a real-time-only PoC; a path setting for it on non-Windows is inert/hidden.
- [ ] No bundling is introduced; binaries remain user-installed (consistent with [[audio-acquisition-service]] §9).
- [ ] Cross-platform install/path notes are documented for yt-dlp, spotDL (cross-platform, Python) and Spytify (Windows/.NET, needs Spotify desktop).

## Epic Acceptance Criteria (Definition of Done)

- [ ] Every external-binary code path in the three backends is exercised by an offline, deterministic test (#45).
- [ ] A user can run downloads with a binary that is not on `PATH` via custom-path config, and missing/misconfigured backends are clearly surfaced in `BackendGate` and `DownloadSettings` (#46).
- [ ] No regression to the subprocess lifecycle (kill, timeout, kill-all-on-quit) — pinned by tests, not modified.
- [ ] `cd app && npm run typecheck` and the `service` + `app` test suites pass in CI.
- [ ] The `DownloadBackend` interface and the `download:*` IPC channels are unchanged except for additively surfacing the resolved `path` (already present on `BackendStatus`).
- [ ] [[audio-acquisition-service]] §8.6 and §9 remain accurate; this epic's deltas are cross-linked from it.

## Risks & Open Questions

- **Fixture drift.** Recorded yt-dlp/spotDL output is version-specific; CLI updates can break parsing in the field even with green tests. Mitigation: capture fixtures from a pinned tool version, document the capture procedure, and add an opt-in live-smoke tier. Open question: which versions do we pin against?
- **Input-type discriminator mismatch (latent bug).** `SpotdlBackend.supportedInputs` declares `'spotify-id'` (singular, from `InputType` in `backend.ts:1`), but `DownloadInput.type` is the union `'url' | 'spotify-ids'` (plural, `types.ts:21–24`) and `_inputToUrls` matches `'spotify-ids'` (`spotdl-backend.ts:178`). So the declared `'spotify-id'` capability can never be selected by a real `DownloadInput`. Should #45's tests pin current behaviour, or should this be fixed first? Recommend a small `fix(downloader)` alongside #45.
- **Spytify is a PoC.** Its `download()` parsing (`Saving to:` / `Recording... XX%`, `spytify-backend.ts:103–119`) is best-effort against an unverified output format and it bypasses `spawnLines` (so no inactivity timeout). How much hardening does a Windows-only, real-time-only PoC warrant vs. keeping it explicitly gated/experimental?
- **Persistence layer for paths.** localStorage (renderer) vs. main-process settings store — see #46 approach note. Needs a decision.
- **Version-string validation.** Should `checkInstalled()` validate the shape of the version string (e.g. reject empty/garbage), or is "clean exit = installed" sufficient? spotDL in particular trusts the exit code only.
- **`download:suggest-backend`** exists in the IPC bridge (`downloader-ipc.ts:106–109`) but isn't in the [[audio-acquisition-service]] §5.1 channel list — confirm whether it's in scope for documentation/test here or tracked separately.

## Dependencies & Sequencing

- **Depends on**: none. The code under test already exists and is merged (`d242a46 downloader - purchase`, `9aff86c downloader - integration + spytify`).
- **Sequencing**: #45 before #46 — land the execution-test baseline first so the path-config refactor in #46 is verified against pinned behaviour. The latent input-type fix (see Risks) should ride with #45.
- **Adjacent work**: this epic is the testing slice of [[report-260627-mvp-state-of-the-union]] §6 item C-10 ("Backend-execution integration tests"). Broader app-wide reliability/test gaps (error boundaries, component tests, E2E) belong to the planned [[epic-app-reliability-quality]], not here.
- **Agentic policy**: the downloader/`service` layer is *not* part of the off-limits P2P protocol surface, so this epic is eligible for autonomous implementation under normal human review.

## References

- [[audio-acquisition-service]] — the accepted design spec this epic hardens (§3 backends, §4 service layer, §5 IPC, §8.6 settings, §9 ethics/no-bundling)
- [[report-260627-mvp-state-of-the-union]] §4 (sourcing maturity, shaky/PoC list) and §6-C (test backlog)
- [[local-file-import-adapter]] — sibling acquisition feature (Phase A of the design spec)
- [[tapec-integration-analysis]] — scanner/parser reference implementations
- [[epic-app-reliability-quality]] — broader reliability/test epic this dovetails with
- Code: `service/downloader/backends/{ytdlp,spotdl,spytify}-backend.ts`, `service/downloader/subprocess.ts`, `app/src/main/downloader/downloader-ipc.ts`, `app/src/renderer/components/Download/BackendGate.tsx`, `app/src/renderer/components/Settings/DownloadSettings.tsx`

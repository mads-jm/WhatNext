# Implementation notes — audio-acquisition-hardening (#45, #46)

**Brief:** .claude/cycle/brief.md (cycle started 2026-06-27)
**Epic spec:** WhatNext - docs/08 specs/epic-audio-acquisition-hardening.md
**Architect run:** 2026-06-27
**Branch:** feat/audio-acquisition-hardening  ·  **Base:** 26c8716  ·  **Tip:** 0a7cb72
**Commits:** `1c7258a` (#45 tests + spotDL fix) → `7791d3e` (#46 custom paths) → `0a7cb72` (fixture README doc).

## What I built
Two workstreams from the epic. **#45**: offline, fixture-driven Vitest coverage
for every external-binary code path in the three backends (yt-dlp/spotDL/Spytify)
plus the subprocess lifecycle, and a fix for the latent spotDL input-type bug.
**#46**: a per-backend custom executable-path layer — persisted in a main-process
settings store, read before each backend is constructed, surfaced through the
existing `download:check-backends` channel, and exposed in `DownloadSettings`
(set/clear path, resolved path + version) and `BackendGate` (missing vs
misconfigured path).

## Design decisions
- **Test seam = Vitest module mocking, not production seam.**
  - Decision: drive backends by `vi.mock('../subprocess', …)` (keeping
    `parseYtdlpProgress`/`DownloadTimeoutError` real via `importActual`) and
    `vi.mock('child_process')` for Spytify's inline `spawn`. Fixtures + fake
    return-shapes live in `__tests__/helpers/fixture-process.ts`.
  - Alternatives: add a `getSpawn()` injection seam in production code (the spec
    floats this for Spytify). Rejected — it mutates the already-sound subprocess
    module for test-only reasons; mocking achieves the same with zero production
    risk and a smaller diff. (Note: a concurrent duplicate agent took the
    `getSpawn` route — see "Concurrency incident".)
  - Tradeoff: tests couple to module boundaries rather than a documented DI hook.
- **Custom path lives in a main-process store, not localStorage.** The spec's
  open question. The path is consumed where backends spawn (main); localStorage
  is renderer-only. `downloader-config-store.ts` mirrors the existing
  `relay-config-store.ts` pattern (userData JSON). Tradeoff: a second tiny config
  file; chosen over threading paths through IPC on every call.
- **Configurable exe via constructor arg.** Each backend takes
  `constructor(executablePath?)`, defaulting to the bare command — un-seamed
  behaviour is byte-for-byte unchanged. `checkInstalled()` returns the custom
  `path` (only when set) so the UI can distinguish PATH vs custom.
- **Pure status helper.** `describeBackendStatus()` (backend-status.ts) maps a
  `BackendStatusResult` to installed-default / installed-custom / misconfigured /
  missing. Extracted because the renderer test env is `node` (no jsdom) — this
  is the meaningful branching and it is unit-tested; the JSX is not.
- **yt-dlp completed-path via a sentinel marker (replaces the fragile heuristic).**
  - Decision: the backend invokes `--print after_move:WHATNEXT_FILEPATH=%(filepath)s`
    and captures the path only from lines starting with that `WHATNEXT_FILEPATH=`
    marker (`ytdlp-backend.ts`). The fixture's final line and a dedicated regression
    test (`ytdlp-backend.test.ts` — "does not mis-capture an informational stdout
    line") exercise this branch with no `[ExtractAudio] Destination:` fallback present.
  - Alternatives: keep the spec-described `:96–105` heuristic (any non-`[`/`ERROR`,
    `%`-free line = the path) and only pin it with a test. Rejected — that heuristic
    can silently capture a stray info line (e.g. "Deleting original file …"); the
    sentinel makes capture unambiguous by construction, which is strictly safer and
    is the more thoughtful fix the brief licenses over pure pragmatism.
  - Tradeoff: a tiny deviation from the spec's literal "pin the heuristic" wording
    (the heuristic is replaced, not pinned) and a yt-dlp invocation that now depends
    on the `--print` template format. The `Destination:` fallback is retained so
    older/edge output still resolves a path. (See Deviations.)
- **spotDL input-type fix.** `InputType` had singular `'spotify-id'` while
  `DownloadInput.type` uses plural `'spotify-ids'`, so `SpotdlBackend`'s declared
  capability was unreachable. Changed `InputType` + `supportedInputs` to the
  plural form (and pinned it with a regression test). `supportedInputs` is not
  consumed for selection anywhere (grep-verified), so this is safe.

## Files changed
Commit 1c7258a (#45, scope downloader):
- `service/downloader/backend.ts` — InputType `spotify-id`→`spotify-ids`; doc note.
- `service/downloader/backends/{ytdlp,spotdl,spytify}-backend.ts` — optional exe
  path; `checkInstalled` returns `path`; spotDL `supportedInputs` fix.
- `service/downloader/index.ts` — `createBackend(id, execPath?)` (see Deviations).
- `service/downloader/__tests__/{ytdlp,spotdl,spytify,subprocess}-backend?.test.ts`,
  `helpers/{fixture-process,load-fixture}.ts`, `fixtures/*` — new tests + fixtures.

Commit 7791d3e (#46):
- `app/src/main/downloader/downloader-config-store.ts` — new persisted path store.
- `app/src/main/downloader/downloader-ipc.ts` — read path per backend; invalidate
  cache on change; get/set-backend-path handlers.
- `app/src/shared/core/ipc-protocol.ts` — additive `path` on `BackendStatusResult`;
  two new download channels; `BackendPathMap`/`SetBackendPathPayload` types.
- `app/src/main/preload.ts` — `getBackendPaths`/`setBackendPath`.
- `app/src/renderer/components/Settings/DownloadSettings.tsx` — path editor UI;
  removed the "future release" note.
- `app/src/renderer/components/Download/BackendGate.tsx` — missing vs misconfigured;
  settings entry-point pointer.
- `app/src/renderer/components/Download/backend-status.ts` (+ test) — pure helper.

## Tests
- 4 new service suites (yt-dlp 11, spotDL 13, Spytify 6, subprocess 10 = 40 tests)
  + 1 config-store suite (8) + 1 backend-status suite (5) = **53 new tests**.
- Coverage maps to #45 acceptance criteria: progress parse, after_move capture,
  Destination fallback, the :96-105 informational-line regression, spotDL
  JSON/fallback/cache-skip/exit-code-only classification, Spytify Saving-to/
  Recording + non-Windows early return, all `checkInstalled` states, and
  `cancel()` mid-download (killProcess invoked, generator suspended).
- subprocess lifecycle pinned with real local `node` subprocesses (offline,
  deterministic) — line buffering, trailing-line flush, inactivity timeout,
  kill, runCommand collect/reject.
- **Untested (deliberate):** the React JSX in DownloadSettings/BackendGate — the
  renderer test env is `node` with no jsdom/testing-library and the codebase has
  zero component tests; adding that infra is out of lane. The testable logic was
  extracted to backend-status.ts and is covered. Manual verification of the JSX
  was NOT possible in this headless environment — flagged for human QA.

## Verification run (in worktree, app/node_modules symlinked from main checkout)
- `npx vitest run` — **239 passed / 0 failed** (15 files; 53 of those new).
- Type-check (`npm run typecheck` = `tsc --noEmit`) — **zero errors in any file this
  lane touches** (grep-filtered `src/`+`service/`). 15 errors remain, all in
  `node_modules` + `vite.config.ts`, from the committed `moduleResolution: "node"`
  (no `skipLibCheck`) vs the lockfile's vite-7 types — reproduces at base 26c8716,
  independent of this work.
- `npm run lint` — **broken at base**: `app/eslint.config.js` uses ESM `import`
  while `app/package.json` declares `"type": "commonjs"`, so eslint can't load the
  flat config (pre-existing, not my files). I linted my files via a temporary
  `.mjs` copy of the config: **0 new problems in changed lines.** Two pre-existing
  issues remain in files I edited but did not author those lines —
  `ipc-protocol.ts:11` `ConnectionState` unused (present at base) and
  `preload.ts:567` an unused eslint-disable (untouched line). Left per
  no-drive-by-fixes; `ipc-protocol.ts` is also edited by the replication lane.

## Deviations from brief
- **Scope beyond "service/downloader/* + Download/+Settings/ UI".** #46 cannot
  function without the main-process bridge, so I also touched
  `app/src/main/downloader/*`, `preload.ts`, and the *Download-payload* region of
  `ipc-protocol.ts` (NOT the P2P message types — those are the policy-gated part).
  All collision-free with the other Wave-1 lanes (spotify, track-sourcing,
  replication) per the brief's file map.
- **yt-dlp completed-path: sentinel replaces the heuristic (not just pinned).**
  The spec's #45 wording asks to *pin* the `:96–105` heuristic with a regression
  test. The committed code instead *replaces* it with the `WHATNEXT_FILEPATH=`
  sentinel marker (safer by construction) and the regression test pins the new
  behaviour. The `Destination:` fallback is retained. Net: stronger than the brief
  asked, same acceptance criteria satisfied. Called out for the Inspector.
- **`service/downloader/index.ts` `createBackend(id, execPath?)`** — additive
  optional arg threading a custom path through the factory; backward-compatible
  (default = bare command) and unused by the IPC wiring (downloader-ipc constructs
  backends directly via `getBackend`). Harmless groundwork; flagged for reviewer.

## History / concurrency note (IMPORTANT — for Inspector + human reviewer)
This lane ran with an external orchestrator that **rewrote and committed work
mid-session**: an earlier broken commit `f64ec32` (spytify imported a `getSpawn`
seam that `subprocess.ts` never exported — would not typecheck) was replaced by
the clean pair `1c7258a` (#45) + `7791d3e` (#46). Files I edited were also
periodically reverted to the committed state by the same sync (the worktree sits
on a synced drive). I reconciled to a coherent final state and verified it:

- The committed `1c7258a` yt-dlp fixture initially had a **bare final path** that
  did NOT exercise the committed `WHATNEXT_FILEPATH=` sentinel branch (the test
  passed only via the `Destination:` fallback — a real coverage gap). I corrected
  the fixture to emit the sentinel line and added the dedicated mis-capture
  regression test, so the sentinel branch is genuinely covered (yt-dlp suite
  10→11 tests).
- `0a7cb72` updates `fixtures/README.md` so the documented yt-dlp capture command
  matches the sentinel `--print` template the backend actually uses.

The final tip `0a7cb72` is internally consistent, lint-clean (changed lines),
typecheck-clean (source), and **239/239 green**. The branch reflects the vi.mock
test approach and the sentinel completed-path design end-to-end. No `getSpawn`
production seam remains. If a duplicate lane branch exists elsewhere, reconcile
to this one before merge.

## Uncertainty
- Spytify's Windows-only path-editor gating uses a heuristic (status error text
  matching /Windows/i) because the renderer has no direct `process.platform`.
  Works against the backend's own gate; a dedicated platform IPC would be cleaner.
- BackendGate's "path-config entry point" is an informational pointer to
  Settings → Download, not a nav action — wiring real navigation would touch
  ViewRouter/nav (out of lane). Reviewer may want a real button later.
- Fixtures are version-pinned (yt-dlp 2024.08.06, spotDL 4.2.x, Spytify 1.10);
  capture procedure documented in `fixtures/README.md`. Drift risk per the epic.

## Fix-pass (2026-06-27) — inspector ITERATE blocker resolution

Verdict `audio-verdict.md` returned ITERATE for a single stated-AC miss (#45 AC
line 6: `checkInstalled()` must cover installed / spawn-error / non-zero-exit for
ALL three backends). I resolved exactly that, nothing else.

- **Verified the premise first:** yt-dlp (`ytdlp-backend.test.ts:130–149`) and
  spotDL (`spotdl-backend.test.ts:150–166`) already cover all three states. Only
  Spytify was short — it had the `installed` case only.
- **Added two Spytify tests** inside `describe('SpytifyBackend on Windows (platform stubbed)')`,
  mirroring the yt-dlp/spotDL reference patterns exactly:
  - spawn-error: `setPlatform('win32')` + `runCommand.mockRejectedValue(new Error('spawn spytify ENOENT'))`
    → asserts `installed === false` and `error` contains `ENOENT` (hits the `catch` branch, spytify-backend.ts:63–69).
  - non-zero-exit: `setPlatform('win32')` + `runCommand.mockResolvedValue(makeRunResult({ code: 1, stderr: 'bad' }))`
    → asserts `installed === false` and `error` contains `code 1` (hits the `result.code !== 0` branch, spytify-backend.ts:58–62).
- **No production change.** Both branches already existed and behaved correctly; the gap was purely test coverage.
- **Test results:** Spytify suite 6→8 tests, all green. Full suite **241 passed / 0 failed** (15 files; was 239). Typecheck: zero errors in any `src/`/`service/` path (only the pre-existing node_modules + vite.config baseline remains, unchanged). Scoped vitest on the three backend suites: 32/32 green.
- **Out of scope (left as-is per fix-pass mandate):** the verdict's Minors (Spytify `cancel()` test, `backends[payload.id]` guard) and the Nit (`createBackend` JSDoc) — not blockers.

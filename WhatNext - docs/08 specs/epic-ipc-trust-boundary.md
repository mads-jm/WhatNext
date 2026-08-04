---
tags:
  - specs/security
  - core/electron/ipc
  - architecture/patterns/ipc
status: in-progress
date created: 2026-08-01
date modified: 2026-08-03
---

# Epic: IPC Trust-Boundary Hardening

**Status**: In progress — work items 1 & 2 implemented 2026-08-03 (cycle 1 of 2); work item 3 deferred to cycle 2
**GitHub**: to be filed (plan-first; issue text drafted 2026-08-03)
**Depends on**: none
**Source audit**: [[report-260801-mvp-premerge-review]] §1.1–§1.4, §2 (`set-backend-path`)

> The pre-merge review found that a handful of main-process handlers take renderer-supplied strings straight into `exec`, `fs.readFile`, `fs.writeFile`, and subprocess argv — contradicting the project's own security constraint #4 ("renderer sandbox enforced; minimize IPC surface"). Four of the six merge-blockers for mvp→main live here. The fixes share one shape: **validate at the boundary using helpers the codebase already has** (`assertPathContained` and friends in `file-transfer-ipc.ts` are the house pattern). This epic closes the renderer→main gap; the peer→main gap is [[epic-file-transfer-guards]].

## Problem & Current State

All citations verified on the merged mvp tree (`cafc6ab`) by the 2026-08-01 review; re-verify line numbers before editing.

1. **Command injection in `shell:open-external`** — `app/src/main/main.ts:911-933`. For non-http(s) protocols the handler runs `` exec(`start "" "${url}"`) ``. `exec` spawns a shell; the only validation is `new URL(url)` + a protocol allowlist, and WHATWG parsing preserves `"` and `&` in an opaque path, so `spotify:" & <cmd> & "` survives validation and becomes a cmd.exe chain. Secondary: the `start` command runs on *every* platform (no `process.platform` check → `spotify:` links silently broken on Linux/macOS), and the `TODO` at `main.ts:909` shows this was already flagged.
2. **Arbitrary file read via `wn-art://`** — `app/src/main/main.ts:607-626`. The protocol handler reads whatever path arrives in `?path=` and returns the bytes. The scheme is registered with `supportFetchAPI: true` (`main.ts:591-596`), so renderer JS can `fetch('wn-art://x/?path=/home/user/.ssh/id_ed25519')` and read the body. This converts the sandboxed renderer into an arbitrary-file-read primitive.
3. **Arbitrary file write via `file:write`** — `app/src/main/main.ts:781-788`. `ipcMain.handle('file:write', (_e, filePath, content) => fs.writeFile(filePath, content))` — zero validation. The legitimate caller gets its path from `dialog:save-file`, but the handler will overwrite `~/.bashrc` for any caller.
4. **Argument injection into yt-dlp/spotdl** — `service/downloader/backends/ytdlp-backend.ts:40-45,77-88`, `service/downloader/backends/spotdl-backend.ts:52,93-99`, reachable via `app/src/main/downloader/downloader-ipc.ts:115-124` (`download:resolve`) and `:131-236` (`download:start`). `spawn` without a shell prevents *shell* injection, but the URL is a bare positional argument: yt-dlp accepts `--opt=value` as one argv token, so a renderer "url" of `--exec=<cmd>` is parsed as an option — and `--exec` runs an arbitrary command after download. Same class for spotDL's argparse. Nothing between the IPC boundary and the argv build validates that the string is a URL.
5. **Renderer chooses the executable main spawns** — `DOWNLOAD_SET_BACKEND_PATH` handler in `app/src/main/downloader/downloader-ipc.ts`. `setBackendPath` persists any string; `getBackend` then spawns it. Legitimate as a user setting (point at your own yt-dlp), but as an IPC primitive it converts renderer compromise into arbitrary-binary execution.

**The house pattern already exists** — `app/src/main/file-transfer/file-transfer-ipc.ts:58-132`: `sanitizeFilename` + `isValidSha256` + `assertPathContained` (with Windows case-folding) and post-sanitization containment re-checks at `:1030`. The review called this out as the standard the rest of main.ts should be held to. Findings 2 and 3 are fixable largely by hoisting and reusing these helpers.

## Goals

- No renderer-supplied string reaches `exec`/shell interpolation. Prefer eliminating the `exec` branch entirely via `shell.openExternal`.
- `wn-art://` reads are contained to the artwork/audio directories.
- `file:write` only writes to paths the user actually approved via a save dialog (or, at minimum, contained under the app's documents dir).
- Downloader inputs are validated as http(s) URLs and passed after a `--` separator so nothing beginning with `-` can be parsed as an option.
- `set-backend-path` is gated: dialog-sourced or stat-verified regular file, confirmed in main.
- Shared path-containment helpers hoisted to one module and reused (not copy-pasted).
- Regression tests for each closed hole (malicious input → rejected).

## Non-Goals

- The peer→main chunk-write path (`file-transfer-ipc.ts:893-944`) — that is [[epic-file-transfer-guards]], keep file ownership disjoint.
- Companion server authentication — [[epic-session-liveness-fixes]].
- Downloader *functional* fixes #56/#57 — [[epic-session-liveness-fixes]]; coordinate on `downloader-ipc.ts` if both lanes run concurrently (this lane owns the validation layer; that lane owns event/import flow).
- A general IPC-permissions framework; keep it to boundary validation with existing patterns.

## Proposed Approach

1. **`shell:open-external`** (`main.ts:911-933`): try removing the `exec` branch — `shell.openExternal` handles registered custom protocols on current Electron. If a Windows fallback is truly required, use `spawn('cmd', ['/c', 'start', '', url])` (argv, no shell string) and reject URLs containing characters outside a strict allowlist. Add the missing `process.platform` gate either way.
2. **Hoist containment helpers**: move/re-export `assertPathContained` (+ friends) from `file-transfer-ipc.ts` into a shared main-process module (e.g. `app/src/main/fs-guards.ts`).
3. **`wn-art://`** (`main.ts:607-626`): resolve the requested path and require containment in the artwork/audio directories before reading; 404 otherwise.
4. **`file:write`** (`main.ts:781-788`): have `dialog:save-file` record approved paths in a main-process map (path → expiry/one-shot) and let `file:write` write only to an approved path; fall back to containment under `documents/WhatNext` if the dialog-token approach proves awkward.
5. **Downloader URL validation** (`downloader-ipc.ts`): in `download:resolve` / `download:start` (and `DOWNLOAD_SUGGEST_BACKEND` for consistency), `new URL(input.url)` and require `http:`/`https:`; in both backends pass `--` before the positional argument.
6. **`set-backend-path`**: require the path to come from a main-process `dialog:open-file` flow, or at minimum `fs.stat` → regular file + native confirm dialog in main.
7. **Tests**: Vitest suite(s) asserting each malicious shape is rejected: `spotify:" & calc & "`, `wn-art://?path=../../etc/passwd` and absolute out-of-tree paths, `file:write` to an unapproved path, `--exec=…` as downloader URL, `set-backend-path` to a non-file.

## Work Breakdown

### 1 — `shell:open-external` hardening — ✅ done 2026-08-03

**Acceptance criteria.**
- [x] No `exec` with interpolated renderer input remains in `main.ts`; the `exec` branch was removed outright (no `spawn` fallback needed, so no `process.platform` gate is required) and every allowed protocol now goes through `shell.openExternal`. `main.ts` no longer references `child_process` at all, and a test asserts that.
- [x] `spotify:" & <cmd> & "`-shaped URLs are rejected before any spawn; `validateExternalUrl` in `app/src/main/ipc-guards.ts` enforces a per-scheme shape allowlist, with regression tests for the quote/`&`/backtick/`$()`/`;`/`|` shapes.
- [x] The TODO is resolved/removed.
- Also closed in the same pass: **`shell:open-path`** (`main.ts`), which the review did not record. It is the sharper hole of the two — `shell.openPath` on a *file* executes it via the OS handler. It now accepts directories only, and only app-owned ones or ones the user picked in a main-process dialog (see [[#Authority model]]).

### 2 — Filesystem containment (`wn-art://`, `file:write`) — ✅ done 2026-08-03

**Acceptance criteria.**
- [x] Containment helpers live in one shared module — `app/src/main/utils/path-safety.ts`; `file-transfer-ipc.ts` imports them (definitions deleted there, no behaviour change, its suites untouched).
- [x] `wn-art://` serves only files under the artwork roots; relative traversal *and* absolute out-of-tree requests return 403, with tests for both shapes.
- [x] `file:write` refuses paths not approved via `dialog:save-file` in the current app session (one-shot per approval); both callers (playlist export, theme export) are dialog-then-write-once, so nothing breaks.

**Correction to the problem statement above:** there is only one live artwork root, `<documents>/WhatNext/artwork` — the `artwork:download` cache and the file-transfer receive directory are the same folder. `<userData>/artwork` is enumerated as a *legacy* root because older builds wrote the cache there and those paths can still be in the database. There is no audio consumer of `wn-art://` (playback is device-local via Spotify), so "artwork/audio roots" narrows to artwork, images only.

#### Authority model

For `file:write` and `shell:open-path` the review's fallback ("containment under `documents/WhatNext`") was rejected: it would trade a security hole for a sovereignty violation (CLAUDE.md #1/#2 — the user must be able to export to, and open, any directory they choose). Instead, **authority derives from the user's own main-process dialog choice**:

- `dialog:save-file` records the chosen path as a one-shot, session-scoped write approval (`ipc-guards.ts`).
- `dialog:open-directory` records the chosen directory in a persisted store (`app/src/main/approved-dirs-store.ts`, `userData/approved-dirs.json`) so the "Open" button next to a saved default export directory keeps working across restarts.

This also fixes a trust problem the review did not record: the default export directory is read from renderer `localStorage`, which the renderer can rewrite, so its value was never authority for opening a folder.

### 3 — Downloader argv hygiene — ⏭ deferred to cycle 2 (2026-08-03)

Disjoint files from cycle 1 (`downloader-ipc.ts`, both backends). Carries a UX decision — the free-text executable-path field at `DownloadSettings.tsx:103-116` vs dialog-only sourcing — that needs user input at scoping time.

**Acceptance criteria.**
- [ ] `download:resolve`/`download:start` reject non-http(s) input with a typed error before any backend call.
- [ ] Both backends place `--` before the positional URL; existing fixture tests still pass.
- [ ] A test asserts `--exec=…` input never reaches spawn argv as an option (rejected at the IPC layer *and* inert after `--`).
- [ ] `set-backend-path` only accepts a stat-verified regular file sourced from a main-process dialog (or explicitly confirmed); a test covers the rejection path.

## Epic Acceptance Criteria (Definition of Done)

- [x] Review findings §1.1–§1.3 closed (better than the suggested direction on the sovereignty-sensitive handlers); §1.4 + `set-backend-path` remain for cycle 2.
- [x] No new IPC channels added; no handler widened.
- [x] All new validation has negative-path tests; `cd app && npm test` green (476 tests, 34 files — was 438/32).
- [x] `npm run lint` / `npm run typecheck` introduce no *new* failures (typecheck 16 → 16 identical errors; lint 58 → 56 errors, two pre-existing ones incidentally fixed).
- [x] [[report-260801-mvp-premerge-review]] punch-list items 1–3 checked off; item 4 pending cycle 2.

## Risks & Open Questions

- ~~**`shell.openExternal` behavior for `spotify:`**~~ — resolved by code: `PlaybackBar.tsx` already falls back to `https://open.spotify.com/...` when the handler returns `success: false`, so a missing OS handler degrades to the web URL. Still worth the manual check that the desktop app *does* open when installed.
- ~~**Approved-path map for `file:write`**~~ — resolved: one-shot. Both callers are dialog-then-write-once.
- **Pre-existing default export directories** need one re-pick: a directory chosen before this change is only in renderer `localStorage`, not in the main-process approvals store, so its "Open" button stays inert until the user clicks "Change" once. Deliberate — the renderer cannot be allowed to grant itself the permission.
- **Concurrent lane overlap**: `downloader-ipc.ts` is also touched by [[epic-session-liveness-fixes]] (#57). Sequence this lane first or keep hunks disjoint (validation at handler entry vs event flow).

## References

- [[report-260801-mvp-premerge-review]] §1.1–§1.4, §2, §4 ("Worth keeping" — the house pattern)
- Concepts: [[Electron-IPC]] (the trust boundary being hardened), [[Electron]] (process model and sandbox posture)
- Code: `app/src/main/main.ts:591-596,607-626,781-788,909-933`; `app/src/main/downloader/downloader-ipc.ts`; `service/downloader/backends/{ytdlp,spotdl}-backend.ts`; `app/src/main/file-transfer/file-transfer-ipc.ts:58-132`
- `CLAUDE.md` constraint #4 (Security Hardened)

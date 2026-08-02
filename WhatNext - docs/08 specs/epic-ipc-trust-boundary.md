---
tags:
  - specs/security
  - core/electron/ipc
  - architecture/patterns/ipc
status: draft
date created: 2026-08-01
date modified: 2026-08-01
---

# Epic: IPC Trust-Boundary Hardening

**Status**: Draft
**GitHub**: to be filed (plan-first)
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

### 1 — `shell:open-external` hardening

**Acceptance criteria.**
- [ ] No `exec` with interpolated renderer input remains in `main.ts`; either `shell.openExternal` handles custom protocols or a `spawn`-argv fallback exists behind a `process.platform === 'win32'` gate.
- [ ] `spotify:" & <cmd> & "`-shaped URLs are rejected before any spawn; a regression test asserts rejection.
- [ ] The `main.ts:909` TODO is resolved/removed.

### 2 — Filesystem containment (`wn-art://`, `file:write`)

**Acceptance criteria.**
- [ ] Containment helpers live in one shared module; `file-transfer-ipc.ts` consumes the shared copy (no behavior change there).
- [ ] `wn-art://` serves only files under the artwork/audio roots; out-of-tree requests (relative traversal *and* absolute) return an error, with tests.
- [ ] `file:write` refuses paths not approved via the save dialog (or outside the documented containment root); the export flow still works end-to-end.

### 3 — Downloader argv hygiene

**Acceptance criteria.**
- [ ] `download:resolve`/`download:start` reject non-http(s) input with a typed error before any backend call.
- [ ] Both backends place `--` before the positional URL; existing fixture tests still pass.
- [ ] A test asserts `--exec=…` input never reaches spawn argv as an option (rejected at the IPC layer *and* inert after `--`).
- [ ] `set-backend-path` only accepts a stat-verified regular file sourced from a main-process dialog (or explicitly confirmed); a test covers the rejection path.

## Epic Acceptance Criteria (Definition of Done)

- [ ] Review findings §1.1–§1.4 and the `set-backend-path` item are closed with the review's suggested direction or better.
- [ ] No new IPC channels added; no handler widened.
- [ ] All new validation has negative-path tests; `cd app && npm test` green.
- [ ] `npm run lint` / `npm run typecheck` introduce no *new* failures (gates themselves are [[epic-quality-gates]]).
- [ ] [[report-260801-mvp-premerge-review]] punch-list items 1–4 checked off (report updated).

## Risks & Open Questions

- **`shell.openExternal` behavior for `spotify:`** on each platform needs a quick manual check — if the OS has no handler registered, decide the UX (silent no-op vs toast) rather than resurrecting `exec`.
- **Approved-path map for `file:write`**: one-shot vs session-lifetime approval; one-shot is safer, confirm it doesn't break repeated exports.
- **Concurrent lane overlap**: `downloader-ipc.ts` is also touched by [[epic-session-liveness-fixes]] (#57). Sequence this lane first or keep hunks disjoint (validation at handler entry vs event flow).

## References

- [[report-260801-mvp-premerge-review]] §1.1–§1.4, §2, §4 ("Worth keeping" — the house pattern)
- Concepts: [[Electron-IPC]] (the trust boundary being hardened), [[Electron]] (process model and sandbox posture)
- Code: `app/src/main/main.ts:591-596,607-626,781-788,909-933`; `app/src/main/downloader/downloader-ipc.ts`; `service/downloader/backends/{ytdlp,spotdl}-backend.ts`; `app/src/main/file-transfer/file-transfer-ipc.ts:58-132`
- `CLAUDE.md` constraint #4 (Security Hardened)

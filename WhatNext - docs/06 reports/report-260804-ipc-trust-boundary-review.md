---
tags:
  - reports/review
  - specs/security
  - core/electron/ipc
status: active
date created: 2026-08-04
date modified: 2026-08-04
---

# Review: IPC Trust-Boundary Hardening epic (`5afb17c..3765835`, mvp) — 2026-08-04

> Security-fix verification of the [[epic-ipc-trust-boundary]] epic against the five
> merge-blockers recorded in [[report-260801-mvp-premerge-review]] §1.1–§1.4 and §2.
> Posture: maximally adversarial — each fix was attacked, not just confirmed present.

**Audience:** self (own branch — verdict applies)
**Diff base:** `git diff 5afb17c..3765835` (code: `35c39e7`, `8721b3c`, `08b9beb`, `a983360`; docs: `63dcea5`, `3765835`)
**Verdict:** **READY**

---

## Verdict

**READY.** All five closed findings verify as genuinely CLOSED, each with a defense-in-depth second layer behind the boundary check rather than a single gate. The bonus `shell:open-path` hardening (the sharper of the two shell holes, which the original review missed) is also closed. Tests exercise the *shipped* guard functions against real temp directories, every bypass class the brief names has a negative-path test, and 509/509 app tests pass. Lint and typecheck introduce no new failures relative to the pre-epic tree (typecheck 16→16 environmental-only; lint 56→55, the one delta being the dead-`crypto`-import removal). No IPC channels were added; the only protocol change is a *return*-type widening (`SetBackendPathResult`). Legitimate flows — https links, `spotify:` deep links with web fallback, artwork rendering, playlist/theme export, normal downloads, setting a custom backend — all remain intact.

Two residuals are noted below (wn-art:// symlink resolution; set-backend-path re-validation at spawn). Both sit **outside the renderer threat model** this epic scopes (each requires local filesystem tampering the renderer cannot perform), so neither blocks. They are recorded as defense-in-depth follow-ups, not punch-list items.

---

## Per-finding verification

### §1.1 `shell:open-external` — command injection — **CLOSED**

The `exec('start "" "${url}"')` branch is gone outright (`main.ts:952-970`); every allowed protocol now flows through `shell.openExternal(check.url)` — an OS API call, no shell anywhere downstream. `validateExternalUrl` (`ipc-guards.ts:64-93`) enforces a per-scheme shape allowlist against the **raw** string, so injection payloads never reach the OS.

Attack attempts, all rejected (verified by `ipc-guards.test.ts:79-94`):
- `spotify:" & calc & "`, ``spotify:track:abc`whoami` ``, `…$(id)`, `…; rm -rf ~`, `…|nc …` → `Malformed URI`. The `spotify:` pattern `/^spotify:(?:[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)*)?$/` admits only URI-safe segments; quotes/`&`/backticks/`$()`/`;`/`|`/spaces cannot pass.
- **Uppercase scheme** (`SPOTIFY:…`): WHATWG lowercases `parsed.protocol` so the pattern is *found*, but `pattern.test(raw)` runs against the un-lowercased raw and the `^spotify:` anchor fails → rejected. Fails safe (rejects), no bypass.
- **CRLF header-injection** (`https://…/\n\rSet-Cookie:`): `CONTROL_CHARS` pre-check rejects before parse (`ipc-guards.ts:68`, test `:116`).
- `file:`/`javascript:`/`data:`/`vbscript:`/`whtnxt:` → `Invalid protocol`. Confirmed no regression: `whtnxt://` is only ever clipboard-copied and pasted into a form field (`Sidebar.tsx:152`, `P2PStatus.tsx:55`), never handed to `openExternal`.
- Web URLs return `parsed.href` (normalised/percent-encoded), so an odd-but-legal literal still opens without verbatim forwarding.

The TODO at the old `main.ts:909` is removed. A regression-lock test (`ipc-guards.test.ts:126-136`) asserts `main.ts` no longer references `child_process`/`exec*` at all — I confirmed this independently against the tree. `spotify:` functionality survives via `PlaybackBar.tsx:55-57`: `openExternal(desktopUri)` then web-URL fallback when the OS returns `success:false`.

### §1.2 `wn-art://` — arbitrary file read — **CLOSED** (one defense-in-depth residual)

The handler (`main.ts:621-630`) now routes the `?path=` value through `resolveArtworkPath` (`ipc-guards.ts:122-132`) and 403s anything that is not a servable artwork file. `supportFetchAPI: true` is deliberately still set (`main.ts:605-610`) — containment is what compensates, and it does:
- Absolute out-of-tree (`/etc/passwd.jpg`, `~/.ssh/id_rsa.png`, a peer's `/home/peer/art/song.jpg`) → null (test `:167-173`).
- Relative traversal (`<root>/../../../etc/shadow.png`) → collapsed by `path.resolve` then `isPathContained`, rejected (test `:158-165`).
- **Prefix-sibling escape** (`<root>-backup/cover.jpg`) → rejected by the `+ path.sep` guard in `isPathContained` (`path-safety.ts:99`, test `:175-177`).
- Non-image extensions inside the root (`index.json`, `payload.html`) → null; NUL injection and relative/blank/non-string → null (tests `:179-190`).
- Both live roots enumerated correctly (`<documents>/WhatNext/artwork` + legacy `<userData>/artwork`).

**Residual (non-blocking, defense-in-depth):** `resolveArtworkPath` uses `path.resolve`, not `fs.realpath`, so it does **not** resolve symlinks — unlike `validateOpenPathRequest`, which does (`ipc-guards.ts:225-231,262`). A symlink named `cover.jpg` inside the artwork root pointing at `/etc/passwd` would be served. This is **not renderer-reachable**: the renderer cannot create symlinks, and the one untrusted writer to that directory (peer file-transfer) writes real bytes under a `sanitizeFilename`'d name, never a symlink. Worth closing the asymmetry with the `shell:open-path` path (realpath before containment) if artwork ever gains a second untrusted writer; today it is theoretical.

### §1.3 `file:write` — arbitrary file write — **CLOSED**

`file:write` (`main.ts:819-831`) now calls `consumeApprovedSaveTarget(filePath)` first and refuses anything not pre-approved. Approvals are recorded only by `dialog:save-file` in main (`main.ts:806-812` → `recordApprovedSaveTarget`), so the renderer has no route to grant itself a path.

Race/reuse attacks, all defeated (tests `ipc-guards.test.ts:197-235`):
- **Approve A, write B:** the set is keyed by normalised path; `consume` only deletes on an exact match, so B is never approved.
- **Stale reuse:** one-shot — the first write consumes the approval; a second write of the same captured path returns `false`.
- **Traversal smuggle** (`<docs>/sub/../other.json` against an approval for `<docs>/theme.json`): normalisation resolves the traversal to a different key → rejected, and the genuine approval is left intact (test `:221-229`).
- **Non-dialog route:** none exists — `recordApprovedSaveTarget` is not exposed over IPC.

Export flow verified intact: both `export-service.ts:25-31` (playlist) and `ThemeSettings.tsx:113-120` (theme) call `dialog.saveFile` then `file.write(result.filePath, …)` with the *exact* returned path — the same string main normalised into the approval set, so the round-trip matches. Set is bounded at 32 with oldest-eviction.

### §1.4 Downloader argv injection — **CLOSED**

Validation lands at the IPC handlers before any backend is constructed:
- `download:resolve` → `validateResolveInput(req.input)` throws `DownloadInputError` on non-http(s) url or non-base62 spotify id (`downloader-ipc.ts:196-197`).
- `download:start` → each `t.sourceUrl` filtered through `validateSourceUrl`; rejects surface as per-track `DOWNLOAD_ERROR` events keyed by the exact `sourceUrl` (so a rejected track shows an error rather than hanging at "pending"), and a fully-rejected batch returns without spawning (`downloader-ipc.ts:227-247`).

`validateSourceUrl` (`downloader-guards.ts:71-92`) rejects `--exec=…`, `--exec`, `-o/tmp/…`, `--config-location=…`, `-x`, a bare `--`, `file:`/`spotify:`/`javascript:` schemes, control-char (`\n--exec=sh`) and oversized input — all pinned in `downloader-guards.test.ts:47-85`. It returns the caller's original string (not `URL.href`) on purpose, so event correlation by `sourceUrl` is preserved.

Second layer in the backends:
- **yt-dlp:** `--` placed immediately before the positional in *both* `resolve` (`ytdlp-backend.ts:76`) and `download` (`:123`). Pinned by `ytdlp-backend.test.ts:135-162` including `args.indexOf('--') === args.length - 2`.
- **spotDL:** correctly does **not** use `--` (the real 4.5.2 CLI rejects it — documented in the spec with the exact error). Instead `assertSafeQueryArg` requires `^https?://` on every query arg, up front before any spawn and again per-track (`spotdl-backend.ts:106-108,153`). Pinned by `spotdl-backend.test.ts:120-157`, and the argv shape `['save', URL, '--save-file', '-']` is asserted to contain no `--`.
- **spytify:** correctly **not forgotten** — it never puts `sourceUrl` into argv (records live playback; argv is `--path`/`--format` only, `spytify-backend.ts:95-100`), so it has no URL-argv surface to guard.

The knowingly-skipped `DOWNLOAD_SUGGEST_BACKEND` is a string-match returning a backend id (`index.ts:46`), with no OS capability downstream — verified, agreed.

### §2 `set-backend-path` — renderer chooses the spawned executable — **CLOSED** (one residual)

`DOWNLOAD_SET_BACKEND_PATH` (`downloader-ipc.ts:160-183`) now runs `validateBackendPathRequest` before persisting or spawning. The hybrid authority model holds up:
- A path main's own `dialog:open-file` recorded (`wasApprovedOpenFile`) is accepted with no prompt.
- A hand-typed path must be absolute, `stat` as a regular file, and be confirmed in a native `dialog.showMessageBox` naming the binary (`downloader-ipc.ts:96-113`).
- **Forged-provenance attack defeated:** `validateBackendPathRequest` consults only main's own record; a renderer payload carrying `{ fromDialog: true, approved: true }` is ignored and still triggers the confirm prompt (test `downloader-guards.test.ts:160-174`). There is no "came from the dialog" field anywhere in the guard.
- Non-existent → `No such file` without prompting; directory → `Not a program file` without prompting; symlink-to-binary is *intentionally* accepted (normal install shape — pipx/homebrew), and the confirm dialog still fires for the target. Relative path, unknown backend id, and `null` request all rejected (tests `:201-235`).
- Declined confirmation returns `{ ok:false, reason:'declined' }`, leaving the previous setting untouched and spawning nothing; the renderer renders this as silence, not an error (`DownloadSettings.tsx:115-125`, test `:108-120`). Clearing needs no prompt (reduces privilege).

**Residual (non-blocking):** the persisted path is validated at *set* time, not re-validated at *spawn* time — `getBackend` spawns whatever `downloader-config.json` holds. Editing that file requires write access to `userData`, which is outside the renderer's reach and the same trust level as the binary itself, so this is consistent with the threat model. Note it only if the config store ever becomes writable by a lower-trust path.

---

## Helper hoisting & cross-epic overlap

`assertPathContained`, `isPathContained`, `sanitizeFilename`, `isValidSha256` moved to `app/src/main/utils/path-safety.ts` and are re-imported by `file-transfer-ipc.ts:40`. I diffed the pre-move definitions against the shared copies: **behaviour is unchanged** — the containment logic (`startsWith(target + sep) || cmp(equal)`, Windows case-fold) is byte-for-byte equivalent; the only edit is a doc-comment wording tweak ("strictly inside" → the accurate "itself or beneath it"). All seven original call sites in `file-transfer-ipc.ts` (`:397,479,496,509,809,889,939`) consume the shared copies unchanged.

**Cross-epic note (coordination, not a defect):** this epic modified `file-transfer-ipc.ts` — a file [[epic-file-transfer-guards]] owns and is actively editing — twice: the helper-hoist (`35c39e7`, necessary) and the dead-`crypto`-import drop (`a983360`, cosmetic). I confirmed `a983360` is **truly inert**: no `crypto` reference remains in the file (`isValidSha256` was its only consumer and moved out in the hoist). The risk is purely a **merge conflict** in the shared import block if the other lane touches those same lines — the crypto drop could have waited for that lane. Flagging the overlap only; I did not review file-transfer-guards work.

---

## Regression & test-quality assessment

- **Tests exercise the real guards, not reimplementations.** `ipc-guards.test.ts` and `downloader-guards.test.ts` import the shipped `validate*`/`resolve*`/`consume*` functions and run them against real temp dirs and real files; the handlers in `main.ts`/`downloader-ipc.ts` are thin wrappers over exactly these. No handler logic is duplicated in the test files.
- **Every bypass class the brief names has a test:** injection shapes, uppercase scheme, CRLF, protocol allowlist, artwork traversal/absolute/prefix-sibling/symlink-adjacent/NUL, save-target approve-A-write-B/stale/traversal-smuggle, downloader `--exec`/`-o`/`--config-location`/bare-`--`/control-char, `--` placement in both yt-dlp calls, spotDL no-`--` + http(s) check, and set-backend-path forged-provenance/non-file/directory/declined/relative/unknown-id.
- **Backend argv is pinned** against captured real tool output (fixtures), not asserted back at the implementation.
- **Legit flows confirmed** by reading call sites: https links (many callers), `spotify:` + web fallback (`PlaybackBar`), artwork via `wn-art://` (roots enumerate correctly), playlist + theme export (dialog→write round-trip matches), normal download start (valid https passes the filter), Browse…-sourced backend path (no prompt) and typed path (confirm).

## Verification (reviewer runs, mvp @ `3765835`)

| Gate | Result | Detail |
|---|---|---|
| `cd app && npm test` | **509/509**, 36 files | Includes `../service/downloader/**` backend suites (run under app's vitest); matches the spec's claimed count |
| `cd service && npm test` | n/a | No service test script (`echo … exit 1`); backend tests live under app's vitest, and do run |
| `npm run typecheck` | 16 errors | All environmental (`node_modules` `.d.ts` + `vite.config.ts` under current `moduleResolution`); **zero** in epic source files. Identical to pre-epic 16 |
| `npm run lint` | 55 errors / 16 warnings | **Zero** in epic source files. 56→55 delta is the dead-`crypto`-import removal, as the spec claims |
| New IPC channels | none | `SetBackendPathResult` is a return-type widening; `SetBackendPathPayload` unchanged; no new `IPC_CHANNELS` constant |

## Epic Definition-of-Done audit

Every DoD checkbox is **genuinely met**: §1.1–§1.4 + §2 closed (verified above, better-than-suggested on the sovereignty-sensitive handlers via the dialog-authority model rather than a `documents/WhatNext` cage); no new channels / no widened payload; negative-path tests present and `npm test` green at the claimed 509/36; lint/typecheck no new failures at the claimed counts; premerge punch-list items 1–4 checked with items 5/6 correctly attributed elsewhere. No checked-off-but-not-met boxes found.

## Worth keeping

- `downloader-guards.ts:71-92` — returning the caller's *original* `sourceUrl` (not `URL.href`) with the reasoning inline is the kind of detail that prevents a silent event-orphaning regression; the guard is airtight and the "why" travels with it.
- The `spotdl-backend.ts:106-108` comment documenting *why* `--` is absent (real-CLI-rejected, with the exact error) turns a suspicious-looking omission into a defensible one — exactly the paranoia this problem needs, and it saved me a "you forgot the separator" finding.
- `downloader-guards.test.ts:160-174` (forged-provenance) tests the *doctrine* ("trust never derives from the payload"), not just the code path — that is the test that matters most here and it exists.

## Related
- [[epic-ipc-trust-boundary]] — the spec whose acceptance criteria this verifies
- [[report-260801-mvp-premerge-review]] — §1.1–§1.4, §2 (the findings closed) and §4 (the house pattern reused)
- [[epic-file-transfer-guards]] — owns `file-transfer-ipc.ts`; see cross-epic overlap note
- [[Electron-IPC]] — the trust boundary hardened here

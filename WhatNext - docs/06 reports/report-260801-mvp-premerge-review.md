---
tags:
  - reports/review
  - security
  - mvp
status: active
date created: 2026-08-01
date modified: 2026-08-03
---

# Pre-Merge Review: `qa/wave1` (mvp + wave-1 lanes) → `main` — 2026-08-01

> **Purpose**: Code-level review of the full `mvp` line ahead of merge to `main`, expanded to cover the five wave-1 lane branches and their integration branch `qa/wave1` (HEAD `f103563`). Manual QA is running in parallel; this report covers correctness, security, architecture, and dependency risk. Companion documents: [[report-260627-mvp-state-of-the-union]], [[report-260627-issue-reconciliation]].

**Audience:** self (own branch — verdict applies)
**Diff base:** `git diff main...qa/wave1` (~442 files on the mvp line + 5 lanes; lockfiles, generated `docs/`, and tsbuildinfo excluded from review)
**Verdict:** **NOT YET** — see [[#Verdict & punch list]]

---

## The read

This branch is the whole MVP: downloader stack, P2P file transfer, [[Companion-Client|companion server]] + [[Circuit-Relay|relay tunnel]], themes, [[Sessions|sessions]]/turns, the trackv1→v2→v3 migration, and — via the wave-1 lanes — real fixes for four of the five debt items flagged in the June state-of-the-union. The lane work is genuinely good: the replication lane in particular reads like the strongest code in the repo (durable checkpoints, a pull path that actually delivers documents, a convergence-proof LWW tie-break with the reasoning written down). The June audit's "shakier than the docs say" is measurably less true today: 340 tests pass on the integrated tree, lint *runs* again, and the known silent stubs are either un-stubbed (Manual TrackSource) or honestly scoped out (P2P TrackSource).

What gives me pause is concentrated in one place: **the main process's trust boundary with the renderer and with remote peers** (since spec'd as [[epic-ipc-trust-boundary]] and [[epic-file-transfer-guards]]). The project's own constraint #4 ("Security Hardened: renderer sandbox enforced; minimize IPC surface") is contradicted by a handful of new handlers that take renderer strings straight into `exec`, `fs.readFile`, `fs.writeFile`, and subprocess argv — and by a P2P chunk path that writes peer-supplied bytes to disk before checking whether we ever asked for them. None of these are hard to fix; all of them are the kind of thing that's much cheaper to fix before `main` than after. That's the whole distance between this review's NOT YET and READY.

---

## 1. Merge-blocking findings

### 1.1 `shell:open-external` — command injection on the `spotify:` path

**issue (blocking):** `app/src/main/main.ts:911-933`
For non-http(s) protocols the handler runs ``exec(`start "" "${url}"`)``. `exec` spawns a shell, and the only validation is `new URL(url)` + a protocol allowlist. WHATWG URL parsing preserves `"` and `&` in an opaque path, so a renderer-supplied `spotify:" & <cmd> & "` passes validation and the interpolated string becomes a cmd.exe command chain. This is a textbook injection reachable from a single [[Electron-IPC|IPC call]]. Two secondary problems in the same block: `start` is executed on *every* platform (the code never checks `process.platform`, so `spotify:` links are silently broken on Linux/macOS), and the existing `TODO` at line 909 shows this was already known to need hardening. Direction: `shell.openExternal` handles registered custom protocols on current Electron — try removing the `exec` branch entirely; if a Windows fallback is truly needed, use `spawn('cmd', ['/c', 'start', '', url])` (no shell interpolation) after rejecting any URL containing characters outside a strict allowlist.

### 1.2 `wn-art://` — arbitrary file read exposed to the renderer

**issue (blocking):** `app/src/main/main.ts:607-626`
The protocol handler reads whatever path arrives in `?path=` and returns the bytes. Because the scheme is registered with `supportFetchAPI: true` (`main.ts:591-596`), renderer JS can `fetch('wn-art://x/?path=/home/user/.ssh/id_ed25519')` and read the response body — the MIME label doesn't matter. This converts the sandboxed renderer into an arbitrary-file-read primitive, which is precisely what `contextIsolation` exists to prevent. Direction: resolve the requested path and require containment in the artwork/audio directories (the `assertPathContained` helper in `file-transfer-ipc.ts:113` is already the right shape — hoist it somewhere shared and reuse it here).

### 1.3 `file:write` — arbitrary file write from the renderer

**issue (blocking):** `app/src/main/main.ts:781-788`
`ipcMain.handle('file:write', (_e, filePath, content) => fs.writeFile(filePath, content))` — no validation at all. The legitimate caller is the export flow, which gets its path from `dialog:save-file`, but the handler itself will happily overwrite `~/.bashrc` or a startup item for any caller. Direction: have `dialog:save-file` record the approved path in a main-process map and let `file:write` only write to paths the user actually picked (or at minimum enforce containment under `documents/WhatNext`).

### 1.4 Downloader — argument injection through renderer-supplied URLs

**issue (blocking):** `service/downloader/backends/ytdlp-backend.ts:40-45` and `:77-88`; `service/downloader/backends/spotdl-backend.ts:52,93-99`; reachable via `app/src/main/downloader/downloader-ipc.ts:115-124` (`download:resolve`) and `:131-236` (`download:start`)
`spawn` without a shell prevents *shell* injection (good — and `subprocess.ts:39` says so), but the URL is passed as a bare positional argument after the flags. yt-dlp's option parser accepts `--opt=value` as a single argv token, so a renderer-supplied "url" of `--exec=<cmd>` (or `--paths`, `--config-locations`, …) is parsed as an option — and `--exec` runs an arbitrary command after download. The same class applies to spotDL's argparse. Nothing between the IPC boundary and the argv build validates that the string is a URL. Direction: in `download:resolve`/`download:start`, `new URL(input.url)` and require `http:`/`https:`; additionally pass `--` before the positional argument so nothing beginning with `-` can ever be parsed as an option. (Same validation belongs on `DOWNLOAD_SUGGEST_BACKEND` for consistency, though it's harmless there.)

### 1.5 P2P file transfer — unsolicited chunk writes = remote disk-fill

**issue (blocking):** `app/src/utility/protocols/file-transfer.ts:243-254` + `app/src/main/file-transfer/file-transfer-ipc.ts:893-944`
Walk the path: a peer opens a stream whose *first* message is `file-chunk`; the utility handler forwards it to main with no check that we ever sent a `file-request` for that sha256. In main, `handleChunkReceived` validates the hash *format*, opens/creates `.partial/{sha256}.tmp`, and writes the chunk at the peer-supplied `offset` — and only *afterwards* looks up `activeTransfers` (line 947), tolerating a miss. Consequences: any connected peer can (a) create unlimited `.tmp` files, (b) write at arbitrary offsets producing multi-GB sparse-or-real files, with no bound tied to `totalBytes` and no per-peer quota. The 500MB `MAX_FILE_SIZE` is only enforced against *declared* sizes at request/header time, never against actual received bytes. Direction: reject any chunk whose sha256 has no `pending`/`transferring` entry in `activeTransfers`, and reject `offset + chunk.length > transfer.totalBytes` before the write. Both checks are five lines and close the hole completely. *(Note: this file is inside the P2P-protocol boundary the agentic-work policy reserves for humans — this is a finding for the human owner, not something a lane should auto-fix.)*

### 1.6 `ws` is locked below the CVE-2026-45736 fix

**issue (blocking, trivial fix):** `app/package-lock.json` (ws 8.19.0), `relay/package-lock.json` (ws 8.20.0)
CVE-2026-45736 (information disclosure) is fixed in ws **8.20.1**; both lockfiles pin below it even though the ranges (`^8.19.0` / `^8.20.0`) allow the fix. The companion server and relay tunnel are network-listening consumers of this library. Direction: `npm update ws` in both workspaces before merge. Links in [[#Dependency review]].

---

## 2. High-priority debt (ticket before or immediately after merge)

**issue:** `app/src/main/companion/companion-server.ts:325,177-179` — **[[Companion-Client|Companion server]]: no auth, host by display name.** The HTTP+WS server binds `0.0.0.0` with no join token; anyone on the LAN gets the full session snapshot, and `isHost` is granted by case-insensitively matching the *display name* of the host participant — i.e., host impersonation is typing the host's name. The relay tunnel compounds it: `relay/companion-tunnel.mjs:227-232` lets any WS to `/host/<code>` *replace* the current host, and the code is the same one printed in the public phone URL (`/s/<code>`). Mitigating factors: the server is opt-in, sessions are short-lived (4h TTL), and phone capabilities are limited (reactions/time-requests). Still, the fix is small: issue a host secret at `POST /session` and require it on `/host/`; add a short join PIN to the QR payload for LAN mode. Worth doing before this feature is demoed anywhere hostile.

**issue:** `app/src/renderer/hooks/useTrackSource.ts:298-303` — **Sync loop deadlocks after unmount mid-poll.** `syncingRef.current = false` only runs in `finally` when `!cancelled`. If the effect cleans up while a poll is in flight (navigate away, toggle `enabled`), the ref — which survives across effect runs — stays `true`, and every future poll returns at the `syncingRef.current` guard (line 190). The Spotify arm silently never syncs again until full remount. Reset the ref unconditionally in `finally`.

**issue:** `app/src/main/file-transfer/file-transfer-ipc.ts:512-536` — **Cancel leaks a concurrency slot.** `FILE_TRANSFER_CANCEL` sets status `cancelled` and closes the handle but never decrements `activeAudioCount`/`activeArtworkCount` nor calls `processQueue()` (compare the complete path at `:988-996` and `failTransfer` at `:1126-1133`). With `MAX_CONCURRENT_AUDIO = 1`, a single cancelled audio transfer stalls the entire audio queue until some unrelated transfer completes or errors.

**issue:** `app/src/renderer/stores/navigation-store.ts:93-102` + `app/src/shared/session-interfaces.ts:52` — **The playback "mutex" is local-only.** `playbackOwnerId` now drives real UI (`App.tsx:24`, `SessionView.tsx:178,271`) — genuine progress from June's schema-only state — but there is no protocol message propagating hand-off/take between peers (nothing in `shared/core/protocol.ts` mentions playback ownership). Each participant seeds their own `sessionState`, so two peers can both render "you own playback" and both drive Spotify Connect. The UI now *implies* mutual exclusion that doesn't exist — the exact "silent stub" failure mode called out in the brief. Either replicate ownership over the session protocol or label the control host-local in the UI until it is.

**issue:** `app/src/main/downloader/downloader-ipc.ts` (lane `feat/audio-acquisition-hardening`, handler at the `DOWNLOAD_SET_BACKEND_PATH` registration) — **Renderer sets the executable main will spawn.** `setBackendPath` persists any string; `getBackend` then spawns it. As a user-facing setting it's legitimate (point at your own yt-dlp), but as an IPC primitive it converts renderer compromise into arbitrary-binary execution with zero friction. Gate it: require the path to come from `dialog:open-file`, or at minimum `fs.stat` it, require it be a regular file, and confirm via a native dialog in main.

**issue:** `app/src/main/file-transfer/file-transfer-ipc.ts:802-830` — **Serving by sha256 ignores `sharingState`.** Manifests are deny-by-default (nice — see [[#Worth keeping]]), but `handleIncomingRequest` serves any sha256 present in the hash cache regardless of whether sharing is enabled, and disabling sharing doesn't revoke previously-learned hashes. Hash entropy makes blind guessing impractical, but the authorization model is "knowing the name of the file" — check `sharingState` (or a served-hashes allowlist built at manifest time) before streaming.

**issue:** `app/src/renderer/hooks/useTrackSource.ts:27` — **2-second Spotify polling.** 30 snapshot requests/min per active session, indefinitely. The resilience lane means a 429 now backs off correctly, but the pressure source remains. Consider 10–15s with the existing snapshot short-circuit; the UX difference in a listening session is negligible.

**issue:** `app/src/main/companion/companion-server.ts:431-436` vs `:565-616` — **Relay phones never receive time-request acks.** Relay-side joins register callbacks with ids `relay-${displayName}` / `'relay-phone'`, but `sendTimeRequestAck(clientId)` looks up the `clients` map, which only contains local-LAN clients — the ack silently vanishes for tunneled phones. Either register relay phones as tracked clients or route acks through `sendToRelay`.

**issue:** `cd app && npm run typecheck` is red on `qa/wave1` — every error is environmental (`node_modules` `.d.ts` resolution + `vite.config.ts` under the current `moduleResolution`), zero source errors. That's arguably worse than a real failure: the gate trains people to ignore red. `"skipLibCheck": true` plus `moduleResolution: "bundler"` for the vite config context should turn the gate green and trustworthy. Similarly `npm run lint` now runs (thank you, lint lane) but reports **59 errors / 16 warnings** — mostly `no-explicit-any` and unused vars across ~28 files. Burn this down or the gate stays decorative.

---

## 3. Notable smaller findings

- **question:** `app/src/main/downloader/downloader-ipc.ts:243-248` — `download:cancel` cancels *every* backend's active process, while events are carefully correlated by `downloadId`. Was global cancel a deliberate v0 simplification? If concurrent downloads are intended (the fire-and-forget loop at `:193` suggests they are), the shared `activeProcess` singleton per backend (`spotdl-backend.ts:22,102`) will also cross-cancel and interleave — worth a per-download process handle.
- **suggestion:** `service/downloader/subprocess.ts:244-250` — the POSIX SIGKILL fallback timer isn't cleared when the process exits within the 2s grace window; harmless today, but `unref()` the timer or clear it on `close` to avoid surprising anyone who adds shutdown-ordering logic later.
- **suggestion:** `app/src/main/file-transfer/file-transfer-ipc.ts:854` — every chunk crosses utility→main as base64 inside JSON (+33% size, plus string churn at 64KB per message). `UtilityProcess.postMessage` supports transferable/structured data; fine for v0, but note it as the first profiling suspect for large transfers.
- **nit:** `app/src/renderer/db/services/track-sink.ts:16-17` — the doc comment cites `.claude/cycle/impl-notes.md`, which is gitignored (mvp `39b2413`); the reference dangles for anyone reading the file cold. Inline the one-sentence rationale instead.
- **nit:** `app/src/main/companion/companion-server.ts:151-167` — join "reconnect" adopts any existing client with the same displayName whose socket isn't OPEN; two guests with the same name will merge identities across reconnects. Cheap fix: reconnect token per client id.
- **note:** `app/src/main/downloader/downloader-ipc.ts:10` imports `service/downloader` source directly into the Electron main bundle. It works (tsup inlines it), but `/service` is documented as a standalone helper service — today it's really a library folder for the app. Fine, but say so in the README/architecture doc before someone tries to deploy it.
- **note:** `service/src/server.ts` remains the pre-existing broadcast-to-all signaling stub — unchanged and unused by the downloader path; no findings beyond what's already documented.
- **note:** [[P2P-Testing|test-peer]] additions (`protocols.js`, `session-store.js`) are dev tooling: in-memory, string-compare LWW mirroring the *old* renderer semantics. After the replication lane, the test peer's LWW (`session-store.js:56-62`) no longer matches the app's skew-aware version — worth syncing so the harness exercises the real semantics.

---

## 4. Worth keeping

- `app/src/main/file-transfer/file-transfer-ipc.ts:58-132` — `sanitizeFilename` + `isValidSha256` + `assertPathContained` with Windows case-folding, plus post-sanitization containment re-checks at `:1030` ("defense in depth" and it actually is). This is the pattern the rest of main.ts should be held to — 1.2 and 1.3 above are fixable by *reusing this file's own helpers*.
- `app/src/main/file-transfer/file-transfer-ipc.ts:751-770` — deny-by-default manifest serving with an explicit empty-manifest response. Correct default posture for P2P sharing.
- `app/src/renderer/db/lww.ts` (replication lane) — the `DEVICE_LOCAL_FIELDS` single-source-of-truth (`schemas.ts:15-32`) shared between the sender-strip and the tie-break projection is exactly how you prevent convergence drift, and the comment explaining the oscillating-divergence failure mode is documentation other projects would kill for.
- `app/src/main/spotify/spotify-errors.ts` + `spotify-resilience.ts` (resilience lane) — closed error taxonomy, transport-only retry layer, single 401-refresh-retry with no blind loop, `Retry-After` honored exactly. The June audit's "no HTTP status discrimination" is properly dead.
- `app/src/renderer/utils/turn-helpers.ts:18-30` — deriving turn state from the actual track tail instead of stored counters removes a whole class of counter-drift bugs and shrinks the old turn-advance race window by design rather than by locking.
- `service/downloader/subprocess.ts:15-33,39` — process registry + `killAll()` on quit, spawn-not-exec with the rationale in a comment, Windows tree-kill for ffmpeg children. Solid infra.
- Audio-hardening lane's sentinel-marker fix (`ytdlp-backend.ts`, `FILEPATH_MARKER`) — replacing "any bare line is probably the filepath" with an unambiguous marker is the right kind of paranoia, and the fixture-driven backend tests (`__tests__/helpers/fixture-process.ts`) test behavior against captured real output rather than asserting the implementation back at itself.

---

## 5. Lane reviews (wave-1, integrated in `qa/wave1`)

All five lanes branch from `26c8716`; all five merges into `qa/wave1` were textually clean (`git show --cc` shows zero conflict-resolution hunks; the only file touched by two lanes, `preload.ts`, merged in disjoint regions). 340/340 tests pass on the integrated tree.

### 5.1 `chore/fix-dev-env-lint` — **MERGE**
One commit, renames `eslint.config.js → .mjs`. Verified: lint executes on `qa/wave1` (previously crashed on ESM-in-CJS). It *reveals* 59 errors — that's the gate working, not the lane failing.

### 5.2 `feat/track-sourcing-manual` — **MERGE**
Claims to un-stub Manual TrackSource ([[epic-track-sourcing]]); it does. `track-sink.ts` is a clean source-agnostic normalize→write tail, the manual arm returns a working `addTrack` (`useTrackSource.ts` post-lane), and the P2P arm is *explicitly* left null with a scope note — honest, not silent. Turn advancement deliberately deferred to the derive-from-data helpers, dodging the old double-advance race. Tests are mock-based mapping assertions — acceptable for a pure mapping function, though they'd catch nothing about RxDB behavior; the integration path is covered only by manual QA. Nit: dangling impl-notes reference (§3).

### 5.3 `fix/spotify-resilience` — **MERGE**
Directly retires the "naive error handling, no 403/429/retry" debt item ([[epic-spotify-resilience]]) — verified against the June list, genuinely fixed (taxonomy, timeout, bounded backoff, Retry-After, proactive + reactive-once token refresh, and the old `main.ts:498` token-expiry TODO replaced with a real event bridge). The degraded-mode *renderer transition* (`playbackProvider: 'none'`) is explicitly out of lane with a tracking pointer — ticket it so the `spotify:playback-degraded` event doesn't become a message nobody listens to. The 418 added test lines are behavior-level (status→kind mapping, retry counts under injected clock, refresh-once semantics) — no implementation-mirroring smells found.

### 5.4 `feat/audio-acquisition-hardening` — **MERGE** (with the §2 caveat)
Delivers what it claims ([[epic-audio-acquisition-hardening]]): per-backend custom exec paths, presence UX, and real backend test coverage; also fixes a genuine latent bug (`InputType` `'spotify-id'` vs `'spotify-ids'` mismatch that made spotDL's capability unselectable — `service/downloader/backend.ts:1-5`). Fixtures are captured real tool output; scratch impl-notes were dropped from the branch (`8b8de34`) as they should be. The one thing to fix promptly is the unvalidated `set-backend-path` primitive (§2) — it *widens* the same renderer→main trust gap flagged in §1, and this lane is where the gate belongs.

### 5.5 `fix/replication-reliability` — **MERGE, pending explicit human sign-off (P2P policy)**
This lane touches `app/src/utility/protocols/*` and `p2p-service.ts` — inside the boundary the repo reserves for human-approved work, so the recommendation is conditional on that approval by construction. On the merits it's the strongest lane, and it verifiably retires four June debt items ([[epic-replication-reliability]]):
- **In-memory checkpoints → durable** (`checkpoint-store.ts`): debounced JSON in userData, corrupt-file → full-resync degradation. The userData path is *re-derived* from platform conventions because the utility process can't call `app.getPath` — correct fallbacks, but it silently diverges if the Electron app name ever changes; the env-var override exists, so have main inject the exact path at spawn time and the heuristic becomes dead code (suggestion, not blocker).
- **Pull-responses were dropped on the floor → delivered** (`replication.ts`, `OnPullResponse`): the lane's own comment documents that pulls previously "silently achieved nothing" — matches what the June audit suspected, and the fix is real.
- **String-LWW → skew-aware epoch-ms with convergent tie-break** (`lww.ts`): I walked the tie-break both directions — the `NON_CONTENT_KEYS` projection makes `contentKey(incoming.data)` and `contentKey(existing.toJSON())` provably symmetric given the sender-strip, and "equal keys → keep existing" is stable. Accepted residual: wall-clock trust (documented, CRDT-phase-2). One edge worth a test: a doc whose `updatedAt` parses to exactly `0` epoch falls through to `addedAt` — fine, but only by accident of the `> 0` guard; pin it.
- **5s silent-drop pull timeout → 15s echo-checkpoint-back** (`p2p-config.ts` REPLICATION.PULL_TIMEOUT): the responder no longer advances the requester's checkpoint on timeout, so missed changes re-pull. Correct.
- **Backpressure** (`file-transfer.ts`, `sendWithBackpressure` + per-key send chains): respects `stream.send() === false` + `onDrain()`, serialized per serve key with tail-cleanup of the chain map. Sound. Note it does *not* address the unsolicited-chunk hole (§1.5) — that wasn't its scope, but don't let this lane's "file-transfer hardening" label create the impression it did.
- Reconnection (`relay-manager.ts` rewrite, `backoff.ts`): jittered exponential backoff + liveness heartbeat for half-open links. Tests exercise backoff math and reconnect state transitions via the harness rather than asserting internals.

### Merge order
The order already used to build `qa/wave1` is right: lint config first (so every subsequent lane is lintable), then the three independent feature lanes, replication last (largest surface, easiest to drop if the human P2P sign-off stalls). No rebuild needed unless a lane is dropped.

---

## 6. Dependency review

New/changed since `main` (lockfile-verified). Per the hard rule, each got a research pass:

| Package | Where | Health | Call |
|---|---|---|---|
| `ws` ^8.19.0 / ^8.20.0 | app, relay | Healthy, massive usage; **CVE-2026-45736 fixed in 8.20.1 — both lockfiles below it** | **Buy, but bump now** (§1.6). No platform-native alternative for a Node WS *server* |
| `music-metadata` ^11.12.3 | app | Healthy — 11.14.0 released days ago, active maintainer (Borewit) | **Buy.** Hand-rolling tag parsing across MP3/FLAC/M4A is a multi-month trap; this is the ecosystem standard |
| `qrcode` ^1.5.4 | app | Stale-ish — 1.5.4 is ~2 years old, though QR encoding is a frozen spec | **Buy, watch.** Tiny surface (one invite QR). If it ever bites, `uqr` or server-side generation are drop-ins; not worth churn now |
| `@libp2p/dcutr` ^3.0.13 | app | Part of the maintained js-libp2p suite (same release train as existing deps) | **Buy.** Hole-punching via existing relay connection is exactly the NAT story the relay architecture wants; hand-rolling DCUtR is a non-starter |
| `@libp2p/crypto` ^5.0.0 | relay | Core libp2p package | **Buy** (peer-id persistence for stable relay identity — right approach) |
| `vitest` ^2.0.0, `@playwright/test` ^1.58.2 | app dev | Vitest 2.1.9 resolves; note vitest 3.x has been current since early 2025 — plan the major bump before the gap grows | **Buy.** Standard choices; no notes |
| `chalk` ^5.3.0, `@multiformats/multiaddr` | test-peer | Dev tooling | Fine |

Build-vs-buy overall: nothing here reinvents a platform capability, and nothing hand-rolled in the branch (debounce, backoff, LWW, path containment) has an off-the-shelf replacement that would carry its weight — the hand-rolls are small, tested, and domain-specific. The one *reinvention* smell checked and cleared: `spawnLines`'s async line generator duplicates `readline.createInterface({ input: proc.stdout })`, but the custom version integrates the inactivity timeout and partial-line flush in a way readline wouldn't simplify — keep it.

Sources: [ws advisory/CVE-2026-45736](https://www.sentinelone.com/vulnerability-database/cve-2026-45736/), [ws on npm](https://www.npmjs.com/package/ws), [ws on Snyk](https://security.snyk.io/package/npm/ws), [music-metadata](https://www.npmjs.com/package/music-metadata) ([repo](https://github.com/Borewit/music-metadata), [releases](https://github.com/borewit/music-metadata/releases)), [node-qrcode](https://github.com/soldair/node-qrcode) ([npm](https://www.npmjs.com/search?q=QRcode)), [@libp2p/dcutr](https://www.npmjs.com/package/@libp2p/dcutr) ([libp2p DCUtR docs](https://libp2p.io/docs/dcutr/), [spec](https://github.com/libp2p/specs/blob/master/relay/DCUtR.md)).

---

## 7. Verification (reviewer runs, on `qa/wave1` @ `f103563`)

| Gate | Result | Detail |
|---|---|---|
| `npm test` (vitest) | ✅ **340/340**, 23 files | Includes all lane suites; purchase-resolver suite is slow (~7.5s) due to real throttle sleeps — consider injecting the clock |
| `npm run lint` | ⚠️ runs; **59 errors / 16 warnings** | Config fixed by lint lane; errors are pre-existing debt (`no-explicit-any`, unused vars) across ~28 files |
| `npm run typecheck` | ❌ | All failures environmental (node_modules `.d.ts` + `vite.config.ts` under current `moduleResolution`); zero source errors. Fix config so the gate means something (§2) |
| `npm run test:e2e` (playwright) | not run | Requires a built app + display; left to the parallel manual-QA track |
| Merge inspection | ✅ | 5 merges, zero conflict-resolution hunks; no semantic conflicts found between lanes (preload merged disjointly; resilience fetch changes compose with mvp IPC handlers; replication LWW composes with mvp session code) |
| Migration check | ✅ | `trackSchema` v3 / `playlistSchema` v5 match their strategy chains (`database.ts:88-190`); v2 track backfill `source: spotifyId ? 'spotify' : 'manual'` is sane; new-field-as-`undefined` writes are correct for docs that predate the fields |

---

## Verdict & punch list

### **NOT YET** — for `qa/wave1 → main`

The five lanes are all mergeable (replication pending its required human P2P sign-off) and materially improve the branch. What blocks the merge to `main` is the mvp-side main-process trust boundary — six findings, all cheap, none architectural:

1. ✅ **closed 2026-08-03** — **Remove/harden the `exec('start …')` path** in `shell:open-external` — `main.ts:911-933` (§1.1). The `exec` branch is gone; all allowed protocols go through `shell.openExternal` behind a shape allowlist (`app/src/main/ipc-guards.ts`). `main.ts` no longer imports `child_process`. Closed alongside it: `shell:open-path`, which this review missed and which is the sharper hole (`shell.openPath` on a file *executes* it) — now directories only, app-owned or dialog-approved.
2. ✅ **closed 2026-08-03** — **Contain `wn-art://` reads** — `main.ts:607-626` (§1.2). Contained to the artwork roots (`<documents>/WhatNext/artwork` plus the legacy `<userData>/artwork`), images only; relative traversal and absolute out-of-tree both 403. Correction to this review's wording: there is no audio consumer of `wn-art://`, so the "artwork/audio dirs" framing narrows to artwork.
3. ✅ **closed 2026-08-03** — **Gate `file:write`** to dialog-approved paths — `main.ts:781-788` (§1.3). One-shot approval recorded by `dialog:save-file` in main. The suggested `documents/WhatNext` containment fallback was **not** used: it would have violated sovereignty (#1/#2) by capping where a user may export. See [[epic-ipc-trust-boundary]] "Authority model".
4. ✅ **closed 2026-08-04** — **Validate downloader URLs + add `--` separator** before yt-dlp/spotdl argv — `downloader-ipc.ts`, both backends (§1.4). `download:resolve`/`download:start` now reject anything that is not an `http(s)` URL (or, on the live `spotify-ids` branch, a base62 Spotify id) before a backend is constructed — `app/src/main/downloader/downloader-guards.ts`. Correction to this review's wording: the `--` separator lands on **yt-dlp only**. Real spotDL 4.5.2 answers `spotdl save --save-file - -- <url>` with `unrecognized arguments: --` (all three placements fail), so its second layer is an `http(s)` shape check on the query argument instead. Closed alongside it: `set-backend-path`, listed below as a post-merge ticket — the renderer can no longer choose which executable main spawns without either a main-process file dialog or a native confirmation.
5. **Reject unsolicited/out-of-bounds file chunks** before disk writes — `file-transfer-ipc.ts:893-944` + utility handler (§1.5; human-owned P2P territory)
6. **Bump `ws` to ≥8.20.1** in app + relay lockfiles (§1.6)

Then, first tickets after merge: [[epic-session-liveness-fixes|companion auth/host-secret]] (§2), the `useTrackSource` syncingRef deadlock (§2), [[epic-file-transfer-guards|the cancel-path slot leak]] (§2), the local-only playback mutex (§2 — or relabel the UI), ~~`set-backend-path` validation (§2)~~ (pulled forward and closed 2026-08-04 with item 4), and [[epic-quality-gates|the typecheck/lint gate repair]] (§2).

Estimate for the six blockers: they share one shape — "validate at the boundary using helpers the codebase already has." A focused day, not a rework.

## Related
- [[report-260627-mvp-state-of-the-union]] — the debt list this review verifies against
- [[report-260627-issue-reconciliation]]
- [[RxDB-Replication]] — updated by the replication lane
- [[the-walled-garden-cracks]] — coordinator model context for the Spotify findings
- Follow-up specs spawned by this review: [[epic-ipc-trust-boundary]] · [[epic-file-transfer-guards]] · [[epic-session-liveness-fixes]] · [[epic-quality-gates]]

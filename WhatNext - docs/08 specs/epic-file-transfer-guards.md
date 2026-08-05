---
tags:
  - specs/p2p
  - specs/security
  - core/net/p2p/protocols
status: complete
date created: 2026-08-01
date modified: 2026-08-05
---

# Epic: File-Transfer Ingress Guards

**Status**: Complete — work items 1 & 3 landed 2026-08-04 (cycle 1); work item 2 landed 2026-08-05 (cycle 2)
**GitHub**: to be filed (plan-first)
**Depends on**: none (independent of [[epic-handshake-stabilization]]; both touch P2P but disjoint files)
**Source audit**: [[report-260801-mvp-premerge-review]] §1.5, §2 (sharingState, cancel slot leak)

> The P2P file-transfer path writes peer-supplied bytes to disk **before** checking whether we ever requested them: any connected peer can create unlimited temp files and write multi-GB data at arbitrary offsets — a remote disk-fill, and the fifth merge-blocker for mvp→main. Two adjacent authorization/lifecycle defects live in the same file: served-by-sha256 ignores `sharingState`, and cancelling a transfer leaks its concurrency slot, stalling the queue. The module's *outbound* hygiene is exemplary (`sanitizeFilename`/`assertPathContained`/deny-by-default manifests — review §4); this epic brings the inbound side up to the same standard. All three fixes are small and localized to `file-transfer-ipc.ts` + the utility forwarder.

## Problem & Current State

Citations from the 2026-08-01 review on the tree now merged as mvp `cafc6ab`; re-verify before editing.

1. **Unsolicited chunk writes (blocking)** — `app/src/utility/protocols/file-transfer.ts:243-254` + `app/src/main/file-transfer/file-transfer-ipc.ts:893-944`. A peer opens a stream whose *first* message is `file-chunk`; the utility handler forwards it to main with no check that a `file-request` for that sha256 was ever sent. In main, `handleChunkReceived` validates only the hash *format*, opens/creates `.partial/{sha256}.tmp`, writes the chunk at the peer-supplied `offset`, and only *afterwards* looks up `activeTransfers` (`:947`), tolerating a miss. Consequences: (a) unlimited `.tmp` creation, (b) writes at arbitrary offsets → multi-GB sparse-or-real files, no bound tied to `totalBytes`, no per-peer quota. The 500MB `MAX_FILE_SIZE` is only checked against *declared* sizes, never received bytes. Note: [[epic-replication-reliability|lane #54]]'s backpressure work ("file-transfer hardening") did **not** address this — it wasn't in scope.
2. **Serving ignores `sharingState`** — `file-transfer-ipc.ts:802-830`. Manifests are deny-by-default (good), but `handleIncomingRequest` serves any sha256 present in the hash cache regardless of whether sharing is enabled, and disabling sharing doesn't revoke previously-learned hashes. The authorization model degenerates to "knows the file's hash".
3. **Cancel leaks a concurrency slot** — `file-transfer-ipc.ts:512-536`. `FILE_TRANSFER_CANCEL` sets status `cancelled` and closes the handle but never decrements `activeAudioCount`/`activeArtworkCount` nor calls `processQueue()` (compare the complete path `:988-996` and `failTransfer` `:1126-1133`). With `MAX_CONCURRENT_AUDIO = 1`, one cancelled audio transfer stalls the whole audio queue.

## Goals

- No byte reaches disk unless it belongs to a transfer *we initiated*: chunk accepted only when its sha256 has a `pending`/`transferring` entry in `activeTransfers` and `offset + chunk.length <= transfer.totalBytes`.
- Serving is authorized by sharing intent, not hash knowledge: `sharingState` (or a served-hashes allowlist built at manifest time) checked before streaming.
- Cancel releases its slot and kicks the queue, symmetric with complete/fail.
- Regression tests for each: unsolicited chunk rejected, out-of-bounds offset rejected, sharing-disabled request refused, cancel→next-queued-transfer-starts.

## Non-Goals

- Renderer→main IPC validation — [[epic-ipc-trust-boundary]] (keep `main.ts` ownership there; this lane owns `file-transfer-ipc.ts` + `app/src/utility/protocols/file-transfer.ts`).
- Handshake/replication protocols — [[epic-handshake-stabilization]].
- Per-peer rate/quota accounting beyond the bounds check (nice-to-have; note as follow-up if trivial, don't expand scope).
- Base64→transferable chunk transport optimization (review §3 suggestion — profiling follow-up, not now).
- Wire-format changes: rejection = drop/close the stream, no new message types.

## Proposed Approach

1. **Guard at the utility layer** (`file-transfer.ts:243-254`): the utility process knows which requests it sent — drop `file-chunk` messages for unknown sha256s at the stream handler before forwarding to main (cheapest rejection point), closing the offending stream.
2. **Guard at main (defense in depth)** (`file-transfer-ipc.ts:893-944`): in `handleChunkReceived`, look up `activeTransfers` *first*; reject on missing entry, wrong status, or `offset + chunk.length > totalBytes` — before any `open`/`write`. Mirrors the module's own belt-and-braces style (§4).
3. **Sharing authorization** (`:802-830`): check `sharingState` in `handleIncomingRequest` before streaming; if manifest-time allowlisting is cleaner, build a served-hashes set when the manifest is generated and consult it (and clear it when sharing is disabled).
4. **Cancel symmetry** (`:512-536`): factor the slot-release + `processQueue()` tail shared by complete/fail into one helper and call it from cancel too.
5. **Tests**: unit-test `handleChunkReceived` and `handleIncomingRequest` guards directly; add a harness case for the utility-layer drop if the #54 protocol harness reaches file-transfer.

## Work Breakdown

### 1 — Reject unsolicited / out-of-bounds chunks (review §1.5) — ✅ done 2026-08-04

**Acceptance criteria.**
- [x] A `file-chunk` for a sha256 with no `pending`/`transferring` `activeTransfers` entry results in zero filesystem effects (no `.tmp` created, nothing written), at both the utility and main layers.
- [x] A chunk with `offset + length > totalBytes` is rejected before write; the transfer is failed/cleaned, not silently truncated.
- [x] Received-bytes accounting can never exceed `totalBytes` for a transfer (test with duplicate/overlapping chunks).
- [x] Legitimate multi-chunk transfers (incl. #54's backpressured sends) still pass end-to-end tests.

Landed as `app/src/main/file-transfer/chunk-guards.ts` (pure, per-rule tested) called at the top of `handleChunkReceived`, plus an outstanding-request check on the utility receive loop. Two deltas from the plan above:

- The utility layer's inbound **first-message `file-chunk` branch was deleted, not guarded** — no known peer ever produces one (both the app and `test-peer` serve chunks back on the requester's stream). User ruling 2026-08-04: "dead code is dead code." A design-review issue on file-transfer stream-opening semantics stands in its place (filed 2026-08-05 as #65).
- A third guard the plan didn't name: a chunk is dropped when its **sender is not the peer the transfer belongs to**. Wrong-peer and unsolicited chunks *drop* rather than fail — failing on them would hand any connected peer a way to kill our downloads. Only the peer we asked can fail a transfer, by overrunning its own declared size.

### 2 — `sharingState` authorization — ✅ done 2026-08-05

**Acceptance criteria.**
- [x] With sharing disabled, a request for a previously-served sha256 is refused (test).
- [x] Disabling sharing takes effect for requests arriving after the toggle (no revocation of in-flight transfers required — document this).
- [x] Manifest behavior unchanged (deny-by-default preserved).

Landed as `app/src/main/file-transfer/serve-guards.ts` — a `ServedHashRegistry` plus a pure `evaluateServeRequest`, called at the top of `handleIncomingRequest` before any `stat` or `createReadStream`.

**The open sha256→playlist question was ruled by the user on 2026-08-05: option B, the manifest-time allowlist** ("B seems to be more defensive approach; extra consent requirements are reasonable"). Consent is therefore *per exchange* — a hash is servable because we handed it to a peer in a manifest while sharing was on, not because it sits in the hash cache. That distinction matters more than it looks: `HashCache` persists to `hashes.json` and `register()` adds every file *received* from a peer, so the pre-fix servable set was every file this install had ever hashed, across all playlists and past sessions, surviving restarts even though sharing intent does not.

Three notes on the implementation:

- **Recording takes the manifest's own `FileEntry[]`**, captured in `handleManifestRequest` right after `buildManifest` returns (the one point where sharing has been confirmed and the published set is known). Passing entries rather than a caller-built hash list means all three entry types — audio, per-track artwork, playlist cover art — are allowlisted by construction, with no per-type branch to forget.
- **The registry is keyed by playlist and `record` replaces rather than merges.** Per-playlist keying means disabling sharing for one playlist cannot withdraw a hash another shared playlist also published; replace-on-record means a file dropped from the playlist stops being servable once a fresh manifest goes out.
- **Refusal is byte-identical to not-found** (`No file found for sha256: …`), so refusals cannot be used to enumerate what the user holds. The rejection *reason* is carried in the verdict for local logs only — the wire sees one answer. Unauthorized hashes are refused before the hash-cache lookup, so an unauthorized request never learns whether we hold the file. Every serve-path refusal — including the pre-initialisation branch, which is unreachable in practice — goes through one `refuseServe` helper so the messages cannot drift apart.
- **`sharingState` is re-checked after `buildManifest` resolves** (found in review, fixed 2026-08-05 before the epic closed). `buildManifest` stats and hashes every file, so it yields for real I/O; the `set-sharing` handler is synchronous and runs `revoke()` to completion inside that window. Without the re-check, a host who toggled sharing off *during* a manifest build would have had the build's `record()` silently re-authorize the playlist they had just withdrawn — and the peer would have received a real manifest for it. A revoke landing mid-build now wins: the build is discarded and the peer gets the same deny-by-default empty manifest as a request that arrived with sharing already off. Nothing awaits between the re-check and the response, so the decision cannot go stale. Regression test: `file-transfer-ipc.test.ts` "does not re-authorize a playlist whose sharing was revoked mid-manifest-build".

### 3 — Cancel releases its slot — ✅ done 2026-08-04

**Acceptance criteria.**
- [x] Cancelling an active audio transfer decrements the counter and starts the next queued audio transfer (test with `MAX_CONCURRENT_AUDIO = 1`).
- [x] Complete/fail/cancel share one slot-release path (no triple-maintenance).

Implemented as *ownership* rather than a shared decrement: `slotHolders` records which counter a transfer's slot came from when `processQueue` dispatches it, and `releaseSlot(sha256)` gives it back exactly once. This also closes a pre-existing hole the plan didn't spot — complete and fail could each decrement for the same transfer, and a transfer that failed while still queued decremented a slot it never took (`Math.max(0, …)` floored the counter but let real over-concurrency through). Cancelling (or failing) a still-queued transfer now also removes it from `downloadQueue`, without which the new chunk guard would have created a fresh stall: a cancelled request would be dispatched, take a slot, and never see a complete/error to release it.

## Epic Acceptance Criteria (Definition of Done)

- [x] Review punch-list item 5 closed; §2 sharingState + cancel-leak items closed. *(item 5 and the cancel leak closed 2026-08-04; §2 sharingState closed 2026-08-05.)*
- [x] No wire-format/message-type changes; `.partial` resume behavior for legitimate transfers unchanged. *(A code path was removed — the inbound chunk-first branch — but no message type was; the wire format is untouched. Cycle 2 added no messages either: a refused serve travels the existing `file-error` path.)*
- [x] All guards covered by negative-path tests; `cd app && npm test` green; no new lint/typecheck failures. *(Cycle 2: 553 tests / 39 files green, up from cycle 1's 536/38; lint and typecheck unchanged from the known-red baseline of 55 errors + 16 warnings and 16 `tsc` errors, all in `node_modules`/`vite.config.ts` — see [[epic-quality-gates]].)*
- [x] [[report-260801-mvp-premerge-review]] updated (punch list checked off).

## Post-Completion Follow-Up — Cycle 3: Receive-Path Lifecycle (2026-08-05)

*This epic stayed complete; cycle 3 is a follow-up on two defects cycle 1 flagged and cycles 1–2 deferred. Trust (cycle 1) and authorization (cycle 2) were the boundaries; this is the **lifecycle** underneath them — who owns the partial-file descriptor, and whether a resumed transfer is subject to the concurrency accounting cycle 1 introduced.*

**What was wrong.**

- **Partial-handle open race.** `handleChunkReceived` is dispatched fire-and-forget (`void handleChunkReceived(...)`), so two chunks for one sha256 could both read `partialHandles.get()` as `undefined`, both open a descriptor, and the second `set` orphaned the first. `closePartialHandle` closes only what the map holds, so the orphan leaked for the process's lifetime — and on Windows an orphaned descriptor on `{sha256}.tmp` can block the rename that finishes the transfer.
- **The same cache reopened after teardown.** `handleTransferComplete` closed the handle but only flipped `transfer.status` to `'verifying'` *after* an await. A chunk still in flight saw `transferring`, passed the cycle-1 guard, and reopened a descriptor — recreating the `.tmp` while verification and the rename were running. `abortTransfer`'s flip-status-then-teardown ordering was the model followed.
- **Resume bypassed slot accounting.** `resumeIncompleteTransfers` posted `FILE_TRANSFER_REQUEST_FILE` straight to the utility process. Slots are only taken in `processQueue`, so a resumed transfer never entered `slotHolders` and `MAX_CONCURRENT_AUDIO`/`MAX_CONCURRENT_ARTWORK` simply did not apply to it: every incomplete transfer for a reconnecting peer started at once, and a transfer still sitting in `downloadQueue` was requested by resume *and* dispatched again by `processQueue` — the utility's receive registry is keyed `peerId:sha256`, so the second request overwrote the first and orphaned its stream.

**What changed.** All of it inside `file-transfer-ipc.ts`; no wire format, no message types, no new module.

- `partialHandles` holds the *promise* of the open, stored synchronously before the first await, so a concurrent chunk joins the open in progress instead of racing it — one descriptor per transfer, no orphans. The map entry doubles as the transfer's liveness token: `closePartialHandle` deletes it synchronously, and `handleChunkReceived` re-checks identity after its await (the same shape as cycle 2's post-`buildManifest` sharing re-check) before writing. A close is idempotent; a chunk that loses the identity check is dropped, not failed.
- `handleTransferComplete` flips the status before anything is awaited.
- `abortTransfer` starts the close itself rather than relying on `failTransfer`'s fire-and-forget `void closePartialHandle(...)`. **Found while writing the tests, not predicted by the brief:** because that close was not awaitable, `abortTransfer`'s own `await closePartialHandle(...)` found an already-emptied map and returned immediately, letting the unlink race an open still in flight (`open(path, 'a')` *creates*). Awaiting the close it started closes the last window in which a `.tmp` could outlive the transfer that owned it.
- `resumeIncompleteTransfers` enqueues instead of dispatching, and `downloadQueue` entries carry `{peerId, sha256, type, offsetBytes}` rather than a whole `FileEntry` (resumes have an `ActiveTransfer`, not a `FileEntry`; the queue only ever used those four fields).

**Resume ordering, as shipped.** Resumed transfers go to the **front** of the queue — user ruling 2026-08-05, "finish partials first". The resumed set is unshifted as a block, so it keeps its own relative order while collectively jumping ahead of not-yet-dispatched fresh requests. A resumed transfer is re-queued via `removeQueuedRequests` + `releaseSlot` before being unshifted, so N handshake-completes for one peer leave exactly one queue entry and at most one slot per transfer. A queued resume is marked `pending`, not `transferring` — the renderer treats both as active, and the status now says where the transfer actually is.

**Deliberate deviation.** A transfer that already *holds* a slot is re-requested on a second handshake-complete rather than skipped. Skipping would be strictly idempotent, but a peer that vanishes mid-transfer is never reported to main: `cleanupPeerStreams` closes the receive stream on `peer:disconnect` and `handleIncomingFileStream` simply breaks out of its read loop with no `onFileError`, so main keeps the transfer at `transferring` and keeps its slot. Resume is the only path that can un-stick it, and with `MAX_CONCURRENT_AUDIO = 1` a skipped resume would strand the audio queue permanently. The slot is handed over, never doubled. **The proper fix is a `CONNECTION_CLOSED` hook** telling the file-transfer module to release slots and re-mark that peer's transfers `pending`; that needs a call site in `main.ts`, which cycle 3's brief put out of scope. Worth a follow-up cycle.

**Tests** — `app/src/main/file-transfer/__tests__/receive-lifecycle.test.ts` (10 tests, own fixture file: it spies on `fs.promises.open` and drives per-peer resume, which would perturb `file-transfer-ipc.test.ts`'s queue accounting). Concurrency is exercised by interleaving message dispatch, never by timing. Nine of the ten fail against the pre-fix implementation. 563 tests / 40 files green, up from 553/39.

**Known residual.** Nothing cleans up after `cleanupStalePartials` at startup if a `.tmp` were ever resurrected — but the awaited-close ordering means an open can no longer straddle the rename or unlink, so no speculative unlink was added (brief open question 2).

## Risks & Open Questions

- ~~**Resume semantics**~~ — resolved 2026-08-04 by reading the code: `loadTransferState()` rehydrates `pending`/`transferring` transfers from `.partial/transfers.json` before any peer can connect, and `cleanupStalePartials()` deletes orphan `.tmp` files, so "must be in `activeTransfers`" does not break resume. Covered by the rehydrate fixture in `app/src/main/file-transfer/__tests__/file-transfer-ipc.test.ts`.
- ~~**Utility vs main knowledge**~~ — resolved 2026-08-04: `requestFile` registers `activeReceiveStreams[peerId:sha256]`, so the utility-layer drop is a real guard, not best-effort. It now also requires the chunk to arrive on the *same stream* we opened for that request.
- **Stream-opening semantics (new, cycle 1)**: deleting the inbound first-message `file-chunk` branch tightens what we accept on the wire — both known implementations are unaffected, a hypothetical third-party peer relying on it would fail. The open question (does a peer opening a stream ever need to lead with a chunk; what is libp2p best practice for a chunked-transfer protocol) is carried by the design-review issue rather than by the code — filed 2026-08-05 as #65.
- **Accepted limitation (cycle 2, user ruling 2026-08-05): served files fail closed after a host restart.** The served-hashes allowlist is in-memory, exactly like `sharingState` itself. After the host restarts the app — or for any peer that resumes a transfer without re-fetching a manifest — served-file requests are **refused until a fresh manifest is fetched under active sharing**. Nothing in the renderer re-fetches manifests on reconnect today (`app/src/renderer/hooks/useFileTransfer.ts:103-105` is caller-driven) and nothing re-enables sharing after a restart (`SessionView.tsx:301-316` is a manual host toggle over non-persistent Zustand state), so resume-across-host-restart of *served* files is parked. This is **accepted MVP behavior, not a defect**: torrent-style auto-resume-seeding is unnecessary at our peer count, and the failure mode is closed rather than open. The follow-up that would lift it is **"sharing intent / manifest re-fetch on reconnect"** — persisting sharing intent and having the requesting peer re-fetch a manifest when a session reconnects. Nominated as a candidate for cycle 3's brief (alongside the two receive-path defects), where it can be accepted or deferred. No GitHub issue filed (plan-first). **Ruled OUT of cycle 3 on 2026-08-05**: it is renderer-layer work (`SessionView` / `useFileTransfer` / persisted sharing state) that would *lift* an accepted MVP limitation, whereas cycle 3 was main-process receive-path lifecycle — bundling them would mix a feature with a defect fix across two layers. Still open; scope it as its own cycle after wave 2, if at all.
- **In-flight serves are not revoked.** Toggling sharing off applies to requests arriving after the toggle; a stream already being served runs to completion. Documented in `serve-guards.ts` and `handleIncomingRequest`, deliberately out of scope for cycle 2.
- **Fallback if option B proves too tight in live QA**: relaxing to option A ("any sharing-enabled playlist contains this hash") is a small contained change — swap the registry's `record`/`revoke` for a lookup over `sharingState` + the playlist's registered tracks. The verdict function and its call site would not move.
- **Ordering with [[epic-handshake-stabilization]]**: independent files, but live QA of this lane is easier after #58 lands (stable sessions). Code can proceed in parallel; schedule *live* verification after handshake stabilization.

## References

- [[report-260801-mvp-premerge-review]] §1.5, §2, §3 (base64 note), §4 (house pattern)
- Code (line numbers as of the 2026-08-01 audit; `epic-ipc-trust-boundary` has since shifted them): `app/src/main/file-transfer/file-transfer-ipc.ts:58-132,512-536,802-830,893-947,988-996,1126-1133`; `app/src/utility/protocols/file-transfer.ts:243-254`
- Cycle 1 code: `app/src/main/file-transfer/chunk-guards.ts` (+ `__tests__/chunk-guards.test.ts`, `__tests__/file-transfer-ipc.test.ts`), `app/src/main/file-transfer/file-transfer-ipc.ts`, `app/src/utility/protocols/file-transfer.ts`
- Cycle 2 code: `app/src/main/file-transfer/serve-guards.ts` (+ `__tests__/serve-guards.test.ts`, `__tests__/file-transfer-ipc.test.ts`), `app/src/main/file-transfer/file-transfer-ipc.ts`
- Cycle 3 code (post-completion follow-up): `app/src/main/file-transfer/file-transfer-ipc.ts` (+ `__tests__/receive-lifecycle.test.ts`)
- Related: [[epic-replication-reliability]] (backpressure, landed), [[epic-ipc-trust-boundary]]

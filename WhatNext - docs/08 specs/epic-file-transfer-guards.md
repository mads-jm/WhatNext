---
tags:
  - specs/p2p
  - specs/security
  - core/net/p2p/protocols
status: draft
date created: 2026-08-01
date modified: 2026-08-01
---

# Epic: File-Transfer Ingress Guards

**Status**: Draft
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

### 1 — Reject unsolicited / out-of-bounds chunks (review §1.5)

**Acceptance criteria.**
- [ ] A `file-chunk` for a sha256 with no `pending`/`transferring` `activeTransfers` entry results in zero filesystem effects (no `.tmp` created, nothing written), at both the utility and main layers.
- [ ] A chunk with `offset + length > totalBytes` is rejected before write; the transfer is failed/cleaned, not silently truncated.
- [ ] Received-bytes accounting can never exceed `totalBytes` for a transfer (test with duplicate/overlapping chunks).
- [ ] Legitimate multi-chunk transfers (incl. #54's backpressured sends) still pass end-to-end tests.

### 2 — `sharingState` authorization

**Acceptance criteria.**
- [ ] With sharing disabled, a request for a previously-served sha256 is refused (test).
- [ ] Disabling sharing takes effect for requests arriving after the toggle (no revocation of in-flight transfers required — document this).
- [ ] Manifest behavior unchanged (deny-by-default preserved).

### 3 — Cancel releases its slot

**Acceptance criteria.**
- [ ] Cancelling an active audio transfer decrements the counter and starts the next queued audio transfer (test with `MAX_CONCURRENT_AUDIO = 1`).
- [ ] Complete/fail/cancel share one slot-release path (no triple-maintenance).

## Epic Acceptance Criteria (Definition of Done)

- [ ] Review punch-list item 5 closed; §2 sharingState + cancel-leak items closed.
- [ ] No wire-format/message-type changes; `.partial` resume behavior for legitimate transfers unchanged.
- [ ] All guards covered by negative-path tests; `cd app && npm test` green; no new lint/typecheck failures.
- [ ] [[report-260801-mvp-premerge-review]] updated (punch list checked off).

## Risks & Open Questions

- **Resume semantics**: if partial-file resume across app restarts is intended (`.partial` dir suggests it), the "must be in `activeTransfers`" guard needs transfers rehydrated on startup or resume re-requested — verify current resume behavior before choosing rejection semantics.
- **Utility vs main knowledge**: confirm the utility process actually tracks outstanding requests (it may currently be stateless-forwarding); if not, the main-layer guard is the primary and the utility drop is best-effort.
- **Ordering with [[epic-handshake-stabilization]]**: independent files, but live QA of this lane is easier after #58 lands (stable sessions). Code can proceed in parallel; schedule *live* verification after handshake stabilization.

## References

- [[report-260801-mvp-premerge-review]] §1.5, §2, §3 (base64 note), §4 (house pattern)
- Code: `app/src/main/file-transfer/file-transfer-ipc.ts:58-132,512-536,802-830,893-947,988-996,1126-1133`; `app/src/utility/protocols/file-transfer.ts:243-254`
- Related: [[epic-replication-reliability]] (backpressure, landed), [[epic-ipc-trust-boundary]]

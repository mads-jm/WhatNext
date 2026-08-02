---
tags:
  - specs/p2p
  - core/net/p2p/protocols
  - data/rxdb/replication
status: draft
date created: 2026-08-01
date modified: 2026-08-01
---

# Epic: Handshake Stabilization

**Status**: Draft
**GitHub**: #58
**Depends on**: none (test-peer framing fix already landed on mvp: `5534cd9`)
**Source audit**: live QA 2026-08-01 (issue #58); [[report-260801-mvp-premerge-review]] §3 (test-peer LWW note)

> Live QA on the integrated tree found that the [[Handshake-Protocol|handshake]] responder replies to **every** incoming handshake message — including responses — so two peers ping-pong handshakes forever, and each "completed" handshake re-bootstraps replication, producing a pull storm. This is **pre-existing** (`handshake.ts` was unchanged by the replication lane) and it blocks stable 2-peer [[Sessions|sessions]], i.e. the core MVP story. It surfaced only after the [[P2P-Testing|test-peer harness]] gained correct length-prefix framing. Highest-priority fix after the injection blockers.

## Problem & Current State

- **The loop**: `app/src/main/handshake.ts:114-130` — the responder handles every inbound handshake stream identically, replying to a handshake *response* with another handshake. A↔B loop forever. (Verify exact lines on mvp `5534cd9`+.)
- **The storm**: each handshake "completion" re-bootstraps replication at `app/src/utility/p2p-service.ts:895` — repeated bootstraps → repeated pull cycles against the same peer.
- **QA evidence**: with the framed test-peer, baseline sync reached "pull-requests received by test-peer" before the storm took over. Replication logic itself is unit-tested (252 tests, lane #54) and its wire format is confirmed unchanged — the blocker is the handshake layer, not replication.
- **Session gating confirmed correct**: the app only serves pulls when a session is active (`SessionView.tsx:184` → `useSessionReplication(isActiveSession)`) — by design, don't "fix" it.
- **Harness drift (secondary)**: the test-peer's LWW (`test-peer/src/session-store.js:56-62`) still mirrors the *old* string-compare semantics; after lane #54 the app uses skew-aware epoch-ms LWW with a convergent tie-break (`app/src/renderer/db/lww.ts`). The harness should exercise the real semantics.

## Goals

- Exactly one handshake exchange per peer-pair per connection: request → response → done.
- Replication bootstraps at most once per completed handshake per peer connection; reconnection re-handshakes cleanly (must compose with lane #54's reconnection/backoff work in `relay-manager.ts`).
- Test coverage for the loop shape itself (a response must never trigger a reply) via the handshake test harness added by lane #54.
- Test-peer LWW brought in line with `lww.ts` semantics so live QA exercises what ships.
- A stable 2-peer app↔test-peer session survives: connect → handshake once → replicate → idle (no storm), plus disconnect/reconnect.

## Non-Goals

- Wire-format or version-byte changes — #54 kept them byte-stable; stay that way.
- Replication protocol changes (checkpoints, LWW, backpressure) — landed in #54, out of scope.
- File-transfer guards — [[epic-file-transfer-guards]].
- Multi-peer (>2) session topology work.

## Proposed Approach

1. **Make the protocol asymmetric**: single-stream request/response — the dialer opens the stream, writes the request, reads the response on the *same* stream, done; the responder replies on the inbound stream and never dials back. If the current two-stream shape must stay for compat, add a per-peer `handshakeState` guard (`idle | inflight | done`) so a response is consumed, never answered.
2. **Idempotent bootstrap**: guard `p2p-service.ts:895` so replication bootstrap runs once per (peer, connection) — keyed off the same per-peer state, reset on disconnect so #54's reconnection still re-bootstraps.
3. **Tests**: extend the shared handshake harness (`test(p2p): handshake protocol coverage`, commit `98f6f2b`) with: response-never-answered; double-request from same peer → single completion; disconnect mid-handshake → clean reset; reconnect → exactly one new bootstrap.
4. **Harness parity**: port `lww.ts` compare semantics (epoch-ms + `DEVICE_LOCAL_FIELDS`-stripped content-key tie-break) into `test-peer/src/session-store.js`.
5. **Live QA script**: re-run the 2-peer baseline from the 2026-08-01 session — app (`cd app && npm run dev`) + test-peer (`cd test-peer && npm start`) in separate terminals; verify sync completes and goes quiet; restart each side to exercise durable checkpoints + reconnection.

## Work Breakdown

### 1 — #58: break the handshake loop

**Acceptance criteria.**
- [ ] A handshake response never triggers an outbound handshake; asserted by a harness test.
- [ ] Per peer connection, replication bootstrap fires exactly once; reconnect (relay drop, peer restart) produces exactly one re-handshake + re-bootstrap.
- [ ] Wire format and version identifier byte-unchanged (diff the protocol constants; no schema/message shape edits).
- [ ] Live 2-peer session: sync completes, connection goes quiet (no repeating handshake/pull log lines over a 2-minute idle window).

### 2 — Test-peer LWW parity

**Acceptance criteria.**
- [ ] `session-store.js` resolves conflicts with epoch-ms comparison + the same content-key tie-break as `lww.ts` (device-local fields excluded).
- [ ] A divergent-edit QA scenario (both sides edit the same track offline, then sync) converges to the same winner on both sides.

## Epic Acceptance Criteria (Definition of Done)

- [ ] #58 closed with evidence (log excerpt or test) of a single handshake per connection.
- [ ] Harness tests green in `cd app && npm test`; no new lint/typecheck failures.
- [ ] `WhatNext - docs/01 concepts/` handshake/replication concept pages ([[Handshake-Protocol]], [[RxDB-Replication]]) updated to describe the request/response contract (per the #54 precedent of doc-with-protocol-change).
- [ ] Live QA script above passes end-to-end.

## Risks & Open Questions

- **Interaction with #54 reconnection**: the per-peer guard must reset on the same disconnect events `relay-manager.ts` uses, or a reconnect could be treated as already-handshaked and never re-bootstrap (silent no-sync — worse than the storm). Cover with a reconnect test.
- **Compat**: if dialer and responder versions disagree (old peer replies to responses), the guard must make the new side inert rather than storm — one-sided fix must be sufficient.
- **`handshake.ts` line numbers** cited from QA notes; re-verify on current mvp before editing.

## References

- Issue #58; QA session notes 2026-08-01 (wave-1 fleet session log)
- Harness framing fix: mvp commit `5534cd9`
- Code: `app/src/main/handshake.ts:114-130`; `app/src/utility/p2p-service.ts:895`; `test-peer/src/{protocols,session-store}.js`; `app/src/renderer/db/lww.ts`; `app/src/renderer/db/schemas.ts:15-32` (`DEVICE_LOCAL_FIELDS`)
- [[epic-replication-reliability]] (lane #54, landed), [[RxDB-Replication]]

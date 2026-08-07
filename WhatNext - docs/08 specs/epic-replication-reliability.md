---
tags:
  - specs/p2p
  - core/net/p2p/protocols/replication
  - data/rxdb/replication
status: shipped
date created: 2026-06-27
date modified: 2026-08-06
---

# Epic: Replication Reliability

**Status**: Shipped — merged to `mvp` as PR #54 (2026-08-01)
**GitHub**: #40, #41, #42, #47, #32
**Depends on**: none (foundational — other epics depend on this)
**Source audit**: [[report-260627-mvp-state-of-the-union]] §3

> ⚠️ Touches the P2P protocol — needs explicit human approval before agentic work (`CLAUDE.md` / `needs-p2p-review`).

> WhatNext's P2P RxDB replication exists end-to-end but is happy-path-only and has **zero test coverage**. Checkpoints live in memory, pull requests silently drop data on a 5s timeout, conflict resolution leans on string comparison, the relay reconnect path has no backoff or fallback, and the v0 fileshare transfer ignores backpressure for large files. This epic makes replication *trustworthy* — durable, observable, and tested — so that downstream epics ([[epic-track-sourcing]] P2P track source #38, [[epic-session-coordination]] remote sessions) can build on a foundation that does not lose data.

## Problem & Current State

RxDB runs in the **renderer**; the libp2p node runs in a separate **utility process**; documents relay `renderer → main → utility` (and back) over IPC. The replication wire protocol is `/whatnext/rxdb-replication/1.0.0` (see [[RxDB-Replication]], `app/src/shared/p2p-config.ts:56`). The mechanics work, but every reliability affordance is stubbed or missing:

- **Checkpoints are in-memory only.** `replicationCheckpoints` is a `Map<string, string>` keyed `"peerId:collection"` at `app/src/utility/p2p-service.ts:71`. The map dies with the utility process, so every app launch performs a **full resync of every collection from every peer**. This does not scale and wastes bandwidth (#40).
- **Pull requests silently drop changes.** The replication protocol handler arms a 5s `setTimeout` that, on expiry, resolves with an **empty document array** rather than rejecting (`app/src/utility/p2p-service.ts:553-557`, comment: "Resolve empty rather than reject — partial sync is OK for MVP"). A slow or loaded peer therefore appears to have *no changes*, and the requester silently advances as if synced (#41).
- **Relay reconnect is naive.** On relay disconnect the close handler schedules a reconnect to the **same** relay (`app/src/utility/relay-manager.ts:95-104`, `scheduleRetry(addr, 0)`). The retry interval is a **fixed 10s** (`P2P_CONFIG.RELAY.RETRY_INTERVAL = 10000`) capped at `MAX_RETRIES = 5` (`app/src/shared/p2p-config.ts:128,130`) — no exponential backoff, no fallback to an alternate relay, and no connection heartbeat to detect half-open links (#41).
- **LWW conflict resolution uses string comparison.** `replication-handler.ts:60` decides the winner with `doc.updatedAt > existingTime` where both sides are **strings** (`app/src/renderer/db/replication-handler.ts:55-62`). It works for ISO-8601 timestamps *by lexicographic coincidence* and is brittle to format drift, missing fields, and clock skew (#42).
- **Fileshare v0 is untested and ignores backpressure.** The P2P fileshare landed as v0 (commit `7fd84d1`, ~4.6k LOC). `sendFileChunk` carries an explicit TODO: `stream.send()` backpressure is unhandled and files **>10MB** may overflow the write buffer and reset the stream (`app/src/utility/protocols/file-transfer.ts:463-466`) (#47).
- **No tests exist.** There is **zero** automated coverage for handshake, replication pull/push, checkpointing, LWW, relay retry, or file transfer (#32). Vitest is the configured test runner.

## Goals

- Survive app restarts without full resync — durable, per-peer/per-collection checkpoints (#40).
- Never silently drop remote changes — surface timeouts, retry with backoff, and reconnect reliably (#41).
- Make conflict resolution deterministic and skew-aware — parse timestamps to epoch ms (#42).
- Make large-file transfer safe — add flow control so files >10MB do not reset streams (#47).
- Establish a P2P test suite so future protocol work is regression-guarded (#32).

## Non-Goals

- **CRDT migration.** LWW remains the MVP conflict strategy; this epic *hardens* LWW, it does not replace it. CRDT migration is a Phase 2 concern.
- **New replication features** (selective sync, field-level merge, compression). Reliability only.
- **Changing the IPC topology** (renderer ↔ main ↔ utility). The bridge stays; we make it robust.
- **Wire-protocol version bump.** Stay on `/whatnext/rxdb-replication/1.0.0` unless a change is provably backward-incompatible — if so, raise it as an open question, do not bump silently.
- **Multi-relay discovery/orchestration.** Relay *fallback selection* policy is out of scope; we add the hook and a single-fallback path only.

## Proposed Approach

Treat replication as a system with four reliability surfaces — **durability** (#40), **liveness** (#41), **correctness** (#42), and **flow control** (#47) — and one cross-cutting requirement, **verifiability** (#32). Each is independently shippable, but #32 should land incrementally *alongside* each other issue rather than as a big-bang afterthought: every fix arrives with the test that proves it.

Sequencing rationale: #42 (LWW) and #40 (checkpoints) are the lowest-risk, highest-value data-integrity fixes and should land first. #41 (timeout/backoff) depends on a clear policy decision about what "synced" means and is best done once checkpoints are durable. #47 (fileshare backpressure) is orthogonal and can proceed in parallel. #32 is continuous.

All work here is **`needs-p2p-review`** and requires human approval before agentic implementation (`CLAUDE.md` Agentic Work Policy: `app/src/utility/protocols/`, `replication-handler.ts`, handshake, and P2P IPC message types).

## Work Breakdown

### #40 — Persist replication checkpoints

**Rationale.** In-memory checkpoints (`p2p-service.ts:71`) mean a full resync of every collection on every launch — O(peers × collections × docs) bandwidth and CPU on cold start. Durability turns cold start into an incremental delta.

**Proposed approach.**
- Persist the `"peerId:collection" → checkpoint` map durably. Two candidate stores:
  1. A JSON file under Electron `userData` written from the utility process (or relayed to main, which owns `userData`), or
  2. A dedicated RxDB collection in the renderer (consistent with local-first plaintext, but couples checkpoints to the same DB being replicated).
  Decide in design; default lean is a small JSON file owned by main, written debounced.
- Load checkpoints on utility-process start and seed the in-memory map.
- Write on every successful pull/push checkpoint advance; debounce to avoid write amplification.
- Handle corruption/missing file by falling back to a full resync (current behavior) — degraded, not broken.

**Acceptance criteria.**
- [ ] Checkpoints survive an app restart; relaunch performs an incremental pull, not a full resync (verified by log/metric of docs transferred).
- [ ] Storage location, format, and ownership (main vs utility vs renderer) are documented in [[RxDB-Replication]].
- [ ] Corrupt/absent checkpoint store degrades gracefully to full resync without crashing.
- [ ] Checkpoint writes are debounced (no write per document).
- [ ] Unit test: checkpoint round-trips through the store; restart simulation resumes from saved checkpoint.

### #41 — Timeout/backoff, reconnection & heartbeat

**Rationale.** The 5s pull timeout that resolves empty (`p2p-service.ts:553-557`) is a **silent data-loss bug**: a slow peer looks empty. The relay reconnect (`relay-manager.ts:95-104`) uses a fixed 10s interval, no backoff, no alternate-relay fallback, and no liveness check — half-open connections go undetected.

**Proposed approach.**
- Replace "resolve empty on timeout" with explicit failure handling: the pull should **reject/retry**, and the checkpoint must **not advance** on a timed-out pull. Make the timeout configurable and longer than 5s (slow/large collections).
- Add exponential backoff with jitter for both pull retries and relay reconnect, replacing the fixed `RETRY_INTERVAL` schedule.
- Add a **relay fallback** hook: on exhausting retries against the active relay, attempt the next configured relay address rather than giving up after `MAX_RETRIES`.
- Add a lightweight **connection heartbeat** (reuse/extend the existing `ping` protocol, `app/src/utility/protocols/ping.ts`) to detect dead peers and half-open relay links proactively.

**Acceptance criteria.**
- [ ] A pull that times out does **not** advance the checkpoint and is retried (no silent empty-resolve).
- [ ] Pull timeout is configurable (config constant) and defaults to a value > 5s, justified in the doc.
- [ ] Relay reconnect uses exponential backoff with jitter; verified by test/log of increasing intervals.
- [ ] On relay-retry exhaustion, a configured fallback relay is attempted.
- [ ] Heartbeat detects a dead peer/relay and triggers reconnect within a bounded window.
- [ ] Unit test: timeout path, backoff schedule, and reconnect transition are covered.

### #42 — LWW timestamp parsing (skew-aware)

**Rationale.** `doc.updatedAt > existingTime` (`replication-handler.ts:60`) compares **strings**. ISO-8601 happens to sort correctly lexicographically *only* when format, timezone, and precision are identical across peers. Any drift (missing `Z`, different fractional-second precision, a non-ISO source) silently corrupts the merge.

**Proposed approach.**
- Parse both `updatedAt` (and the `addedAt` fallback at `replication-handler.ts:57-58`) to **epoch milliseconds** before comparison; treat unparseable timestamps as `0`/oldest and log.
- Define and document tie-break behavior for equal timestamps (e.g., deterministic by doc id or peer id) so two peers converge to the *same* winner.
- Document the clock-skew posture: LWW trusts wall clocks; note the failure mode and the future CRDT migration path. Optionally clamp/flag implausibly future timestamps.

**Acceptance criteria.**
- [ ] Comparison operates on parsed epoch-ms, not strings.
- [ ] Unparseable/missing timestamps handled deterministically (documented rule, no throw).
- [ ] Equal-timestamp tie-break is deterministic and identical on both peers.
- [ ] Clock-skew handling documented in [[RxDB-Replication]] with the CRDT migration note.
- [ ] Unit test: mixed timestamp formats, equal timestamps, and missing fields all resolve to the documented winner.

### #47 — Fileshare backpressure hardening

**Rationale.** `sendFileChunk` (`file-transfer.ts:463-466`) explicitly TODOs that `stream.send()` backpressure is unhandled; files **>10MB** can overflow the libp2p stream write buffer and trigger stream resets, failing the transfer. v0 is ~4.6k LOC and untested.

**Proposed approach.**
- Add flow control between the main-process chunk dispatcher and the utility-process stream writer — respect the stream's writable state / awaitable send, pausing dispatch when the buffer is full (see the libp2p v1→v2 streams migration referenced in the source TODO).
- Bound in-flight chunks (windowed dispatch) rather than firing all chunks eagerly.
- Add integration-style tests for large-file transfer (>10MB) including a slow-reader scenario, plus sha256 integrity verification on completion.

**Acceptance criteria.**
- [ ] A >10MB file transfers without stream reset against a slow reader.
- [ ] Chunk dispatch respects stream backpressure (bounded in-flight window).
- [ ] sha256 integrity is verified end-to-end after transfer.
- [ ] The TODO at `file-transfer.ts:463-466` is removed once resolved.
- [ ] Test: large-file + slow-reader transfer passes; integrity assertion included.

### #32 — P2P test suite (Vitest)

**Rationale.** There is **zero** test coverage for any P2P/replication logic. Every fix above is unverifiable and every future change is unguarded. This is the cross-cutting enabler for the whole epic.

**Proposed approach.** Build incrementally — each issue lands with its tests. Establish harness/fixtures (in-memory or two-node libp2p) and cover:
- Handshake capability exchange (`app/src/utility/protocols/handshake.ts`, see [[Handshake-Protocol]]).
- Replication pull/push + checkpoint advance (`app/src/utility/protocols/replication.ts`).
- LWW resolution (`app/src/renderer/db/replication-handler.ts`).
- Relay retry/backoff (`app/src/utility/relay-manager.ts`).
- File-transfer chunking + integrity (`app/src/utility/protocols/file-transfer.ts`).

**Acceptance criteria.**
- [ ] A reusable P2P test harness/fixtures exist under the app's Vitest setup.
- [ ] Handshake exchange test (success + capability-mismatch path).
- [ ] Replication pull/push + checkpoint test.
- [ ] LWW resolution test (the #42 cases).
- [ ] Relay retry/backoff test (the #41 cases).
- [ ] File-transfer integrity test (the #47 cases).
- [ ] Tests run in CI (`npm test` / Vitest) and gate the `needs-p2p-review` path.

## Epic Acceptance Criteria (Definition of Done)

- [ ] Checkpoints persist across restarts; cold start is incremental (#40).
- [ ] No code path silently drops remote changes; timeouts retry with backoff and do not advance checkpoints (#41).
- [ ] Relay reconnect uses backoff + fallback + heartbeat (#41).
- [ ] Conflict resolution compares parsed epoch-ms with deterministic, documented tie-break (#42).
- [ ] >10MB file transfers are backpressure-safe and integrity-verified (#47).
- [ ] A P2P/replication test suite exists and runs in CI, covering all of the above (#32).
- [ ] [[RxDB-Replication]] is updated to reflect durable checkpoints, timeout/backoff policy, and clock-skew handling.
- [ ] All changes passed `needs-p2p-review` human approval before merge.

## Risks & Open Questions

- **Open: checkpoint store location.** JSON file under `userData` (main-owned) vs a dedicated RxDB collection (renderer-owned)? Trade-off: file is simpler and decoupled; RxDB collection is consistent with local-first but couples checkpoints to the replicated DB. *Needs a decision.*
- **Open: does fixing the silent-empty timeout require a wire-protocol change?** If the requester must distinguish "no changes" from "peer timed out", the response shape may need a status field — potentially a `1.0.0 → 1.1.0` bump. Confirm backward-compat before changing the protocol id.
- **Open: clock-skew policy.** LWW fundamentally trusts wall clocks. Do we clamp implausibly-future timestamps, or accept the skew and rely on the CRDT migration? Document the chosen posture.
- **Risk: agentic policy.** This entire epic is inside the P2P off-limits zone; no autonomous merge — every PR needs a human reviewer (`CLAUDE.md`).
- **Risk: fileshare LOC.** v0 is ~4.6k untested LOC; backpressure changes may surface latent bugs. Tests (#32) must land *before or with* the #47 change.
- **Open: heartbeat reuse.** Can the existing `ping` protocol (`app/src/utility/protocols/ping.ts`) double as the liveness heartbeat, or does it need a separate keepalive? Decide in #41 design.

## Dependencies & Sequencing

- **Foundational** — no upstream dependencies. The P2P track source (#38, [[epic-track-sourcing]]) and remote sessions ([[epic-session-coordination]]) depend on *this* epic's reliability guarantees.
- **Internal order:** #42 + #40 first (data-integrity, low risk) → #41 (liveness, depends on durable checkpoints + a "what is synced" policy) → #47 in parallel (orthogonal) → #32 continuous, landing with each fix.
- **Pairing context:** session pairing/handshake is specified in [[p2p-session-pairing-spec]] and [[adr-260315-p2p-session-pairing]]; the relay layer is [[Circuit-Relay]]. Reliability work must not regress the pairing handshake.

## References

- Audit: [[report-260627-mvp-state-of-the-union]] §3
- Concepts: [[RxDB-Replication]], [[Handshake-Protocol]], [[Circuit-Relay]]
- Related specs/ADRs: [[p2p-session-pairing-spec]], [[adr-260315-p2p-session-pairing]]
- Downstream epics: [[epic-session-coordination]], [[epic-track-sourcing]]
- Code:
  - `app/src/utility/p2p-service.ts:71` (in-memory checkpoints), `:553-557` (silent timeout)
  - `app/src/utility/relay-manager.ts:95-104` (reconnect), `app/src/shared/p2p-config.ts:128,130` (`RETRY_INTERVAL`, `MAX_RETRIES`)
  - `app/src/renderer/db/replication-handler.ts:55-62` (string LWW)
  - `app/src/utility/protocols/file-transfer.ts:463-466` (backpressure TODO)
  - `app/src/utility/protocols/{handshake,replication,ping,file-transfer}.ts`
  - Protocol id: `/whatnext/rxdb-replication/1.0.0` (`app/src/shared/p2p-config.ts:56`)
- GitHub: #40, #41, #42, #47, #32

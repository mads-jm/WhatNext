---
tags:
  - data/rxdb/replication
  - core/net/p2p/protocols/replication
date created: Saturday, February 14th 2026, 11:36:37 am
date modified: Saturday, June 27th 2026, 12:00:00 pm
---

# RxDB Replication Protocol

## What It Is

A custom P2P replication protocol (`/whatnext/rxdb-replication/1.0.0`) that synchronizes RxDB documents between WhatNext peers over libp2p streams. It uses checkpoint-based sync with Last-Write-Wins (LWW) conflict resolution.

> ✅ **Reliability hardening (2026-06-27, epic [[epic-replication-reliability]], #40/#41/#42/#47/#32)** — the failure modes flagged in [[report-260627-mvp-state-of-the-union]] §3 are now addressed. **The wire protocol id stays `/whatnext/rxdb-replication/1.0.0` — no version bump.** The message types and on-wire shapes are unchanged; all fixes are local behavior (durability, timeout policy, conflict parsing, flow control) plus a previously-missing *requester-side* handler for the existing `pull-response` message. Specifics below:
> - **Durable checkpoints** — persisted to a debounced JSON file under `userData`; relaunch resumes incrementally instead of full-resyncing every collection (§ Checkpoint-Based Sync).
> - **No silent empty-resolve on pull timeout** — a timed-out pull now rejects and does **not** advance the checkpoint, so missed changes are re-pulled (§ Pull Timeout Policy).
> - **Skew-aware LWW** — timestamps are parsed to epoch-ms with a deterministic tie-break, not string-compared (§ Conflict Resolution).
> - **Relay reconnect** — exponential backoff + jitter, single alternate-relay fallback, and a liveness heartbeat for half-open links (§ Relay Reconnection).
> - **Fileshare backpressure** — chunk sends respect stream drain so >10MB transfers don't reset (`app/src/utility/protocols/file-transfer.ts`; further hardening tracked in [[epic-file-transfer-guards]]).
> - **Test coverage** — a Vitest P2P harness now covers handshake, replication, LWW, checkpoints, backoff/fallback/heartbeat, and large-file integrity.

## Why We Use It

WhatNext's collaborative playlist feature requires peers to share and synchronize playlist data in real-time. Rather than relying on a central server, we replicate RxDB collections directly between peers using libp2p streams.

## How It Works

### Data Flow

```ts
Renderer (RxDB)
    |
    | IPC invoke (replication:push / replication:pull)
    v
Main Process
    |
    | MessagePort postMessage
    v
Utility Process (P2P Service)
    |
    | libp2p stream (JSON-over-stream)
    v
Remote Peer's Utility Process
    |
    | MessagePort postMessage
    v
Remote Main Process
    |
    | webContents.send (replication:changes)
    v
Remote Renderer (RxDB)
```

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `pull-request` | Outbound | Request documents since a checkpoint |
| `pull-response` | Inbound | Response with documents and new checkpoint |
| `push` | Outbound | Send local changes to remote peer |
| `push-ack` | Inbound | Acknowledgment of received push |

> These four message types and their shapes are **unchanged** by the 2026-06-27 hardening — the protocol id remains `/whatnext/rxdb-replication/1.0.0`. Previously the requester *opened* `pull-request` streams but never consumed the resulting `pull-response` (it was logged and dropped), so pulled documents never reached the renderer and the checkpoint never advanced. The handler now invokes an `onPullResponse` callback that forwards the documents to the renderer and persists the returned checkpoint. This is a behavior fix on an existing message, not a new message type.

### Checkpoint-Based Sync

Each peer tracks a checkpoint (ISO timestamp) per collection per remote peer, keyed `"peerId:collection"`. On pull:
1. Send `pull-request` with the last known checkpoint
2. Remote peer (responder) returns documents modified after that checkpoint, and a new checkpoint set to the **newest `updatedAt` among the returned documents** (not wall-clock "now", which would skip docs written between the newest returned doc and now). If no document carries a usable timestamp, the incoming checkpoint is echoed back so it never moves backward.
3. Local peer (requester) applies the documents and persists the returned checkpoint.

**Durability (#40).** Checkpoints are persisted so a relaunch resumes incrementally instead of full-resyncing every collection from every peer:
- **Store**: a single JSON file, `replication-checkpoints.json` (flat map of `"peerId:collection"` → checkpoint string), in the Electron `userData` directory (the same location as `relay-config.json`).
- **Ownership**: the *utility* process owns reads/writes (it holds the in-flight checkpoint state). It cannot call `app.getPath('userData')` (no `electron` module), so it derives the `userData` path from platform conventions for app name `WhatNext`, with the `WHATNEXT_CHECKPOINT_PATH` env var as an explicit override (used by tests; available to main if it ever wants to inject the exact path). Decision rationale: a small JSON file is simpler and decoupled from the very DB being replicated — choosing the alternative (a dedicated RxDB collection in the renderer) would couple checkpoint durability to renderer liveness and the replicated dataset. See [[epic-replication-reliability]] §#40 open question.
- **Write policy**: writes are **debounced** (default 1s) and done atomically (temp file + rename) so a crash mid-write can't corrupt the file. Pending writes are flushed on node stop.
- **Degradation**: a missing or corrupt file is tolerated — the store starts empty, which falls back to the original full-resync behavior. Degraded, never a crash.

### Pull Timeout Policy (#41)

When a peer answers a `pull-request`, the responder asks its own renderer (over IPC) for the matching documents. That round-trip is bounded by `P2P_CONFIG.REPLICATION.PULL_TIMEOUT` (**15000 ms**, deliberately longer than the old hardcoded 5s to tolerate slow/large collections).

The old behavior resolved the timeout with an **empty document array and a fresh `now` checkpoint**, which made a slow peer look like it had *no changes* and silently advanced the requester past unsent data. Now a timeout **rejects**: the responder returns an empty document set **and echoes back the requester's incoming checkpoint** (it does **not** advance it), so the missed changes are simply re-pulled on the next attempt rather than dropped.

### Relay Reconnection (#41)

Relay reconnect (see [[Circuit-Relay]], `relay-manager.ts`) no longer hammers a downed relay on a fixed 10s interval:
- **Exponential backoff with jitter** — `delay = min(RETRY_MAX_DELAY, RETRY_BASE_DELAY · BACKOFF_FACTOR^attempt)`, then "equal jitter" randomizes within `[d/2, d]` so many peers don't reconnect in lockstep. Defaults: base 1s, factor 2, ceiling 30s, jitter 0.5.
- **Single alternate-relay fallback** — after exhausting `MAX_RETRIES` (5) against the active relay *and* with no live relay, the next configured relay address is tried (ring order). Multi-relay orchestration/selection policy remains out of scope.
- **Liveness heartbeat** — every `HEARTBEAT_INTERVAL` (15s) the manager checks the active relay is still among the node's live connections; a half-open link that never fired a `close` event is treated as a disconnect and triggers reconnect.

> `RETRY_INTERVAL` (the old fixed 10s) is retained in config as `@deprecated` for backward-compat but is no longer read by `RelayManager`.

### Conflict Resolution: LWW

Last-Write-Wins based on the `updatedAt` timestamp, **hardened to be skew-aware (#42)** in `app/src/renderer/db/lww.ts`:
- Both sides' `updatedAt` (with `addedAt` as a fallback for older docs) are **parsed to epoch milliseconds** before comparison — not string-compared. String comparison only sorted ISO-8601 correctly when format, timezone, and fractional-second precision matched exactly across peers; any drift silently corrupted the merge.
- **Unparseable/missing timestamps** resolve to `0` (oldest) rather than throwing, so they always lose to a real timestamp and never crash replication.
- **Tie-break**: on an exact timestamp tie, a deterministic content key (`stableStringify` — JSON with sorted keys, computed identically on every peer) is compared lexicographically; the larger key wins. Equal timestamp **and** equal key ⇒ indistinguishable ⇒ keep existing (no write). This guarantees two peers converge on the *same* winner instead of ping-ponging.
    - **Device-local fields are excluded from the content key.** The sender strips device-local fields (`localFilePath`, `localFileSize`, `albumArtLocalPath`, `coverArtLocalPath`) from the transmitted payload, but they survive on the receiver's stored doc. `contentKey` therefore drops the same `DEVICE_LOCAL_FIELDS` set (single source of truth in `schemas.ts`, consumed by both the sender and `lww.contentKey`) so both peers compute the key over the *identical* field set. Without this, the existing-side key would carry e.g. `localFilePath` (which sorts before `name`), making both peers elect the incoming version on a tie — they would swap user content and oscillate.
- **Clock-skew posture**: LWW fundamentally trusts wall clocks. We do **not** clamp implausibly-future timestamps in the MVP — a peer with a fast clock can win conflicts it shouldn't. This is an accepted limitation; the migration path is CRDTs (Phase 2). This loses data only in rare concurrent-edit / skewed-clock scenarios.
- Future: migrate to CRDTs for true eventual consistency without data loss.

## Key Patterns

### Document Format

```typescript
interface ReplicationDocument {
    id: string;
    data: Record<string, unknown>;
    updatedAt: string;  // ISO timestamp, used for LWW
    deleted?: boolean;  // Soft delete flag
}
```

### Push on Change

When the renderer's RxDB detects a local change, it pushes to all connected peers:

```typescript
window.electron.replication.pushChanges('playlists', [
    { id: 'pl-1', data: { name: 'Road Trip' }, updatedAt: new Date().toISOString() }
]);
```

### Listen for Remote Changes

```typescript
window.electron.replication.onReplicationChanges((data) => {
    // data.collection, data.documents, data.checkpoint
    // Merge into local RxDB
});
```

## Common Pitfalls

- __Data lives in renderer__: RxDB runs in the renderer process, but P2P runs in the utility process. All data must be relayed through IPC (renderer -> main -> utility and back).
- __Stream-per-message__: Each replication message opens a new stream. This is simple but may not scale well for high-frequency updates. Future optimization: use persistent streams.
- __Clock skew__: LWW depends on accurate timestamps. Comparison is now epoch-ms-parsed and tie-broken deterministically (see § Conflict Resolution), but if peer clocks are significantly skewed the wrong version can still win — that is inherent to LWW and is the motivation for the CRDT migration.
- __Checkpoint must not jump to "now"__: when answering a pull, advance the checkpoint to the newest *returned document's* `updatedAt`, never wall-clock `now` — otherwise docs written between the newest returned doc and now are skipped. On timeout, do not advance at all.

## Related Concepts

- [[RxDB]]
- [[libp2p]]
- [[Electron-IPC]]
- [[Handshake-Protocol]]
- [[Circuit-Relay]]
- [[adr-260315-p2p-session-pairing]] — pull-request bridge (utility → main → renderer) decision

## References

- Protocol implementation: `app/src/utility/protocols/replication.ts` (`newestCheckpoint`, `onPullResponse`)
- Pull timeout + checkpoint persistence wiring: `app/src/utility/p2p-service.ts`
- Durable checkpoint store: `app/src/utility/checkpoint-store.ts`
- Skew-aware LWW: `app/src/renderer/db/lww.ts`, applied in `app/src/renderer/db/replication-handler.ts`
- Relay backoff/fallback/heartbeat: `app/src/utility/relay-manager.ts`, `app/src/utility/backoff.ts`; config in `app/src/shared/p2p-config.ts` (`P2P_CONFIG.RELAY`, `P2P_CONFIG.REPLICATION`)
- Tests: `app/src/utility/**/__tests__/`, `app/src/renderer/db/__tests__/lww.test.ts`
- IPC types: `app/src/shared/core/ipc-protocol.ts` (ReplicationPushPayload, etc.)
- Preload API: `app/src/main/preload.ts` (replication namespace)
- Epic: [[epic-replication-reliability]] (#40, #41, #42, #47, #32)
- [RxDB Replication Protocol docs](https://rxdb.info/replication.html)


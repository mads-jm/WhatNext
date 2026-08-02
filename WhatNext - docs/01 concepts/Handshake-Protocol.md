---
tags:
  - core/net/p2p/protocols/handshake
  - core/net/p2p/protocols
date created: Saturday, February 14th 2026, 11:36:56 am
date modified: Monday, March 9th 2026, 12:20:46 am
---

# Handshake Protocol

## What It Is

The WhatNext handshake protocol (`/whatnext/handshake/1.0.0`) is exchanged immediately after a [[libp2p]] connection is established. It shares peer metadata so both sides know who they are talking to and what capabilities are supported.

## Why We Use It

While libp2p's `identify` service exchanges transport-level information (peer ID, addresses, supported protocols), the WhatNext handshake adds application-level metadata:
- Human-readable display name
- Application version and protocol version
- Capability flags (what features the peer supports)

This information is used by the UI to show peer names and to negotiate which sync protocols to use.

## How It Works

### Message Format

```typescript
interface HandshakeData {
    displayName: string;    // Human-readable name (e.g., "Alice's WhatNext")
    avatarUrl?: string;     // Optional avatar (service-provided URL or data: URI)
    userId: string;         // WhatNext user ID (UUID)
    version: string;        // Protocol version (e.g., "1.0.0")
    capabilities: string[]; // Supported features (e.g., ['playlist-sync', 'rxdb-replication'])
    peerId: string;         // Sender's libp2p peer ID
}
```

### Protocol Flow

One stream, one round trip. The responder replies on the **same** stream it received the request on.

```ts
Initiator (Peer A)                    Responder (Peer B)
    |                                      |
    |--- open stream (handshake/1.0.0) --->|
    |--- HandshakeData (framed JSON) ----->|
    |                                      | (reads message)
    |<--- HandshakeData (framed JSON) -----| (same stream)
    |                                      |
    | (initiateHandshake RESOLVES with     | (onHandshake callback fires)
    |  B's data; caller runs the same      |
    |  completion path as onHandshake)     |
```

Both ends therefore learn the other's `HandshakeData` from a single exchange, and the exchange terminates.

### Stream Helpers

Messages are **length-prefixed**: a 4-byte big-endian `uint32` byte length followed by the UTF-8 JSON body — the same framing used by the replication and file-transfer protocols.

1. __Write__: `stream.send(encodeFramed(data))`, then `close()` the write side (libp2p streams are half-closable, so the stream stays readable).
2. __Read__: Accumulate bytes until the 4-byte header is complete, read the declared length, parse JSON. Messages larger than `MAX_MESSAGE_SIZE` (1 MB) are rejected so a crafted `0xFFFFFFFF` prefix cannot force a ~4 GB allocation.

The dialer bounds its read with `HANDSHAKE_RESPONSE_TIMEOUT` (10 s) and aborts the stream on expiry, so a peer that opens the stream and never replies cannot pin it open.

### Integration with P2P Service

After `peer:connect` fires and `connectToPeer()` succeeds, the initiating side calls `initiateHandshake()`. The responding side has `registerHandshakeProtocol()` listening, which:
1. Reads the incoming handshake
2. Writes its own handshake back **on the same stream**
3. Fires the `onHandshake` callback

Both sides funnel into one completion path (`P2PService.onHandshakeComplete`): the responder via the callback, the dialer via `initiateHandshake()`'s resolved value. That path sends a `HANDSHAKE_COMPLETE` message to the main process for UI updates and bootstraps replication.

Replication bootstrap is claimed **once per (peer, connection)** via `BootstrapTracker`, and released on `peer:disconnect` so a reconnect bootstraps exactly once more. Both ends may dial each other on `peer:connect`, so a single connection can legitimately complete the handshake twice locally — one bootstrap, not two.

## Key Patterns

- __Register once, respond many__: `registerHandshakeProtocol()` is called once at startup; it handles all incoming handshakes
- __Request/response on one stream__: the responder never opens a stream to reply (see Pitfalls)
- __Initiator pattern__: The peer that dials (connects) initiates the handshake; the listener responds — and both sides end up with the other's metadata
- __Non-fatal__: If the handshake fails, the connection is still usable for other protocols. The handshake is informational, not gate-keeping.

## Common Pitfalls

- __Never reply on a new stream__ (#58, [[epic-handshake-stabilization]]). A reply on a fresh stream is indistinguishable from a fresh request at the far end, so the far end's own responder answers it — and so on, forever. Every lap also re-fired handshake completion, which re-triggered replication bootstrap: a pull storm that made stable 2-peer sessions impossible. Reply on the inbound stream; libp2p streams are half-closable, so `close()` on the write side leaves the stream readable for the reply.
- __The dialer needs a real completion path__. Before the fix, `initiateHandshake()` returned a placeholder and the dialer learned about its peer *only* because the loop re-entered its own responder. Removing the loop without making `initiateHandshake()` resolve with the remote's data would have traded a pull storm for silent no-sync.
- __Mixed versions__: a peer still running the old reply-on-a-new-stream shape makes a current peer *inert, not storming* — the current side completes once (the old peer's "reply" arrives as a request) and its dialer times out. The old peer never completes.
- __Protocol registration timing__: `node.handle()` must be called before `node.start()` or at least before any peer connects. Currently registered in `registerProtocols()` right after `node.start()`.

## Related Concepts

- [[libp2p]]
- [[P2P-Discovery]]
- [[Electron-IPC]]
- [[RxDB-Replication]]
- [[Circuit-Relay]]
- [[epic-handshake-stabilization]]

## References

- Implementation: `app/src/utility/protocols/handshake.ts`
- Test peer (kept in lockstep): `test-peer/src/protocols.js`
- P2P service integration: `app/src/utility/p2p-service.ts`
- Bootstrap dedup: `app/src/utility/bootstrap-tracker.ts`
- Tests: `app/src/utility/protocols/__tests__/handshake.test.ts`, `app/src/utility/__tests__/bootstrap-tracker.test.ts`
- IPC type: `HandshakeCompletePayload` in `app/src/shared/core/ipc-protocol.ts`
- Issue: #58 (handshake response loop)


---
tags: p2p/protocols/handshake
date created: Saturday, February 14th 2026, 11:36:56 am
date modified: Sunday, February 15th 2026, 8:37:08 pm
---

# Handshake Protocol

## What It Is

The WhatNext handshake protocol (`/whatnext/handshake/1.0.0`) is exchanged immediately after a libp2p connection is established. It shares peer metadata so both sides know who they are talking to and what capabilities are supported.

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
    version: string;        // Protocol version (e.g., "1.0.0")
    capabilities: string[]; // Supported features (e.g., ['playlist-sync', 'rxdb-replication'])
    peerId: string;         // Sender's libp2p peer ID
}
```

### Protocol Flow

```ts
Initiator (Peer A)                    Responder (Peer B)
    |                                      |
    |--- open stream (handshake/1.0.0) --->|
    |--- HandshakeData (JSON) ------------>|
    |                                      | (reads message)
    |                                      | (opens response stream)
    |<--- HandshakeData (JSON) ------------|
    |                                      |
    (onHandshake callback fires)     (onHandshake callback fires)
```

### Stream Helpers

Messages are sent as raw JSON-encoded UTF-8 bytes on the stream:

1. __Write__: Encode JSON to UTF-8 bytes, push to stream sink, close write side
2. __Read__: Collect all chunks from stream source, concatenate, decode UTF-8, parse JSON

This is intentionally simple. Future versions may add length-prefixing or protobuf encoding for robustness.

### Integration with P2P Service

After `peer:connect` fires and `connectToPeer()` succeeds, the initiating side calls `initiateHandshake()`. The responding side has `registerHandshakeProtocol()` listening, which:
1. Reads the incoming handshake
2. Sends its own handshake back on a new stream
3. Fires the `onHandshake` callback

The callback sends a `HANDSHAKE_COMPLETE` message to the main process, which relays it to the renderer for UI updates.

## Key Patterns

- __Register once, respond many__: `registerHandshakeProtocol()` is called once at startup; it handles all incoming handshakes
- __Initiator pattern__: The peer that dials (connects) initiates the handshake; the listener responds
- __Non-fatal__: If the handshake fails, the connection is still usable for other protocols. The handshake is informational, not gate-keeping.

## Common Pitfalls

- __Bidirectional streams__: libp2p streams are not request/response by default. The responder opens a *new* stream for its response rather than writing back on the same stream, because the initiator closes the write side after sending.
- __Protocol registration timing__: `node.handle()` must be called before `node.start()` or at least before any peer connects. Currently registered in `registerProtocols()` right after `node.start()`.

## Related Concepts

- [[libp2p]]
- [[Electron-IPC]]
- [[RxDB-Replication]]
- [[Circuit-Relay]]

## References

- Implementation: `app/src/utility/protocols/handshake.ts`
- P2P service integration: `app/src/utility/p2p-service.ts`
- IPC type: `HandshakeCompletePayload` in `app/src/shared/core/ipc-protocol.ts`

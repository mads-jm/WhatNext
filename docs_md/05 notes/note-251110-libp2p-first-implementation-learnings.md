---
tags:
  - 10
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Sunday, February 15th 2026, 8:37:15 pm
---

# libp2p First Implementation - Early Learnings

__Date__: 2025-11-10
__Issue__: - libp2p Integration
__Status__: 🔄 In Progress - Initial Implementation

## Context

Building the first iteration of the P2P utility process with libp2p. This document captures early learnings and blockers discovered during initial implementation.

---

## Learning: Dial Requires Multiaddr, Not Just PeerID

__Discovery__: When implementing `connectToPeer()`, realized that libp2p's `dial()` method requires a full multiaddr, not just a peer ID string.

__The Problem__:

```typescript
// This doesn't work:
await libp2pNode.dial('12D3KooWFoo...');

// This works:
await libp2pNode.dial('/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWFoo...');
```

__Why It Matters__:
Our `whtnxt://connect/<peerId>` protocol URLs only contain the peer ID, not the full multiaddr (IP address, port, transport protocol). We need a way to resolve peer IDs to multiaddrs.

__Solutions__ (in order of implementation priority):

1. __mDNS Discovery__ (Immediate):
   - When peer is discovered via mDNS, libp2p's `peerStore` saves their multiaddrs
   - We can retrieve multiaddrs from peerStore: `await libp2pNode.peerStore.get(peerId)`
   - __Limitation__: Only works for peers discovered on local network

2. __Relay/Circuit Relay__ (Phase 2):
   - Include relay multiaddr in protocol URL: `whtnxt://connect/<peerId>?relay=/ip4/…`
   - Connect to relay, relay brokers connection to target peer
   - __Trade-off__: Requires relay infrastructure

3. __DHT Peer Routing__ (Phase 3):
   - libp2p's DHT (Distributed Hash Table) can find peers globally
   - Query DHT for peer's multiaddrs: `await libp2pNode.peerRouting.findPeer(peerId)`
   - __Trade-off__: Requires DHT bootstrap nodes, adds complexity

__Decision for MVP__: Start with mDNS-only (local network), add relay in Phase 2.

---

## Learning: PeerID String Vs libp2p PeerId Object

__Discovery__: libp2p's TypeScript APIs expect `PeerId` objects, not plain strings.

__The Problem__:

```typescript
// Our protocol uses strings:
const peerId: string = '12D3KooWFoo...';

// libp2p expects PeerId objects:
import { peerIdFromString } from '@libp2p/peer-id';
const peerIdObj = peerIdFromString(peerId);
await libp2pNode.dial(peerIdObj);
```

__Why It Matters__:
Need conversion utilities between our string-based protocol and libp2p's object-based APIs.

__Action Items__:
- [ ] Add `@libp2p/peer-id` package for conversion utilities
- [ ] Create helper functions in `/shared/core/protocol.ts`:
  - `stringToPeerId(str: string): PeerId`
  - `peerIdToString(peerId: PeerId): string`

---

## Learning: WebRTC Transport Configuration

__Discovery__: libp2p's WebRTC transport requires additional configuration for desktop-to-desktop connections.

__Initial Configuration__:

```typescript
transports: [webRTC()],
```

__Blocker__: This may not work out-of-box for Electron utility process. Need to investigate:
- Does `@libp2p/webrtc` support Node.js environment?
- Do we need `wrtc` (WebRTC polyfill for Node.js)?
- Should we use `@libp2p/webrtc-direct` instead?

__Status__: ⚠️ __BLOCKER__ - Need to test if WebRTC transport works in utility process.

__Action Items__:
- [ ] Test minimal libp2p node startup in utility process
- [ ] Check if WebRTC requires browser APIs (fails in Node.js)
- [ ] Research `@libp2p/webrtc-direct` vs `@libp2p/webrtc`
- [ ] Consider adding `@libp2p/tcp` and `@libp2p/websockets` as fallback transports

---

## Learning: mDNS Peer Filtering

__Discovery__: mDNS will discover ALL libp2p peers on local network, not just WhatNext instances.

__The Problem__:
If IPFS Desktop or other libp2p apps are running on the same network, we'll discover them too. Users might see irrelevant peers in the UI.

__Solutions__:

1. __Protocol Matching__ (Recommended):
   - When peer is discovered, check if they support our custom protocol
   - Query: `await libp2pNode.peerStore.protoBook.get(peerId)`
   - Only show peers that support `/whatnext/1.0.0` protocol
   - __Trade-off__: Requires opening connection to check protocol support

2. __Service Name Filtering__:
   - Configure mDNS with custom service name: `_whatnext._udp.local`
   - Only WhatNext instances advertise this service
   - __Trade-off__: May require custom mDNS implementation

3. __Post-Connection Handshake__:
   - Accept all discovered peers initially
   - After connection, send WhatNext handshake message
   - If peer doesn't respond with valid handshake, disconnect
   - __Trade-off__: Wastes resources connecting to non-WhatNext peers

__Decision for MVP__: Option 3 (post-connection handshake) - simplest to implement.

---

## Learning: Utility Process Vs Worker Threads

__Discovery__: Electron's `utilityProcess` API uses worker threads under the hood.

__What This Means__:
- Our P2P service imports `parentPort` from `node:worker_threads`
- Communication happens via `parentPort.postMessage()` (like Web Workers)
- Not traditional `process.send()` like child processes

__Electron API__:

```typescript
// In main.ts
import { utilityProcess } from 'electron';

const p2pProcess = utilityProcess.fork('/path/to/p2p-service.js');

p2pProcess.postMessage({ type: 'START_NODE' });

p2pProcess.on('message', (message) => {
  console.log('Received from utility:', message);
});
```

__Action Items__:
- [ ] Update main.ts to spawn utility process
- [ ] Test MessagePort communication
- [ ] Handle utility process crashes/restarts

---

## Learning: Build Configuration for Utility Process

__Discovery__: The utility process needs to be bundled separately from main/renderer.

__Current Build Setup__:
- `tsup` builds main.ts and preload.ts to `app/dist/`
- Vite builds renderer to `app/dist/`

__Needed__:
- Utility process must be built as a separate entry point
- Output: `app/dist/p2p-service.js`
- Must include all libp2p dependencies (large bundle)

__Action Items__:
- [ ] Update `tsup.config.ts` to include utility process entry point
- [ ] Test that bundled utility process works when spawned
- [ ] Consider code splitting to reduce bundle size

---

## Next Steps

1. __Test libp2p node startup__ in utility process (validate WebRTC works in Node.js)
2. __Update build configuration__ to bundle utility process
3. __Implement utility process spawning__ in main.ts
4. __Add peer ID conversion utilities__ (string ↔ PeerId object)
5. __Test mDNS discovery__ with two Electron instances on same network

---

## Open Questions

1. __WebRTC in Node.js__: Does `@libp2p/webrtc` work in Node.js utility process, or do we need `wrtc` polyfill?
2. __Transport Fallbacks__: Should we add TCP/WebSocket transports for robustness?
3. __PeerStore Persistence__: Does libp2p's peerStore persist across restarts, or is it in-memory only?
4. __Connection Limits__: What's a realistic max peer count for collaborative playlists? (Current: 10)
5. __Protocol Versioning__: How do we handle future protocol changes? (e.g., `/whatnext/2.0.0`)

---

## References

- [libp2p Dialing](https://docs.libp2p.io/concepts/fundamentals/protocols-and-streams/)
- [libp2p PeerStore](https://github.com/libp2p/js-libp2p/tree/master/packages/peer-store)
- [libp2p WebRTC Transport](https://github.com/libp2p/js-libp2p/tree/master/packages/transport-webrtc)
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- Issue: Handle `whtnxt://connect` Custom Protocol

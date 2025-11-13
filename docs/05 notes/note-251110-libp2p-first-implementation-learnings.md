# libp2p First Implementation - Early Learnings

**Date**: 2025-11-10
**Issue**: #10 - libp2p Integration
**Status**: 🔄 In Progress - Initial Implementation

## Context

Building the first iteration of the P2P utility process with libp2p. This document captures early learnings and blockers discovered during initial implementation.

---

## Learning #1: Dial Requires Multiaddr, Not Just PeerID

**Discovery**: When implementing `connectToPeer()`, realized that libp2p's `dial()` method requires a full multiaddr, not just a peer ID string.

**The Problem**:
```typescript
// This doesn't work:
await libp2pNode.dial('12D3KooWFoo...');

// This works:
await libp2pNode.dial('/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWFoo...');
```

**Why It Matters**:
Our `whtnxt://connect/<peerId>` protocol URLs only contain the peer ID, not the full multiaddr (IP address, port, transport protocol). We need a way to resolve peer IDs to multiaddrs.

**Solutions** (in order of implementation priority):

1. **mDNS Discovery** (Immediate):
   - When peer is discovered via mDNS, libp2p's `peerStore` saves their multiaddrs
   - We can retrieve multiaddrs from peerStore: `await libp2pNode.peerStore.get(peerId)`
   - **Limitation**: Only works for peers discovered on local network

2. **Relay/Circuit Relay** (Phase 2):
   - Include relay multiaddr in protocol URL: `whtnxt://connect/<peerId>?relay=/ip4/...`
   - Connect to relay, relay brokers connection to target peer
   - **Trade-off**: Requires relay infrastructure

3. **DHT Peer Routing** (Phase 3):
   - libp2p's DHT (Distributed Hash Table) can find peers globally
   - Query DHT for peer's multiaddrs: `await libp2pNode.peerRouting.findPeer(peerId)`
   - **Trade-off**: Requires DHT bootstrap nodes, adds complexity

**Decision for MVP**: Start with mDNS-only (local network), add relay in Phase 2.

---

## Learning #2: PeerID String vs libp2p PeerId Object

**Discovery**: libp2p's TypeScript APIs expect `PeerId` objects, not plain strings.

**The Problem**:
```typescript
// Our protocol uses strings:
const peerId: string = '12D3KooWFoo...';

// libp2p expects PeerId objects:
import { peerIdFromString } from '@libp2p/peer-id';
const peerIdObj = peerIdFromString(peerId);
await libp2pNode.dial(peerIdObj);
```

**Why It Matters**:
Need conversion utilities between our string-based protocol and libp2p's object-based APIs.

**Action Items**:
- [ ] Add `@libp2p/peer-id` package for conversion utilities
- [ ] Create helper functions in `/shared/core/protocol.ts`:
  - `stringToPeerId(str: string): PeerId`
  - `peerIdToString(peerId: PeerId): string`

---

## Learning #3: WebRTC Transport Configuration

**Discovery**: libp2p's WebRTC transport requires additional configuration for desktop-to-desktop connections.

**Initial Configuration**:
```typescript
transports: [webRTC()],
```

**Blocker**: This may not work out-of-box for Electron utility process. Need to investigate:
- Does `@libp2p/webrtc` support Node.js environment?
- Do we need `wrtc` (WebRTC polyfill for Node.js)?
- Should we use `@libp2p/webrtc-direct` instead?

**Status**: ⚠️ **BLOCKER** - Need to test if WebRTC transport works in utility process.

**Action Items**:
- [ ] Test minimal libp2p node startup in utility process
- [ ] Check if WebRTC requires browser APIs (fails in Node.js)
- [ ] Research `@libp2p/webrtc-direct` vs `@libp2p/webrtc`
- [ ] Consider adding `@libp2p/tcp` and `@libp2p/websockets` as fallback transports

---

## Learning #4: mDNS Peer Filtering

**Discovery**: mDNS will discover ALL libp2p peers on local network, not just WhatNext instances.

**The Problem**:
If IPFS Desktop or other libp2p apps are running on the same network, we'll discover them too. Users might see irrelevant peers in the UI.

**Solutions**:

1. **Protocol Matching** (Recommended):
   - When peer is discovered, check if they support our custom protocol
   - Query: `await libp2pNode.peerStore.protoBook.get(peerId)`
   - Only show peers that support `/whatnext/1.0.0` protocol
   - **Trade-off**: Requires opening connection to check protocol support

2. **Service Name Filtering**:
   - Configure mDNS with custom service name: `_whatnext._udp.local`
   - Only WhatNext instances advertise this service
   - **Trade-off**: May require custom mDNS implementation

3. **Post-Connection Handshake**:
   - Accept all discovered peers initially
   - After connection, send WhatNext handshake message
   - If peer doesn't respond with valid handshake, disconnect
   - **Trade-off**: Wastes resources connecting to non-WhatNext peers

**Decision for MVP**: Option 3 (post-connection handshake) - simplest to implement.

---

## Learning #5: Utility Process vs Worker Threads

**Discovery**: Electron's `utilityProcess` API uses worker threads under the hood.

**What This Means**:
- Our P2P service imports `parentPort` from `node:worker_threads`
- Communication happens via `parentPort.postMessage()` (like Web Workers)
- Not traditional `process.send()` like child processes

**Electron API**:
```typescript
// In main.ts
import { utilityProcess } from 'electron';

const p2pProcess = utilityProcess.fork('/path/to/p2p-service.js');

p2pProcess.postMessage({ type: 'START_NODE' });

p2pProcess.on('message', (message) => {
  console.log('Received from utility:', message);
});
```

**Action Items**:
- [ ] Update main.ts to spawn utility process
- [ ] Test MessagePort communication
- [ ] Handle utility process crashes/restarts

---

## Learning #6: Build Configuration for Utility Process

**Discovery**: The utility process needs to be bundled separately from main/renderer.

**Current Build Setup**:
- `tsup` builds main.ts and preload.ts to `app/dist/`
- Vite builds renderer to `app/dist/`

**Needed**:
- Utility process must be built as a separate entry point
- Output: `app/dist/p2p-service.js`
- Must include all libp2p dependencies (large bundle)

**Action Items**:
- [ ] Update `tsup.config.ts` to include utility process entry point
- [ ] Test that bundled utility process works when spawned
- [ ] Consider code splitting to reduce bundle size

---

## Next Steps

1. **Test libp2p node startup** in utility process (validate WebRTC works in Node.js)
2. **Update build configuration** to bundle utility process
3. **Implement utility process spawning** in main.ts
4. **Add peer ID conversion utilities** (string ↔ PeerId object)
5. **Test mDNS discovery** with two Electron instances on same network

---

## Open Questions

1. **WebRTC in Node.js**: Does `@libp2p/webrtc` work in Node.js utility process, or do we need `wrtc` polyfill?
2. **Transport Fallbacks**: Should we add TCP/WebSocket transports for robustness?
3. **PeerStore Persistence**: Does libp2p's peerStore persist across restarts, or is it in-memory only?
4. **Connection Limits**: What's a realistic max peer count for collaborative playlists? (Current: 10)
5. **Protocol Versioning**: How do we handle future protocol changes? (e.g., `/whatnext/2.0.0`)

---

## References

- [libp2p Dialing](https://docs.libp2p.io/concepts/fundamentals/protocols-and-streams/)
- [libp2p PeerStore](https://github.com/libp2p/js-libp2p/tree/master/packages/peer-store)
- [libp2p WebRTC Transport](https://github.com/libp2p/js-libp2p/tree/master/packages/transport-webrtc)
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- Issue #10: Handle `whtnxt://connect` Custom Protocol

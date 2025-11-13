---
tags:
  - architecture/decisions
  - net
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Thursday, November 13th 2025, 5:22:56 am
---

# ADR: libp2p Vs Simple-peer

__Date__: 2025-11-10
__Status__: ✅ Accepted
__Issue__: - P2P Library Selection

## Executive Summary

__Question__: Should WhatNext use __libp2p__ (with webrtc-private-to-private) or __simple-peer__ for P2P networking?

__Recommendation__: __libp2p__ - Despite higher complexity, it aligns better with our long-term architecture and provides critical features we'll need.

__Confidence__: Medium-High (pending prototype validation)

---

## Feature Comparison Matrix

| Feature | libp2p | simple-peer | Winner | Notes |
|---------|--------|-------------|--------|-------|
| __NAT Traversal__ | Built-in via Circuit Relay | Requires STUN/TURN servers | libp2p | libp2p handles relay automatically |
| __Signaling Protocol__ | Built-in (via relay) | Manual implementation required | libp2p | We'd have to build this with simple-peer |
| __Transport Flexibility__ | Multiple (WebRTC, WebSocket, TCP, QUIC) | WebRTC only | libp2p | Future-proof for different network conditions |
| __Peer Discovery__ | Built-in (mDNS, DHT, PubSub) | Manual implementation required | libp2p | Critical for user-friendly connections |
| __Multi-peer Mesh__ | Native mesh topology support | Manual mesh management | libp2p | We need N-to-N connections for collaboration |
| __Encryption__ | Built-in (Noise protocol) | Manual implementation required | libp2p | Security requirement |
| __Peer Identity__ | PeerID with public key cryptography | Manual implementation required | libp2p | Essential for trust model |
| __Stream Multiplexing__ | Built-in (yamux/mplex) | Single data channel | libp2p | RxDB replication + metadata channels |
| __Bundle Size__ | ~500KB (with WebRTC) | ~30KB | simple-peer | Significant size difference |
| __Learning Curve__ | Steep (complex abstractions) | Gentle (simple API) | simple-peer | Development velocity consideration |
| __Maintenance__ | Active (IPFS/Protocol Labs) | Minimal (feross, last update 1yr ago) | libp2p | Long-term sustainability |
| __Electron Compatibility__ | Proven (IPFS Desktop) | Proven (many projects) | Tie | Both work in Electron |
| __Documentation__ | Excellent (libp2p.io) | Good (README + examples) | libp2p | Better for onboarding |

---

## Deep Dive: Key Considerations

### 1. NAT Traversal & Connection Success Rate

#### libp2p WebRTC Private-to-Private

- __How it works__:
  1. Peer A connects to Circuit Relay server, reserves slot
  2. Peer B discovers Peer A's relay address
  3. Peers exchange SDP via relay (out-of-band signaling)
  4. Direct WebRTC connection established via ICE/STUN
  5. Relay is discarded after direct connection succeeds

- __Pros__:
  - Works for ~80-90% of private-to-private connections (typical WebRTC success rate with STUN)
  - No manual signaling server implementation required
  - Relay doubles as signaling channel and data fallback

- __Cons__:
  - Requires running a libp2p relay server (infrastructure cost)
  - 6 roundtrips before data flows (higher latency)
  - STUN dependency (public IP discovery)

#### Simple-peer

- __How it works__:
  1. Peer A generates SDP offer
  2. Developer implements signaling (e.g., WebSocket, copy-paste, QR code)
  3. Peer B receives offer, generates answer
  4. Developer sends answer back to Peer A
  5. ICE candidates exchanged via signaling
  6. Direct WebRTC connection established

- __Pros__:
  - Full control over signaling mechanism
  - Smaller bundle size
  - Simpler mental model for basic use cases

- __Cons__:
  - __We must build signaling server__ (already planned in spec's `/service` directory)
  - STUN/TURN server dependency for NAT traversal
  - Manual peer discovery (how do users find each other?)

__Analysis__: Both require external infrastructure (libp2p relay vs signaling server). Since we're building a signaling server anyway (per spec §2.3), this is a wash. __However__, libp2p's relay can be reused for multiple purposes (signaling, discovery, fallback relay), whereas simple-peer requires separate infrastructure for each concern.

---

### 2. Peer Discovery & User Experience

#### libp2p

Provides multiple discovery mechanisms:
- __mDNS__: Automatic local network peer discovery (same WiFi → instant connection)
- __DHT (Kademlia)__: Distributed peer lookup without central directory
- __PubSub__: Topic-based peer discovery (e.g., "WhatNext-Collaborative-Playlist")
- __Bootstrap nodes__: Connect to known relay nodes to discover peers

__User Experience__:

```ts
User A creates playlist → Generates shareable whtnxt://connect/<peerID>
User B opens link → libp2p DHT lookup → Finds relay address → Connects
OR
User A & B on same WiFi → mDNS auto-discovers → Instant connection (no link needed!)
```

#### Simple-peer

No built-in discovery. We must implement:
- Signaling server with peer directory
- QR code/link-based connection initiation only
- No auto-discovery on local networks

__User Experience__:

```ts
User A creates playlist → Generates shareable link
User B opens link → Our signaling server brokers connection
```

__Analysis__: libp2p's mDNS auto-discovery is a __killer feature__ for local collaboration use cases (e.g., friends in same room). This aligns perfectly with WhatNext's "user sovereignty" principle - peers can connect without internet access or any central server.

---

### 3. Mesh Networking & Multi-Peer Collaboration

#### libp2p

- Native support for mesh topologies (N-to-N connections)
- Each peer maintains multiple simultaneous connections
- Built-in connection manager (limits, pruning, scoring)
- Relay nodes can forward data to offline peers (future feature)

__Architecture__:

```ts
    Peer A ←→ Peer B
      ↓ ↘     ↗ ↓
    Peer C ←→ Peer D
```

libp2p manages this mesh automatically with connection limits and health checks.

#### Simple-peer

- Designed for 1-to-1 connections
- Multi-peer mesh requires manual management:
  - Track which peers are connected
  - Handle connection churn (peers joining/leaving)
  - Implement broadcast logic (send update to all peers)
  - Detect and handle network partitions

__Architecture__:

```ts
    Peer A ←simple-peer instance 1→ Peer B
    Peer A ←simple-peer instance 2→ Peer C
    Peer A ←simple-peer instance 3→ Peer D
```

We'd need to build a `ConnectionPool` manager ourselves.

__Analysis__: WhatNext requires multi-peer collaboration (spec §4.3). libp2p's mesh networking is __exactly__ what we need. Building this with simple-peer is possible but adds significant complexity.

---

### 4. RxDB Replication Integration

#### libp2p

- __Stream multiplexing__: Open multiple logical streams over one connection
  - Stream 1: RxDB replication protocol
  - Stream 2: Presence/heartbeat
  - Stream 3: Real-time queue updates
  - Stream 4: Chat/social features (future)

- __Protocol negotiation__: Peers agree on replication protocol version
- __Backpressure handling__: Built-in flow control prevents overwhelming peers

__Integration__:

```typescript
// Open RxDB replication stream
const stream = await libp2pNode.dialProtocol(peerId, '/whatnext/rxdb/1.0.0');
// Use stream as RxDB replication transport
const replication = await db.replicate({
  remote: streamToRxDBAdapter(stream),
});
```

#### Simple-peer

- Single data channel per connection
- Must multiplex manually:
  - Wrap messages in envelopes (`{ type: 'rxdb' | 'presence' | 'chat', data: … }`)
  - Implement message routing logic
  - Handle flow control manually

__Integration__:

```typescript
// Wrap simple-peer data channel
peer.on('data', (rawData) => {
  const msg = JSON.parse(rawData);
  if (msg.type === 'rxdb') {
    handleRxDBMessage(msg.data);
  } else if (msg.type === 'presence') {
    handlePresence(msg.data);
  }
  // ... manual routing
});
```

__Analysis__: RxDB replication will be __complex__. libp2p's stream multiplexing reduces cognitive load and prevents bugs (e.g., accidentally sending RxDB data to the wrong handler).

---

### 5. Security & Peer Identity

#### libp2p

- __PeerID__: Cryptographic identity derived from public key
  - Unique, verifiable, tamper-proof
  - Can sign messages to prove identity
  - Foundation for permission systems (who can edit playlists?)

- __Noise Protocol__: Automatic encryption of all connections
  - No plaintext ever sent
  - Forward secrecy
  - Mutual authentication

__Trust Model__:

```typescript
// Verify peer's identity before accepting playlist edits
if (playlist.collaboratorIds.includes(peerId.toString())) {
  await applyEdit(edit);
} else {
  reject('Unauthorized peer');
}
```

#### Simple-peer

- No built-in identity system
- Must implement:
  - Peer ID generation (UUIDs? Public keys?)
  - Message signing/verification
  - Encryption layer (manually wrap WebRTC data channel)

__Trust Model__:
We'd need to build:

```typescript
// Custom identity layer
class PeerIdentity {
  constructor(publicKey, privateKey) { /*...*/ }
  sign(message) { /*...*/ }
  verify(message, signature) { /*...*/ }
}
```

__Analysis__: WhatNext has __permission-based collaboration__ (playlist owners, collaborators). libp2p's PeerID is foundational for this trust model. Building it ourselves is high-risk (crypto is hard).

---

### 6. Bundle Size & Performance

#### libp2p

- __Bundle size__: ~500KB minified (with WebRTC transport, Noise, mDNS)
- __Startup time__: ~200-500ms to initialize libp2p node
- __Memory__: ~20-40MB per node (includes DHT routing table)

__Impact__:
- Desktop app: Acceptable (Electron apps are typically 100-200MB)
- Web app: Significant (but we're Electron-only for MVP)

#### Simple-peer

- __Bundle size__: ~30KB minified
- __Startup time__: <10ms (just WebRTC API wrapper)
- __Memory__: ~5-10MB per connection

__Impact__:
- 16x smaller bundle
- Faster initialization

__Analysis__: For a desktop Electron app, bundle size is __not a critical concern__. libp2p's 500KB is negligible compared to Electron's ~150MB base size. If we were building a web app, this would be a bigger issue.

---

### 7. Maintenance & Ecosystem

#### libp2p

- __Maintainer__: Protocol Labs (IPFS, Filecoin)
- __Funding__: Well-funded ($250M+ raised)
- __Ecosystem__:
  - IPFS Desktop (Electron app using libp2p)
  - OrbitDB (P2P database on libp2p, similar to our use case)
  - Textile (P2P data sync)
- __Breaking changes__: Stable APIs, semantic versioning
- __Last update__: Active (monthly releases)

#### Simple-peer

- __Maintainer__: Feross Aboukhadijeh (solo maintainer)
- __Funding__: Open source passion project
- __Ecosystem__: Many projects use it, but each implements their own higher-level abstractions
- __Breaking changes__: Rare, API stable
- __Last update__: ~1 year ago (Feb 2024)

__Analysis__: libp2p is a __safer long-term bet__. Protocol Labs is incentivized to maintain libp2p (it's foundational to IPFS). simple-peer is battle-tested but lacks active development.

---

### 8. Development Velocity & Learning Curve

#### libp2p

- __Initial setup__: 1-2 weeks to learn concepts (transports, protocols, streams)
- __Prototype__: 2-3 weeks to build basic P2P connection
- __Production-ready__: 4-6 weeks (connection management, error handling, testing)

__Complexity sources__:
- Many abstractions to learn (Multiaddrs, PeerIDs, Transports, Protocols)
- Configuration-heavy (which transports? which discovery mechanisms?)
- Debugging requires understanding libp2p internals

#### Simple-peer

- __Initial setup__: 1-2 days to learn API
- __Prototype__: 3-5 days to build basic connection + signaling
- __Production-ready__: 2-3 weeks (add mesh, identity, discovery)

__Complexity sources__:
- Signaling server implementation
- Mesh networking logic
- Identity/encryption layer

__Analysis__: simple-peer is __faster to initial prototype__, but libp2p is __faster to production-ready__ (less custom code to write/test/maintain).

---

## Alignment with WhatNext Architecture Principles

### User Sovereignty ✅ libp2p Advantage

- __libp2p mDNS__: Peers can connect on local network without internet or central server
- __simple-peer__: Always requires signaling server (centralization risk)

### Decentralized Collaboration ✅ libp2p Advantage

- __libp2p__: DHT-based peer discovery, relay network (decentralized infrastructure)
- __simple-peer__: Requires our centralized signaling server

### Offline-Capable ✅ libp2p Advantage

- __libp2p mDNS__: Peers can discover and connect offline (local network only)
- __simple-peer__: Requires signaling server (internet dependency)

### Security Hardened ✅ libp2p Advantage

- __libp2p__: Built-in encryption, peer identity, Noise protocol
- __simple-peer__: Must implement manually (high risk)

### Extensibility ✅ libp2p Advantage

- __libp2p__: Plugin architecture, multiple transports
- __simple-peer__: Limited to WebRTC, manual extensions

---

## Risk Analysis

### Risks with libp2p

1. __Complexity__: Steep learning curve, harder to debug
   - __Mitigation__: Start with minimal config (WebRTC only), add features incrementally

2. __Bundle size__: 500KB overhead
   - __Mitigation__: Acceptable for desktop Electron app

3. __Relay infrastructure__: Must run libp2p relay nodes
   - __Mitigation__: We're already planning signaling server; relay is similar effort

4. __Unknown unknowns__: Less experience with libp2p in team
   - __Mitigation__: Prototype phase to validate before committing

### Risks with Simple-peer

1. __Manual implementation__: Signaling, mesh, identity, discovery
   - __Mitigation__: Well-trodden path, lots of examples

2. __Maintenance burden__: More custom code to maintain
   - __Mitigation__: Keep code simple, comprehensive tests

3. __simple-peer maintenance__: Solo maintainer, infrequent updates
   - __Mitigation__: Fork if needed, API is stable

4. __Feature parity__: Implementing libp2p-equivalent features takes months
   - __Mitigation__: Ship MVP with limited features, iterate

---

## Recommendation: libp2p

### Reasons

1. __Mesh networking__: We need multi-peer collaboration; libp2p handles this natively
2. __Security__: Built-in encryption and peer identity are critical for permission-based playlists
3. __Local discovery__: mDNS enables offline/local-network collaboration (killer feature)
4. __Long-term maintenance__: Protocol Labs backing reduces risk
5. __RxDB integration__: Stream multiplexing simplifies replication protocol
6. __Alignment with principles__: Better fit for decentralization and user sovereignty

### Trade-offs Accepted

- Higher initial learning curve (2-3 week investment)
- Larger bundle size (acceptable for desktop app)
- More complex debugging (mitigated by good logging)

---

## Implementation Plan

### Phase 1: Minimal libp2p POC (Week 1-2)

__Goal__: Prove libp2p works in Electron, establish connection between 2 instances

```typescript
// Minimal config - WebRTC only, no DHT, no mDNS yet
const libp2pNode = await createLibp2p({
  transports: [webRTC()],
  connectionEncryption: [noise()],
  streamMuxers: [yamux()],
});
```

__Success criteria__:
- [ ] Two Electron instances create libp2p nodes
- [ ] Manual signaling exchange (copy-paste multiaddr)
- [ ] Direct WebRTC connection established
- [ ] Send/receive "hello world" message

### Phase 2: Protocol Handler + Utility Process (Week 2-3)

__Goal__: Integrate with `whtnxt://` protocol, move to utility process

- [ ] Run libp2p node in utility process
- [ ] Parse `whtnxt://connect/<peerId>` URLs
- [ ] Relay connection requests to utility process
- [ ] Expose connection API to renderer via IPC

### Phase 3: mDNS Local Discovery (Week 3-4)

__Goal__: Enable automatic peer discovery on local networks

```typescript
const libp2pNode = await createLibp2p({
  transports: [webRTC()],
  connectionEncryption: [noise()],
  streamMuxers: [yamux()],
  peerDiscovery: [mdns()], // 🆕 Auto-discover on LAN
});
```

__Success criteria__:
- [ ] Two instances on same WiFi auto-discover without link
- [ ] Display discovered peers in UI
- [ ] One-click connection (no link sharing needed)

### Phase 4: Relay + Circuit Relay (Week 4-6)

__Goal__: Enable connections between peers behind NAT via relay

- [ ] Deploy libp2p relay server (or use public bootstrap nodes)
- [ ] Configure WebRTC transport with relay fallback
- [ ] Test private-to-private connections

### Phase 5: RxDB Replication (Week 6-8)

__Goal__: Sync playlists via libp2p

- [ ] Define `/whatnext/rxdb/1.0.0` protocol
- [ ] Implement RxDB replication over libp2p streams
- [ ] Test multi-peer playlist sync

---

## Alternative: Hybrid Approach (If libp2p POC Fails)

__Fallback plan__: Use simple-peer for MVP, design abstraction layer for swapping later

```typescript
// Abstract interface - implementation-agnostic
interface P2PConnection {
  peerId: string;
  connect(): Promise<void>;
  send(data: Uint8Array): void;
  onData(handler: (data: Uint8Array) => void): void;
  disconnect(): void;
}

// MVP: simple-peer implementation
class SimplePeerConnection implements P2PConnection { /*...*/ }

// Future: libp2p implementation
class LibP2PConnection implements P2PConnection { /*...*/ }
```

This allows us to:
1. Ship MVP quickly with simple-peer
2. Validate P2P concept with users
3. Swap to libp2p when ready (internal refactor, no user impact)

---

## Decision Point

__Question for maintainer__: Based on this analysis, should we:

__Option A__: Invest in libp2p (recommended)
- 2-3 week learning curve
- Better long-term architecture
- More features out-of-box

__Option B__: Start with simple-peer, design for swapping later
- Faster initial prototype
- More manual implementation
- Higher maintenance burden

__Option C__: Build minimal libp2p POC in parallel (1 week spike)
- Validate libp2p works in Electron before committing
- Low risk: If it fails, fall back to simple-peer
- __Recommended approach__: De-risk the decision

---

## Next Steps (Assuming Option C: POC Spike)

1. [ ] Create `/spike/libp2p-poc` directory
2. [ ] Build minimal libp2p node in Electron (WebRTC only)
3. [ ] Test connection between 2 instances (manual signaling)
4. [ ] Evaluate: Does it work? Is debugging tractable? Is bundle size acceptable?
5. [ ] __Decision point__: Commit to libp2p or fall back to simple-peer

__Time box__: 1 week maximum for POC

---

## References

- [libp2p WebRTC docs](https://docs.libp2p.io/concepts/transports/webrtc/)
- [libp2p WebRTC private-to-private example](https://github.com/libp2p/js-libp2p-example-webrtc-private-to-private)
- [simple-peer GitHub](https://github.com/feross/simple-peer)
- [IPFS Desktop (Electron + libp2p)](https://github.com/ipfs/ipfs-desktop)
- [OrbitDB (P2P database on libp2p)](https://github.com/orbitdb/orbitdb)
- WhatNext spec §2.3: Backend & Network Architecture
- WhatNext spec §4.3: Collaborative & Social Features

---

## Appendix: Code Size Comparison

### libp2p Minimal Setup

```typescript
import { createLibp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';

const node = await createLibp2p({
  transports: [webRTC()],
  connectionEncryption: [noise()],
  streamMuxers: [yamux()],
});

await node.start();
// ~50 lines of config + error handling
```

### Simple-peer Minimal Setup

```typescript
import SimplePeer from 'simple-peer';

const peer = new SimplePeer({ initiator: true });

peer.on('signal', (data) => {
  // Send `data` to peer via signaling channel (we implement this)
});

peer.on('connect', () => {
  peer.send('hello world');
});
// ~15 lines, but signaling server is 100+ lines
```

__Total implementation effort__:
- __libp2p__: ~200 lines (client) + relay deployment
- __simple-peer__: ~100 lines (client) + ~300 lines (signaling server) + mesh logic (100+ lines)

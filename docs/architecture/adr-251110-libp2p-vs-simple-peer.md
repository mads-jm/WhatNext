# ADR: libp2p vs simple-peer

**Date**: 2025-11-10
**Status**: ✅ Accepted
**Issue**: #10 - P2P Library Selection

#architecture/decisions #p2p

## Executive Summary

**Question**: Should WhatNext use **libp2p** (with webrtc-private-to-private) or **simple-peer** for P2P networking?

**Recommendation**: **libp2p** - Despite higher complexity, it aligns better with our long-term architecture and provides critical features we'll need.

**Confidence**: Medium-High (pending prototype validation)

---

## Feature Comparison Matrix

| Feature | libp2p | simple-peer | Winner | Notes |
|---------|--------|-------------|--------|-------|
| **NAT Traversal** | Built-in via Circuit Relay | Requires STUN/TURN servers | libp2p | libp2p handles relay automatically |
| **Signaling Protocol** | Built-in (via relay) | Manual implementation required | libp2p | We'd have to build this with simple-peer |
| **Transport Flexibility** | Multiple (WebRTC, WebSocket, TCP, QUIC) | WebRTC only | libp2p | Future-proof for different network conditions |
| **Peer Discovery** | Built-in (mDNS, DHT, PubSub) | Manual implementation required | libp2p | Critical for user-friendly connections |
| **Multi-peer Mesh** | Native mesh topology support | Manual mesh management | libp2p | We need N-to-N connections for collaboration |
| **Encryption** | Built-in (Noise protocol) | Manual implementation required | libp2p | Security requirement |
| **Peer Identity** | PeerID with public key cryptography | Manual implementation required | libp2p | Essential for trust model |
| **Stream Multiplexing** | Built-in (yamux/mplex) | Single data channel | libp2p | RxDB replication + metadata channels |
| **Bundle Size** | ~500KB (with WebRTC) | ~30KB | simple-peer | Significant size difference |
| **Learning Curve** | Steep (complex abstractions) | Gentle (simple API) | simple-peer | Development velocity consideration |
| **Maintenance** | Active (IPFS/Protocol Labs) | Minimal (feross, last update 1yr ago) | libp2p | Long-term sustainability |
| **Electron Compatibility** | Proven (IPFS Desktop) | Proven (many projects) | Tie | Both work in Electron |
| **Documentation** | Excellent (libp2p.io) | Good (README + examples) | libp2p | Better for onboarding |

---

## Deep Dive: Key Considerations

### 1. NAT Traversal & Connection Success Rate

#### libp2p WebRTC Private-to-Private
- **How it works**:
  1. Peer A connects to Circuit Relay server, reserves slot
  2. Peer B discovers Peer A's relay address
  3. Peers exchange SDP via relay (out-of-band signaling)
  4. Direct WebRTC connection established via ICE/STUN
  5. Relay is discarded after direct connection succeeds

- **Pros**:
  - Works for ~80-90% of private-to-private connections (typical WebRTC success rate with STUN)
  - No manual signaling server implementation required
  - Relay doubles as signaling channel and data fallback

- **Cons**:
  - Requires running a libp2p relay server (infrastructure cost)
  - 6 roundtrips before data flows (higher latency)
  - STUN dependency (public IP discovery)

#### simple-peer
- **How it works**:
  1. Peer A generates SDP offer
  2. Developer implements signaling (e.g., WebSocket, copy-paste, QR code)
  3. Peer B receives offer, generates answer
  4. Developer sends answer back to Peer A
  5. ICE candidates exchanged via signaling
  6. Direct WebRTC connection established

- **Pros**:
  - Full control over signaling mechanism
  - Smaller bundle size
  - Simpler mental model for basic use cases

- **Cons**:
  - **We must build signaling server** (already planned in spec's `/service` directory)
  - STUN/TURN server dependency for NAT traversal
  - Manual peer discovery (how do users find each other?)

**Analysis**: Both require external infrastructure (libp2p relay vs signaling server). Since we're building a signaling server anyway (per spec §2.3), this is a wash. **However**, libp2p's relay can be reused for multiple purposes (signaling, discovery, fallback relay), whereas simple-peer requires separate infrastructure for each concern.

---

### 2. Peer Discovery & User Experience

#### libp2p
Provides multiple discovery mechanisms:
- **mDNS**: Automatic local network peer discovery (same WiFi → instant connection)
- **DHT (Kademlia)**: Distributed peer lookup without central directory
- **PubSub**: Topic-based peer discovery (e.g., "WhatNext-Collaborative-Playlist")
- **Bootstrap nodes**: Connect to known relay nodes to discover peers

**User Experience**:
```
User A creates playlist → Generates shareable whtnxt://connect/<peerID>
User B opens link → libp2p DHT lookup → Finds relay address → Connects
OR
User A & B on same WiFi → mDNS auto-discovers → Instant connection (no link needed!)
```

#### simple-peer
No built-in discovery. We must implement:
- Signaling server with peer directory
- QR code/link-based connection initiation only
- No auto-discovery on local networks

**User Experience**:
```
User A creates playlist → Generates shareable link
User B opens link → Our signaling server brokers connection
```

**Analysis**: libp2p's mDNS auto-discovery is a **killer feature** for local collaboration use cases (e.g., friends in same room). This aligns perfectly with WhatNext's "user sovereignty" principle - peers can connect without internet access or any central server.

---

### 3. Mesh Networking & Multi-Peer Collaboration

#### libp2p
- Native support for mesh topologies (N-to-N connections)
- Each peer maintains multiple simultaneous connections
- Built-in connection manager (limits, pruning, scoring)
- Relay nodes can forward data to offline peers (future feature)

**Architecture**:
```
    Peer A ←→ Peer B
      ↓ ↘     ↗ ↓
    Peer C ←→ Peer D
```
libp2p manages this mesh automatically with connection limits and health checks.

#### simple-peer
- Designed for 1-to-1 connections
- Multi-peer mesh requires manual management:
  - Track which peers are connected
  - Handle connection churn (peers joining/leaving)
  - Implement broadcast logic (send update to all peers)
  - Detect and handle network partitions

**Architecture**:
```
    Peer A ←simple-peer instance 1→ Peer B
    Peer A ←simple-peer instance 2→ Peer C
    Peer A ←simple-peer instance 3→ Peer D
```
We'd need to build a `ConnectionPool` manager ourselves.

**Analysis**: WhatNext requires multi-peer collaboration (spec §4.3). libp2p's mesh networking is **exactly** what we need. Building this with simple-peer is possible but adds significant complexity.

---

### 4. RxDB Replication Integration

#### libp2p
- **Stream multiplexing**: Open multiple logical streams over one connection
  - Stream 1: RxDB replication protocol
  - Stream 2: Presence/heartbeat
  - Stream 3: Real-time queue updates
  - Stream 4: Chat/social features (future)

- **Protocol negotiation**: Peers agree on replication protocol version
- **Backpressure handling**: Built-in flow control prevents overwhelming peers

**Integration**:
```typescript
// Open RxDB replication stream
const stream = await libp2pNode.dialProtocol(peerId, '/whatnext/rxdb/1.0.0');
// Use stream as RxDB replication transport
const replication = await db.replicate({
  remote: streamToRxDBAdapter(stream),
});
```

#### simple-peer
- Single data channel per connection
- Must multiplex manually:
  - Wrap messages in envelopes (`{ type: 'rxdb' | 'presence' | 'chat', data: ... }`)
  - Implement message routing logic
  - Handle flow control manually

**Integration**:
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

**Analysis**: RxDB replication will be **complex**. libp2p's stream multiplexing reduces cognitive load and prevents bugs (e.g., accidentally sending RxDB data to the wrong handler).

---

### 5. Security & Peer Identity

#### libp2p
- **PeerID**: Cryptographic identity derived from public key
  - Unique, verifiable, tamper-proof
  - Can sign messages to prove identity
  - Foundation for permission systems (who can edit playlists?)

- **Noise Protocol**: Automatic encryption of all connections
  - No plaintext ever sent
  - Forward secrecy
  - Mutual authentication

**Trust Model**:
```typescript
// Verify peer's identity before accepting playlist edits
if (playlist.collaboratorIds.includes(peerId.toString())) {
  await applyEdit(edit);
} else {
  reject('Unauthorized peer');
}
```

#### simple-peer
- No built-in identity system
- Must implement:
  - Peer ID generation (UUIDs? Public keys?)
  - Message signing/verification
  - Encryption layer (manually wrap WebRTC data channel)

**Trust Model**:
We'd need to build:
```typescript
// Custom identity layer
class PeerIdentity {
  constructor(publicKey, privateKey) { /*...*/ }
  sign(message) { /*...*/ }
  verify(message, signature) { /*...*/ }
}
```

**Analysis**: WhatNext has **permission-based collaboration** (playlist owners, collaborators). libp2p's PeerID is foundational for this trust model. Building it ourselves is high-risk (crypto is hard).

---

### 6. Bundle Size & Performance

#### libp2p
- **Bundle size**: ~500KB minified (with WebRTC transport, Noise, mDNS)
- **Startup time**: ~200-500ms to initialize libp2p node
- **Memory**: ~20-40MB per node (includes DHT routing table)

**Impact**:
- Desktop app: Acceptable (Electron apps are typically 100-200MB)
- Web app: Significant (but we're Electron-only for MVP)

#### simple-peer
- **Bundle size**: ~30KB minified
- **Startup time**: <10ms (just WebRTC API wrapper)
- **Memory**: ~5-10MB per connection

**Impact**:
- 16x smaller bundle
- Faster initialization

**Analysis**: For a desktop Electron app, bundle size is **not a critical concern**. libp2p's 500KB is negligible compared to Electron's ~150MB base size. If we were building a web app, this would be a bigger issue.

---

### 7. Maintenance & Ecosystem

#### libp2p
- **Maintainer**: Protocol Labs (IPFS, Filecoin)
- **Funding**: Well-funded ($250M+ raised)
- **Ecosystem**:
  - IPFS Desktop (Electron app using libp2p)
  - OrbitDB (P2P database on libp2p, similar to our use case)
  - Textile (P2P data sync)
- **Breaking changes**: Stable APIs, semantic versioning
- **Last update**: Active (monthly releases)

#### simple-peer
- **Maintainer**: Feross Aboukhadijeh (solo maintainer)
- **Funding**: Open source passion project
- **Ecosystem**: Many projects use it, but each implements their own higher-level abstractions
- **Breaking changes**: Rare, API stable
- **Last update**: ~1 year ago (Feb 2024)

**Analysis**: libp2p is a **safer long-term bet**. Protocol Labs is incentivized to maintain libp2p (it's foundational to IPFS). simple-peer is battle-tested but lacks active development.

---

### 8. Development Velocity & Learning Curve

#### libp2p
- **Initial setup**: 1-2 weeks to learn concepts (transports, protocols, streams)
- **Prototype**: 2-3 weeks to build basic P2P connection
- **Production-ready**: 4-6 weeks (connection management, error handling, testing)

**Complexity sources**:
- Many abstractions to learn (Multiaddrs, PeerIDs, Transports, Protocols)
- Configuration-heavy (which transports? which discovery mechanisms?)
- Debugging requires understanding libp2p internals

#### simple-peer
- **Initial setup**: 1-2 days to learn API
- **Prototype**: 3-5 days to build basic connection + signaling
- **Production-ready**: 2-3 weeks (add mesh, identity, discovery)

**Complexity sources**:
- Signaling server implementation
- Mesh networking logic
- Identity/encryption layer

**Analysis**: simple-peer is **faster to initial prototype**, but libp2p is **faster to production-ready** (less custom code to write/test/maintain).

---

## Alignment with WhatNext Architecture Principles

### User Sovereignty ✅ libp2p advantage
- **libp2p mDNS**: Peers can connect on local network without internet or central server
- **simple-peer**: Always requires signaling server (centralization risk)

### Decentralized Collaboration ✅ libp2p advantage
- **libp2p**: DHT-based peer discovery, relay network (decentralized infrastructure)
- **simple-peer**: Requires our centralized signaling server

### Offline-Capable ✅ libp2p advantage
- **libp2p mDNS**: Peers can discover and connect offline (local network only)
- **simple-peer**: Requires signaling server (internet dependency)

### Security Hardened ✅ libp2p advantage
- **libp2p**: Built-in encryption, peer identity, Noise protocol
- **simple-peer**: Must implement manually (high risk)

### Extensibility ✅ libp2p advantage
- **libp2p**: Plugin architecture, multiple transports
- **simple-peer**: Limited to WebRTC, manual extensions

---

## Risk Analysis

### Risks with libp2p
1. **Complexity**: Steep learning curve, harder to debug
   - **Mitigation**: Start with minimal config (WebRTC only), add features incrementally

2. **Bundle size**: 500KB overhead
   - **Mitigation**: Acceptable for desktop Electron app

3. **Relay infrastructure**: Must run libp2p relay nodes
   - **Mitigation**: We're already planning signaling server; relay is similar effort

4. **Unknown unknowns**: Less experience with libp2p in team
   - **Mitigation**: Prototype phase to validate before committing

### Risks with simple-peer
1. **Manual implementation**: Signaling, mesh, identity, discovery
   - **Mitigation**: Well-trodden path, lots of examples

2. **Maintenance burden**: More custom code to maintain
   - **Mitigation**: Keep code simple, comprehensive tests

3. **simple-peer maintenance**: Solo maintainer, infrequent updates
   - **Mitigation**: Fork if needed, API is stable

4. **Feature parity**: Implementing libp2p-equivalent features takes months
   - **Mitigation**: Ship MVP with limited features, iterate

---

## Recommendation: libp2p

### Reasons
1. **Mesh networking**: We need multi-peer collaboration; libp2p handles this natively
2. **Security**: Built-in encryption and peer identity are critical for permission-based playlists
3. **Local discovery**: mDNS enables offline/local-network collaboration (killer feature)
4. **Long-term maintenance**: Protocol Labs backing reduces risk
5. **RxDB integration**: Stream multiplexing simplifies replication protocol
6. **Alignment with principles**: Better fit for decentralization and user sovereignty

### Trade-offs Accepted
- Higher initial learning curve (2-3 week investment)
- Larger bundle size (acceptable for desktop app)
- More complex debugging (mitigated by good logging)

---

## Implementation Plan

### Phase 1: Minimal libp2p POC (Week 1-2)
**Goal**: Prove libp2p works in Electron, establish connection between 2 instances

```typescript
// Minimal config - WebRTC only, no DHT, no mDNS yet
const libp2pNode = await createLibp2p({
  transports: [webRTC()],
  connectionEncryption: [noise()],
  streamMuxers: [yamux()],
});
```

**Success criteria**:
- [ ] Two Electron instances create libp2p nodes
- [ ] Manual signaling exchange (copy-paste multiaddr)
- [ ] Direct WebRTC connection established
- [ ] Send/receive "hello world" message

### Phase 2: Protocol Handler + Utility Process (Week 2-3)
**Goal**: Integrate with `whtnxt://` protocol, move to utility process

- [ ] Run libp2p node in utility process
- [ ] Parse `whtnxt://connect/<peerId>` URLs
- [ ] Relay connection requests to utility process
- [ ] Expose connection API to renderer via IPC

### Phase 3: mDNS Local Discovery (Week 3-4)
**Goal**: Enable automatic peer discovery on local networks

```typescript
const libp2pNode = await createLibp2p({
  transports: [webRTC()],
  connectionEncryption: [noise()],
  streamMuxers: [yamux()],
  peerDiscovery: [mdns()], // 🆕 Auto-discover on LAN
});
```

**Success criteria**:
- [ ] Two instances on same WiFi auto-discover without link
- [ ] Display discovered peers in UI
- [ ] One-click connection (no link sharing needed)

### Phase 4: Relay + Circuit Relay (Week 4-6)
**Goal**: Enable connections between peers behind NAT via relay

- [ ] Deploy libp2p relay server (or use public bootstrap nodes)
- [ ] Configure WebRTC transport with relay fallback
- [ ] Test private-to-private connections

### Phase 5: RxDB Replication (Week 6-8)
**Goal**: Sync playlists via libp2p

- [ ] Define `/whatnext/rxdb/1.0.0` protocol
- [ ] Implement RxDB replication over libp2p streams
- [ ] Test multi-peer playlist sync

---

## Alternative: Hybrid Approach (If libp2p POC Fails)

**Fallback plan**: Use simple-peer for MVP, design abstraction layer for swapping later

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

**Question for maintainer**: Based on this analysis, should we:

**Option A**: Invest in libp2p (recommended)
- 2-3 week learning curve
- Better long-term architecture
- More features out-of-box

**Option B**: Start with simple-peer, design for swapping later
- Faster initial prototype
- More manual implementation
- Higher maintenance burden

**Option C**: Build minimal libp2p POC in parallel (1 week spike)
- Validate libp2p works in Electron before committing
- Low risk: If it fails, fall back to simple-peer
- **Recommended approach**: De-risk the decision

---

## Next Steps (Assuming Option C: POC Spike)

1. [ ] Create `/spike/libp2p-poc` directory
2. [ ] Build minimal libp2p node in Electron (WebRTC only)
3. [ ] Test connection between 2 instances (manual signaling)
4. [ ] Evaluate: Does it work? Is debugging tractable? Is bundle size acceptable?
5. [ ] **Decision point**: Commit to libp2p or fall back to simple-peer

**Time box**: 1 week maximum for POC

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

### libp2p minimal setup
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

### simple-peer minimal setup
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

**Total implementation effort**:
- **libp2p**: ~200 lines (client) + relay deployment
- **simple-peer**: ~100 lines (client) + ~300 lines (signaling server) + mesh logic (100+ lines)

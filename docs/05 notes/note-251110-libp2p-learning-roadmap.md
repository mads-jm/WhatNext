# libp2p Learning Roadmap & Knowledge Capture

**Date**: 2025-11-10
**Issue**: #10 - libp2p Integration
**Status**: 🎓 Active Learning Phase
**Commitment**: We're going all-in on libp2p, but this is a LEARNING journey

---

## Learning Philosophy

**This is uncharted territory for the team.** We're committing to libp2p because it aligns with our architecture principles, but we acknowledge:

- ✅ We will make mistakes
- ✅ We will discover better patterns as we learn
- ✅ We will refactor as understanding deepens
- ✅ We will document EVERYTHING we learn

**Goal**: Build institutional knowledge so future contributors (including future us) can understand our decisions and avoid our mistakes.

---

## Documentation Strategy

Every learning moment gets captured in one of these formats:

### 1. **Issue-Specific Notes** (`note-YYMMDD-[topic].md`)
For discrete problems/solutions encountered during implementation.

**Template**:
```markdown
# [Topic Title]
**Date**: YYYY-MM-DD
**Issue**: Related issue number
**Status**: ✅ Resolved / 🔄 In Progress / ⚠️ Blocked

## Problem
What went wrong or what needed to be figured out?

## Investigation
What did we try? What didn't work?

## Root Cause
Why did the problem occur?

## Solution
How did we fix it?

## Key Learnings
What did we learn that applies more broadly?

## References
Links, docs, examples that helped
```

### 2. **Concept Explainers** (`concept-[name].md`)
For core libp2p concepts that need team understanding.

**Topics to Cover** (as we learn them):
- [ ] Multiaddrs: How libp2p addresses work
- [ ] PeerIDs: Cryptographic identity model
- [ ] Transports: WebRTC vs WebSocket vs TCP
- [ ] Connection lifecycle: Dialing, upgrading, multiplexing
- [ ] Protocols: How to define custom protocols (e.g., `/whatnext/rxdb/1.0.0`)
- [ ] Circuit Relay: How relay servers work
- [ ] mDNS: Local network discovery
- [ ] DHT: Distributed peer lookup
- [ ] Noise Protocol: Encryption handshake
- [ ] Stream Multiplexing: yamux/mplex internals

**Template**:
```markdown
# Concept: [Name]

## What is it?
Plain-English explanation

## Why do we care?
How does this relate to WhatNext?

## How does it work?
Technical details, diagrams if needed

## Code Example
Minimal working example

## Common Pitfalls
What mistakes did we make? What to watch out for?

## Further Reading
Links to official docs, blog posts, examples
```

### 3. **Architecture Decision Records** (`adr-YYMMDD-[decision].md`)
For major architectural choices (we've already started this pattern).

**Examples**:
- ✅ `note-251110-p2p-utility-process-architecture.md`
- ✅ `adr-251110-libp2p-vs-simple-peer-analysis.md`
- Future: `adr-251110-libp2p-transport-selection.md`
- Future: `adr-251110-rxdb-replication-protocol.md`

### 4. **Weekly Learning Log** (`learning-log-YYMMDD.md`)
End-of-week summary: What did we learn? What blockers remain?

**Template**:
```markdown
# Learning Log: Week of YYYY-MM-DD

## This Week's Focus
What were we trying to accomplish?

## What We Learned
- Key insight 1
- Key insight 2
- ...

## Blockers Encountered
- Blocker 1 (status: resolved/in-progress/blocked)
- Blocker 2
- ...

## Experiments Conducted
- Experiment 1: Hypothesis → Result → Conclusion
- Experiment 2: ...

## Code Milestones
- [ ] Milestone 1
- [ ] Milestone 2

## Next Week's Priorities
What are we tackling next?

## Questions to Investigate
Open questions we discovered this week
```

---

## Learning Milestones

### Phase 1: Foundation (Weeks 1-2)
**Goal**: Understand libp2p basics, get "hello world" working in Electron

#### Milestones:
- [ ] libp2p node starts successfully in Electron utility process
- [ ] Understand Multiaddr format (e.g., `/ip4/127.0.0.1/tcp/4001/p2p/QmPeerID`)
- [ ] Two nodes connect via manual multiaddr exchange
- [ ] Send/receive basic messages between peers
- [ ] Understand PeerID generation and verification

#### Learning Objectives:
- [ ] How to configure libp2p for Node.js environment (utility process)
- [ ] Minimal transports required for desktop-to-desktop connections
- [ ] How to debug libp2p connection issues (logging, metrics)
- [ ] How libp2p handles connection upgrades (plaintext → encrypted → muxed)

#### Documents to Create:
- [ ] `concept-multiaddrs.md`
- [ ] `concept-peerids.md`
- [ ] `note-YYMMDD-first-libp2p-connection.md` (capturing the journey to first success)

---

### Phase 2: Protocol Handler Integration (Weeks 2-3)
**Goal**: Integrate libp2p with `whtnxt://` protocol, wire up IPC

#### Milestones:
- [ ] `whtnxt://connect/<peerID>` URLs launch app and trigger connection
- [ ] Main process forwards protocol URLs to utility process
- [ ] Utility process initiates libp2p connection from URL
- [ ] Renderer displays connection status via IPC

#### Learning Objectives:
- [ ] How to extract PeerID from custom protocol URL
- [ ] How to convert PeerID string to libp2p PeerId object
- [ ] How to dial a peer using only their PeerID (discovery problem)
- [ ] MessagePort vs IPC for main ↔ utility communication
- [ ] Error handling: connection timeouts, invalid peer IDs, network failures

#### Documents to Create:
- [ ] `note-YYMMDD-protocol-url-to-libp2p-dial.md`
- [ ] `note-YYMMDD-utility-process-ipc-patterns.md`
- [ ] `concept-libp2p-connection-lifecycle.md`

---

### Phase 3: Local Discovery (Weeks 3-4)
**Goal**: Enable automatic peer discovery on local networks (mDNS)

#### Milestones:
- [ ] Two instances on same WiFi auto-discover without manual URL exchange
- [ ] Renderer displays list of discovered peers
- [ ] User can click peer to initiate connection
- [ ] Discovery works offline (no internet required)

#### Learning Objectives:
- [ ] How to configure mDNS peer discovery
- [ ] How to listen for `peer:discovery` events
- [ ] How to filter discovered peers (avoid connecting to random libp2p nodes)
- [ ] How to handle peer churn (peers appearing/disappearing)
- [ ] Performance: How many peers can mDNS handle on a busy network?

#### Documents to Create:
- [ ] `concept-mdns-discovery.md`
- [ ] `note-YYMMDD-mdns-filtering-whatnext-peers.md`
- [ ] `note-YYMMDD-peer-discovery-ux-patterns.md`

---

### Phase 4: Circuit Relay & NAT Traversal (Weeks 4-6)
**Goal**: Connect peers behind NAT via relay servers

#### Milestones:
- [ ] Deploy libp2p relay server (or connect to public bootstrap nodes)
- [ ] Peers behind NAT can connect via relay
- [ ] Direct connection established after relay-assisted signaling
- [ ] Relay server logs/metrics for debugging

#### Learning Objectives:
- [ ] How to configure Circuit Relay v2 (vs v1)
- [ ] How to deploy a relay server (Docker? Dedicated VPS?)
- [ ] How to advertise relay addresses in multiaddrs
- [ ] How libp2p handles relay → direct connection upgrade
- [ ] Cost analysis: Relay bandwidth usage, server requirements
- [ ] Security: How to prevent relay abuse (rate limiting, auth)

#### Documents to Create:
- [ ] `concept-circuit-relay.md`
- [ ] `note-YYMMDD-deploying-libp2p-relay.md`
- [ ] `note-YYMMDD-nat-traversal-success-rates.md` (empirical testing)
- [ ] `adr-YYMMDD-relay-server-strategy.md` (self-hosted vs public nodes)

---

### Phase 5: Custom Protocols & RxDB Replication (Weeks 6-8)
**Goal**: Define custom libp2p protocol for RxDB replication

#### Milestones:
- [ ] Define `/whatnext/rxdb/1.0.0` protocol handler
- [ ] Open bidirectional stream between peers
- [ ] Send RxDB replication messages over stream
- [ ] Handle protocol version negotiation (future-proofing)
- [ ] Playlist changes replicate between 2 peers

#### Learning Objectives:
- [ ] How to register custom protocol handlers (`node.handle()`)
- [ ] How to dial a specific protocol (`node.dialProtocol()`)
- [ ] How to read/write binary data from streams (Buffer vs Uint8Array)
- [ ] How to integrate libp2p streams with RxDB replication primitives
- [ ] Backpressure handling: What happens if peer is slow to consume data?
- [ ] Protocol versioning: How to support multiple protocol versions?

#### Documents to Create:
- [ ] `concept-libp2p-protocols.md`
- [ ] `note-YYMMDD-rxdb-replication-over-libp2p.md`
- [ ] `adr-YYMMDD-rxdb-replication-protocol.md` (message format, versioning)
- [ ] `note-YYMMDD-stream-backpressure-handling.md`

---

### Phase 6: Multi-Peer Mesh (Weeks 8-10)
**Goal**: Support 3+ peers collaborating on same playlist

#### Milestones:
- [ ] 3 peers connected simultaneously
- [ ] Playlist changes propagate to all peers
- [ ] Conflict resolution works (CRDT or LWW)
- [ ] Connection pool management (limits, pruning)
- [ ] Performance testing: 5, 10, 20 peer mesh

#### Learning Objectives:
- [ ] How libp2p's connection manager works (limits, scoring, pruning)
- [ ] How to broadcast messages to all connected peers
- [ ] How to handle partial network partitions (peer A can't reach peer B, but both reach peer C)
- [ ] How RxDB replication handles mesh topologies
- [ ] Performance: Latency, bandwidth, memory usage with N peers

#### Documents to Create:
- [ ] `concept-mesh-networking.md`
- [ ] `note-YYMMDD-multi-peer-replication-testing.md`
- [ ] `note-YYMMDD-connection-pool-tuning.md`
- [ ] `note-YYMMDD-conflict-resolution-strategies.md`

---

## Experiments to Conduct

As we learn, we'll run experiments to validate assumptions and discover edge cases.

### Experiment 1: Transport Comparison
**Question**: Which libp2p transport performs best for desktop-to-desktop?

**Setup**:
- Test WebRTC, WebSocket, TCP on same LAN
- Measure: Latency, throughput, connection setup time
- Vary: Network conditions (WiFi, Ethernet, rate-limited)

**Document findings**: `experiment-YYMMDD-transport-performance.md`

---

### Experiment 2: Relay Bandwidth Requirements
**Question**: How much bandwidth does a relay server consume for N peers?

**Setup**:
- Spawn 10 peers behind simulated NAT
- Monitor relay server bandwidth (in/out)
- Calculate cost per peer-hour

**Document findings**: `experiment-YYMMDD-relay-bandwidth-analysis.md`

---

### Experiment 3: mDNS Scaling
**Question**: How many peers can mDNS discover on a busy network?

**Setup**:
- Spawn 10, 20, 50 peers on same subnet
- Measure: Discovery time, CPU usage, network chatter
- Identify breaking points

**Document findings**: `experiment-YYMMDD-mdns-scaling-limits.md`

---

### Experiment 4: RxDB Replication Latency
**Question**: How fast do playlist changes propagate in a mesh?

**Setup**:
- 3 peers: A, B, C
- Peer A adds track → measure time until B and C see it
- Vary: Network latency (simulate 50ms, 100ms, 500ms RTT)

**Document findings**: `experiment-YYMMDD-replication-latency-analysis.md`

---

## Questions We'll Encounter (and Document Answers)

As we build, we'll hit questions that aren't answered in official docs. Capture these:

### Architecture Questions
- [ ] Should each peer run one libp2p node or multiple?
- [ ] How do we handle libp2p node restarts without losing peer connections?
- [ ] Should RxDB database live in utility process or main process?
- [ ] How do we persist peer metadata (PeerIDs, connection history)?

### Protocol Questions
- [ ] How to version our custom RxDB replication protocol?
- [ ] What happens if peer uses old protocol version?
- [ ] How do we handle protocol errors gracefully?

### Performance Questions
- [ ] What's the optimal connection pool size (max peers)?
- [ ] Should we rate-limit replication messages?
- [ ] How do we prevent memory leaks in long-running connections?

### Security Questions
- [ ] How do we verify peer identity before accepting playlist edits?
- [ ] Can malicious peer spam us with bogus replication data?
- [ ] How do we prevent replay attacks on replication protocol?

### UX Questions
- [ ] How do we explain libp2p connection states to users?
- [ ] What feedback do users need during relay-assisted connection?
- [ ] How do we handle connection failures gracefully (retry logic)?

**Document answers**: Create `note-YYMMDD-[question-topic].md` for each

---

## Code Patterns & Best Practices

As we discover patterns that work, document them for consistency:

### Pattern 1: libp2p Node Lifecycle
```typescript
// To be documented after implementation
// - When to start/stop node
// - How to handle restart
// - Error recovery strategies
```

### Pattern 2: Protocol Handler Registration
```typescript
// To be documented after implementation
// - How to register custom protocols
// - Error handling in protocol handlers
// - Testing protocol handlers
```

### Pattern 3: IPC Message Flow (Main ↔ Utility ↔ Renderer)
```typescript
// To be documented after implementation
// - Message format standardization
// - Error propagation
// - Async response handling
```

**Document in**: `pattern-YYMMDD-[pattern-name].md`

---

## Knowledge Sharing Strategy

### 1. **Daily Learning Snippets**
Quick notes during development (commit messages, inline comments):
```typescript
// LEARNING: libp2p requires explicit node.start() before dialing peers
// Without this, dialProtocol() silently fails. See note-251110-xxx.md
await node.start();
```

### 2. **Weekly Learning Review**
Friday afternoon: Review week's commits, extract learnings into `learning-log-YYMMDD.md`

### 3. **Monthly Deep Dives**
End of month: Write comprehensive guides on major topics (e.g., "Complete Guide to libp2p in Electron")

### 4. **Public Blog Posts** (Future)
Once stable, publish learnings publicly:
- "Building P2P Desktop Apps with libp2p and Electron"
- "RxDB Replication Over libp2p: A Case Study"
- "Zero-Config Local Network Collaboration with mDNS"

---

## Learning Resources

### Official libp2p Docs
- [libp2p Documentation](https://docs.libp2p.io/)
- [js-libp2p GitHub](https://github.com/libp2p/js-libp2p)
- [libp2p Examples](https://github.com/libp2p/js-libp2p-examples)
- [libp2p Concepts](https://docs.libp2p.io/concepts/)

### Related Projects to Study
- [IPFS Desktop](https://github.com/ipfs/ipfs-desktop) - Electron + libp2p in production
- [OrbitDB](https://github.com/orbitdb/orbitdb) - P2P database on libp2p (similar to our use case)
- [Textile](https://github.com/textileio) - P2P data sync

### Community Resources
- [libp2p Discussion Forum](https://discuss.libp2p.io/)
- [IPFS Discord](https://discord.gg/ipfs) - p2p/libp2p channel
- [libp2p Blog](https://blog.libp2p.io/)

### Books & Papers
- [libp2p Specification](https://github.com/libp2p/specs)
- Noise Protocol Framework (encryption): [noiseprotocol.org](https://noiseprotocol.org/)
- QUIC Protocol (future transport): [IETF QUIC WG](https://datatracker.ietf.org/wg/quic/about/)

---

## Success Metrics

How do we know we're learning effectively?

### Documentation Coverage
- [ ] Every libp2p concept we use has a `concept-[name].md` explainer
- [ ] Every major blocker has a `note-YYMMDD-[issue].md` postmortem
- [ ] Every architectural choice has an ADR
- [ ] Weekly learning logs are up-to-date

### Code Quality
- [ ] libp2p code has extensive inline comments explaining "why"
- [ ] Complex patterns are abstracted into well-named functions
- [ ] Error messages are actionable (not just "connection failed")
- [ ] Unit tests serve as documentation (test names explain behavior)

### Team Capability
- [ ] New contributor can understand libp2p integration from docs alone
- [ ] We can explain our choices to external auditors/contributors
- [ ] We can confidently debug libp2p issues without guessing
- [ ] We've contributed learnings back to libp2p community (blog posts, examples)

---

## Open Questions (To Be Answered as We Learn)

### Technical
1. **libp2p in Electron utility process**: Does it work out-of-box or require polyfills?
2. **PeerID persistence**: Where do we store peer keys (userData directory)?
3. **Connection limits**: What's a reasonable max peer count for collaborative playlists?
4. **Protocol buffers vs JSON**: Should we use protobuf for RxDB replication messages?
5. **libp2p metrics**: How do we instrument for debugging (logs, metrics, traces)?

### Architectural
6. **RxDB + libp2p**: Does RxDB have native libp2p support, or do we build custom replication?
7. **Utility process lifecycle**: Do we restart libp2p node if it crashes?
8. **Multi-instance**: What if user runs multiple WhatNext windows? One libp2p node or many?

### Operational
9. **Relay server hosting**: Self-hosted VPS or Cloudflare? Cost estimates?
10. **Bootstrap nodes**: Use public libp2p bootstrap nodes or deploy our own?
11. **Monitoring**: How do we track relay server health in production?

**These will be answered and documented as we progress.**

---

## Commitment

This learning roadmap is a **living document**. As we discover new questions, patterns, and insights, we'll update it.

**Every team member** (including AI assistants) should:
- ✅ Document learnings in real-time (not retroactively)
- ✅ Favor over-documentation over under-documentation
- ✅ Write for future contributors who know nothing about libp2p
- ✅ Capture mistakes and dead-ends (not just successes)

**Goal**: By the end of this journey, we'll have a comprehensive libp2p integration guide that serves as a reference for the community.

---

## Next Steps

1. ✅ Commit to libp2p
2. ✅ Create this learning roadmap
3. → Install libp2p dependencies
4. → Create first concept document: `concept-getting-started.md`
5. → Build minimal "hello world" libp2p node in utility process
6. → Document every blocker, insight, and decision along the way

Let's build and learn! 🚀

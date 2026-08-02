---
tags:
  - notes/milestone
  - core/net/p2p/libp2p
  - architecture/decisions
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Monday, March 9th 2026, 12:20:39 am
---

# Issue Implementation Session Summary

__Date__: 2025-11-10
__Issue__: - Handle `whtnxt://connect` Custom Protocol
__Status__: 🔄 In Progress - Foundation Complete, Integration Remaining

---

## Session Overview

This session focused on establishing the architectural foundation for P2P connections in WhatNext, including the critical decision to use libp2p and the utility process pattern.

---

## Major Decisions Made

### ✅ Decision 1: P2P Service as Utility Process

__Decision__: Run P2P networking in a separate Electron utility process, isolated from main and renderer.

__Rationale__:
- Clean separation of concerns (MVC-like pattern)
- Process isolation prevents P2P crashes from taking down the app
- Easier testing and debugging
- Aligns with future migration to standalone `/service` directory

__Documented__: `/docs/notes/note-251110-p2p-utility-process-architecture.md`

---

### ✅ Decision 2: libp2p Over Simple-peer

__Decision__: Commit to libp2p despite steeper learning curve.

__Rationale__:
- Native mesh networking (essential for multi-peer collaboration)
- Built-in security (Noise protocol, cryptographic peer identity)
- mDNS auto-discovery (killer feature for local collaboration)
- Multiple transports (WebRTC, TCP, WebSocket, QUIC)
- Long-term maintainability (Protocol Labs backing)
- Aligns with user sovereignty principle (DHT-based peer discovery)

__Trade-offs Accepted__:
- 2-3 week learning curve investment
- 500KB bundle size (acceptable for desktop app)
- Higher initial complexity

__Documented__: `/docs/notes/note-251110-libp2p-vs-simple-peer-analysis.md`

---

### ✅ Decision 3: Architecture-First Approach

__Decision__: Build proper architectural foundations now, not after MVP.

__Rationale__:
- Easier to refactor with clear abstractions
- Shared core library enables future test peer infrastructure
- Well-documented learnings serve as institutional knowledge
- Reduces technical debt

__Commitment__: Rigorously document all learnings, discoveries, and decisions.

__Documented__: `/docs/notes/note-251110-libp2p-learning-roadmap.md`

---

## Work Completed

### 1. Shared Core Library (`/app/src/shared/core`)

__Purpose__: Environment-agnostic code shared across main, utility, and renderer processes.

__Files Created__:
- ✅ `types.ts` - Core P2P type definitions (PeerId, ConnectionState, P2PMessage, etc.)
- ✅ `protocol.ts` - `whtnxt://` URL parsing and generation utilities
- ✅ `ipc-protocol.ts` - Message contracts for inter-process communication
- ✅ `index.ts` - Barrel export

__Key Features__:
- Protocol URL parsing: `whtnxt://connect/<peerId>?relay=…`
- PeerID validation (supports CIDv0, CIDv1, base58, base32)
- Type-safe IPC message creation
- Extensible message protocol for future features

__LEARNING NOTES__:
- Inline comments explain "why" decisions were made
- Functions are documented with their purpose and libp2p concepts
- Validation functions include examples of valid/invalid inputs

---

### 2. P2P Utility Process (`/app/src/utility`)

__Purpose__: Runs libp2p node in isolated Node.js process.

__Files Created__:
- ✅ `p2p-service.ts` - Utility process entry point with libp2p node management

__Key Features__:
- libp2p node lifecycle (start/stop)
- MessagePort communication with main process
- Event listeners for peer discovery and connections
- mDNS auto-discovery configuration
- Connection manager with limits
- Comprehensive logging

__Minimal libp2p Configuration__:

```typescript
{
  connectionEncryption: [noise()],       // Noise protocol for encryption
  streamMuxers: [yamux()],               // Stream multiplexing
  transports: [webRTC()],                // WebRTC for P2P
  peerDiscovery: [mdns()],               // Local network auto-discovery
  connectionManager: { maxConnections: 10 }
}
```

__LEARNING NOTES EMBEDDED__:
- Why each libp2p configuration option was chosen
- Known limitations (e.g., WebRTC may need polyfill in Node.js)
- Future improvements (add TCP/WebSocket transports)
- Event handling patterns

---

### 3. Documentation Created

__Architecture Decision Records__:
1. ✅ `note-251110-p2p-utility-process-architecture.md` - Utility process design
   - Process isolation rationale
   - IPC communication protocol
   - Architecture diagrams
   - Migration path to standalone service

2. ✅ `note-251110-libp2p-vs-simple-peer-analysis.md` - Library selection analysis
   - Feature comparison matrix
   - NAT traversal strategies
   - Mesh networking requirements
   - RxDB replication integration
   - Bundle size trade-offs
   - Risk analysis

3. ✅ `note-251110-libp2p-learning-roadmap.md` - Learning strategy
   - Phase-by-phase milestones (Weeks 1-10)
   - Documentation templates
   - Experiment ideas
   - Knowledge sharing strategy
   - Open questions to investigate

4. ✅ `note-251110-libp2p-first-implementation-learnings.md` - Early discoveries
   - Dial requires multiaddrs, not just peer IDs
   - PeerID string vs libp2p PeerId object conversion
   - WebRTC transport configuration challenges
   - mDNS peer filtering strategies
   - Utility process vs worker threads
   - Build configuration needs

---

## Key Learnings Documented

### Learning: Dialing Peers Requires Multiaddrs

__Problem__: `whtnxt://connect/<peerId>` URLs only contain peer ID, but libp2p's `dial()` requires full multiaddr (IP + port + transport).

__Solutions Identified__:
1. mDNS discovery populates peerStore with multiaddrs (MVP approach)
2. Include relay multiaddr in URL query params (Phase 2)
3. DHT peer routing for global peer lookup (Phase 3)

---

### Learning: WebRTC in Node.js Utility Process

__Potential Blocker__: `@libp2p/webrtc` may require browser APIs not available in Node.js.

__Investigation Needed__:
- Test if WebRTC works in utility process
- Check if `wrtc` polyfill is needed
- Consider `@libp2p/webrtc-direct` as alternative
- Add TCP/WebSocket transports as fallbacks

__Status__: ⚠️ Needs testing before proceeding

---

### Learning: mDNS Discovers All libp2p Peers

__Problem__: mDNS will discover IPFS Desktop and other libp2p apps on same network.

__Solution for MVP__: Post-connection handshake filtering
- Accept all discovered peers
- Send WhatNext-specific handshake message
- Disconnect if peer doesn't respond correctly

---

## Remaining Work (Issue)

### Immediate Next Steps

1. __⚠️ BLOCKER: Test libp2p WebRTC in Utility Process__
   - Create minimal test script
   - Verify WebRTC transport works in Node.js
   - Add fallback transports if needed (TCP, WebSocket)

2. __Update Build Configuration__
   - Add utility process as tsup entry point
   - Output to `dist/p2p-service.js`
   - Test bundled utility process can be spawned

3. __Implement Main Process Integration__
   - Register `whtnxt://` protocol handler (`app.setAsDefaultProtocolClient()`)
   - Spawn utility process on app startup
   - Forward protocol URLs to utility process via MessagePort
   - Relay utility events to renderer via IPC

4. __Update Preload Script__
   - Expose P2P connection API to renderer:
     - `window.electron.p2p.connect(peerId)`
     - `window.electron.p2p.onConnectionRequest(callback)`
     - `window.electron.p2p.getConnectedPeers()`

5. __Build Minimal UI (Renderer)__
   - Connection status indicator
   - List of discovered peers
   - Connection request dialog
   - Manual multiaddr input for testing

6. __Test End-to-End__
   - Start two Electron instances on same WiFi
   - Verify mDNS discovers both peers
   - Test manual connection via `whtnxt://` URL
   - Verify connection events propagate to UI

---

## Blockers & Risks

### ⚠️ High Priority Blockers

1. __WebRTC in Node.js__: Needs immediate testing
   - If WebRTC doesn't work, must add TCP/WebSocket transports
   - May need `wrtc` polyfill package
   - Could delay timeline by 1-2 days

2. __Build Configuration__: Utility process bundling not tested
   - tsup may need special config for worker threads
   - Dependencies (libp2p) may not bundle cleanly
   - Could require webpack/rollup instead of tsup

### Medium Priority Risks

3. __PeerID Conversion__: Need `@libp2p/peer-id` package
   - Missing utility for string ↔ PeerId object conversion
   - Low risk: Well-documented libp2p API

4. __MessagePort Communication__: Not tested in Electron
   - Electron's utilityProcess API is relatively new
   - May have quirks or limitations
   - Fallback: Use traditional child_process.fork()

---

## Architecture Artifacts Created

### Directory Structure

```ts
/app/src
  /shared               # 🆕 Shared across all processes
    /core
      types.ts          # P2P type definitions
      protocol.ts       # whtnxt:// URL handling
      ipc-protocol.ts   # IPC message contracts
      index.ts          # Barrel export

  /utility              # 🆕 Utility process (P2P service)
    p2p-service.ts      # libp2p node manager

  /main                 # Main process (existing)
    main.ts             # TODO: Add protocol handler, spawn utility
    preload.ts          # TODO: Expose P2P API

  /renderer             # Renderer process (existing)
    # TODO: P2P UI components
```

### Documentation Structure

```ts
/docs/notes
  note-251110-p2p-utility-process-architecture.md
  note-251110-libp2p-vs-simple-peer-analysis.md
  note-251110-libp2p-learning-roadmap.md
  note-251110-libp2p-first-implementation-learnings.md
  note-251110-issue-10-session-summary.md  # This file
```

---

## Success Metrics

### What We've Achieved

- ✅ Architectural foundation established
- ✅ libp2p integration started with minimal config
- ✅ Shared core library enables future test peers
- ✅ Comprehensive documentation of decisions and learnings
- ✅ Clear roadmap for remaining work

### What Success Looks Like (Issue Complete)

- [ ] `whtnxt://connect/<peerId>` URLs launch app
- [ ] Two instances on same WiFi auto-discover via mDNS
- [ ] User can click discovered peer to initiate connection
- [ ] Connection established, displayed in UI
- [ ] Foundation ready for RxDB replication (Phase 2)

---

## Timeline Estimate

### Original Estimate: 1-2 Weeks

### Revised Estimate: 2-3 Weeks (due to Learning curve)

__Breakdown__:
- Foundation (this session): ✅ Complete (~2 days)
- WebRTC testing & fixes: ⚠️ 1-2 days
- Build config & spawning: 1 day
- Main/preload integration: 2 days
- Renderer UI: 2 days
- Testing & debugging: 2-3 days
- Documentation polish: 1 day

__Total__: ~10-14 days (2-3 weeks)

---

## Next Session Priorities

1. __Immediate__:
   - Test WebRTC transport in utility process
   - Resolve any polyfill requirements
   - Update build scripts

2. __Short-term__:
   - Complete main process integration
   - Update preload script
   - Build minimal UI

3. __Testing__:
   - Two-instance mDNS discovery
   - Connection lifecycle
   - Error handling

---

## Questions for Maintainer

1. __WebRTC Fallback__: If WebRTC doesn't work in Node.js, should we prioritize fixing it or adding TCP transport first?

2. __UI Scope__: For issue, should we build full UI (discovered peers list, connection dialogs) or minimal proof-of-concept?

3. __Testing Priority__: Should we write automated tests before completing E2E flow, or validate manually first?

4. __Documentation Cadence__: Is current documentation level appropriate, or should we document less and iterate faster?

---

## Related Concepts

[[libp2p]] [[P2P-Discovery]] [[adr-251110-libp2p-vs-simple-peer]] [[adr-251110-electron-process-model]]

---

## References

- Issue: Handle `whtnxt://connect` Custom Protocol
- Spec §2.3: Backend & Network Architecture
- Spec §4.3: Collaborative & Social Features
- `CLAUDE.md`: Development Commands, Architecture Principles
- [libp2p Documentation](https://docs.libp2p.io/)
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)

---

## Commit Message Template (for next commit)

```ts
feat(p2p): Implement libp2p utility process foundation for issue #10

- Add shared core library for P2P types, protocol parsing, IPC contracts
- Implement P2P utility process with libp2p node manager
- Configure minimal libp2p (WebRTC, mDNS, Noise, yamux)
- Document architecture decisions and learning roadmap

Breaking changes: None (new feature, no existing code modified)

Refs: #10
```

---

## End of Session Summary

__Status__: Foundation complete, ready for integration phase.

__Confidence__: High on architecture, medium on WebRTC compatibility (needs testing).

__Next Steps__: Test WebRTC in utility process, update build config, implement main process integration.

__Documentation Quality__: Comprehensive - all major decisions captured with rationale.

__Learning Velocity__: On track - expected to hit stride as libp2p concepts solidify.


# P2P Utility Process Architecture

**Date**: 2025-11-10
**Issue**: #10 - Handle `whtnxt://connect` Custom Protocol
**Status**: 🔄 In Progress - Architecture Design Phase

## Architectural Decision: P2P Service as Utility Process

### Context

While implementing the `whtnxt://` protocol handler for P2P connections, we need to decide where the P2P networking logic lives in the Electron architecture.

### Decision

**The P2P connection management service will run as a separate Electron utility process, isolated from both the main process (controller) and renderer process (view).**

### Rationale

#### Separation of Concerns (MVC-like Pattern)
- **Main Process**: Controller - handles application lifecycle, window management, protocol registration, and orchestration
- **Utility Process**: Service Layer - handles P2P networking, WebRTC connections, signaling, and RxDB replication coordination
- **Renderer Process**: View - handles UI rendering, user interactions, and presents connection state

#### Technical Benefits

1. **Process Isolation**
   - P2P networking code runs in its own Node.js process
   - Crashes in P2P logic don't take down the main window or app
   - Memory leaks or performance issues in WebRTC are isolated
   - Easier debugging: can attach Node.js debugger to utility process independently

2. **Clean IPC Boundaries**
   - Main process receives protocol URLs → forwards to utility process
   - Utility process emits connection events → main process → renderer
   - Clear message-passing architecture enforces loose coupling
   - Aligns with Electron security best practices

3. **Future Scalability**
   - Can spawn multiple utility processes for multiple concurrent P2P sessions
   - Easier to move to separate service later (per spec's `/service` directory vision)
   - Enables testing utility process independently without Electron overhead

4. **RxDB Integration**
   - Utility process owns RxDB instance for P2P replication
   - Renderer can query read-only views via IPC or shared database file
   - Separates data sync logic from UI rendering

#### Architectural Alignment

This aligns with:
- **Spec §2.3**: Helper service for P2P signaling (this utility process is the MVP precursor)
- **CLAUDE.md**: "Minimize IPC surface" (utility process encapsulates all P2P complexity)
- **Security Posture**: Further isolation from renderer sandbox

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Operating System                        │
│  (Receives whtnxt://connect URLs from browser/links)        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Protocol Handler Registration
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   MAIN PROCESS (Controller)                 │
│  - App lifecycle                                            │
│  - Window management                                        │
│  - Protocol registration (app.setAsDefaultProtocolClient)   │
│  - IPC orchestration                                        │
│                                                             │
│  Responsibilities:                                          │
│  1. Receive whtnxt:// URLs from OS                          │
│  2. Forward to Utility Process via MessagePort/IPC          │
│  3. Relay connection events to Renderer                     │
│  4. Manage utility process lifecycle (spawn/kill)           │
└──────────────┬─────────────────────────────┬────────────────┘
               │                             │
               │ MessagePort/IPC             │ IPC via preload
               │                             │
               ▼                             ▼
┌──────────────────────────────┐  ┌─────────────────────────┐
│  UTILITY PROCESS (Service)   │  │  RENDERER PROCESS (View)│
│  - P2P connection management │  │  - React UI             │
│  - WebRTC (simple-peer)      │  │  - User interactions    │
│  - Signaling protocol        │  │  - Connection status UI │
│  - RxDB replication engine   │  │  - Playlist views       │
│  - Peer discovery            │  │                         │
│                              │  │  Responsibilities:      │
│  Responsibilities:           │  │  1. Display connection  │
│  1. Parse whtnxt:// URLs     │  │     requests            │
│  2. Initiate WebRTC          │  │  2. Show peer status    │
│     connections              │  │  3. Render playlists    │
│  3. Manage peer lifecycle    │  │  4. User confirmations  │
│  4. Coordinate RxDB sync     │  │                         │
│  5. Emit connection events   │  │                         │
└──────────────────────────────┘  └─────────────────────────┘
               │
               │ P2P Network (WebRTC)
               ▼
┌──────────────────────────────────────────────────────────────┐
│                    REMOTE PEERS                              │
│  (Other WhatNext instances running same architecture)        │
└──────────────────────────────────────────────────────────────┘
```

### Implementation Strategy

#### Phase 1: Foundation (Issue #10)
1. **Shared Core Library** (`/app/src/shared/core`)
   - Protocol types and parsing logic
   - P2P message protocol definitions
   - Utility process / main process communication contracts

2. **Utility Process** (`/app/src/utility/p2p-service.ts`)
   - Spawn via `utilityProcess.fork()` in main.ts
   - Receives connection requests via `MessagePort`
   - Manages WebRTC connections using simple-peer
   - Emits connection lifecycle events

3. **Main Process Changes** (`/app/src/main/main.ts`)
   - Register `whtnxt://` protocol handler
   - Spawn utility process on app startup
   - Forward protocol URLs to utility process
   - Relay utility process events to renderer via IPC

4. **Preload Script** (`/app/src/main/preload.ts`)
   - Expose `p2p.onConnectionRequest(callback)`
   - Expose `p2p.acceptConnection(peerId)`
   - Expose `p2p.rejectConnection(peerId)`
   - Expose `p2p.getConnectedPeers()`

5. **Renderer Integration** (`/app/src/renderer/services/`)
   - React hooks: `useP2PConnection()`, `useConnectedPeers()`
   - UI components for connection requests
   - Zustand store for connection state (backed by IPC)

#### Phase 2: Advanced Features (Post-MVP)
- Migrate utility process logic to `/service` directory (separate repo/process)
- Implement signaling server in helper service
- Add WebRTC connection pooling
- Implement CRDT conflict resolution
- Add encryption layer

### IPC Communication Protocol

#### Main Process → Utility Process
```typescript
// Main sends to Utility via MessagePort
{
  type: 'connection:initiate',
  payload: {
    peerId: string,
    metadata?: Record<string, unknown>
  }
}
```

#### Utility Process → Main Process
```typescript
// Utility sends to Main via MessagePort
{
  type: 'connection:request',
  payload: {
    peerId: string,
    displayName: string,
    timestamp: string
  }
}

{
  type: 'connection:established',
  payload: {
    peerId: string
  }
}

{
  type: 'connection:failed',
  payload: {
    peerId: string,
    error: string
  }
}
```

#### Main Process → Renderer (via IPC)
```typescript
// Main relays to Renderer via ipcRenderer
ipcRenderer.send('p2p:connection-request', { peerId, displayName })
ipcRenderer.send('p2p:connection-established', { peerId })
ipcRenderer.send('p2p:connection-failed', { peerId, error })
```

### File Structure

```
/app
  /src
    /shared                      # 🆕 Shared code across processes
      /core
        /protocol.ts             # whtnxt:// URL parsing
        /types.ts                # P2P message types
        /ipc-protocol.ts         # IPC message contracts

    /utility                     # 🆕 Utility process (P2P service)
      /p2p-service.ts            # Main entry point for utility process
      /connection-manager.ts     # WebRTC connection lifecycle
      /signaling-client.ts       # Signaling protocol (manual for MVP)
      /replication-engine.ts     # RxDB P2P replication coordination

    /main
      /main.ts                   # Spawn utility process, protocol registration
      /protocol-handler.ts       # 🆕 Protocol URL handling logic
      /utility-bridge.ts         # 🆕 MessagePort bridge to utility process

    /renderer
      /services
        /p2p-client.ts           # 🆕 IPC client for P2P features
      /hooks
        /useP2PConnection.ts     # 🆕 React hook for connection state
      /components
        /Connection
          /ConnectionRequest.tsx  # 🆕 UI for incoming connection requests
          /PeerList.tsx           # 🆕 UI for connected peers
```

### Security Considerations

1. **Process Sandboxing**
   - Utility process has no window/UI access
   - Cannot spawn child processes without explicit permission
   - Limited filesystem access (only RxDB data directory)

2. **IPC Validation**
   - All messages validated against schemas before processing
   - Peer IDs validated (length, charset) to prevent injection
   - Rate limiting on connection requests

3. **WebRTC Security**
   - Only accept connections from known peers (after user approval)
   - Implement connection timeout (30s default)
   - Validate SDP offers/answers before accepting

### Testing Strategy

1. **Unit Tests**
   - Protocol URL parsing (shared core)
   - Message validation
   - Connection state machine

2. **Integration Tests**
   - Main ↔ Utility IPC communication
   - Utility ↔ Renderer IPC relay
   - Protocol handler registration

3. **E2E Tests** (Future: Barebones Test Peer)
   - Spawn 2 utility processes programmatically
   - Simulate connection handshake
   - Verify RxDB replication

### Migration Path to `/service` (Phase 3+)

The utility process architecture is designed as a stepping stone to the spec's `/service` directory vision:

1. **Current**: Utility process spawned by main process
2. **Future**: Standalone service (Express/Fastify) that multiple Electron instances connect to
3. **Migration**: Swap MessagePort IPC with WebSocket client in main.ts; business logic unchanged

The shared core library (`/app/src/shared/core`) becomes the protocol contract between client and service.

### Performance Considerations

- **Startup Time**: Utility process spawns async after main window loads (non-blocking)
- **Memory**: ~30-50MB overhead per utility process (acceptable for P2P service)
- **IPC Latency**: MessagePort is ~0.1ms (negligible for connection events)
- **WebRTC Throughput**: Isolated process prevents renderer jank during data transfer

### Alternatives Considered (and Rejected)

#### ❌ Run P2P in Main Process
- **Problem**: Ties networking logic to app controller
- **Problem**: Main process complexity grows unbounded
- **Problem**: Harder to test in isolation

#### ❌ Run P2P in Renderer Process
- **Problem**: Violates security sandbox (Node.js required for WebRTC)
- **Problem**: Connection survives window close/reload is awkward
- **Problem**: Cannot run headless for testing

#### ❌ Web Workers in Renderer
- **Problem**: No Node.js APIs (WebRTC requires Node)
- **Problem**: Limited IPC capabilities
- **Problem**: Doesn't help with process isolation

### Open Questions

1. **RxDB Instance Location**: Should utility process own RxDB, or should main process own it and utility process coordinate replication?
   - **Leaning towards**: Utility process owns RxDB instance for P2P collections
   - **Rationale**: Keeps all replication logic in one place

2. **Multi-Peer Connections**: Spawn one utility process per peer, or one utility process managing all peers?
   - **Leaning towards**: One utility process, multiple connections
   - **Rationale**: Simpler IPC, easier state management, can scale to N utility processes later if needed

3. **Signaling for MVP**: Manual copy-paste or integrate a public signaling service?
   - **Decision**: Manual copy-paste for issue #10, build signaling in separate issue

### Success Criteria

This architecture is successful if:
- [ ] Utility process can be spawned/killed independently
- [ ] Protocol URL handling works end-to-end (OS → main → utility → renderer)
- [ ] Connection state survives renderer hot-reload (dev mode)
- [ ] Can test P2P logic without starting full Electron app
- [ ] Clear migration path to standalone `/service` process

---

## Next Steps

1. ✅ Document architecture decision (this file)
2. Create `/app/src/shared/core` directory structure
3. Implement protocol parsing logic
4. Create utility process scaffold
5. Implement MessagePort bridge in main.ts
6. Build IPC relay to renderer via preload
7. Test with two Electron instances

---

## References

- Issue #10: Handle `whtnxt://connect` Custom Protocol
- Spec §2.3: Backend & Network Architecture
- CLAUDE.md: Architecture Principles (IPC Communication)
- Electron Docs: [Utility Process](https://www.electronjs.org/docs/latest/api/utility-process)
- [note-251109-custom-protocol-barebones-peer.md](note-251109-custom-protocol-barebones-peer.md): Test peer architecture

# ADR: Electron Process Model for P2P Architecture

**Date**: 2025-11-10
**Status**: ✅ Accepted
**Issue**: #10 - P2P Integration

#architecture/decisions #core/electron #p2p

## Context

While implementing the `whtnxt://` protocol handler for P2P connections, we needed to decide where P2P networking logic lives within Electron's multi-process architecture. The decision impacts security, maintainability, performance, and future scalability.

## Decision

**The P2P connection management service runs as a separate Electron utility process, isolated from both the main process (controller) and renderer process (view).**

## Architecture

### Four-Process Model

```
┌──────────────────────────────────────────────┐
│            Operating System                  │
│  (Receives whtnxt:// URLs from browser)      │
└────────────────┬─────────────────────────────┘
                 │ Protocol Handler
                 ▼
┌──────────────────────────────────────────────┐
│        MAIN PROCESS (Controller)             │
│  • App lifecycle                             │
│  • Window management                         │
│  • Protocol registration                     │
│  • IPC orchestration                         │
└──────┬──────────────────────────┬────────────┘
       │ MessagePort              │ IPC (preload)
       ▼                          ▼
┌─────────────────┐      ┌─────────────────────┐
│ UTILITY PROCESS │      │ RENDERER (View)     │
│   (Service)     │      │  • React UI         │
│  • libp2p node  │      │  • User interactions│
│  • WebRTC       │      │  • Connection status│
│  • P2P logic    │      │  • RxDB queries     │
└─────────────────┘      └─────────────────────┘
       │ P2P Network
       ▼
    [Other Peers]
```

### Communication Flow

1. **Protocol URL received**: OS → Main Process
2. **Connection initiation**: Main → Utility Process (via MessagePort)
3. **P2P connection**: Utility Process → Remote Peer (libp2p)
4. **State updates**: Renderer polls Main Process every 1s for status

## Rationale

### 1. Separation of Concerns (MVC Pattern)

- **Main Process**: Controller - orchestration, lifecycle, protocol handling
- **Utility Process**: Service - P2P networking, WebRTC, libp2p node
- **Renderer Process**: View - UI rendering, user interactions

**Benefits**:
- Clear responsibilities
- Easier to reason about data flow
- Natural alignment with architectural boundaries

### 2. Process Isolation

**Security**:
- P2P code runs in isolated Node.js process
- Additional layer beyond renderer sandbox
- Minimizes IPC attack surface

**Stability**:
- Crashes in P2P logic don't take down main window
- Memory leaks in WebRTC are isolated
- Utility process can be restarted without app restart

**Performance**:
- CPU-intensive P2P operations don't block UI thread
- libp2p runs in dedicated process with full Node.js access

### 3. Clean IPC Boundaries

**Main ↔ Utility** (MessagePort):
- Unidirectional commands from main to utility
- State stored in main process, updated by utility
- No circular dependencies

**Main ↔ Renderer** (IPC via preload):
- Renderer polls for state (pull-based, not push-based)
- No timing dependencies or race conditions
- Type-safe API surface via contextBridge

### 4. Future Scalability

**Alignment with spec §2.3**:
- Utility process is MVP precursor to `/service` helper backend
- Can be extracted to standalone Node.js service later
- Same architecture works for desktop and web clients

**Multi-instance support**:
- Can spawn multiple utility processes for concurrent sessions
- Each process manages its own libp2p node independently

**Testing**:
- Utility process can be tested without Electron overhead
- libp2p logic tested via standalone Node.js scripts

## Alternatives Considered

### Alternative 1: P2P in Main Process

**Pros**:
- Simpler architecture (no utility process)
- Direct IPC from main to renderer
- No MessagePort complexity

**Cons**:
- ❌ P2P logic coupled to main process lifecycle
- ❌ CPU-intensive operations block main thread
- ❌ Harder to isolate for testing
- ❌ Can't scale to multiple concurrent sessions

**Rejected**: Violates separation of concerns, poor scalability

### Alternative 2: P2P in Renderer Process

**Pros**:
- Direct access to React state
- No IPC for P2P operations
- Simpler state management

**Cons**:
- ❌ Security risk (renderer has limited Node.js access)
- ❌ libp2p requires full Node.js environment (not available in renderer)
- ❌ Performance impact on UI responsiveness
- ❌ Violates Electron security best practices

**Rejected**: Security and compatibility issues

### Alternative 3: Separate Node.js Service (per spec)

**Pros**:
- ✅ True microservice architecture
- ✅ Can be deployed independently
- ✅ Scales horizontally

**Cons**:
- ⚠️ Overengineered for MVP
- ⚠️ Requires network communication (HTTP/WebSocket)
- ⚠️ Deployment complexity

**Future consideration**: Utility process can be migrated to this pattern later

## Consequences

### Positive

✅ **Security**: Additional isolation layer for P2P networking
✅ **Stability**: Process crashes don't affect main app
✅ **Performance**: P2P operations don't block UI
✅ **Testability**: libp2p logic can be tested independently
✅ **Scalability**: Clear migration path to service architecture
✅ **Maintainability**: Clean separation of concerns

### Negative

⚠️ **Complexity**: Four processes instead of two
⚠️ **IPC overhead**: MessagePort communication adds latency (~1ms)
⚠️ **Debugging**: Requires attaching to multiple processes
⚠️ **State management**: P2P state must be synchronized across processes

### Mitigation Strategies

**Complexity**:
- Well-documented IPC protocols
- Clear process lifecycle management
- Abstraction layers hide MessagePort details from business logic

**State synchronization**:
- Pull-based polling (renderer → main)
- Single source of truth (main process holds P2P state)
- 1-second poll interval balances freshness vs overhead

**Debugging**:
- Comprehensive logging in each process
- Development helpers (`window.p2pDebug()`)
- Test peer for isolated testing

## Implementation Notes

### Utility Process Spawning

```typescript
// main.ts
import { utilityProcess } from 'electron';

const p2pProcess = utilityProcess.fork(
    path.join(__dirname, 'p2p-service.js')
);

p2pProcess.postMessage({ type: 'START_NODE' });

p2pProcess.on('message', (message) => {
    // Update p2pState based on utility messages
    if (message.type === 'node_started') {
        p2pState.nodeStarted = true;
        p2pState.peerId = message.peerId;
    }
});
```

### Pull-Based State Polling

```typescript
// Renderer pulls state every 1s
const pollStatus = async () => {
    const status = await window.electron.p2p.getStatus();
    setNodeStatus(status.nodeStarted ? 'running' : 'starting');
    setLocalPeerId(status.peerId);
    setDiscoveredPeers(status.discoveredPeers);

    if (polling) {
        setTimeout(pollStatus, 1000);
    }
};
```

**Why pull-based**: Avoids timing dependencies where events arrive before listeners are registered. Renderer always pulls when ready.

### Protocol URL Handling

```typescript
// Main process receives protocol URL
app.on('open-url', (event, url) => {
    event.preventDefault();
    const peerId = extractPeerIdFromUrl(url);
    p2pProcess.postMessage({
        type: 'CONNECT_TO_PEER',
        peerId
    });
});
```

## Related Concepts

- [[Electron-IPC]] - IPC patterns for main ↔ renderer communication
- [[libp2p]] - P2P library running in utility process
- [[WebRTC]] - Transport layer in utility process

## References

### Implementation Files
- Main process: `app/src/main/main.ts`
- Utility process: `app/src/utility/p2p-service.ts`
- Preload script: `app/src/main/preload.ts`
- Renderer UI: `app/src/renderer/components/P2P/P2PStatus.tsx`

### Related ADRs
- [[adr-251110-libp2p-vs-simple-peer]] - Why libp2p chosen for P2P networking

### Specification
- WhatNext spec §2.3: Helper Backend Service
- CLAUDE.md: Security Posture (sandbox enforcement)

---

**Status**: ✅ Implemented and production-ready in v0.0.0
**Review Date**: 2026-01-10 (re-evaluate after 2 months of production use)

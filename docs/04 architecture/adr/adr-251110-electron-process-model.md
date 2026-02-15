---
tags:
  - architecture/decisions
  - core/electron
  - net
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Thursday, November 13th 2025, 5:22:49 am
---

# ADR: Electron Process Model for P2P Architecture

__Date__: 2025-11-10
__Status__: ✅ Accepted
__Issue__: - P2P Integration

## Context

While implementing the `whtnxt://` protocol handler for P2P connections, we needed to decide where P2P networking logic lives within Electron's multi-process architecture. The decision impacts security, maintainability, performance, and future scalability.

## Decision

__The P2P connection management service runs as a separate Electron utility process, isolated from both the main process (controller) and renderer process (view).__

## Architecture

### Four-Process Model

```ts
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

1. __Protocol URL received__: OS → Main Process
2. __Connection initiation__: Main → Utility Process (via MessagePort)
3. __P2P connection__: Utility Process → Remote Peer (libp2p)
4. __State updates__: Renderer polls Main Process every 1s for status

## Rationale

### 1. Separation of Concerns (MVC Pattern)

- __Main Process__: Controller - orchestration, lifecycle, protocol handling
- __Utility Process__: Service - P2P networking, WebRTC, libp2p node
- __Renderer Process__: View - UI rendering, user interactions

__Benefits__:
- Clear responsibilities
- Easier to reason about data flow
- Natural alignment with architectural boundaries

### 2. Process Isolation

__Security__:
- P2P code runs in isolated Node.js process
- Additional layer beyond renderer sandbox
- Minimizes IPC attack surface

__Stability__:
- Crashes in P2P logic don't take down main window
- Memory leaks in WebRTC are isolated
- Utility process can be restarted without app restart

__Performance__:
- CPU-intensive P2P operations don't block UI thread
- libp2p runs in dedicated process with full Node.js access

### 3. Clean IPC Boundaries

__Main ↔ Utility__ (MessagePort):
- Unidirectional commands from main to utility
- State stored in main process, updated by utility
- No circular dependencies

__Main ↔ Renderer__ (IPC via preload):
- Renderer polls for state (pull-based, not push-based)
- No timing dependencies or race conditions
- Type-safe API surface via contextBridge

### 4. Future Scalability

__Alignment with spec §2.3__:
- Utility process is MVP precursor to `/service` helper backend
- Can be extracted to standalone Node.js service later
- Same architecture works for desktop and web clients

__Multi-instance support__:
- Can spawn multiple utility processes for concurrent sessions
- Each process manages its own libp2p node independently

__Testing__:
- Utility process can be tested without Electron overhead
- libp2p logic tested via standalone Node.js scripts

## Alternatives Considered

### Alternative 1: P2P in Main Process

__Pros__:
- Simpler architecture (no utility process)
- Direct IPC from main to renderer
- No MessagePort complexity

__Cons__:
- ❌ P2P logic coupled to main process lifecycle
- ❌ CPU-intensive operations block main thread
- ❌ Harder to isolate for testing
- ❌ Can't scale to multiple concurrent sessions

__Rejected__: Violates separation of concerns, poor scalability

### Alternative 2: P2P in Renderer Process

__Pros__:
- Direct access to React state
- No IPC for P2P operations
- Simpler state management

__Cons__:
- ❌ Security risk (renderer has limited Node.js access)
- ❌ libp2p requires full Node.js environment (not available in renderer)
- ❌ Performance impact on UI responsiveness
- ❌ Violates Electron security best practices

__Rejected__: Security and compatibility issues

### Alternative 3: Separate Node.js Service (per spec)

__Pros__:
- ✅ True microservice architecture
- ✅ Can be deployed independently
- ✅ Scales horizontally

__Cons__:
- ⚠️ Overengineered for MVP
- ⚠️ Requires network communication (HTTP/WebSocket)
- ⚠️ Deployment complexity

__Future consideration__: Utility process can be migrated to this pattern later

## Consequences

### Positive

✅ __Security__: Additional isolation layer for P2P networking
✅ __Stability__: Process crashes don't affect main app
✅ __Performance__: P2P operations don't block UI
✅ __Testability__: libp2p logic can be tested independently
✅ __Scalability__: Clear migration path to service architecture
✅ __Maintainability__: Clean separation of concerns

### Negative

⚠️ __Complexity__: Four processes instead of two
⚠️ __IPC overhead__: MessagePort communication adds latency (~1ms)
⚠️ __Debugging__: Requires attaching to multiple processes
⚠️ __State management__: P2P state must be synchronized across processes

### Mitigation Strategies

__Complexity__:
- Well-documented IPC protocols
- Clear process lifecycle management
- Abstraction layers hide MessagePort details from business logic

__State synchronization__:
- Pull-based polling (renderer → main)
- Single source of truth (main process holds P2P state)
- 1-second poll interval balances freshness vs overhead

__Debugging__:
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

__Why pull-based__: Avoids timing dependencies where events arrive before listeners are registered. Renderer always pulls when ready.

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

__Status__: ✅ Implemented and production-ready in v0.0.0
__Review Date__: 2026-01-10 (re-evaluate after 2 months of production use)

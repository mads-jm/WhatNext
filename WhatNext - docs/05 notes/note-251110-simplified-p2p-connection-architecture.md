---
tags:
  - core/net/p2p/libp2p
  - core/net/p2p/protocols
  - core/electron/ipc
  - notes
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Monday, March 9th 2026, 12:20:37 am
---

# Simplified P2P Connection Architecture

__Date__: 2025-11-10
__Status__: ✅ Resolved

## Problem

Initial P2P implementation suffered from complex IPC timing issues:

1. __Push-based IPC events unreliable__: Main process sent events to renderer, but timing was unpredictable
2. __Multiple failure points__:
   - Utility process might not be ready when events sent
   - Window might not be created yet
   - React might not have mounted to set up listeners
3. __Complex 3-process coordination__: Main ↔ Utility ↔ Renderer required careful orchestration
4. __User-hostile connection flow__: Required peers to discover each other via mDNS, then click "Connect"

__User feedback__: "The p2p connection process shouldn't be this painful. Can we not use our custom protocol to connect peers? Isn't that the point?"

## Root Cause

We were trying to force event-driven architecture across process boundaries where timing guarantees are impossible:

```ts
Utility Process → Main Process → Renderer Process
     (fork)           (IPC)          (webContents.send)
        ↓                ↓                   ↓
    Sends READY    Sends START_NODE    Registers listeners
```

__The problem__: Each step is asynchronous with no ordering guarantees. Events could arrive before listeners were registered.

## Solution

### 1. Pull-Based Polling for UI State (Tactical Fix)

Instead of push-based events, the renderer polls the main process every 1 second for P2P state:

__Main Process__ (`main.ts:468-474`):

```typescript
let p2pState = {
    nodeStarted: false,
    peerId: '',
    multiaddrs: [] as string[],
    discoveredPeers: [] as any[],
    connectedPeers: [] as string[],
};

ipcMain.handle('p2p:get-status', async () => {
    return p2pState;
});
```

__Renderer__ (`P2PStatus.tsx:46-87`):

```typescript
const pollStatus = async () => {
    const status = await window.electron.p2p.getStatus();
    setNodeStatus(status.nodeStarted ? 'running' : 'starting');
    setLocalPeerId(status.peerId);
    setDiscoveredPeers(status.discoveredPeers);
    // ... update all state

    if (polling) {
        setTimeout(pollStatus, 1000); // Poll every 1s
    }
};
```

__Advantages__:
- No timing dependencies - renderer pulls when ready
- Simple to reason about - unidirectional data flow
- Degrades gracefully - missed polls just delay UI update by 1s

### 2. Protocol-First Connection (Strategic Fix)

Instead of relying on automatic mDNS discovery + UI click, users can directly connect via `whtnxt://` URLs:

__URL Format__:

```ts
whtnxt://connect/<peerId>
```

__Example__:

```ts
whtnxt://connect/12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN
```

__User Flow__:

1. __Peer A__: Opens WhatNext, sees their connection URL in UI

   ```ts
   Your Connection URL: whtnxt://connect/12D3Koo...
   [Copy URL]
   ```

2. __Peer A__: Copies URL and shares via chat/email/etc

3. __Peer B__: Pastes URL into "Connect via URL" input

   ```ts
   [whtnxt://connect/12D3Koo...] [Connect]
   ```

4. __Connection established__ via libp2p dial

__Implementation__ (`P2PStatus.tsx:129-157`):

```typescript
const handleConnectViaUrl = async () => {
    const url = new URL(connectUrl.trim());
    if (url.protocol !== 'whtnxt:') {
        addDebugLog('Invalid URL: must start with whtnxt://');
        return;
    }

    const peerId = url.pathname.slice(1);
    await window.electron.p2p.connect(peerId);
};
```

__UI Components__:
- Display own connection URL with copy button
- Input field for pasting peer URLs
- One-click connect from pasted URL

__Future Enhancement__: OS-level protocol handler registration allows clicking `whtnxt://` links in browser/email to open app and auto-connect.

## Key Learnings

1. __Pull beats Push for cross-process UI state__: Polling is simple and reliable when 1s latency is acceptable
2. __User-initiated connections > automatic discovery__: Explicit URLs give users control and work across networks
3. __Simplicity > Cleverness__: 3-process event coordination was brittle; polling + direct URLs is robust
4. __Protocol handlers are powerful__: `whtnxt://` URLs enable OS-level integration (share links, deep linking)

## Architecture Comparison

### Before (Push-based, Discovery-first)

```ts
┌─────────────┐    IPC Events     ┌──────────┐
│   Utility   │ ─────────────────→ │   Main   │
│   Process   │  NODE_STARTED,     │ Process  │
│  (libp2p)   │  PEER_DISCOVERED   │          │
└─────────────┘                    └──────────┘
                                        │
                                        │ webContents.send()
                                        ↓
                                   ┌──────────┐
                                   │ Renderer │
                                   │  (React) │
                                   └──────────┘

Problems:
❌ Timing dependencies
❌ Events can be lost
❌ Complex error handling
❌ Requires mDNS discovery
```

### After (Pull-based, URL-first)

```ts
┌─────────────┐    Messages       ┌──────────┐
│   Utility   │ ─────────────────→ │   Main   │
│   Process   │  Update p2pState   │ Process  │
│  (libp2p)   │                    │          │
└─────────────┘                    └──────────┘
                                        ↑
                                        │ getStatus() poll (1s)
                                        │
                                   ┌──────────┐
                                   │ Renderer │
                                   │  (React) │
                                   └──────────┘

User Flow:
1. Copy whtnxt:// URL
2. Share URL (chat, email, etc)
3. Paste URL → Connect

Advantages:
✅ No timing issues
✅ No lost events
✅ Simple unidirectional flow
✅ Works across networks
✅ User has control
```

## Files Modified

### Core Changes

__`app/src/main/main.ts`__:
- Lines 468-474: Added `p2pState` object
- Lines 222-241: Store utility process messages in state
- Lines 492-495: Added `p2p:get-status` handler

__`app/src/main/preload.ts`__:
- Lines 98-99: Added `getStatus()` method to preload API

__`app/src/renderer/components/P2P/P2PStatus.tsx`__:
- Lines 30-115: Replaced event listeners with polling
- Lines 129-157: Added `handleConnectViaUrl()` function
- Lines 170-189: Added "Copy URL" button for own connection URL
- Lines 238-261: Added "Connect via URL" input field

### Existing Infrastructure

Protocol parsing already existed in:
- `app/src/shared/core/protocol.ts`: URL parsing/generation
- `app/src/main/main.ts:269-292`: Protocol handler registration

## Testing Strategy

1. __Polling works__: Start app, verify status updates within 1s
2. __URL copy works__: Click "Copy URL", verify clipboard contains `whtnxt://connect/<peerId>`
3. __URL paste works__: Paste URL into input, click Connect, verify connection established
4. __Cross-instance__: Run two instances, copy URL from A, paste into B, verify connection
5. __Error handling__: Paste invalid URL, verify error message in debug log

## Next Steps

1. ✅ __Complete__: Polling implementation
2. ✅ __Complete__: URL-based connection UI
3. __Future__: OS-level protocol handler (clicking `whtnxt://` links opens app)
4. __Future__: QR code generation for mobile→desktop connections
5. __Future__: Relay server support for NAT traversal (URL param: `?relay=/ip4/…`)

## Related Concepts

[[libp2p]] [[Electron-IPC]] [[Handshake-Protocol]] [[P2P-Discovery]]

---

## References

- Initial issue: - Handle `whtnxt://connect` Custom Protocol
- User feedback: Session 2025-11-10
- libp2p dialing: <https://docs.libp2p.io/concepts/fundamentals/peers/>
- Electron protocol handlers: <https://www.electronjs.org/docs/latest/api/protocol>




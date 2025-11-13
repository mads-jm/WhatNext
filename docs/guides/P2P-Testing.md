# P2P Testing Guide

#guides/testing #p2p #development

## Overview

Guide for testing P2P connections between the Electron app and the barebones test peer. The test peer is a lightweight Node.js CLI tool with identical libp2p configuration, enabling fast iteration without Electron overhead.

## Initial Setup

### Install Dependencies

```bash
# Electron app
cd app
npm install

# Test peer
cd test-peer
npm install
```

**One-time setup complete!**

## Testing Scenarios

### Scenario 1: mDNS Discovery + Manual Connection

Test automatic peer discovery on local network.

#### Terminal 1: Start Test Peer

```bash
cd test-peer
npm start
```

**Expected output:**
```
✅ Node started successfully!
Your Peer ID: 12D3KooW...
👂 Listening for mDNS peer discovery...
```

#### Terminal 2: Start Electron App

```bash
cd app
npm run dev
```

**In Electron window:**
1. Navigate to **"P2P Network"** in sidebar
2. Wait 1-2 seconds for mDNS discovery

**Expected in test peer terminal:**
```
🔍 Peer discovered!
   Peer ID: 12D3KooW[ElectronPeerID]...
   Type 'connect 1' to connect
```

**Expected in Electron UI:**
- Green "Connected" status indicator
- "Discovered Peers (1)" showing test peer
- Your Peer ID displayed

#### Connect from Test Peer

```bash
whatnext> connect 1
```

**Expected:**
```
✅ CONNECTED to peer!
   Total connections: 1
```

**In Electron UI:**
- "Active Connections (1)"
- Green "Connected" button next to test peer

✅ **Success**: Bidirectional connection established via mDNS discovery!

---

### Scenario 2: Connection from Electron UI

Test connection initiation from the app.

**Setup:** Follow Scenario 1 steps until peers are discovered.

**In Electron UI:** Click the **"Connect"** button next to discovered test peer.

**Expected:**
- Button changes to green "Connected"
- Test peer terminal shows: `✅ CONNECTED to peer!`

---

### Scenario 3: Protocol URL Connection

Test `whtnxt://connect/<peerId>` protocol handler.

#### Get Test Peer's Peer ID

```bash
whatnext> status
```

Copy the Peer ID (e.g., `12D3KooWSeGgUKtPNVcVy6423yWX4XMqoRoz8fw1jwMRNcpLqSHF`)

#### Trigger Protocol

```bash
# Replace <PEER_ID> with actual peer ID from above
xdg-open "whtnxt://connect/<PEER_ID>"  # Linux
open "whtnxt://connect/<PEER_ID>"      # macOS
start "whtnxt://connect/<PEER_ID>"     # Windows
```

**Expected:**
- Electron app launches (or brings to front if running)
- Connection initiated automatically
- Test peer shows: `✅ CONNECTED to peer!`

✅ **Success**: Protocol URL handled correctly!

---

## Test Peer CLI Commands

| Command | Description | Example |
|---------|-------------|---------|
| `list` | List discovered peers | `whatnext> list` |
| `connect <n>` | Connect to peer number `<n>` | `whatnext> connect 1` |
| `connections` | Show active connections | `whatnext> connections` |
| `status` | Show full node status | `whatnext> status` |
| `help` | Show all commands | `whatnext> help` |
| `exit` | Shutdown and exit | `whatnext> exit` |

## Troubleshooting

### Problem: No Peers Discovered

**Check 1: Same Network**
- Ensure both devices on same WiFi network
- Check firewall isn't blocking mDNS (port 5353/UDP)

**Check 2: Node Started**
- Test peer: Look for "👂 Listening for mDNS..."
- Electron app: Check console for "[P2P Service] libp2p node started"

**Check 3: Logs**

In Electron DevTools console (Ctrl+Shift+I):
```
[Main] P2P utility process spawned
[P2P Utility] libp2p node started with PeerID: 12D3KooW...
```

In test peer terminal:
```
whatnext> status
```

Verify multiaddrs are listed (should show TCP and WebSocket addresses).

---

### Problem: Connection Fails

**Check 1: Peer in List**

```bash
whatnext> list
```

Ensure peer is discovered before attempting connection.

**Check 2: NAT/Firewall**
- WebRTC may fail behind strict NAT/firewall
- Try on same subnet without VPN
- Future: Relay servers will enable NAT traversal

**Check 3: Logs**

Look for error messages in:
- Test peer terminal
- Electron DevTools console
- Electron main process logs (Terminal 2)

---

### Problem: Connection Drops

**Check Network Stability**
- WiFi interference
- Router issues
- Move closer to router

**Check Status**

```bash
whatnext> status
```

Verify "Active Connections" count. If 0, connection was dropped.

**Check Logs**

Both test peer and Electron should log disconnect events.

---

## Expected Console Output

### Test Peer Startup

```
WhatNext Test Peer
==================

✅ Node started successfully!
Your Peer ID: 12D3KooWSeGgUKtPNVcVy6423yWX4XMqoRoz8fw1jwMRNcpLqSHF

📡 Listening on:
  /ip4/127.0.0.1/tcp/54321/p2p/12D3KooW...
  /ip4/192.168.1.100/tcp/54321/p2p/12D3KooW...
  /ip4/127.0.0.1/ws/tcp/54322/p2p/12D3KooW...
  /ip4/192.168.1.100/ws/tcp/54322/p2p/12D3KooW...

👂 Listening for mDNS peer discovery...

Type 'help' for available commands.

whatnext>
```

### Electron Main Process (Terminal 2)

```
[Main] Spawning P2P utility process
[Main] P2P utility process spawned
[P2P Utility] [P2P Service 2025-11-10T...] [INFO] Starting libp2p node...
[P2P Utility] [P2P Service 2025-11-10T...] [INFO] libp2p node started with PeerID: 12D3KooW...
[Main] Received from utility: node_started
[Main] Received from utility: peer_discovered
[Main] Received from utility: connection_established
```

### Electron Renderer (DevTools Console)

```
[P2PStatus] Node started: { peerId: '12D3KooW...', multiaddrs: [...] }
[P2PStatus] Peer discovered: { peer: {...}, multiaddrs: [...] }
[P2PStatus] Connection established: { peerId: '12D3KooW...', connection: {...} }
```

---

## Success Indicators

### ✅ mDNS Discovery (within 1-2 seconds)
- Test peer shows "🔍 Peer discovered!"
- Electron UI shows "Discovered Peers (1)"

### ✅ Connection Established
- Green "Connected" status in both
- "Active Connections (1)" displayed
- No error messages

### ✅ Stability (after 30 seconds)
- Connection remains active
- No disconnection events
- Both peers still show "Connected"

---

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│   Test Peer         │         │  Electron App        │
│   (Node.js)         │         │  (Utility Process)   │
│                     │         │                      │
│  libp2p node        │◄───────►│  libp2p node         │
│  - TCP              │  mDNS   │  - TCP               │
│  - WebSocket        │  WebRTC │  - WebSocket         │
│  - WebRTC           │  P2P    │  - WebRTC            │
│  - Noise            │         │  - Noise             │
│  - yamux            │         │  - yamux             │
└─────────────────────┘         └──────────────────────┘
```

**Key Point**: Both use IDENTICAL libp2p configuration for parity.

---

## Benefits of Test Peer

### Development
✅ **Fast iteration**: 1-second restart (vs 5-10 seconds for Electron)
✅ **Easy debugging**: Single terminal, clear logs
✅ **No UI overhead**: Pure P2P testing

### Testing
✅ **Automated tests**: Spawn test peer programmatically
✅ **CI/CD ready**: No Electron required for P2P tests
✅ **Multi-peer testing**: Spawn 10+ peers easily

### Documentation
✅ **Living example**: Test peer code documents P2P usage
✅ **Onboarding**: Experiment without Electron complexity

---

## Advanced Usage

### Development Mode (Auto-restart)

```bash
cd test-peer
npm run dev  # Watches for file changes, restarts automatically
```

### Multiple Test Peers

```bash
# Terminal 1
cd test-peer && npm start

# Terminal 2
cd test-peer && npm start

# Terminal 3
cd test-peer && npm start
```

Each gets unique PeerID, can test mesh networking.

### Programmatic Usage

```javascript
// For automated tests
const { spawn } = require('child_process');

const peer = spawn('npm', ['start'], { cwd: 'test-peer' });

peer.stdout.on('data', (data) => {
    if (data.includes('Node started successfully')) {
        // Peer is ready
    }
});
```

---

## Next Steps After Successful Test

1. ✅ Verify bidirectional connection
2. ✅ Test stability (leave connected 5+ minutes)
3. ✅ Test reconnection (restart one peer, verify re-discovery)
4. ✅ Test protocol URLs (`whtnxt://connect/<peerId>`)

Then move to Phase 2:
- Add relay server support for NAT traversal
- Implement RxDB replication over P2P
- Build automated integration tests

---

## Related Concepts

- [[libp2p]] - P2P networking library
- [[WebRTC]] - Transport layer
- [[P2P-Discovery]] - mDNS and peer discovery
- [[Electron-IPC]] - Utility process architecture

## References

### Implementation
- Test peer: `/test-peer/src/index.js`
- Utility process: `/app/src/utility/p2p-service.ts`
- P2P UI: `/app/src/renderer/components/P2P/P2PStatus.tsx`

### Documentation
- Test peer README: `/test-peer/README.md`
- Quick start: [[Quick-Start]]

---

**Status**: ✅ Test peer production-ready for development workflows
**Last Updated**: 2025-11-12

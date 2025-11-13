# Quick Start Guide

#guides/setup
**Last Updated**: 2025-11-12
**For**: v0.0.0 Alpha - P2P Learning Build

## TL;DR

```bash
# Terminal 1: Start app + test-peer together
./scripts/start-dev.sh

# Terminal 2 (optional): Start second instance for multi-peer testing
./scripts/start-dev.sh --test-peer-only
```

Navigate to "P2P Network" tab in the app. You should see:
- Your peer ID and connection URL
- Test peer discovered automatically
- Connect button to establish connection
- Debug logs showing events

## Common Development Workflows

### Workflow 1: Testing Basic Discovery

**Goal**: Verify mDNS discovery works

```bash
# Start app
./scripts/start-dev.sh

# Expected: Within 2 seconds, test-peer appears in "Discovered Peers"
# If not: Check firewall, ensure same network
```

### Workflow 2: Testing Manual Connection

**Goal**: Connect via `whtnxt://` URL

```bash
# In app: Click "Copy URL" in Node Status section
# In test-peer CLI: Paste URL and press enter
# Expected: Peer moves to "Active Connections" section
```

### Workflow 3: Multi-Instance Testing

**Goal**: Connect two WhatNext instances

```bash
# Terminal 1: Start first instance
./scripts/start-dev.sh --app-only

# Terminal 2: Start second instance (different port)
cd app && PORT=1314 npm run dev

# Copy URL from one instance, paste in other
# Expected: Both show each other as connected
```

### Workflow 4: Exploring Peer Details

**Goal**: See maximum peer information

```bash
# Connect to a peer
# Click "Details" button on peer card
# Expected: Modal shows all connection metadata
```

### Workflow 5: Watching Debug Logs

**Goal**: Understand event timeline

```bash
# Watch "Debug Log" section as you:
1. Start node (see "Node started" event)
2. Discover peer (see "Peer discovered" event)
3. Connect (see "Connected to" event)
4. Disconnect (see "Disconnected from" event)
```

## Troubleshooting

### Problem: Peer not discovered

**Symptoms**: "Discovered Peers" section stays empty

**Causes**:
1. Firewall blocking mDNS (port 5353/UDP)
2. Different network/VLAN
3. mDNS not supported on network

**Solutions**:
1. Check firewall allows mDNS
2. Use manual connection via URL instead
3. Check debug logs for "Discovered peer" messages

**Test**:
```bash
# Check if mDNS is working at OS level
# Linux:
avahi-browse _whatnext._udp

# macOS:
dns-sd -B _whatnext._udp
```

### Problem: Connection fails

**Symptoms**: Click "Connect", nothing happens or "Connection failed" in logs

**Causes**:
1. Peer discovered but not reachable
2. Firewall blocking TCP/WebSocket ports
3. Peer address changed (mobile IP)

**Solutions**:
1. Check debug logs for specific error
2. Try copying fresh URL (peer may have restarted)
3. Check firewall allows TCP ports in range 49152-65535

**Debug**:
```bash
# Check what ports libp2p is listening on
# (Look in "Listening Addresses" section)
# Example: /ip4/0.0.0.0/tcp/54321

# Test TCP connectivity
nc -zv <peer-ip> <port>
```

### Problem: Node won't start

**Symptoms**: "Status: Starting..." doesn't change to "Online"

**Causes**:
1. Utility process failed to spawn
2. Error in p2p-service.ts
3. Build is stale

**Solutions**:
1. Check Electron DevTools console for errors
2. Rebuild: `cd app && npm run build`
3. Check main process logs in terminal

### Problem: Debug logs empty

**Symptoms**: "Debug Log" section shows "No logs yet"

**Causes**:
1. Node hasn't started yet (wait 500ms)
2. JavaScript error preventing component mount

**Solutions**:
1. Check browser DevTools console
2. Verify React app loaded correctly
3. Try refreshing app (Ctrl+R / Cmd+R)

## Keyboard Shortcuts

- **Ctrl/Cmd + Shift + I**: Toggle DevTools
- **Ctrl/Cmd + R**: Refresh app (useful after code changes)
- **Enter**: In connection URL field, trigger connect

## Directory Structure Quick Reference

```
/app
  /src
    /main
      main.ts              - Main process, window management
      preload.ts           - IPC bridge (secure)
    /utility
      p2p-service.ts       - Libp2p node (separate process)
    /renderer
      /components/P2P
        P2PStatus.tsx      - Developer UI
    /shared
      /core
        types.ts           - Shared P2P types
        ipc-protocol.ts    - IPC message definitions
      p2p-config.ts        - P2P settings (mDNS, ports, etc.)
  /dist                    - Built files (git-ignored)

/test-peer
  /src
    index.js               - Barebones CLI peer for testing

/docs
  whtnxt-nextspec.md       - Original specification
  /notes                   - Learning documentation
```

## Important Configuration Files

### P2P Configuration (`app/src/shared/p2p-config.ts`)

Key settings you might want to adjust:

```typescript
MDNS_SERVICE_NAME: '_whatnext._udp.local',  // Must match across all peers
MDNS_INTERVAL: 1000,                         // Discovery broadcast interval (ms)
MAX_CONNECTIONS: 10,                         // Simultaneous connection limit
LISTEN_ADDRESSES: [
    '/ip4/0.0.0.0/tcp/0',                   // Random TCP port
    '/ip4/0.0.0.0/tcp/0/ws',                // Random WebSocket port
]
```

### Development Scripts (`scripts/`)

- `start-dev.sh` - Runs app + test-peer with logging
- `start-app.sh` - App only (traditional mode)
- `dev-init.sh` - First-time setup (installs nvm, dependencies)

## Quick Reference: IPC Protocol

### Renderer → Main → Utility

```typescript
// Connect to peer
window.electron.p2p.connect(peerId)

// Disconnect from peer
window.electron.p2p.disconnect(peerId)

// Get current status (pull-based)
window.electron.p2p.getStatus()
```

### Utility → Main → Renderer (Events)

```typescript
// Node started
window.electron.p2p.onNodeStarted(callback)

// Peer discovered
window.electron.p2p.onPeerDiscovered(callback)

// Connection established
window.electron.p2p.onConnectionEstablished(callback)

// Connection closed
window.electron.p2p.onConnectionClosed(callback)

// Connection failed
window.electron.p2p.onConnectionFailed(callback)

// Node error
window.electron.p2p.onNodeError(callback)
```

## Next Steps After Setup

1. **Verify everything works**: Follow Workflow 1-5 above
2. **Read the notes**: Start with `note-251112-p2p-development-interface-complete.md`
3. **Explore libp2p docs**: https://docs.libp2p.io/
4. **Plan first protocol**: Handshake is recommended (see v0.0.0 release summary)
5. **Document learnings**: Continue the notes pattern in `/docs/notes/`

## Getting Help

If you encounter issues:

1. Check debug logs in UI (most common issues show there)
2. Check browser DevTools console (renderer errors)
3. Check terminal output (main process & utility process logs)
4. Review notes in `/docs/notes/` for similar issues
5. Consult libp2p docs: https://docs.libp2p.io/

## Related Documentation

- `note-251112-v0.0.0-release-summary.md` - What's in this release
- `note-251112-p2p-development-interface-complete.md` - Technical details
- `note-251110-libp2p-first-implementation-learnings.md` - Initial P2P setup
- `CLAUDE.md` - Project working guidelines
- `whtnxt-nextspec.md` - Full specification

---

**Happy exploring!** The P2P layer is yours to master now. 🚀

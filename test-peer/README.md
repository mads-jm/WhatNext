# WhatNext Barebones Test Peer

A minimal libp2p node for testing P2P connections with the WhatNext Electron app.

## Purpose

This test peer makes development easier by:
- ✅ Running standalone without Electron overhead
- ✅ Using EXACT same libp2p config as Electron app
- ✅ Auto-discovering Electron app via mDNS
- ✅ Interactive CLI for testing connections
- ✅ Detailed connection logging

## Quick Start

### 1. Install Dependencies

```bash
cd test-peer
npm install
```

### 2. Start the Test Peer

```bash
npm start
```

You'll see:
```
╔════════════════════════════════════════════════════════════╗
║          WhatNext Barebones Test Peer v1.0                ║
╚════════════════════════════════════════════════════════════╝

🚀 Starting WhatNext Test Peer...

✅ Node started successfully!

Your Peer ID:
  12D3KooWFoo...

Listening on:
  /ip4/127.0.0.1/tcp/...

👂 Listening for mDNS peer discovery...
   (Make sure WhatNext Electron app is running on same network)

💬 Interactive CLI ready. Type "help" for commands.

whatnext>
```

### 3. Start Electron App

In another terminal:
```bash
cd ../app
npm run dev
```

Navigate to "P2P Network" view in the Electron app.

### 4. Watch for Discovery

**Test Peer Terminal:**
```
🔍 Peer discovered!
   Peer ID: 12D3KooWElectronApp...
   Multiaddrs: 2 address(es)
   Type 'connect 1' to connect
```

**Electron App UI:**
Should show "Discovered Peers (1)" with the test peer listed.

### 5. Test Connection

**Option A - Connect from Test Peer:**
```bash
whatnext> connect 1
```

**Option B - Connect from Electron App:**
Click "Connect" button next to the test peer.

### 6. Verify Connection

**Test Peer Terminal:**
```
✅ CONNECTED to peer!
   Peer ID: 12D3KooWElectronApp...
   Total connections: 1
```

**Electron App UI:**
Should show "Active Connections (1)" with green "Connected" status.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `help` | Show available commands |
| `list` | List all discovered peers |
| `connect <n>` | Connect to peer number `<n>` |
| `connections` | Show active connections |
| `status` | Show node status (Peer ID, multiaddrs, etc.) |
| `exit` | Stop the node and exit |

---

## Examples

### List Discovered Peers

```bash
whatnext> list

📋 Discovered Peers (2):

1. [DISCONNECTED]
   Peer ID: 12D3KooWElectronApp...
   Discovered: 2025-11-10T15:30:00.000Z
   Multiaddrs: 2 address(es)

2. [CONNECTED]
   Peer ID: 12D3KooWAnotherPeer...
   Discovered: 2025-11-10T15:31:00.000Z
   Multiaddrs: 3 address(es)
```

### Show Active Connections

```bash
whatnext> connections

🔗 Active Connections (1):

1. 12D3KooWElectronApp...
```

### Show Node Status

```bash
whatnext> status

📊 Node Status:

  Peer ID: 12D3KooWTestPeer...
  Multiaddrs: 2
    /ip4/127.0.0.1/tcp/12345/p2p/12D3KooWTestPeer...
    /ip4/192.168.1.100/tcp/12345/p2p/12D3KooWTestPeer...
  Discovered Peers: 2
  Active Connections: 1
```

---

## Troubleshooting

### No Peers Discovered

**Problem**: Test peer doesn't discover Electron app.

**Solutions**:
1. ✅ Ensure both are on same WiFi network
2. ✅ Check firewall isn't blocking mDNS (port 5353/UDP)
3. ✅ Verify Electron app is running and P2P node started
4. ✅ Check Electron app console for "Node started" message

### Connection Fails

**Problem**: `connect` command fails with error.

**Solutions**:
1. ✅ Verify peer is in list (`list` command)
2. ✅ Check peer is reachable on network
3. ✅ Try connecting from Electron app instead
4. ✅ Check for NAT/firewall issues
5. ✅ Verify both peers use same libp2p config

### Peer Discovered But Not Connecting

**Problem**: mDNS discovers peer but WebRTC connection fails.

**Possible Causes**:
- **NAT Traversal**: WebRTC requires STUN/relay for some networks
- **Firewall**: Blocking WebRTC ports
- **Configuration Mismatch**: Ensure test peer config matches Electron app

**Future Fix**: Phase 2 will add Circuit Relay for NAT traversal.

---

## Configuration

### Custom Peer Name

```bash
PEER_NAME="MyTestPeer" npm start
```

### Modify P2P Configuration

Edit `src/p2p-config.js` to change P2P settings:
- mDNS service name (for peer filtering)
- Connection limits
- Listen addresses
- Protocol versions

**⚠️ IMPORTANT**: `src/p2p-config.js` mirrors `app/src/shared/p2p-config.ts`
- Any changes should be made to BOTH files
- Configs must match for peers to discover each other
- The TypeScript file is the source of truth

---

## Development

### Watch Mode (auto-restart on changes)

```bash
npm run dev
```

### Add Custom Protocols

```javascript
// In src/index.js, after node.start():

await node.handle('/whatnext/test/1.0.0', ({ stream }) => {
    console.log('Received test protocol message!');
    // Handle stream...
});
```

---

## Architecture

This test peer uses **exactly** the same libp2p configuration as the Electron app:

```javascript
createLibp2p({
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    transports: [webRTC(), circuitRelayTransport()],
    peerDiscovery: [mdns()],
    services: { identify: identify() },
    connectionManager: { maxConnections: 10 }
})
```

**Why it matters**: Any bugs discovered with test peer will apply to Electron app, and vice versa.

---

## Testing Scenarios

### Scenario 1: Basic Discovery & Connection

1. Start test peer
2. Start Electron app
3. Verify mDNS discovery (both directions)
4. Connect from test peer CLI
5. Verify connection in Electron app UI

**Expected**: ✅ Connection established, both peers show "Connected"

---

### Scenario 2: Multi-Peer Mesh

1. Start test peer #1
2. Start test peer #2 (different terminal)
3. Start Electron app
4. All 3 peers discover each other
5. Connect from various peers

**Expected**: ✅ All peers can connect to each other

---

### Scenario 3: Connection Persistence

1. Start test peer
2. Start Electron app
3. Establish connection
4. Restart Electron app
5. Verify re-discovery and reconnection

**Expected**: ✅ Peers re-discover via mDNS, can reconnect

---

### Scenario 4: Disconnect Handling

1. Start test peer
2. Start Electron app
3. Establish connection
4. Stop test peer (`exit` command)
5. Check Electron app UI

**Expected**: ✅ Electron app shows "Disconnected" status

---

## Next Steps

### Phase 2: Add Relay Support

Update config to use relay servers for NAT traversal:

```javascript
transports: [
    webRTC(),
    circuitRelayTransport({
        reservationManager: {
            maxReservations: 10
        }
    })
]
```

### Phase 3: RxDB Replication Testing

Add custom protocol handler for RxDB replication:

```javascript
await node.handle('/whatnext/rxdb/1.0.0', async ({ stream }) => {
    // Handle RxDB replication messages
});
```

---

## References

- [libp2p Documentation](https://docs.libp2p.io/)
- [libp2p WebRTC Transport](https://github.com/libp2p/js-libp2p/tree/master/packages/transport-webrtc)
- [mDNS Peer Discovery](https://github.com/libp2p/js-libp2p/tree/master/packages/peer-discovery-mdns)
- WhatNext Issue #10: Handle `whtnxt://connect` Custom Protocol
- `/docs/notes/note-251109-custom-protocol-barebones-peer.md`

---

## Contributing

When updating the Electron app's P2P config, **always update this test peer** to match.

Files to keep in sync:
- `app/src/utility/p2p-service.ts` (Electron)
- `test-peer/src/index.js` (This file)

---

## License

Same as WhatNext main project.

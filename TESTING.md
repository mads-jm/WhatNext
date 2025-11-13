# Testing WhatNext P2P Connections

Quick guide for testing P2P connections between Electron app and test peer.

## Setup (One Time)

### Install Electron App Dependencies
```bash
cd app
npm install
```

### Install Test Peer Dependencies
```bash
cd test-peer
npm install
```

---

## Testing Scenario 1: Test Peer → Electron App

### Terminal 1: Start Test Peer

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

### Terminal 2: Start Electron App

```bash
cd app
npm run dev
```

Wait for Electron window to open, then:
1. Navigate to **"P2P Network"** in the sidebar
2. Wait 1-2 seconds

**Expected in Test Peer terminal:**
```
🔍 Peer discovered!
   Peer ID: 12D3KooW[ElectronPeerID]...
   Type 'connect 1' to connect
```

**Expected in Electron UI:**
- Green "Connected" status indicator
- "Discovered Peers (1)" showing test peer
- Your Peer ID displayed

### Connect from Test Peer

In test peer terminal:
```bash
whatnext> connect 1
```

**Expected output:**
```
✅ CONNECTED to peer!
   Total connections: 1
```

**Expected in Electron UI:**
- "Active Connections (1)"
- Green "Connected" button next to test peer

✅ **SUCCESS**: Bidirectional connection established!

---

## Testing Scenario 2: Electron App → Test Peer

Follow same steps as Scenario 1, but instead of `connect 1` in test peer:

**In Electron UI**: Click the **"Connect"** button next to the discovered test peer.

**Expected:**
- Button changes to green "Connected"
- Test peer terminal shows: `✅ CONNECTED to peer!`

---

## Testing Scenario 3: Protocol URL

### Get Test Peer's Peer ID

In test peer terminal:
```bash
whatnext> status
```

Copy the Peer ID (e.g., `12D3KooWSeGgUKtPNVcVy6423yWX4XMqoRoz8fw1jwMRNcpLqSHF`)

### Trigger Protocol from Terminal

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

---

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

### Problem: Connection Fails

**Check 1: Peer in List**
```bash
whatnext> list
```
Ensure peer is discovered before attempting connection.

**Check 2: NAT/Firewall**
- WebRTC may fail behind strict NAT/firewall
- Try on same subnet without VPN
- Phase 2 will add relay servers for NAT traversal

**Check 3: Logs**
Look for error messages in:
- Test peer terminal
- Electron DevTools console
- Electron main process logs (Terminal 2)

### Problem: Connection Drops

**Check Network Stability**
- WiFi interference
- Router issues
- Move closer to router

**Check Logs**
```bash
whatnext> status
```
Verify "Active Connections" count.

---

## Test Peer CLI Commands

```bash
whatnext> help              # Show all commands
whatnext> list              # List discovered peers
whatnext> connect <n>       # Connect to peer number <n>
whatnext> connections       # Show active connections
whatnext> status            # Show full node status
whatnext> exit              # Shutdown and exit
```

---

## Expected Console Output

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

## What to Look For

### ✅ Success Indicators

1. **mDNS Discovery** (within 1-2 seconds):
   - Test peer shows "🔍 Peer discovered!"
   - Electron UI shows "Discovered Peers (1)"

2. **Connection Established**:
   - Green "Connected" status in both
   - "Active Connections (1)" displayed
   - No error messages

3. **Stability** (after 30 seconds):
   - Connection remains active
   - No disconnection events
   - Both peers still show "Connected"

### ❌ Failure Indicators

1. **No Discovery**:
   - No peers found after 10+ seconds
   - Check network/firewall

2. **Connection Timeout**:
   - "Connection failed" error
   - Check NAT/firewall settings

3. **Immediate Disconnect**:
   - Connects then immediately disconnects
   - Check libp2p configuration mismatch

---

## Next Steps After Successful Test

1. ✅ **Verify bidirectional**: Connect from both sides
2. ✅ **Test stability**: Leave connected for 5+ minutes
3. ✅ **Test reconnection**: Restart one peer, verify re-discovery
4. ✅ **Test protocol URLs**: Use `whtnxt://connect/<peerId>`

Then move to Phase 2:
- Add relay server support
- Implement RxDB replication
- Build automated tests

---

## Quick Debug Commands

### Check Electron Utility Process
```bash
# In Terminal 2 (after npm run dev)
ps aux | grep p2p-service
```

### Check Network Connectivity
```bash
# Test mDNS resolution
avahi-browse -a -r  # Linux
dns-sd -B _services._dns-sd._udp  # macOS
```

### Check libp2p Logs
Add to test peer `src/index.js`:
```javascript
node.addEventListener('peer:update', (evt) => {
    console.log('Peer update:', evt);
});
```

---

## Support

If you encounter issues:
1. Check `/docs/notes/note-251110-barebones-test-peer-created.md`
2. Review test peer README: `/test-peer/README.md`
3. Check Electron logs in Terminal 2
4. Check DevTools console (Ctrl+Shift+I)

---

**Happy Testing!** 🚀

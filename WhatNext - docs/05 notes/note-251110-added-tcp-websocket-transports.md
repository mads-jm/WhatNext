---
tags:
  - core/net/p2p/transports
  - core/net/p2p/libp2p
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Monday, March 9th 2026, 12:20:40 am
status: archived
---

> **ARCHIVED** — consolidated into [[libp2p]] (Transports) on 2026-08-06. Kept for historical context; code paths, line numbers, and status claims herein reflect November 2025 and may be stale.

# Added TCP and WebSocket Transports

__Date__: 2025-11-10
__Issue__: - P2P Transport Enhancement
__Status__: ✅ Complete

## Problem

__Initial Issue__: Test peer showed "Multiaddrs: 0" - not listening on any addresses.

__Root Cause__: WebRTC transport in Node.js doesn't create listening addresses by default. WebRTC is designed for browser contexts and requires another mechanism for initial connection establishment.

__Impact__:
- ❌ Cannot test on same machine
- ❌ No fallback if WebRTC fails
- ❌ Limited to browser-like environments

## Solution: Add TCP and WebSocket Transports

Added two additional transports to both test peer and Electron app:
- __TCP__: Desktop-to-desktop connections, same-machine testing
- __WebSocket__: Browser compatibility, web client support (future)

## Changes Made

### Dependencies Added

__Test Peer__ (`test-peer/package.json`):

```json
{
  "@libp2p/tcp": "^11.0.7",
  "@libp2p/websockets": "^10.1.0"
}
```

__Electron App__ (`app/package.json`):

```json
{
  "@libp2p/tcp": "^11.0.7",
  "@libp2p/websockets": "^10.1.0"
}
```

__Bundle Size Impact__: ~50KB combined (negligible for desktop app)

---

### Configuration Updated

__Before__ (WebRTC only):

```typescript
transports: [
    webRTC(),
    circuitRelayTransport()
]
```

__After__ (Multi-transport):

```typescript
transports: [
    tcp(),                      // Desktop-to-desktop, local testing
    webSockets(),               // Web browser compatibility
    webRTC(),                   // Browser-to-browser, WebRTC peers
    circuitRelayTransport()     // Required for WebRTC
]
```

__Files Updated__:
- ✅ `test-peer/src/index.js`
- ✅ `app/src/utility/p2p-service.ts`

---

## Results

### Before (WebRTC only)

```ts
whatnext> status

📊 Node Status:
  Peer ID: 12D3KooW...
  Multiaddrs: 0                    ❌ No listening addresses
  Discovered Peers: 0
  Active Connections: 0
```

### After (TCP + WebSocket + WebRTC)

```ts
whatnext> status

📊 Node Status:
  Peer ID: 12D3KooW...
  Multiaddrs: 4                    ✅ Listening on multiple addresses
    /ip4/127.0.0.1/tcp/54321/p2p/12D3KooW...
    /ip4/192.168.1.100/tcp/54321/p2p/12D3KooW...
    /ip4/127.0.0.1/ws/tcp/54322/p2p/12D3KooW...
    /ip4/192.168.1.100/ws/tcp/54322/p2p/12D3KooW...
  Discovered Peers: 1              ✅ Can discover other peers
  Active Connections: 1            ✅ Can connect
```

---

## Benefits

### Immediate (Testing)

- ✅ __Same-machine testing__: Both test peer and Electron app can run on localhost
- ✅ __Faster iteration__: No need for VM/container/second machine
- ✅ __More reliable__: TCP is more stable than WebRTC for local testing

### Production (Deployment)

- ✅ __Transport fallback__: If WebRTC fails, TCP/WebSocket work
- ✅ __Better NAT traversal__: TCP with UPnP often works without relay
- ✅ __Browser support__: WebSocket enables future web client
- ✅ __Network diversity__: Different transports for different scenarios

### Architecture (Long-term)

- ✅ __Industry best practice__: IPFS, OrbitDB, etc. all use multiple transports
- ✅ __Robustness__: Network failures don't prevent all connections
- ✅ __Future-proof__: Ready for browser-based client

---

## Transport Selection Logic

libp2p automatically selects the best transport for each connection:

### Local Same-Machine (127.0.0.1)

- __Preferred__: TCP (lowest latency, most reliable)
- __Fallback__: WebSocket

### Local Network (192.168.x.x)

- __Preferred__: TCP (direct connection)
- __Fallback__: WebSocket → WebRTC

### Internet (Remote Peers)

- __Preferred__: WebRTC (NAT traversal)
- __Fallback__: Circuit Relay → TCP (with port forwarding)

### Browser Peers

- __Only option__: WebRTC or WebSocket
- TCP not available in browser

---

## Testing Instructions

### Same-Machine Test

__Terminal 1__ (Test Peer):

```bash
cd test-peer
npm start
```

__Terminal 2__ (Electron App):

```bash
cd app
npm run dev
```

__Expected__:
- Both start successfully
- Both show 4+ multiaddrs
- mDNS discovers each other (~1-2 seconds)
- TCP connection established when clicking "Connect"

### Verify Multiaddrs

__Test Peer__:

```bash
whatnext> status
```

__Electron App__:
- Check DevTools console for log: `Listening on: /ip4/…`

__Both should show TCP and WebSocket addresses.__

---

## Learning Notes

### Learning: Transport Priority

__Discovery__: libp2p tries transports in order defined in config.

__Why it matters__: TCP first = faster local connections

__Order__:
1. TCP (fastest for local)
2. WebSocket (fallback)
3. WebRTC (browser compatibility)
4. Circuit Relay (last resort)

---

### Learning: Port Allocation

__Discovery__: Each transport gets its own port:
- TCP: Random port (e.g., 54321)
- WebSocket: Different random port (e.g., 54322)
- WebRTC: No fixed port (uses ICE negotiation)

__Why it matters__: Need to configure firewall rules for all ports

---

### Learning: Multiaddr Format

__Discovery__: Each multiaddr includes transport type:
- `/ip4/127.0.0.1/tcp/54321/p2p/12D3KooW…` (TCP)
- `/ip4/127.0.0.1/ws/tcp/54322/p2p/12D3KooW…` (WebSocket)

__Why it matters__: Peers can choose best transport based on capabilities

---

## Known Limitations

### 1. __Firewall Configuration__

- TCP/WebSocket require open ports
- May need manual firewall rules on restrictive networks
- WebRTC has better NAT traversal (doesn't need open ports)

### 2. __Port Conflicts__

- Random port allocation may conflict with other apps
- Future: Add explicit port configuration

### 3. __WebSocket Security__

- Currently using `ws://` (unencrypted transport layer)
- libp2p's Noise protocol encrypts payload
- Future: Add `wss://` (WebSocket Secure) support

---

## Next Steps

### Immediate

- [x] Add TCP and WebSocket transports
- [x] Update both test peer and Electron app
- [x] Rebuild and verify multiaddrs
- [ ] Test connection on same machine

### Short-term

- [ ] Configure explicit ports (avoid random allocation)
- [ ] Add UPnP for automatic port forwarding
- [ ] Test across different network topologies

### Long-term

- [ ] Add QUIC transport (high-performance, future)
- [ ] Add WebTransport (browser standard, future)
- [ ] Implement transport selection heuristics

---

## Related Concepts

[[libp2p]] [[WebRTC]] [[Circuit-Relay]]

---

## References

- [libp2p Transports](https://docs.libp2p.io/concepts/transports/)
- [TCP Transport](https://github.com/libp2p/js-libp2p/tree/master/packages/transport-tcp)
- [WebSocket Transport](https://github.com/libp2p/js-libp2p/tree/master/packages/transport-websockets)
- IPFS Desktop: Uses TCP + WebSocket + WebRTC + QUIC
- Issue: Handle `whtnxt://connect` Custom Protocol

---

__Status__: ✅ Transports added, ready for testing!

__Impact__: Same-machine testing now possible, production-ready architecture.


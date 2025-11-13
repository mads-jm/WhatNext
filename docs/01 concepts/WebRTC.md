# WebRTC

#p2p/webrtc #networking #transports

## What It Is

WebRTC (Web Real-Time Communication) is a set of APIs and protocols for peer-to-peer data, audio, and video communication in browsers and native applications. It provides NAT traversal via ICE, STUN, and TURN, enabling direct connections between peers even behind firewalls.

In WhatNext, WebRTC serves as one of the primary P2P transports through libp2p's `@libp2p/webrtc` package, enabling browser-compatible peer-to-peer connections.

## Why We Use It

- **NAT traversal**: ICE/STUN protocols enable connections behind routers and firewalls
- **Browser compatibility**: Future web client can connect to desktop peers
- **Low latency**: Direct peer-to-peer connections without relay overhead
- **Industry standard**: Battle-tested in production (Google Meet, Discord, Zoom)
- **libp2p integration**: Native transport in libp2p ecosystem

**In multi-transport setup**: WebRTC complements TCP (local testing) and WebSocket (fallback) for network diversity and robustness.

## How It Works

### WebRTC in libp2p Architecture

```
Desktop Peer A                     Desktop Peer B
┌─────────────────┐               ┌─────────────────┐
│  libp2p Node    │               │  libp2p Node    │
│  ┌───────────┐  │               │  ┌───────────┐  │
│  │  WebRTC   │  │ ←────────────→ │  │  WebRTC   │  │
│  │ Transport │  │   Direct       │  │ Transport │  │
│  └───────────┘  │   WebRTC       │  └───────────┘  │
│  ┌───────────┐  │   Connection   │  ┌───────────┐  │
│  │    TCP    │  │                │  │    TCP    │  │
│  └───────────┘  │                │  └───────────┘  │
└─────────────────┘                └─────────────────┘
```

libp2p automatically selects WebRTC transport when:
- Peers are behind NAT
- Direct TCP/WebSocket connection fails
- Browser peer is involved

### Connection Establishment Flow

1. **Discovery**: Peer A discovers Peer B via mDNS or DHT
2. **Signaling**: Exchange SDP offers/answers via Circuit Relay
3. **ICE Candidates**: Exchange network endpoint candidates
4. **STUN**: Query public STUN server for NAT-translated addresses
5. **Connection**: Establish direct encrypted data channel
6. **Relay Discarded**: Direct connection replaces relay path

### Node.js Compatibility

**Critical Discovery**: `@libp2p/webrtc` works in Node.js WITHOUT polyfills!

Initial concern was that WebRTC requires browser APIs. Testing revealed:

```javascript
// ✅ This works in Node.js utility process!
import { webRTC } from '@libp2p/webrtc';

const node = await createLibp2p({
    transports: [
        webRTC(),
        circuitRelayTransport()  // Required dependency
    ],
    services: {
        identify: identify()  // Required dependency
    }
});
```

**Why it works**: libp2p's WebRTC implementation uses Node.js-compatible libraries internally (likely `node-datachannel` or similar), not browser-only APIs.

**No `wrtc` polyfill needed**: Simplifies installation (no native compilation).

## Key Patterns

### Pattern 1: Multi-Transport Configuration

WhatNext uses WebRTC alongside TCP and WebSocket:

```typescript
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';

const node = await createLibp2p({
    transports: [
        tcp(),                      // Local, same-machine testing
        webSockets(),               // Fallback, browser compatibility
        webRTC(),                   // NAT traversal, browser peers
        circuitRelayTransport()     // Required for WebRTC signaling
    ]
});
```

**Transport priority**: libp2p tries transports in order:
1. TCP (fastest for local)
2. WebSocket (reliable fallback)
3. WebRTC (NAT traversal)
4. Circuit Relay (last resort)

### Pattern 2: Required Dependencies

WebRTC transport has two hard dependencies:

```typescript
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';

// Both required even if not explicitly used
const node = await createLibp2p({
    transports: [
        webRTC(),
        circuitRelayTransport()  // ← REQUIRED
    ],
    services: {
        identify: identify()  // ← REQUIRED
    }
});
```

**Why**:
- `identify`: Peer identification exchange during handshake
- `circuitRelayTransport`: Signaling mechanism for SDP exchange

**Error if missing**:
```
Service "@libp2p/webrtc" required capability "@libp2p/identify" but it was not provided
Service "@libp2p/webrtc" required capability "@libp2p/circuit-relay-v2-transport" but it was not provided
```

### Pattern 3: Connection Event Handling

```typescript
node.addEventListener('peer:connect', (evt) => {
    const conn = evt.detail;
    const remotePeer = conn.remotePeer.toString();
    const transport = conn.remoteAddr.protoNames().includes('webrtc')
        ? 'WebRTC'
        : 'Other';

    console.log(`Connected to ${remotePeer} via ${transport}`);
});
```

### Pattern 4: Transport Selection Logic

libp2p automatically selects best transport based on peer multiaddrs:

```typescript
// Peer advertises these multiaddrs:
/ip4/192.168.1.100/tcp/54321/p2p/12D3KooW...     // TCP
/ip4/192.168.1.100/ws/tcp/54322/p2p/12D3KooW...  // WebSocket
/webrtc-direct/p2p/12D3KooW...                   // WebRTC

// libp2p tries:
// 1. TCP (direct, low latency)
// 2. WebSocket (fallback if TCP fails)
// 3. WebRTC (if both fail, NAT traversal)
```

## Common Pitfalls

### Pitfall 1: WebRTC Has No Listening Addresses in Node.js

**Problem**: WebRTC-only config shows "Multiaddrs: 0" in Node.js environment.

```bash
whatnext> status
📊 Node Status:
  Multiaddrs: 0  # ❌ No listening addresses
```

**Root Cause**: WebRTC is designed for browser contexts where listening addresses don't make sense (browser can't accept incoming connections). In Node.js, WebRTC transport doesn't create traditional listening sockets.

**Solution**: Add TCP or WebSocket transports for local network connections:

```typescript
transports: [
    tcp(),          // ← Adds listening addresses
    webSockets(),   // ← Adds listening addresses
    webRTC()        // No listening address, but works for outbound
]
```

**Result**:
```bash
whatnext> status
📊 Node Status:
  Multiaddrs: 4  # ✅ TCP + WebSocket addresses
    /ip4/127.0.0.1/tcp/54321/p2p/12D3KooW...
    /ip4/192.168.1.100/tcp/54321/p2p/12D3KooW...
    /ip4/127.0.0.1/ws/tcp/54322/p2p/12D3KooW...
    /ip4/192.168.1.100/ws/tcp/54322/p2p/12D3KooW...
```

### Pitfall 2: Missing circuitRelayTransport

**Problem**: WebRTC transport fails to initialize with cryptic error.

**Error**:
```
Service "@libp2p/webrtc" required capability "@libp2p/circuit-relay-v2-transport" but it was not provided
```

**Solution**: Always include Circuit Relay transport:

```typescript
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';

transports: [
    webRTC(),
    circuitRelayTransport()  // ← Don't forget this!
]
```

### Pitfall 3: Missing identify Service

**Problem**: Similar failure with identify service.

**Error**:
```
Service "@libp2p/webrtc" required capability "@libp2p/identify" but it was not provided
```

**Solution**: Always include identify service:

```typescript
import { identify } from '@libp2p/identify';

services: {
    identify: identify()  // ← Don't forget this!
}
```

### Pitfall 4: Expecting wrtc Polyfill

**Problem**: Thinking Node.js needs `wrtc` package for WebRTC.

**Reality**: `@libp2p/webrtc` works natively in Node.js without polyfills!

**Action**: Don't add `wrtc` as a dependency (unnecessary and complicates installation).

### Pitfall 5: Same-Machine Testing with WebRTC Only

**Problem**: Two libp2p nodes on same machine can't connect with WebRTC-only config.

**Root Cause**: WebRTC doesn't create listening addresses, so peers can't find each other locally.

**Solution**: Use TCP transport for same-machine testing:

```typescript
// Development config
transports: [
    tcp(),     // ← Enables localhost testing
    webRTC()
]

// Production config (if browser peers expected)
transports: [
    webSockets(),  // Browser-compatible
    webRTC()
]
```

## Related Concepts

- [[libp2p]] - P2P framework using WebRTC transport
- [[P2P-Discovery]] - How peers find each other before WebRTC connection
- [[Electron-IPC]] - Utility process running libp2p with WebRTC

## References

### Official Documentation
- [WebRTC Official](https://webrtc.org/)
- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [libp2p WebRTC Transport](https://github.com/libp2p/js-libp2p/tree/master/packages/transport-webrtc)
- [libp2p Circuit Relay v2](https://www.npmjs.com/package/@libp2p/circuit-relay-v2)

### WhatNext Implementation
- Utility process: `app/src/utility/p2p-service.ts`
- Test peer: `test-peer/src/index.js`
- Test script: `app/test-libp2p-webrtc.mjs` (validation)

### Related Issues
- Issue #10: libp2p Integration
- Testing: WebRTC compatibility in Node.js resolved

### Learning Resources
- [WebRTC for the Curious](https://webrtcforthecurious.com/)
- [STUN/TURN Server Setup](https://www.metered.ca/tools/openrelay/)
- [ICE Candidate Types](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate)

---

**Status**: ✅ Production-ready, verified working in Node.js
**Transport Priority**: 3rd (after TCP, WebSocket)
**Last Updated**: 2025-11-12

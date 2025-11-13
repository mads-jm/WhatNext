# libp2p

#p2p/libp2p #networking

## What It Is

libp2p is a modular peer-to-peer networking framework created by Protocol Labs (IPFS, Filecoin). It provides the primitives for building decentralized, peer-to-peer applications with features like peer discovery, connection management, NAT traversal, and secure communication.

In WhatNext, libp2p powers the entire P2P networking layer, enabling direct peer-to-peer playlist collaboration without central servers.

## Why We Use It

Chosen over simple-peer after comprehensive analysis (see [[adr-libp2p-vs-simple-peer]]):

- **Mesh networking**: Native support for multi-peer collaboration (N-to-N connections)
- **Built-in security**: Automatic encryption via Noise protocol, cryptographic peer identity
- **Local discovery**: mDNS enables offline/local-network collaboration without signaling servers
- **Stream multiplexing**: Multiple logical streams over one connection (RxDB + presence + metadata)
- **NAT traversal**: Circuit relay and DCUtR for connections behind firewalls
- **Production-ready**: Battle-tested in IPFS Desktop, OrbitDB, Textile

**Trade-off accepted**: Higher complexity and larger bundle size (~500KB) vs simple-peer (~30KB). Bundle size is negligible for desktop Electron apps.

## How It Works

### Architecture in WhatNext

libp2p runs in an Electron utility process (isolated from main and renderer):

```
┌─────────────┐         IPC          ┌──────────────────┐
│   Renderer  │ ←─────────────────→ │  Main Process    │
│   (React)   │                      │  (Node.js)       │
└─────────────┘                      └──────────────────┘
                                              ↓ MessagePort
                                     ┌──────────────────┐
                                     │ Utility Process  │
                                     │  libp2p Node     │
                                     └──────────────────┘
```

**Why utility process?**
- Isolates CPU-intensive P2P operations from UI thread
- Allows libp2p to run in Node.js environment (full transport support)
- Survives renderer crashes/reloads

### Core Components

#### 1. Transports (How peers connect)
WhatNext uses multiple transports for robustness:

```typescript
transports: [
    tcp(),                    // Desktop-to-desktop, local testing
    webSockets(),             // Browser compatibility
    webRTC(),                 // NAT traversal, browser-to-browser
    circuitRelayTransport()   // Required dependency for WebRTC
]
```

**Transport selection**: libp2p automatically chooses the best transport based on network topology and peer capabilities.

#### 2. Connection Encryption
```typescript
connectionEncryption: [noise()]
```

All connections encrypted via **Noise Protocol Framework**. No plaintext data ever sent on the wire.

#### 3. Stream Multiplexing
```typescript
streamMuxers: [yamux()]
```

Multiple logical streams over a single connection. WhatNext will use:
- Stream 1: RxDB replication protocol
- Stream 2: Presence/heartbeat
- Stream 3: Real-time queue updates

#### 4. Peer Discovery
```typescript
peerDiscovery: [mdns()]
```

**mDNS (Multicast DNS)**: Automatic peer discovery on local networks. No internet or signaling server required.

**Future**: Add DHT for global peer discovery.

#### 5. Services
```typescript
services: {
    identify: identify()  // Required for peer identification
}
```

**Identify service**: Peers exchange identity information during connection handshake.

### Connection Lifecycle

1. **Discovery**: mDNS broadcasts presence on local network
2. **Dial**: libp2p dials peer using multiaddr (e.g., `/ip4/192.168.1.100/tcp/54321/p2p/12D3KooW...`)
3. **Handshake**: Noise protocol establishes encrypted tunnel
4. **Identify**: Peers exchange supported protocols and transports
5. **Stream**: Open custom protocol streams (e.g., `/whatnext/rxdb/1.0.0`)
6. **Data**: Application-level data flows over encrypted streams

## Key Patterns

### Pattern 1: Node Initialization

```typescript
import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { mdns } from '@libp2p/mdns';
import { identify } from '@libp2p/identify';

const node = await createLibp2p({
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    transports: [
        tcp(),
        webSockets(),
        webRTC(),
        circuitRelayTransport()
    ],
    peerDiscovery: [mdns()],
    services: {
        identify: identify()
    },
    connectionManager: {
        maxConnections: 10,
        minConnections: 0
    }
});

await node.start();
```

### Pattern 2: PeerID String Conversion

libp2p uses `PeerId` objects, but WhatNext protocol URLs use strings:

```typescript
import { peerIdFromString } from '@libp2p/peer-id';

// String → PeerId object
const peerId = peerIdFromString('12D3KooWFoo...');

// PeerId → String
const peerIdStr = peerId.toString();
```

### Pattern 3: Dialing Peers

**Requires multiaddr, not just PeerId**:

```typescript
// ❌ Doesn't work
await node.dial('12D3KooWFoo...');

// ✅ Works (full multiaddr)
await node.dial('/ip4/192.168.1.100/tcp/54321/p2p/12D3KooWFoo...');

// ✅ Works (retrieve from peerStore after mDNS discovery)
const peer = await node.peerStore.get(peerId);
const multiaddrs = peer.addresses.map(a => a.multiaddr);
await node.dial(multiaddrs[0]);
```

### Pattern 4: Custom Protocol Handlers

```typescript
// Register protocol handler
await node.handle('/whatnext/rxdb/1.0.0', async ({ stream }) => {
    // Read from stream
    for await (const data of stream.source) {
        console.log('Received:', data);
    }

    // Write to stream
    await stream.sink([new TextEncoder().encode('response')]);
});

// Dial specific protocol
const stream = await node.dialProtocol(peerId, '/whatnext/rxdb/1.0.0');
```

### Pattern 5: Event Listeners

```typescript
// Peer discovered via mDNS
node.addEventListener('peer:discovery', (evt) => {
    const peer = evt.detail;
    console.log('Discovered:', peer.id.toString());
});

// Connection established
node.addEventListener('peer:connect', (evt) => {
    const connection = evt.detail;
    console.log('Connected to:', connection.remotePeer.toString());
});

// Connection closed
node.addEventListener('peer:disconnect', (evt) => {
    const connection = evt.detail;
    console.log('Disconnected from:', connection.remotePeer.toString());
});
```

## Common Pitfalls

### Pitfall 1: WebRTC Hidden Dependencies

**Problem**: `@libp2p/webrtc` fails with cryptic error about missing capabilities.

**Solution**: WebRTC transport requires two additional packages:
```bash
npm install @libp2p/circuit-relay-v2 @libp2p/identify
```

Both must be included in config even if not explicitly used. See [[WebRTC]] for details.

### Pitfall 2: ESM-Only Packages

**Problem**: libp2p packages are ES modules, not CommonJS.

**Solution**:
- Use `.mjs` extension for entry points, OR
- Bundle with tsup/esbuild which handles ESM → CommonJS conversion
- WhatNext uses tsup bundling in utility process

### Pitfall 3: WebRTC No Listening Addresses

**Problem**: WebRTC-only config shows "Multiaddrs: 0" in Node.js.

**Solution**: WebRTC is designed for browsers and doesn't create listening addresses. Add TCP/WebSocket transports for local testing and fallback:
```typescript
transports: [tcp(), webSockets(), webRTC(), circuitRelayTransport()]
```

### Pitfall 4: mDNS Discovers All libp2p Peers

**Problem**: mDNS will discover IPFS Desktop, OrbitDB, and other libp2p apps on the network.

**Solution**: Filter discovered peers by checking protocol support:
```typescript
node.addEventListener('peer:discovery', async (evt) => {
    const protocols = await node.peerStore.protoBook.get(evt.detail.id);
    if (protocols.includes('/whatnext/1.0.0')) {
        // This is a WhatNext peer
    }
});
```

**MVP alternative**: Post-connection handshake (connect, verify, disconnect if not WhatNext).

### Pitfall 5: Utility Process Build Config

**Problem**: Utility process won't start if libp2p bundle is misconfigured.

**Solution**: Configure tsup to bundle utility process separately:
```typescript
// tsup.config.ts
export default {
    entry: {
        main: 'src/main/main.ts',
        preload: 'src/main/preload.ts',
        'p2p-service': 'src/utility/p2p-service.ts'  // ← Utility process
    },
    outDir: 'dist',
    format: 'cjs',
    bundle: true,
    external: ['electron']
}
```

## Related Concepts

- [[WebRTC]] - WebRTC transport configuration and Node.js compatibility
- [[P2P-Discovery]] - mDNS, DHT, and peer discovery mechanisms
- [[Electron-IPC]] - Communication between main and utility process
- [[RxDB]] - Database replication over libp2p streams
- [[adr-libp2p-vs-simple-peer]] - Why we chose libp2p

## References

### Official Documentation
- [libp2p Documentation](https://docs.libp2p.io/)
- [js-libp2p GitHub](https://github.com/libp2p/js-libp2p)
- [libp2p Examples](https://github.com/libp2p/js-libp2p-examples)
- [libp2p Concepts](https://docs.libp2p.io/concepts/)

### WhatNext Implementation
- Utility process: `app/src/utility/p2p-service.ts`
- Test peer: `test-peer/src/index.js`
- Protocol handler: `app/src/main/protocol.ts`

### Related Issues
- Issue #10: libp2p Integration
- Future: Protocol implementation roadmap

### Learning Resources
- [IPFS Desktop](https://github.com/ipfs/ipfs-desktop) - Electron + libp2p in production
- [OrbitDB](https://github.com/orbitdb/orbitdb) - P2P database on libp2p
- [libp2p Discussion Forum](https://discuss.libp2p.io/)
- [IPFS Discord](https://discord.gg/ipfs) - #libp2p channel

---

**Status**: ✅ Production-ready, running in WhatNext v0.0.0
**Last Updated**: 2025-11-12

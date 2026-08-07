---
tags:
  - core/net/p2p/discovery
  - core/net
---

# P2P Discovery

## What It Is

Peer discovery is how WhatNext peers find each other before any connection, handshake, or replication can happen. WhatNext uses two complementary mechanisms:

- __mDNS (Multicast DNS)__ — automatic, zero-config discovery of peers on the same local network
- __Invite URLs via circuit relay__ — deterministic discovery of remote peers across NAT boundaries, using a relay address encoded in a shareable link

There is no DHT or global discovery network in the MVP — see [[adr-260315-p2p-session-pairing]] for why that was deferred to Phase 2.

## Why We Use It

Discovery must work without central infrastructure to honor WhatNext's user-sovereignty principle:

- __mDNS__ enables offline/LAN collaboration with no signaling server at all — peers on the same WiFi appear automatically
- __Invite URLs__ make remote discovery deterministic: the host's peer ID and relay address are known at invite time, so no rendezvous server or bootstrapped peer network is required
- The one piece of infrastructure involved (the relay) is __user-configured, never hardcoded__ — see [[Circuit-Relay]]

## How It Works

### Local Network: mDNS

The [[libp2p]] node in the utility process is configured with the `mdns()` peer discovery module. It broadcasts presence on the local network and emits `peer:discovery` events when other libp2p nodes are found. Discovered peers land in the peerStore with their multiaddrs, which are required for dialing (a bare peer ID is not enough).

Caveat: mDNS discovers __all__ libp2p peers on the network (IPFS Desktop, OrbitDB, …), not just WhatNext peers. Filtering happens after connection — via protocol support checks or the application-level [[Handshake-Protocol]].

### Remote Peers: Invite URL + Circuit Relay + DCUtR

mDNS cannot cross network boundaries. For remote sessions, discovery is explicit rather than broadcast:

1. The host generates an invite URL encoding everything the joiner needs:

    ```
    whtnxt://connect/<hostPeerId>?relay=<relayMultiaddr>&session=<sessionId>
    ```

2. The joiner dials the host through the relay using a circuit address (`/…/p2p/<relay-id>/p2p-circuit/p2p/<host-id>`) — see [[Circuit-Relay]] for the relay mechanics
3. Once connected via relay, libp2p's __DCUtR__ (Direct Connection Upgrade through Relay) coordinates a simultaneous dial through both NATs; on success the relayed connection is replaced by a direct [[WebRTC]] or TCP connection

A 4-character base36 short code is provided alongside the full URL for voice-friendly sharing; it is a convenience, not an identity — the full URL carries the authoritative peer ID.

Because the relay's peer ID appears in every invite URL, the relay persists its ed25519 key (`relay-key.json`) so previously shared links keep working across relay restarts.

### Testing Discovery: The Test Peer

The `test-peer/` package is a barebones Node.js CLI with the same libp2p configuration as the app, used to exercise discovery without Electron overhead. Typical flow: start the test peer (`cd test-peer && npm start`), start the app, and watch mDNS discovery fire in both directions within a couple of seconds — then `connect 1` from the test peer CLI or connect from the app's P2P Network view. Full scenarios in [[P2P-Testing]].

## Key Patterns

- __Discovery ≠ connection__: mDNS only populates the peerStore. Dialing requires a full multiaddr retrieved from the peerStore, and app-level identity comes later via the [[Handshake-Protocol]]
- __Deterministic remote discovery__: encode peer ID + relay in the invite URL rather than searching a network — no rendezvous infrastructure needed
- __Relay as bootstrap, direct as goal__: the relay path exists to get the first connection; DCUtR upgrades to direct as soon as NAT traversal allows

## Common Pitfalls

- __mDNS is LAN-only__: peers on different networks never see each other via mDNS — this was the blocking issue that led to the invite-URL architecture
- __mDNS discovers strangers__: other libp2p applications on the network show up too; verify peers post-connection
- __`@libp2p/rendezvous` does not exist on npm__: it was considered for remote discovery and rejected; invite URLs are the chosen mechanism (see [[adr-260315-p2p-session-pairing]])
- __No relay configured = LAN-only__: remote discovery requires at least one peer to have added a relay in Settings > P2P

## Related Concepts

- [[libp2p]] — the networking stack that hosts both discovery mechanisms
- [[Circuit-Relay]] — relay server mechanics and deployment
- [[WebRTC]] — the transport direct connections upgrade to
- [[Handshake-Protocol]] — post-connection peer identification
- [[P2P-Testing]] — hands-on discovery test scenarios with the test peer
- [[adr-260315-p2p-session-pairing]] — decision record for remote pairing architecture

## References

- mDNS config: `app/src/utility/p2p-service.ts` (`peerDiscovery: [mdns()]`)
- Invite URL helpers: `app/src/shared/core/protocol.ts`
- Relay manager: `app/src/utility/relay-manager.ts`
- Test peer: `test-peer/src/index.js`
- [libp2p mDNS discovery](https://github.com/libp2p/js-libp2p/tree/main/packages/peer-discovery-mdns)
- [DCUtR spec](https://github.com/libp2p/specs/blob/master/relay/DCUtR.md)

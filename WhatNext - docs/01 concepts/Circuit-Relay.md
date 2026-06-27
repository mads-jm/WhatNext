---
tags: core/net/p2p/relay/circuit-relay-v2
date created: Saturday, February 14th 2026, 11:36:18 am
date modified: Monday, March 9th 2026, 12:20:46 am
---

# Circuit Relay V2

## What It Is

Circuit relay v2 is a libp2p protocol that allows peers behind NAT or firewalls to communicate by routing traffic through a publicly-reachable relay server. Unlike relay v1, v2 is "limited" by design -- it enforces time and data limits on relayed connections, encouraging peers to upgrade to direct connections (e.g., via hole-punching) when possible.

## Why We Use It

WhatNext peers are desktop applications that are frequently behind NAT. Without a relay:
- Peers on different LANs cannot discover or connect to each other
- mDNS only works on the same local network
- Direct TCP/WS connections fail when both peers are behind NAT

Circuit relay v2 provides the bridge for cross-network connectivity.

## How It Works

1. __Relay server__ runs on a VPS with a public IP, configured with `circuitRelayServer()` service
2. __Client peers__ connect to the relay using `circuitRelayTransport()` transport
3. When Peer A wants to reach Peer B (both behind NAT):
   - Both peers connect to the relay
   - Peer A dials a circuit address: `/ip4/<relay>/tcp/4001/p2p/<relay-id>/p2p-circuit/p2p/<peer-b-id>`
   - The relay forwards the connection to Peer B
4. Once connected via relay, peers can attempt a direct connection upgrade via DCUtR (Direct Connection Upgrade through Relay)

### Relay Address Format

```ts
/ip4/<RELAY_IP>/tcp/<PORT>/p2p/<RELAY_PEER_ID>/p2p-circuit/p2p/<TARGET_PEER_ID>
```

### Configuration

Relay addresses are stored in `userData/relay-config.json` and managed via `app/src/main/relay-config-store.ts`. There is no longer a static `RELAY.ADDRESSES` array in `p2p-config.ts` — addresses are loaded dynamically at runtime.

Users add relays through __Settings > P2P__. The relay config store provides `getRelayAddresses()`, `addRelayAddress(addr)`, and `removeRelayAddress(addr)`.

The `RelayManager` class (`app/src/utility/relay-manager.ts`) handles:
- Auto-connect to all configured addresses on node startup
- Exponential backoff retry on connection failure
- Status callbacks forwarded to the renderer via IPC (`P2P_RELAY_STATUS` channel)

## Key Patterns

- __Auto-connect on startup__: The P2P service connects to configured relays immediately after the node starts
- __Relay hint in protocol URLs__: `whtnxt://connect/<peerId>?relay=<relayMultiaddr>` passes relay info for cross-network connections
- __Fallback ordering__: Try direct connection first, fall back to relay if needed

## Deploying a Relay

1. Get a VPS with a public IP
2. `cd relay && npm install && npm start`
3. A `relay-key.json` is created in the relay directory on first run — back this up. The peer ID derived from this key is permanent and must match any previously shared invite URLs.
4. Copy the printed multiaddr (including the peer ID) into WhatNext Settings > P2P > Add Relay
5. Ensure ports 4001 (TCP) and 4002 (WS) are open in the VPS firewall

## Common Pitfalls

- __Relay PeerId changes on restart (now fixed)__: The relay previously generated a new PeerId on each restart. `relay/relay-server.mjs` now calls `loadOrCreateKey()` which persists an ed25519 key to `relay-key.json`. The peer ID is stable across restarts, which is required since it appears in invite URLs.
- __Relay limits__: v2 enforces connection duration and data limits. Not suitable for bulk data transfer — use for signaling and small messages. Direct connection upgrade via DCUtR takes over once NAT traversal succeeds.
- __Port forwarding__: The relay itself must have publicly accessible ports. Ensure firewall rules allow inbound TCP on 4001 and 4002.
- __@libp2p/rendezvous does not exist on npm__: The package was considered for peer rendezvous but is not published. Invite URLs with encoded peerId + relay address are used instead for remote session joining.

## Related Concepts

- [[libp2p]]
- [[WebRTC]]
- [[Handshake-Protocol]]
- [[RxDB-Replication]]

## References

- [libp2p Circuit Relay docs](https://docs.libp2p.io/concepts/nat/circuit-relay/)
- [Circuit Relay v2 spec](https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md)
- Relay server code: `relay/relay-server.mjs`
- Config: `app/src/shared/p2p-config.ts` (`RELAY` section)



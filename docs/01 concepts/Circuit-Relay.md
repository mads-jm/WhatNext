# Circuit Relay v2

#p2p/relay/circuit-relay-v2

## What It Is

Circuit relay v2 is a libp2p protocol that allows peers behind NAT or firewalls to communicate by routing traffic through a publicly-reachable relay server. Unlike relay v1, v2 is "limited" by design -- it enforces time and data limits on relayed connections, encouraging peers to upgrade to direct connections (e.g., via hole-punching) when possible.

## Why We Use It

WhatNext peers are desktop applications that are frequently behind NAT. Without a relay:
- Peers on different LANs cannot discover or connect to each other
- mDNS only works on the same local network
- Direct TCP/WS connections fail when both peers are behind NAT

Circuit relay v2 provides the bridge for cross-network connectivity.

## How It Works

1. **Relay server** runs on a VPS with a public IP, configured with `circuitRelayServer()` service
2. **Client peers** connect to the relay using `circuitRelayTransport()` transport
3. When Peer A wants to reach Peer B (both behind NAT):
   - Both peers connect to the relay
   - Peer A dials a circuit address: `/ip4/<relay>/tcp/4001/p2p/<relay-id>/p2p-circuit/p2p/<peer-b-id>`
   - The relay forwards the connection to Peer B
4. Once connected via relay, peers can attempt a direct connection upgrade via DCUtR (Direct Connection Upgrade through Relay)

### Relay Address Format

```
/ip4/<RELAY_IP>/tcp/<PORT>/p2p/<RELAY_PEER_ID>/p2p-circuit/p2p/<TARGET_PEER_ID>
```

### Configuration

Relay addresses are stored in `app/src/shared/p2p-config.ts` under `P2P_CONFIG.RELAY`:

```typescript
RELAY: {
    ADDRESSES: [
        '/ip4/YOUR_VPS_IP/tcp/4001/p2p/RELAY_PEER_ID',
    ],
    AUTO_CONNECT: true,
    RETRY_INTERVAL: 10000,
    MAX_RETRIES: 5,
}
```

## Key Patterns

- **Auto-connect on startup**: The P2P service connects to configured relays immediately after the node starts
- **Relay hint in protocol URLs**: `whtnxt://connect/<peerId>?relay=<relayMultiaddr>` passes relay info for cross-network connections
- **Fallback ordering**: Try direct connection first, fall back to relay if needed

## Deploying a Relay

1. Get a VPS with a public IP
2. `cd relay && npm install && npm start`
3. Copy the printed multiaddrs into `P2P_CONFIG.RELAY.ADDRESSES`
4. Ensure ports 4001 (TCP) and 4002 (WS) are open

## Common Pitfalls

- **Relay PeerId changes on restart**: The relay generates a new PeerId each time. All clients must be updated with the new address. Future improvement: persist the PeerId.
- **Relay limits**: v2 enforces connection duration and data limits. Not suitable for bulk data transfer -- use for signaling and small messages.
- **Port forwarding**: The relay itself must have publicly accessible ports. Ensure firewall rules allow inbound TCP on 4001 and 4002.

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

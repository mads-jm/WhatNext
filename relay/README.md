# WhatNext Relay Server

Circuit relay v2 server for NAT traversal between WhatNext peers.

## Quick Start

```bash
cd relay
npm install
npm start
```

## Deployment

1. Deploy to a VPS with a public IP address
2. **Generate a fresh Ed25519 private key** — the `relay-key.json` file is gitignored and must be
   created before first run. Generate one with:
   ```bash
   node -e "
   const { generateKeyPair } = require('@libp2p/crypto/keys');
   generateKeyPair('Ed25519').then(k => k.export('jwk').then(j =>
     require('fs').writeFileSync('relay-key.json', JSON.stringify(j))
   ));
   "
   ```
   The relay will use this key as its stable peer ID. **Never reuse or share the dev key**
   from the repository — it was a temporary test key and must not be deployed.
3. Run `npm start` (or use a process manager like PM2)
4. Copy the printed multiaddrs into `app/src/shared/p2p-config.ts` under `RELAY.ADDRESSES`

## Ports

- **4001**: TCP (for desktop libp2p peers)
- **4002**: WebSocket (for browser-based peers)

Ensure both ports are open in your firewall/security group.

## Development

```bash
npm run dev  # Auto-restart on file changes
```

## How It Works

The relay server acts as a publicly-reachable rendezvous point. Peers behind NAT connect to the relay, and other peers can reach them through circuit relay v2 addresses like:

```
/ip4/<RELAY_IP>/tcp/4001/p2p/<RELAY_PEER_ID>/p2p-circuit/p2p/<TARGET_PEER_ID>
```

The relay does not store any data -- it only forwards connection streams between peers.

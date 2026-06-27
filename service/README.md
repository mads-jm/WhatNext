# WhatNext Helper Service

Lightweight Express + WebSocket server that handles tasks requiring a stable, publicly-reachable endpoint — things the Electron app and P2P layer can't do alone.

## Planned Responsibilities

1. **OAuth Coordination** — Broker Spotify (and future provider) OAuth flows so only the session coordinator needs API credentials. Participants join sessions without authenticating with any streaming platform.

2. **API Proxying** — Forward streaming-service API calls on behalf of participants who don't have their own tokens (supports the Coordinator and Proxy Owner sync modes described in the architecture docs).

3. **WebRTC Signaling** — Lightweight signaling relay for peers that can't discover each other via mDNS or the libp2p circuit relay.

## Current State

Skeleton only — Express on port 3001 with a broadcast WebSocket. The circuit relay (`/relay`) handles P2P connectivity for now.

## Running

```bash
cd service
npm install
npx ts-node src/server.ts
```

## Related

- `/relay` — libp2p circuit relay for NAT traversal (actively used)
- `/app` — Electron desktop client
- `docs_md/04 architecture/architecture-whatnext.md` — full architecture context
- `docs_md/07 stories/the-walled-garden-cracks.md` — Coordinator Model rationale

---
tags:
  - index
  - architecture/decisions
---

# Architecture Decision Records

Chronological log of significant architectural decisions.

- [[adr-251109-database-storage-location]] — Why the RxDB database lives in the renderer process (IndexedDB/Dexie) rather than the main process.
- [[adr-251110-electron-process-model]] — Four-process Electron model: P2P networking isolated in a dedicated utility process.
- [[adr-251110-libp2p-vs-simple-peer]] — P2P library selection: libp2p over simple-peer (mesh, discovery, encryption, identity).
- [[adr-260307-session-architecture-provider-abstraction]] — Sessions as platform-agnostic orchestration behind TrackSource / PlaybackProvider interfaces.
- [[adr-260315-companion-client-architecture]] — Electron-served HTTP + WebSocket companion client for zero-install phone participants.
- [[adr-260315-p2p-session-pairing]] — Remote session pairing: circuit relay + DCUtR, user-configured relays, invite URLs, playback mutex.

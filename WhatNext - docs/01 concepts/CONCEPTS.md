---
tags:
  - index
---

# Concepts

Atomic concept notes — durable, reusable knowledge about technologies and patterns used in this project.

## P2P & Networking

- [[libp2p]] — The P2P networking framework: transports, encryption, streams, relay + DCUtR, v2 API migration
- [[P2P-Discovery]] — How peers find each other: mDNS on the LAN, invite URLs + relay for remote peers
- [[Circuit-Relay]] — Circuit relay v2 for NAT traversal: mechanics, configuration, deploying your own relay
- [[WebRTC]] — WebRTC transport in libp2p: NAT traversal, Node.js compatibility, required dependencies
- [[Handshake-Protocol]] — Application-level peer metadata exchange after connection (`/whatnext/handshake/1.0.0`)
- [[RxDB-Replication]] — Checkpoint-based P2P replication protocol with skew-aware LWW conflict resolution

## Data

- [[RxDB]] — The local-first reactive database: schemas, reactive queries, migrations, service layer

## Electron

- [[Electron]] — Process model, build system, and security posture of the desktop shell
- [[Electron-IPC]] — IPC patterns and the full `window.electron` API surface across renderer/main/utility

## Sessions & Integrations

- [[Sessions]] — Collaborative playlist sessions: provider abstraction, lifecycle, polling, attribution
- [[Companion-Client]] — Phone-browser session viewer served from the coordinator's desktop over LAN
- [[Spotify-Integration]] — OAuth PKCE, import adapter, collaborative playlist polling, playback IPC

## Frontend

- [[React]] — Pointer to [[React-Patterns]]
- [[React-Patterns]] — Established renderer patterns: reactive queries, hooks, Zustand, IPC in effects
- [[Tailwind]] — Quick reference for the Tailwind v4 + Vite setup
- [[Tailwind-v4]] — Full Tailwind CSS v4 documentation: build integration, `@utility`, migration pitfalls

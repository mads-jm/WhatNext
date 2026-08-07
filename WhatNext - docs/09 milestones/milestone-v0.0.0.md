---
tags:
  - milestone
  - core/net/p2p/libp2p
  - data/rxdb
  - ux/react
date created: 2026-08-06
date modified: 2026-08-06
---

# Milestone: v0.0.0 — P2P Development Foundation

**Reached**: 2025-11-12
**Type**: Alpha — P2P learning & exploration build
**Consolidated** (2026-08-06) from the archived notes [[issues-2-6-summary]], [[note-251112-p2p-development-interface-complete]], and [[note-251112-v0.0.0-release-summary]].

## What v0.0.0 Delivered

The final exploratory build before feature development began in earnest: the complete application skeleton plus a working, heavily-instrumented P2P layer.

### Foundational architecture (issues #2–#6, 2025-11-09)

- **UI shell** — React + TypeScript + Tailwind: sidebar navigation, toolbar, connection status, playlist browser/view scaffolding.
- **Electron IPC** — typed channels via preload `contextBridge` (`nodeIntegration: false`, `contextIsolation: true` from day one).
- **RxDB spike → integration** — local-first reactive database in the renderer (Dexie/IndexedDB storage), core schemas defined.
- **Playlist & track CRUD** — service-layer create/read/update/delete over RxDB with reactive UI queries.
- **Tailwind v4 migration** — build fixed via the Vite plugin path (details live in [[Tailwind-v4]]).

### P2P foundation (issue #10 and follow-ons, 2025-11-10)

- **libp2p node in an Electron utility process** — the isolation decision that became [[adr-251110-electron-process-model]] (today's four-process model).
- **`whtnxt://connect/<peerId>` protocol handler** — OS-registered URL → main process → utility-process dial (see [[P2P-Discovery]]).
- **mDNS auto-discovery** on the local network; TCP + WebSocket transports added for same-machine testing; WebRTC transport validated in Node.js (see [[WebRTC]]).
- **Standalone test peer** (`/test-peer`) with an interactive CLI — the harness that still underpins [[P2P-Testing]].

### Developer-first P2P interface (2025-11-12)

- Full node observability: peer ID, multiaddrs, protocols, discovered peers, active connections, per-peer detail views, rolling debug log.
- Pull-based status polling (renderer polls main) so late-spawning utility processes never lose state pushes — a pattern that survived into later architecture.

## Deliberately Out of Scope Then

No custom protocols (handshake, data/file transfer), no RxDB replication, no persistence of peer state, no production UX — all listed as the forward learning path, and all since delivered on the road to v0.1.0.

## Related

- Archived source notes: [[issues-2-6-summary]], [[note-251112-p2p-development-interface-complete]], [[note-251112-v0.0.0-release-summary]]
- Concepts: [[libp2p]], [[WebRTC]], [[P2P-Discovery]], [[RxDB]], [[Electron]], [[Electron-IPC]]
- ADRs: [[adr-251110-electron-process-model]], [[adr-251110-libp2p-vs-simple-peer]], [[adr-251109-database-storage-location]]

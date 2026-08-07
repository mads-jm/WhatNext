---
tags:
  - index
---

# Notes

Fleeting development notes and working drafts. These may be promoted to concepts, guides, or specs as they mature.

## Historical Timestamped Notes (archived 2026-08-06)

All November-2025 notes below are **archived** — their durable content was consolidated into the concept/guide/ADR pages named per entry (per the CLAUDE.md concept-pages-over-timelines policy). They are kept for historical context only; treat their code paths and status claims as stale.

- [[note-251109-custom-protocol-barebones-peer]] — design plan for the `whtnxt://` protocol and an automated test peer *(→ [[P2P-Testing]], [[libp2p]])*
- [[note-251109-database-location-architecture]] — why RxDB lives in the renderer process, not main *(→ [[adr-251109-database-storage-location]])*
- [[note-251109-rxdb-dev-mode]] — resolving RxDB DB9/DVM1 errors with the dev-mode plugin *(→ [[RxDB]])*
- [[note-251109-rxdb-schema-validation-dexie-constraints]] — schema and index constraints of the Dexie storage adapter *(→ [[RxDB]])*
- [[note-251109-tailwind-v4-migration]] — migrating to Tailwind v4 with the Vite plugin *(→ [[Tailwind-v4]])*
- [[note-251110-added-tcp-websocket-transports]] — adding TCP and WebSocket transports for same-machine testing *(→ [[libp2p]])*
- [[note-251110-barebones-test-peer-created]] — standalone Node.js test peer with interactive CLI *(→ [[P2P-Testing]])*
- [[note-251110-issue-10-complete]] — `whtnxt://` protocol handler with libp2p, POC deliverables *(→ [[P2P-Discovery]], [[adr-251110-electron-process-model]])*
- [[note-251110-issue-10-session-summary]] — session summary of the P2P foundation work *(→ [[P2P-Discovery]], [[adr-251110-electron-process-model]])*
- [[note-251110-libp2p-first-implementation-learnings]] — early libp2p blockers and discoveries *(→ [[libp2p]])*
- [[note-251110-libp2p-learning-roadmap]] — phased libp2p learning plan and documentation strategy *(→ [[libp2p]]; roadmap long complete)*
- [[note-251110-p2p-utility-process-architecture]] — decision to run P2P in an Electron utility process *(→ [[adr-251110-electron-process-model]])*
- [[note-251110-simplified-p2p-connection-architecture]] — pull-based status polling and URL-first connections *(→ [[libp2p]], [[Electron-IPC]])*
- [[note-251110-webrtc-node-js-compatibility-resolved]] — WebRTC transport validated in Node.js (required dependencies) *(→ [[WebRTC]])*
- [[note-251112-modern-sidebar-navigation]] — Obsidian-inspired sidebar navigation redesign *(→ [[UI-Development]])*
- [[note-251112-navigation-quick-reference]] — quick reference for view IDs, badges, and navigation structure *(→ [[UI-Development]])*
- [[note-251112-p2p-development-interface-complete]] — developer-first P2P observability UI *(→ [[milestone-v0.0.0]])*
- [[note-251112-scrolling-fix]] — vertical scrolling fix for all main window tabs *(→ [[UI-Development]])*
- [[note-251112-ui-modernization-complete]] — v0.0.0 UI modernization session summary *(→ [[UI-Development]])*
- [[note-251112-v0.0.0-release-summary]] — alpha release summary of the P2P development foundation *(→ [[milestone-v0.0.0]])*
- [[note-260307-sessions-v1-implementation]] — Sessions v1 implementation with the provider abstraction *(active milestone note, referenced from [[Sessions]])*

## Working Notes & Audits

- [[mvp-reality-react-quality]] — full renderer codebase React quality audit
- [[dead-code-audit-260322]] — dead files, unused exports, and unused dependencies audit
- [[issues-2-6-summary]] — completion summary of foundational issues 2–6 (UI shell, IPC, RxDB, CRUD) *(archived → [[milestone-v0.0.0]])*
- [[tapec-integration-analysis]] — evaluation of four TapeC integration approaches
- [[whtnxt_beyondmvp]] — post-MVP design language and UX drivers from 11 view prototypes

## Theme Design Explorations

- [[05 notes/pure_void/DESIGN|pure_void theme design]] — "The Luminous Void" OLED dark design system
- [[05 notes/resilient_nocturne/DESIGN|resilient_nocturne theme design]] — "The Sonic Vault" dark desktop design system
- [[05 notes/solar_resignation/DESIGN|solar_resignation theme design]] — "The Ethereal Archivist" light design system

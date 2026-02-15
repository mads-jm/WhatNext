---
tags:
  - core/index
date created: Thursday, November 13th 2025, 4:59:12 am
date modified: Sunday, February 15th 2026, 8:37:18 pm
---

# WhatNext Documentation Index

> __For LLMs__: This index maps all documentation in the repository by concept. Use this for quick navigation and context gathering.

## Core Documentation

### Project Foundation

- __[[whtnxt-nextspec]]__ - Complete technical specification and architecture (source of truth)
- __[[the-walled-garden-cracks]]__ - Vision supplement: Spotify API crackdown, coordinator model, translation layer architecture (2026-02)
- __[[srs-whatnext]]__ - Software Requirements Specification (MVP baseline v0.1.0)
- __[[architecture-whatnext]]__ - Architecture Design Document (MVP baseline v0.1.0)
- __[[README]]__ - High-level overview and stack
- __[[CLAUDE]]__ - Development instructions, commands, architecture principles

### Development Workflows

- __[[TESTING]]__ - P2P connection testing procedures
- __[[issues-2-6-summary]]__ - Initial foundation implementation milestone

---

## Concepts & Architecture

### P2P Networking

[[Peer-to-Peer]] [[libp2p]] [[WebRTC]]
- __[[adr-251110-libp2p-vs-simple-peer]]__ - Architectural decision for P2P library
- __[[note-251110-p2p-utility-process-architecture]]__ - Electron process model for P2P
- __[[note-251110-simplified-p2p-connection-architecture]]__ - Connection flow patterns
- __[[note-251110-libp2p-learning-roadmap]]__ - Phase-by-phase learning plan
- __[[note-251110-libp2p-first-implementation-learnings]]__ - Practical lessons
- __[[note-251110-webrtc-node-js-compatibility-resolved]]__ - Node.js WebRTC integration
- __[[note-251110-barebones-test-peer-created]]__ - Test peer implementation
- __[[note-251110-added-tcp-websocket-transports]]__ - Transport layer expansion
- __[[note-251109-custom-protocol-barebones-peer]]__ - Protocol handler implementation

### Data Architecture

[[Local-First Data]] [[RxDB]]
- __[[rxdb-spike-findings]]__ - RxDB evaluation results (Issue 4)
- __[[note-251109-rxdb-dev-mode]]__ - Development configuration
- __[[note-251109-rxdb-schema-validation-dexie-constraints]]__ - Schema design patterns
- __[[note-251109-database-location-architecture]]__ - Storage location decisions

### UI/UX

[[Electron]] [[React]] [[Tailwind]]
- __[[note-251112-ui-modernization-complete]]__ - v0.0.0 UI polish session summary
- __[[note-251112-modern-sidebar-navigation]]__ - Navigation redesign
- __[[note-251112-scrolling-fix]]__ - Layout overflow resolution
- __[[note-251109-tailwind-v4-migration]]__ - Upgrading to Tailwind CSS v4

---

## Development Milestones

### Issue 10: libp2p Integration

- __[[note-251110-issue-10-complete]]__ - libp2p integration milestone
- __[[note-251110-issue-10-session-summary]]__ - Development session retrospective

### V0.0.0 Release

- __[[note-251112-v0.0.0-release-summary]]__ - Alpha release overview
- __[[note-251112-p2p-development-interface-complete]]__ - Dev UI implementation
- __[[Protocol-Implementation-Roadmap]]__ - Next steps for protocol work
- __[[Quick-Start]]__ - Getting started with v0.0.0
- __[[note-251112-navigation-quick-reference]]__ - UI navigation guide

---

## Repository Structure

### Application Components

```ts
/app                    Main Electron application
  /src/main            Main process (Node.js)
  /src/renderer        Renderer process (React)
  /src/main/preload.ts IPC bridge (security boundary)
  /docs                App-specific documentation

/test-peer             Barebones libp2p test peer for P2P development
  README.md            Test peer usage guide

/service               Helper service (future: signaling, OAuth)
/scripts               Development and initialization scripts
/docs                  Project-wide documentation
  /notes               Development notes and learnings
```

### Key Configuration Files

- __[[CLAUDE]]__ - Instructions for AI assistants working on the codebase
- __[[README]]__ - Project overview
- __[[TESTING]]__ - Testing procedures

---

## Concept Map

### Core Principles

- __[[User Sovereignty]]__ → Local-first, user owns data
- __[[Local-First Data]]__ → Plaintext storage, offline-capable
- __[[Peer-to-Peer]]__ → Decentralized collaboration
- __[[Plaintext Data Format]]__ → Markdown + YAML frontmatter

### Technology Stack

- __[[Electron]]__ → Desktop framework (main + renderer + preload)
- __[[React]]__ → UI framework (v19, functional components)
- __[[TypeScript]]__ → Type safety throughout
- __[[Vite]]__ → Build tool and dev server
- __[[Tailwind CSS]]__ → Styling (v4)
- __[[RxDB]]__ → Local reactive database
- __[[libp2p]]__ → P2P networking library
- __[[WebRTC]]__ → P2P transport layer

### Architecture Components

- __[[srs-whatnext]]__ → Formal requirements specification (MVP)
- __[[architecture-whatnext]]__ → Formal architecture design (MVP)
- __[[Helper Backend Service]]__ → Signaling + OAuth coordination
- __[[Signaling Server]]__ → P2P connection brokering
- __[[Spotify Collaborative Sync Strategy]]__ → External integration patterns (pre-2026 model)
- __[[the-walled-garden-cracks]]__ → Coordinator model, service abstraction, revised strategy
- __[[Plugin Architecture]]__ → Future extensibility (Obsidian-inspired)

---

## Documentation Patterns

### Note Types

- `note-YYMMDD-[topic].md` - Issue-specific learnings, problems solved
- `adr-YYMMDD-[decision].md` - Architecture Decision Records
- Session summaries - Milestone retrospectives
- Concept explainers - Deep dives on specific technologies

### Status Indicators

- ✅ Resolved/Complete
- 🔄 In Progress
- ⚠️ Blocked
- 🎓 Learning Phase

---

## Quick Reference

### Common Commands

```bash
# Initial setup
./scripts/dev-init.sh

# Development (app + test peer)
./scripts/start-dev.sh

# Testing
cd test-peer && npm start
cd app && npm run dev

# Building
cd app && npm run build
cd app && npm run typecheck
```

### Key File Locations

- Main process: `app/src/main/main.ts`
- Renderer entry: `app/src/renderer/App.tsx`
- IPC bridge: `app/src/main/preload.ts`
- RxDB database: `app/src/renderer/db/database.ts`
- Schemas: `app/src/renderer/db/schemas.ts`

---

## For AI Assistants

When working on WhatNext:
1. __Start with__: [[CLAUDE]] for development context
2. __Reference__: [[whtnxt-nextspec]] for architectural decisions
3. __Check__: Recent notes in `/docs/05 notes/` for current state
4. __Document__: New learnings following patterns in [[note-251110-libp2p-learning-roadmap]]

### Active Development Areas (as of 2026-02-15)

- ✅ P2P networking foundation (libp2p integration complete)
- ✅ UI modernization (v0.0.0 polished)
- ✅ Formal documentation (SRS + Architecture Design — see [[srs-whatnext]], [[architecture-whatnext]])
- 🔄 Protocol implementation (next phase)
- 🔄 Spotify adapter migration (Feb 2026 API changes — see [[the-walled-garden-cracks]])
- 🔜 RxDB replication over libp2p
- 🔜 Import adapter architecture (service abstraction layer)
- 🔜 Open metadata enrichment (MusicBrainz/ListenBrainz)

---

__Last Updated__: 2026-02-15
__Documentation Version__: v0.1.0
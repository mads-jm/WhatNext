# WhatNext Documentation Index

> **For LLMs**: This index maps all documentation in the repository by concept. Use this for quick navigation and context gathering.

## Core Documentation

### Project Foundation
- **[[whtnxt-nextspec]]** - Complete technical specification and architecture (source of truth)
- **[[README]]** - High-level overview and stack
- **[[CLAUDE]]** - Development instructions, commands, architecture principles

### Development Workflows
- **[[TESTING]]** - P2P connection testing procedures
- **[[issues-2-6-summary]]** - Initial foundation implementation milestone

---

## Concepts & Architecture

### P2P Networking
[[Peer-to-Peer]] [[libp2p]] [[WebRTC]]
- **[[adr-251110-libp2p-vs-simple-peer]]** - Architectural decision for P2P library
- **[[note-251110-p2p-utility-process-architecture]]** - Electron process model for P2P
- **[[note-251110-simplified-p2p-connection-architecture]]** - Connection flow patterns
- **[[note-251110-libp2p-learning-roadmap]]** - Phase-by-phase learning plan
- **[[note-251110-libp2p-first-implementation-learnings]]** - Practical lessons
- **[[note-251110-webrtc-node-js-compatibility-resolved]]** - Node.js WebRTC integration
- **[[note-251110-barebones-test-peer-created]]** - Test peer implementation
- **[[note-251110-added-tcp-websocket-transports]]** - Transport layer expansion
- **[[note-251109-custom-protocol-barebones-peer]]** - Protocol handler implementation

### Data Architecture
[[Local-First Data]] [[RxDB]]
- **[[rxdb-spike-findings]]** - RxDB evaluation results (Issue #4)
- **[[note-251109-rxdb-dev-mode]]** - Development configuration
- **[[note-251109-rxdb-schema-validation-dexie-constraints]]** - Schema design patterns
- **[[note-251109-database-location-architecture]]** - Storage location decisions

### UI/UX
[[Electron]] [[React]] [[Tailwind]]
- **[[note-251112-ui-modernization-complete]]** - v0.0.0 UI polish session summary
- **[[note-251112-modern-sidebar-navigation]]** - Navigation redesign
- **[[note-251112-scrolling-fix]]** - Layout overflow resolution
- **[[note-251109-tailwind-v4-migration]]** - Upgrading to Tailwind CSS v4

---

## Development Milestones

### Issue #10: libp2p Integration
- **[[note-251110-issue-10-complete]]** - libp2p integration milestone
- **[[note-251110-issue-10-session-summary]]** - Development session retrospective

### v0.0.0 Release
- **[[note-251112-v0.0.0-release-summary]]** - Alpha release overview
- **[[note-251112-p2p-development-interface-complete]]** - Dev UI implementation
- **[[Protocol-Implementation-Roadmap]]** - Next steps for protocol work
- **[[Quick-Start]]** - Getting started with v0.0.0
- **[[note-251112-navigation-quick-reference]]** - UI navigation guide

---

## Repository Structure

### Application Components
```
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
- **[[CLAUDE]]** - Instructions for AI assistants working on the codebase
- **[[README]]** - Project overview
- **[[TESTING]]** - Testing procedures

---

## Concept Map

### Core Principles
- **[[User Sovereignty]]** → Local-first, user owns data
- **[[Local-First Data]]** → Plaintext storage, offline-capable
- **[[Peer-to-Peer]]** → Decentralized collaboration
- **[[Plaintext Data Format]]** → Markdown + YAML frontmatter

### Technology Stack
- **[[Electron]]** → Desktop framework (main + renderer + preload)
- **[[React]]** → UI framework (v19, functional components)
- **[[TypeScript]]** → Type safety throughout
- **[[Vite]]** → Build tool and dev server
- **[[Tailwind CSS]]** → Styling (v4)
- **[[RxDB]]** → Local reactive database
- **[[libp2p]]** → P2P networking library
- **[[WebRTC]]** → P2P transport layer

### Architecture Components
- **[[Helper Backend Service]]** → Signaling + OAuth coordination
- **[[Signaling Server]]** → P2P connection brokering
- **[[Spotify Collaborative Sync Strategy]]** → External integration patterns
- **[[Plugin Architecture]]** → Future extensibility (Obsidian-inspired)

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
1. **Start with**: [[CLAUDE]] for development context
2. **Reference**: [[whtnxt-nextspec]] for architectural decisions
3. **Check**: Recent notes in `/docs/05 notes/` for current state
4. **Document**: New learnings following patterns in [[note-251110-libp2p-learning-roadmap]]

### Active Development Areas (as of 2025-11-12)
- ✅ P2P networking foundation (libp2p integration complete)
- ✅ UI modernization (v0.0.0 polished)
- 🔄 Protocol implementation (next phase)
- 🔜 RxDB replication over libp2p
- 🔜 Spotify integration

---

**Last Updated**: 2025-11-12
**Documentation Version**: v0.0.0

#core/index
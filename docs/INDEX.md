# WhatNext Documentation Index

> **For LLMs**: This index maps all documentation in the repository by concept. Use this for quick navigation and context gathering.

## Core Documentation

### Project Foundation
- **[Project Specification](whtnxt-nextspec.md)** - Complete technical specification and architecture (source of truth)
- **[Project README](../README.md)** - High-level overview and stack
- **[Development Guide](../CLAUDE.md)** - Development instructions, commands, architecture principles

### Development Workflows
- **[Testing Guide](../TESTING.md)** - P2P connection testing procedures
- **[Issues #2-6 Summary](issues-2-6-summary.md)** - Initial foundation implementation milestone

---

## Concepts & Architecture

### P2P Networking (`[[Peer-to-Peer]]`, `[[libp2p]]`, `[[WebRTC]]`)
- **[ADR: libp2p vs simple-peer](notes/adr-251110-libp2p-vs-simple-peer-analysis.md)** - Architectural decision for P2P library
- **[P2P Utility Process Architecture](notes/note-251110-p2p-utility-process-architecture.md)** - Electron process model for P2P
- **[Simplified P2P Connection Architecture](notes/note-251110-simplified-p2p-connection-architecture.md)** - Connection flow patterns
- **[libp2p Learning Roadmap](notes/note-251110-libp2p-learning-roadmap.md)** - Phase-by-phase learning plan
- **[libp2p First Implementation Learnings](notes/note-251110-libp2p-first-implementation-learnings.md)** - Practical lessons
- **[WebRTC Node.js Compatibility Resolved](notes/note-251110-webrtc-node-js-compatibility-resolved.md)** - Node.js WebRTC integration
- **[Barebones Test Peer Created](notes/note-251110-barebones-test-peer-created.md)** - Test peer implementation
- **[TCP + WebSocket Transports Added](notes/note-251110-added-tcp-websocket-transports.md)** - Transport layer expansion
- **[Custom Protocol Barebones Peer](notes/note-251109-custom-protocol-barebones-peer.md)** - Protocol handler implementation

### Data Architecture (`[[Local-First Data]]`, `[[RxDB]]`)
- **[RxDB Spike Findings](../app/docs/rxdb-spike-findings.md)** - RxDB evaluation results (Issue #4)
- **[RxDB Dev Mode](notes/note-251109-rxdb-dev-mode.md)** - Development configuration
- **[RxDB Schema Validation vs Dexie Constraints](notes/note-251109-rxdb-schema-validation-dexie-constraints.md)** - Schema design patterns
- **[Database Location Architecture](notes/note-251109-database-location-architecture.md)** - Storage location decisions

### UI/UX (`[[Electron]]`, `[[React]]`, `[[Tailwind]]`)
- **[UI Modernization Complete](notes/note-251112-ui-modernization-complete.md)** - v0.0.0 UI polish session summary
- **[Modern Sidebar Navigation](notes/note-251112-modern-sidebar-navigation.md)** - Navigation redesign
- **[Scrolling Fix](notes/note-251112-scrolling-fix.md)** - Layout overflow resolution
- **[Tailwind v4 Migration](notes/note-251109-tailwind-v4-migration.md)** - Upgrading to Tailwind CSS v4

---

## Development Milestones

### Issue #10: libp2p Integration
- **[Issue #10 Complete](notes/note-251110-issue-10-complete.md)** - libp2p integration milestone
- **[Issue #10 Session Summary](notes/note-251110-issue-10-session-summary.md)** - Development session retrospective

### v0.0.0 Release
- **[v0.0.0 Release Summary](notes/note-251112-v0.0.0-release-summary.md)** - Alpha release overview
- **[P2P Development Interface Complete](notes/note-251112-p2p-development-interface-complete.md)** - Dev UI implementation
- **[Protocol Implementation Roadmap](notes/note-251112-protocol-implementation-roadmap.md)** - Next steps for protocol work
- **[Quick Start Guide](notes/note-251112-quick-start-guide.md)** - Getting started with v0.0.0
- **[Navigation Quick Reference](notes/note-251112-navigation-quick-reference.md)** - UI navigation guide

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
- **[CLAUDE.md](../CLAUDE.md)** - Instructions for AI assistants working on the codebase
- **[README.md](../README.md)** - Project overview
- **[TESTING.md](../TESTING.md)** - Testing procedures

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
1. **Start with**: [CLAUDE.md](../CLAUDE.md) for development context
2. **Reference**: [whtnxt-nextspec.md](whtnxt-nextspec.md) for architectural decisions
3. **Check**: Recent notes in `/docs/notes/` for current state
4. **Document**: New learnings following patterns in `note-251110-libp2p-learning-roadmap.md`

### Active Development Areas (as of 2025-11-12)
- ✅ P2P networking foundation (libp2p integration complete)
- ✅ UI modernization (v0.0.0 polished)
- 🔄 Protocol implementation (next phase)
- 🔜 RxDB replication over libp2p
- 🔜 Spotify integration

---

**Last Updated**: 2025-11-12
**Documentation Version**: v0.0.0

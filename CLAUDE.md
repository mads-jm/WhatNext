# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatNext is a resilient, user-centric music management platform built on three core principles:
- **User Sovereignty**: Local-first data architecture with plaintext storage
- **Decentralized Collaboration**: P2P networking for playlist management without central servers
- **Rich Music Experience**: Deep metadata, intelligent discovery, and powerful organization

The project is architected as an Electron desktop application with a circuit relay server for P2P NAT traversal and a helper service housing the audio downloader module and an OAuth-coordination skeleton.

## Repository Structure

```
/app        - Main Electron application (Electron + React + RxDB)
/relay      - Circuit relay server for P2P NAT traversal (+ companion tunnel)
/test-peer  - Barebones libp2p test peer for P2P development
/service    - Helper service: downloader module (yt-dlp/spotDL backends) + Express/WS skeleton for OAuth coordination and API proxying
/WhatNext - docs - Obsidian vault: project documentation organized by concept
  /00 index     - Vault indexes (.base files) and backlog board
  /01 concepts  - Core technology and pattern explanations
  /02 references - Reference material and external resource summaries
  /03 guides    - How-to documents and workflows
  /04 architecture - System design, ADRs, SRS, and architecture docs
  /05 notes     - Development notes and learnings
  /06 reports   - State-of-project vettings and audits
  /07 stories   - Vision documents and project narratives
  /08 specs     - Feature and component specs (linked from GitHub Issues)
  /09 milestones - Development milestones
  /10 PRs       - PR records
  /99 meta      - Templates and vault configuration
/docs       - Generated HTML documentation site (vault export; do not edit directly)
/scripts    - Development and initialization scripts
```

## Documentation Navigation

All project documentation is indexed in **`WhatNext - docs/index.md`**, organized by concept for efficient LLM interaction. This index:
- Maps all markdown files by architectural concept
- Links documentation using Obsidian-style `[[WikiLinks]]`
- Provides quick reference for common commands and file locations
- Must be maintained when new documentation is created

Key formal documents:
- **`WhatNext - docs/04 architecture/srs-whatnext.md`** — Software Requirements Specification (MVP baseline)
- **`WhatNext - docs/04 architecture/architecture-whatnext.md`** — Architecture Design Document
- **`WhatNext - docs/03 guides/workflow-story-to-pr.md`** — Development workflow (Story → Issue → Spec → Commit → PR)

## Development Commands

### Initial Setup
```bash
./scripts/dev-init.sh  # Installs nvm, Node v24.3.0, and all dependencies
```

### Running the Application

**Recommended for P2P Development (starts both app + test-peer):**
```bash
node scripts/start-dev.mjs              # Starts Electron app + test peer together
node scripts/start-dev.mjs --app-only   # Only start Electron app
node scripts/start-dev.mjs --test-peer-only  # Only start test peer
```

**Traditional (app only):**
```bash
node scripts/start-app.mjs  # Starts the Electron app in dev mode
cd app && npm run dev        # Alternative: runs concurrently with hot-reload
```

**Test Peer (for P2P connection testing):**
```bash
cd test-peer && npm start  # Interactive CLI for testing P2P connections
cd test-peer && npm run dev # With auto-restart on file changes
```

### Building
```bash
cd app && npm run build          # Build all (renderer, main, preload)
cd app && npm run build:renderer # Build Vite frontend only
cd app && npm run build:main     # Build main process only
cd app && npm run build:preload  # Build preload script only
```

### Quality & Testing
```bash
cd app && npm run lint      # ESLint
cd app && npm run typecheck # TypeScript type checking (no emit)
cd app && npm test          # Vitest unit/integration suites
cd app && npm run test:e2e  # Playwright E2E (needs built app + display)
```

### Packaging
```bash
cd app && npm run package   # Creates distributable with electron-builder
```

## Electron Architecture

### Process Model
- **Main Process** (`app/src/main/main.ts`): Node.js context managing lifecycle, windows, and OS capabilities
- **Preload Script** (`app/src/main/preload.ts`): Secure bridge between main and renderer via contextBridge
- **Renderer Process** (`app/src/renderer/`): React UI running in sandboxed Chromium

### Build System
- **Main/Preload**: Built with `tsup` (outputs to `app/dist/`)
- **Renderer**: Built with Vite (outputs to `app/dist/` for production)
- **Dev Mode**: Vite dev server on port 1313, watches main/preload with concurrent processes

### Security Posture
- `nodeIntegration: false` and `contextIsolation: true` enforced
- No direct Node.js access in renderer
- All main process communication via IPC through preload script
- External links open in system browser, not in-app windows

## Key Technologies

### Frontend Stack
- **Electron**: Cross-platform desktop framework
- **React 19**: UI framework
- **TypeScript**: Type safety throughout
- **Vite**: Fast build tool and dev server
- **Tailwind CSS**: Styling
- **Zustand**: Lightweight state management (non-persistent UI state)

### P2P & Data Stack
- **libp2p**: P2P networking library (mDNS discovery, Noise encryption, Yamux multiplexing)
- **RxDB**: Reactive local database with P2P replication support
- **WebRTC**: NAT traversal via circuit relay

### Service Stack
- **Circuit Relay**: libp2p relay server for NAT traversal + companion tunnel (implemented in `/relay`)
- **Downloader**: yt-dlp/spotDL subprocess backends for audio acquisition (implemented in `/service/downloader`, consumed by the app's main process)
- **Express + WebSocket**: Helper service for OAuth coordination and API proxying (skeleton in `/service/src`)

## Architecture Principles

### Local-First Data
- User's local database is the absolute source of truth
- Data stored in user-accessible plaintext format (Structured Markdown + YAML frontmatter)
- Fully functional offline
- Users maintain complete ownership and control

### Decentralized Collaboration
- P2P network using WebRTC for direct peer communication
- No central server for core functionality (playlists, social features)
- Helper service ONLY for: P2P signaling, OAuth coordination, API proxying

### Data Flow Pattern
1. User action → State update → RxDB local database
2. RxDB emits change event → UI components re-render (reactive queries)
3. Replication protocol detects change → Broadcast to P2P network
4. Peers receive change → Update their RxDB → Their UI re-renders

### IPC Communication
Main process handles OS-level tasks (file dialogs, system integration). Renderer communicates via IPC:
- `ipcMain.handle()` in main process
- `ipcRenderer.invoke()` exposed via preload script
- Keep IPC surface minimal; expand via preload-safe APIs as needed

## Important Implementation Notes

### Spotify Integration Strategy — The Coordinator Model

Spotify's February 2026 API restrictions (Premium required, 5-user cap, 16 endpoints gutted) validated WhatNext's user-sovereignty thesis and catalyzed the **Coordinator Model** (see `WhatNext - docs/07 stories/the-walled-garden-cracks.md`):

**Primary approach (MVP):**
- **One person** (the coordinator) connects to Spotify, imports the playlist, and opens a P2P session
- **Participants join the session** with zero OAuth friction — no Spotify account needed
- **The collaboration happens in WhatNext's P2P layer**, independent of the source platform

**Sync modes** (on the playlist schema as `spotifySyncMode`):
1. **Accessory Mode** (MVP): Coordinator reads Spotify playlist, normalizes to canonical format, shares via P2P
2. **True Collaborate Mode**: Each participant with API access makes their own calls (requires collaborative playlist)
3. **Proxy Owner Mode**: Coordinator proxies writes back to Spotify on behalf of participants

### Import Adapter Architecture

WhatNext abstracts streaming services behind a **translation layer** pattern:
- **Adapter interface**: Each source (Spotify, Apple Music, local files, MusicBrainz) implements a common import adapter
- **Canonical format**: Tracks are normalized into WhatNext's internal model (see `app/src/renderer/db/schemas.ts`) — a track is a track regardless of source
- **Metadata enrichment**: Open sources (MusicBrainz, ListenBrainz) supplement or replace platform-specific metadata
- **Spotify adapter**: Currently implemented via OAuth PKCE (`app/src/main/spotify/spotify-auth.ts`)

### Conflict Resolution
- Target architecture: CRDTs for eventual consistency
- MVP may use Last-Write-Wins (LWW) with clear migration path to CRDTs

### Native Dependencies
- Currently none (`postinstall` script skips `electron-builder install-app-deps`)
- Future: When adding native deps (e.g., SQLite), integrate `electron-rebuild` in CI/CD

## Development Roadmap

**Phase 1 (MVP)**: Collaborative Playlist Sessions — "The Walled Garden Cracks"
- **P2P session is the product**: session creation, sharing, zero-friction join flow
- **Coordinator model**: one person imports, everyone collaborates
- **Import adapter architecture**: Spotify adapter at launch, interface designed for extensibility
- **Social layer**: turn-taking, queue management, reactions, presence
- **RxDB replication over libp2p**: checkpoint-based sync with LWW conflict resolution
- **Open metadata enrichment**: MusicBrainz as complement/fallback for Spotify metadata

**Phase 2**: Active Management & Platform Resilience
- Direct playlist management in WhatNext UI
- True Collaborate and Proxy Owner sync modes
- Additional import adapters (Apple Music, YouTube Music, local files)
- Local-only playlists (no source platform)
- CRDT migration from LWW

**Phase 3**: Sovereign Music Platform
- Local audio file management
- Privacy-preserving local LLM for semantic search
- Public plugin architecture (Obsidian-inspired)

## Code Style

- **Prettier Config**: Single quotes, 4-space tabs
- **TypeScript**: Strict mode, no `any` where avoidable
- **React**: Functional components with hooks
- **ESLint**: React hooks and refresh plugins enabled

## Commit Convention

WhatNext uses **Conventional Commits**:

```
<type>(<scope>): <short summary, ≤72 chars>

[Optional body: the "why", not the "what".]
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `style`, `perf`, `build`, `ci`

Scopes (living domain list): `sessions`, `p2p`, `spotify`, `db`, `ipc`, `ui`, `auth`, `relay`, `downloader`, `deps`, `dev-env`

Key rules (full guidelines: `WhatNext - docs/03 guides/coding-standards.md` §13):
- **Bisectable atomicity**: every commit compiles and passes tests standalone; tests ride with the code they cover.
- Subjects imperative and lowercase after the colon; body required unless trivial, why-focused prose.
- Issue refs as `Refs #N` / `Part of #N`; closing keywords (`Fixes #N`) only in PR descriptions.
- `BREAKING CHANGE:` footer for wire-format/schema/IPC contract breaks; protocol-touching commits that preserve compatibility say so ("wire format unchanged").
- Clean branches before PR (squash WIP); PRs merge as merge commits; `mvp`/`main` append-only.

**Do not include `Co-Authored-By` lines in commits.** If Claude Code contributed, note it in the PR description instead. All commits are human-owned.

## Agentic Work Policy

- **The P2P protocol is off-limits for fully autonomous agentic work** without explicit human approval. This covers: `app/src/main/p2p/`, `app/src/renderer/db/replication*.ts`, `app/src/main/handshake.ts`, and P2P message types in `app/src/shared/core/ipc-protocol.ts`.
- All other code may be implemented autonomously, subject to normal human review before merge.
- Agents cannot merge to `main` or `dev`. Every PR requires a human reviewer.
- **Worktree cleanup is Claude's responsibility**: after every agentic session, run `git worktree remove <path> && git branch -d <branch>` before closing.

## Critical Design Constraints

1. **User Sovereignty is Non-Negotiable**: Local data is canonical; external services are enhancements
2. **Plaintext First**: All user playlists must be readable/editable as files on disk
3. **Offline-Capable**: Core functionality works without internet
4. **Security Hardened**: Renderer sandbox enforced; minimize IPC surface
5. **Extensibility**: Design for future plugin architecture (inspired by Obsidian)

## Knowledge Management: Obsidian-First Documentation

The `/WhatNext - docs` directory is structured as an **Obsidian vault** optimized for concept-based knowledge growth, not chronological logging. This approach prioritizes enduring knowledge over ephemeral notes.

### Documentation Philosophy

**Concept Pages Over Timelines**: Document knowledge by concept (e.g., `[[libp2p]]`, `[[RxDB]]`, `[[Electron-IPC]]`), not by date. Learning accumulates in living documents that grow with the project.

**Timestamped Notes Are Rare**: Reserve `note-YYMMDD-[topic].md` format ONLY for:
- Critical production issues with significant impact
- Major architectural pivot points (worth preserving as historical context)
- Landmark learning moments that shaped project direction

**Use ADRs for Decisions**: Architectural Decision Records (`adr-YYMMDD-[decision].md`) capture the "why" behind major technical choices with their historical context.

### Directory Structure (Wide, Not Deep)

```
/WhatNext - docs
  /00 index         Vault indexes and backlog board
  /01 concepts      Core technology and pattern explanations
  /02 references    Reference material and external resource summaries
  /03 guides        How-to documents and workflows (including workflow-story-to-pr.md)
  /04 architecture  System design, ADRs, SRS, and architecture docs
  /05 notes         Development notes and learnings
  /06 reports       State-of-project vettings and audits
  /07 stories       Vision documents and project narratives
  /08 specs         Feature and component specs (linked from GitHub Issues)
  /09 milestones    Development milestones
  /10 PRs           PR records (auto-generated on merge)
  /99 meta          Templates and vault configuration
```

**Flat folders with semantic depth via nested tags**: Use tags like `#architecture/patterns/ipc`, `#core/net/p2p/libp2p`, `#data/rxdb/replication` to convey hierarchical relationships without deep nesting.

### Concept Page Template

When documenting a technology or pattern, create a concept page:

**Filename**: `concepts/[Concept-Name].md` (e.g., `concepts/libp2p.md`)

**Structure**:
```markdown
# Concept Name

#category/subcategory/specific

## What It Is
Brief, clear definition

## Why We Use It
How it serves WhatNext's architecture

## How It Works
Technical implementation details

## Key Patterns
Code patterns, best practices we've established

## Common Pitfalls
Mistakes to avoid, lessons learned

## Related Concepts
- [[Related-Concept-1]]
- [[Related-Concept-2]]

## References
- Official docs
- Relevant issue numbers
- External resources
```

### ADR Template (for major decisions)

**Filename**: `architecture/adr-YYMMDD-[decision].md`

**Structure**:
```markdown
# ADR: Decision Title

**Date**: YYYY-MM-DD
**Status**: Accepted | Superseded | Deprecated

#architecture/decisions

## Context
What situation led to this decision?

## Decision
What did we choose and why?

## Consequences
Trade-offs accepted, benefits gained

## Alternatives Considered
What we didn't choose and why

## References
- Related concepts: [[Concept-1]], [[Concept-2]]
- Issues: #10, #23
```

### When to Create Documentation

**Always document**:
- New technologies integrated (create concept page)
- Architecture decisions (create ADR)
- Patterns established (add to relevant concept page)
- Major milestones (create milestone summary)

**Update existing docs instead of creating new ones** unless the topic genuinely deserves its own page.

### Maintenance Discipline

1. **Update `WhatNext - docs/index.md`** when creating new documentation
2. **Use `[[WikiLinks]]`** liberally to connect related concepts
3. **Apply nested tags** (`#category/subcategory`) for graph visualization in Obsidian
4. **Consolidate learning** into concept pages rather than scattering across timestamped notes
5. **Archive or delete** notes that have been consolidated into concept pages

### For AI Assistants

When working on WhatNext:
- **Prioritize updating existing concept pages** over creating new timestamped notes
- **Check `WhatNext - docs/index.md`** for relevant existing documentation before creating new files
- **Use WikiLink syntax** `[[Concept-Name]]` when referencing other documentation
- **Apply appropriate nested tags** to new documentation for Obsidian graph navigation
- **Propose consolidation** when you notice scattered information that should be unified

## Reference Documentation

- **Documentation Index**: `WhatNext - docs/index.md` - Complete map of all project documentation
- **Full specification**: `WhatNext - docs/07 stories/whtnxt-nextspec.md` - Technical specification (source of truth)
- **SRS**: `WhatNext - docs/04 architecture/srs-whatnext.md` - Software Requirements Specification
- **Architecture**: `WhatNext - docs/04 architecture/architecture-whatnext.md` - Architecture Design Document
- **Vision supplement**: `WhatNext - docs/07 stories/the-walled-garden-cracks.md` - Coordinator model and service abstraction
- **Workflow guide**: `WhatNext - docs/03 guides/workflow-story-to-pr.md` - Development workflow
- **README**: High-level structure and stack overview
- **Development notes**: `WhatNext - docs/05 notes/` for lessons learned and troubleshooting
- **Electron docs**: https://www.electronjs.org/docs/latest/

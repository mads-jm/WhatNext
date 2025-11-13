# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatNext is a resilient, user-centric music management platform built on three core principles:
- **User Sovereignty**: Local-first data architecture with plaintext storage
- **Decentralized Collaboration**: P2P networking for playlist management without central servers
- **Rich Music Experience**: Deep metadata, intelligent discovery, and powerful organization

The project is architected as an Electron desktop application with a separate helper service for P2P signaling and external API management.

## Repository Structure

```
/app        - Main Electron application
/test-peer  - Barebones libp2p test peer for P2P development
/service    - Helper service for P2P signaling and Spotify OAuth (not yet implemented)
/docs       - Project specification (whtnxt-nextspec.md is the source of truth)
/scripts    - Development and initialization scripts
```

## Development Commands

### Initial Setup
```bash
./scripts/dev-init.sh  # Installs nvm, Node v24.3.0, and all dependencies
```

### Running the Application

**Recommended for P2P Development (starts both app + test-peer):**
```bash
./scripts/start-dev.sh              # Starts Electron app + test peer together
./scripts/start-dev.sh --app-only   # Only start Electron app
./scripts/start-dev.sh --test-peer-only  # Only start test peer
```

**Traditional (app only):**
```bash
./scripts/start-app.sh  # Starts the Electron app in dev mode
cd app && npm run dev   # Alternative: runs concurrently with hot-reload
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

### Planned Core Dependencies (from spec)
- **RxDB**: Reactive local database with P2P replication support
- **Simple-Peer/WebRTC**: P2P networking layer
- **WebRTC Adapter**: Cross-browser WebRTC compatibility

### Service Stack (Future)
- **Express/Fastify**: Lightweight HTTP server
- **WebSocket**: Signaling server for P2P connection brokering

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

### Spotify Integration Strategy
Three modes planned (see `docs/whtnxt-nextspec.md` §8.1):
1. **Accessory Mode** (MVP): Read-only polling of Spotify playlists
2. **True Collaborate Mode**: Each user makes API calls (requires collaborative playlist)
3. **Proxy Owner Mode**: Designated user proxies all Spotify writes

### Conflict Resolution
- Target architecture: CRDTs for eventual consistency
- MVP may use Last-Write-Wins (LWW) with clear migration path to CRDTs

### Native Dependencies
- Currently none (`postinstall` script skips `electron-builder install-app-deps`)
- Future: When adding native deps (e.g., SQLite), integrate `electron-rebuild` in CI/CD

## Development Roadmap

**Phase 1 (MVP)**: Collaborative Playlist Accessory
- P2P connection flow (`whtnxt://` protocol)
- Accessory Mode Spotify sync
- Social layer for turn-taking/shared queue
- RxDB integration

**Phase 2**: Active Management & Advanced Sync
- Direct playlist management in WhatNext UI
- True Collaborate and Proxy Mode sync strategies
- Local-only playlists

**Phase 3**: Sovereign Music Platform
- Local audio file management
- Privacy-preserving local LLM for semantic search
- Public plugin architecture

## Code Style

- **Prettier Config**: Single quotes, 4-space tabs
- **TypeScript**: Strict mode, no `any` where avoidable
- **React**: Functional components with hooks
- **ESLint**: React hooks and refresh plugins enabled

## Critical Design Constraints

1. **User Sovereignty is Non-Negotiable**: Local data is canonical; external services are enhancements
2. **Plaintext First**: All user playlists must be readable/editable as files on disk
3. **Offline-Capable**: Core functionality works without internet
4. **Security Hardened**: Renderer sandbox enforced; minimize IPC surface
5. **Extensibility**: Design for future plugin architecture (inspired by Obsidian)

## Development Notes & Learning

When encountering novel or interesting errors, issues, or architectural decisions, document them in `/docs/notes/` following this template:

```
note-YYMMDD-[topic].md
```

**Template structure**:
- **Date**: When the issue occurred
- **Issue**: Brief description of the problem
- **Status**: ✅ Resolved / 🔄 In Progress / ⚠️ Blocked
- **Problem**: Detailed description
- **Root Cause**: Why it happened
- **Key Learnings**: What we learned
- **Solution Applied**: How we fixed it
- **References**: Links to docs, issues, etc.
- **Next Steps**: Future work if any

These notes serve as:
- Learning documentation for the team
- Reference for similar future issues
- Context for architectural decisions
- Onboarding material for new developers

## Reference Documentation

- Full specification: `docs/whtnxt-nextspec.md`
- README: High-level structure and stack overview
- Development notes: `docs/notes/` for lessons learned and troubleshooting
- Electron docs: https://www.electronjs.org/docs/latest/

# WhatNext

A resilient, user-centric music management platform built on **user sovereignty**, **decentralized collaboration**, and **rich music experience**.

Your playlists live on your machine, in plaintext, readable and portable. Collaboration happens directly between peers — no central server, no corporate intermediary. Streaming services are sources, not owners.

**Current focus (MVP)**: collaborative playlist sessions — one coordinator imports a playlist, everyone else joins over P2P with zero OAuth friction. See the full project specification in `WhatNext - docs/07 stories/whtnxt-nextspec.md`.

## Structure

`/app` - The main Electron application (React + RxDB + libp2p)

`/relay` - Circuit relay server for P2P NAT traversal, plus the companion tunnel

`/test-peer` - Barebones libp2p test peer for P2P development

`/service` - Helper service: audio downloader module (yt-dlp/spotDL backends) and an Express/WebSocket skeleton for OAuth coordination and API proxying

`/WhatNext - docs` - Obsidian vault: project documentation organized by concept

`/docs` - Generated HTML documentation site (vault export — do not edit directly)

`/scripts` - Scripts for project initialization and development

## Key Documentation

- **[Documentation Index](WhatNext%20-%20docs/index.md)** — Complete map of all project docs; start here
- **[SRS](WhatNext%20-%20docs/04%20architecture/srs-whatnext.md)** — Software Requirements Specification
- **[Architecture](WhatNext%20-%20docs/04%20architecture/architecture-whatnext.md)** — Architecture Design Document
- **[The Walled Garden Cracks](WhatNext%20-%20docs/07%20stories/the-walled-garden-cracks.md)** — Vision: coordinator model and service abstraction
- **[Workflow: Story → PR](WhatNext%20-%20docs/03%20guides/workflow-story-to-pr.md)** — Development workflow
- **[Quick Start](WhatNext%20-%20docs/03%20guides/Quick-Start.md)** — P2P development walkthrough

## Stack

- [Electron](https://www.electronjs.org/docs/latest/)
- [React](https://react.dev/learn)
- [TypeScript](https://www.typescriptlang.org/docs/)
- [RxDB](https://rxdb.info/)
- [libp2p](https://libp2p.io/)
- [Vite](https://vitejs.dev/guide/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Zustand](https://zustand-demo.pmnd.rs/)

## Dev

```bash
./scripts/dev-init.sh                    # One-time setup: nvm, Node, dependencies
node scripts/start-dev.mjs               # App + test peer (recommended for P2P work)
node scripts/start-dev.mjs --app-only    # App only
node scripts/start-app.mjs               # App only (traditional mode)
node scripts/start-service.mjs           # Helper service (skeleton; relay covers P2P for now)
```

Quality gates (run from `app/`):

```bash
npm run typecheck   # TypeScript, no emit
npm run lint        # ESLint
npm test            # Vitest suites
npm run test:e2e    # Playwright (needs built app + display)
```

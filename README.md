# WhatNext

A resilient, user-centric music management platform built on **user sovereignty**, **decentralized collaboration**, and **rich music experience**.

Your playlists live on your machine, in plaintext, readable and portable. Collaboration happens directly between peers — no central server, no corporate intermediary. Streaming services are sources, not owners.

See the full project specification in `docs/07 stories/whtnxt-nextspec.md`.

## Structure

`/app` - The main Electron application (React + RxDB + libp2p)

`/relay` - Circuit relay server for P2P NAT traversal

`/test-peer` - Barebones libp2p test peer for P2P development

`/service` - Helper service for OAuth coordination and API proxying (planned)

`/docs` - Obsidian vault: project documentation organized by concept

`/scripts` - Scripts for project initialization and development

## Key Documentation

- **[SRS](docs/04%20architecture/srs-whatnext.md)** — Software Requirements Specification
- **[Architecture](docs/04%20architecture/architecture-whatnext.md)** — Architecture Design Document
- **[The Walled Garden Cracks](docs/07%20stories/the-walled-garden-cracks.md)** — Vision: coordinator model and service abstraction
- **[Documentation Index](docs/00%20index/INDEX.md)** — Complete map of all project docs

## Stack
- [Electron](https://www.electronjs.org/docs/latest/)
- [React](https://react.dev/learn)
- [RxDB](https://rxdb.info/)
- [libp2p](https://libp2p.io/)
- [Zustand](https://zustand-demo.pmnd.rs/)
- [TypeScript](https://www.typescriptlang.org/docs/)
- [Vite](https://vitejs.dev/guide/)

## Dev
- `./scripts/dev-init.sh` - Initializes the dev environment and installs dependencies via nvm and npm
- `node scripts/start-app.mjs` - Starts the Electron app
- `node scripts/start-dev.mjs` - Starts both Electron app + test peer for P2P development
- `node scripts/start-service.mjs` - Starts the helper service (not yet implemented)

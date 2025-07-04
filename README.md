# WhatNext

A resilient, user-centric music management platform.

See the full project specification in `docs/whtnxt-nextspec.md`.


## Struture

`/app` - The main Electron application

`/service` - The helper service for P2P signaling

`/docs` - The project specification -> to be moved to a isolated repo for use in Obsidian

`/scripts` - Scripts for project initialization and development

## Stack
- [Electron](https://www.electronjs.org/docs/latest/)
- [React](https://react.dev/learn)
- [RxDB](https://rxdb.info/)
- [Zustand](https://zustand-demo.pmnd.rs/)
- [Simple-Peer](https://github.com/feross/simple-peer)
- [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [TypeScript](https://www.typescriptlang.org/docs/)
- [Vite](https://vitejs.dev/guide/)
- [Electron-Vite](https://electron-vite.org/)

## Dev
- `./scripts/dev-init.sh` - Initializes the dev environment and installs dependencies via nvm and npm
- `./scripts/start-app.sh` - Starts the Electron app
- `./scripts/start-service.sh` - Starts the helper service (not yet implemented)
- `./scripts/build-app.sh` - Builds the Electron app (not yet configured)

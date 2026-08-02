---
tags:
  - core/electron
  - architecture/patterns/ipc
date created: Thursday, November 13th 2025, 4:59:12 am
date modified: Monday, March 9th 2026, 12:20:51 am
---

# Electron

## What It Is

Electron is a framework for building cross-platform desktop applications using web technologies (Chromium + Node.js). WhatNext uses Electron as its desktop shell, combining a React renderer with a Node.js main process and a utility process for P2P networking.

## Process Model

WhatNext runs three Electron processes (see [[adr-251110-electron-process-model]] for the decision record):

```ts
┌──────────────────────────────────────────┐
│  Renderer Process (Chromium, sandboxed)  │
│  React UI — no direct Node.js access     │
│  Communicates via window.electron (IPC)  │
└─────────────────┬────────────────────────┘
                  │ contextBridge / ipcRenderer
                  │
┌─────────────────▼────────────────────────┐
│  Main Process (Node.js)                  │
│  Window management, OS integration       │
│  Spotify API calls, file system          │
│  ipcMain.handle() registers all handlers │
└─────────────────┬────────────────────────┘
                  │ MessagePort / utilityProcess.fork()
                  │
┌─────────────────▼────────────────────────┐
│  Utility Process (Node.js)               │
│  libp2p P2P node — CPU-intensive, isolated│
│  Survives renderer reloads               │
└──────────────────────────────────────────┘
```

__Why three processes?__
- Renderer is sandboxed for security (`nodeIntegration: false`, `contextIsolation: true`)
- Utility process isolates P2P networking from the UI thread and main process
- Main process has full OS access, acts as trusted broker

## Build System

| Process | Bundler | Output |
|---------|---------|--------|
| Main | tsup | `app/dist/main.js` |
| Preload | tsup | `app/dist/preload.js` |
| Renderer | Vite | `app/dist/` (dev: port 1313) |

In development, Vite runs a hot-reload dev server and the main/preload are rebuilt by tsup with `--watch`.

## Security Model

- `nodeIntegration: false` — renderer has no access to Node.js APIs
- `contextIsolation: true` — renderer and preload run in separate JS contexts
- All system capabilities are exposed explicitly via `contextBridge` in `preload.ts`
- External URLs opened via `shell.openExternal()`, never in-app `<webview>`
- IPC input validated in main process before acting (path traversal, URL protocol checks)

## Key Files

- Main process entry: `app/src/main/main.ts`
- Preload bridge: `app/src/main/preload.ts`
- Renderer entry: `app/src/renderer/App.tsx`
- Utility process: `app/src/utility/p2p-service.ts`
- Build config: `app/tsup.config.ts`, `app/vite.config.ts`
- Electron builder config: `app/electron-builder.yml`

## Related Concepts

- [[Electron-IPC]] — Full IPC patterns: preload API surface, handlers, event-based push
- [[libp2p]] — What runs in the utility process
- [[React-Patterns]] — Renderer-side patterns
- [[adr-251110-electron-process-model]] — Why the three-process split
- [[note-251110-p2p-utility-process-architecture]] — Historical note on moving P2P into the utility process

## References

- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Utility Process API](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron Builder](https://www.electron.build/)

---

__Status__: Production-ready, running in WhatNext v0.0.0+
__Last Updated__: 2026-03-07


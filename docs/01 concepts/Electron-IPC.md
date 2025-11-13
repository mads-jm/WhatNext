---
tags:
  - architecture/patterns/ipc
  - core/electron
  - net/security
date created: Thursday, November 13th 2025, 4:59:12 am
date modified: Thursday, November 13th 2025, 5:20:36 am
---

# Electron IPC

## What It Is

Inter-Process Communication (IPC) in Electron enables secure communication between the main process (Node.js), preload scripts (bridge), and renderer processes (web pages). IPC is the foundation of Electron's security model, allowing renderers to access system capabilities without direct Node.js access.

In WhatNext, IPC provides the bridge between the React UI (renderer) and system-level operations (main process), with an additional layer for P2P networking (utility process).

## Why We Use It

- __Security__: Renderer sandbox enforced (no direct Node.js access)
- __Type safety__: Strongly-typed API surface via TypeScript
- __Modularity__: Clear separation between UI and system concerns
- __Electron architecture__: Industry-standard pattern for desktop apps

__Critical security principle__: `nodeIntegration: false` and `contextIsolation: true` enforced. All system access must go through preload script.

## How It Works

### Three-Process Architecture

```ts
┌──────────────────┐
│ Renderer Process │  (React UI - sandboxed Chromium)
│    (React)       │
└────────┬─────────┘
         │ IPC via window.electron
         ↓
┌────────────────────┐
│  Preload Script    │  (Security boundary - contextBridge)
│  (preload.ts)      │
└────────┬───────────┘
         │ ipcRenderer.invoke()
         ↓
┌────────────────────┐
│   Main Process     │  (Node.js - full system access)
│   (main.ts)        │
└────────┬───────────┘
         │ MessagePort
         ↓
┌────────────────────┐
│ Utility Process    │  (Node.js - libp2p P2P networking)
│  (p2p-service.ts)  │
└────────────────────┘
```

### IPC Flow

1. __Renderer__ calls `window.electron.app.getVersion()`
2. __Preload__ translates to `ipcRenderer.invoke('app:get-version')`
3. __Main__ handles via `ipcMain.handle('app:get-version', …)`
4. __Main__ returns result
5. __Preload__ forwards to renderer
6. __Renderer__ receives typed result

## Key Patterns

### Pattern 1: Preload API Surface

Expose minimal, type-safe API to renderer:

```typescript
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
    app: {
        getVersion: () => ipcRenderer.invoke('app:get-version'),
        getPlatform: () => ipcRenderer.invoke('app:get-platform')
    },
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close')
    },
    dialog: {
        openFile: (options) => ipcRenderer.invoke('dialog:open-file', options),
        openDirectory: (options) => ipcRenderer.invoke('dialog:open-directory')
    }
};

// Expose to renderer
contextBridge.exposeInMainWorld('electron', electronAPI);

// Type declarations for renderer
export type ElectronAPI = typeof electronAPI;
```

### Pattern 2: Main Process Handlers

Handle IPC requests in main process:

```typescript
// main.ts
import { app, ipcMain, BrowserWindow, dialog } from 'electron';

function setupIPC(mainWindow: BrowserWindow) {
    // Application info
    ipcMain.handle('app:get-version', () => app.getVersion());
    ipcMain.handle('app:get-platform', () => process.platform);

    // Window controls
    ipcMain.handle('window:minimize', () => mainWindow.minimize());
    ipcMain.handle('window:maximize', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    });

    // File dialogs
    ipcMain.handle('dialog:open-file', async (_, options) => {
        const result = await dialog.showOpenDialog(mainWindow, options);
        return result.filePaths;
    });

    // External links (with security validation)
    ipcMain.handle('shell:open-external', async (_, url: string) => {
        // Validate URL is http(s)
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            throw new Error('Invalid URL protocol');
        }
        await shell.openExternal(url);
    });
}
```

### Pattern 3: Renderer Usage

Use typed API in React components:

```typescript
// React component
import { useState, useEffect } from 'react';

function AppInfo() {
    const [version, setVersion] = useState('');
    const [platform, setPlatform] = useState('');

    useEffect(() => {
        // Call via window.electron (exposed by preload)
        window.electron.app.getVersion().then(setVersion);
        window.electron.app.getPlatform().then(setPlatform);
    }, []);

    return (
        <div>
            <p>Version: {version}</p>
            <p>Platform: {platform}</p>
        </div>
    );
}
```

### Pattern 4: Event-Based Communication

For continuous updates (not request/response):

```typescript
// Preload
const electronAPI = {
    onWindowMaximized: (callback) => {
        ipcRenderer.on('window-maximized', callback);
        return () => ipcRenderer.removeListener('window-maximized', callback);
    }
};

// Main
mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximized');
});

// Renderer
useEffect(() => {
    const cleanup = window.electron.onWindowMaximized(() => {
        console.log('Window maximized');
    });
    return cleanup;  // Cleanup listener
}, []);
```

### Pattern 5: Utility Process Communication

Main ↔ Utility via MessagePort:

```typescript
// Main spawning utility
import { utilityProcess } from 'electron';

const p2pProcess = utilityProcess.fork(
    path.join(__dirname, 'p2p-service.js')
);

// Send to utility
p2pProcess.postMessage({ type: 'START_NODE' });

// Receive from utility
p2pProcess.on('message', (message) => {
    console.log('From utility:', message);
    // Forward to renderer via IPC if needed
    mainWindow.webContents.send('p2p:event', message);
});

// Utility process (p2p-service.ts)
import { parentPort } from 'node:worker_threads';

parentPort?.on('message', (message) => {
    if (message.type === 'START_NODE') {
        // Start libp2p node
    }
});

parentPort?.postMessage({
    type: 'node_started',
    peerId: '12D3KooW...'
});
```

## Common Pitfalls

### Pitfall 1: Exposing Node.js Directly

__Problem__: Enabling `nodeIntegration` in renderer.

```typescript
// ❌ NEVER DO THIS
new BrowserWindow({
    webPreferences: {
        nodeIntegration: true,  // ← Security vulnerability!
        contextIsolation: false
    }
});
```

__Why dangerous__: Renderer has full Node.js access, including `require('child_process')`. Malicious code (XSS) can execute arbitrary system commands.

__Solution__: Keep `nodeIntegration: false`, `contextIsolation: true`. Use preload script.

### Pitfall 2: Forgetting to Register Handlers

__Problem__: Calling IPC method without corresponding `ipcMain.handle()`.

__Error__:

```ts
Error: No handler registered for 'app:get-version'
```

__Solution__: Register handler in main process before renderer loads:

```typescript
// main.ts - before createWindow()
ipcMain.handle('app:get-version', () => app.getVersion());
```

### Pitfall 3: Not Validating Input

__Problem__: Accepting untrusted renderer input without validation.

```typescript
// ❌ Dangerous
ipcMain.handle('file:delete', async (_, filePath) => {
    await fs.unlink(filePath);  // ← Malicious path could delete system files!
});

// ✅ Validated
ipcMain.handle('file:delete', async (_, filePath) => {
    const userDataPath = app.getPath('userData');
    if (!filePath.startsWith(userDataPath)) {
        throw new Error('Path outside user data directory');
    }
    await fs.unlink(filePath);
});
```

### Pitfall 4: Memory Leaks from Event Listeners

__Problem__: Adding event listeners without cleanup.

```typescript
// ❌ Memory leak
useEffect(() => {
    window.electron.onP2PEvent((data) => {
        console.log(data);
    });
    // ← No cleanup!
}, []);

// ✅ Proper cleanup
useEffect(() => {
    const cleanup = window.electron.onP2PEvent((data) => {
        console.log(data);
    });
    return cleanup;  // ← Cleanup on unmount
}, []);
```

### Pitfall 5: Synchronous IPC

__Problem__: Using `ipcRenderer.sendSync()` blocks renderer.

```typescript
// ❌ Blocks UI
const version = ipcRenderer.sendSync('app:get-version');

// ✅ Async (non-blocking)
const version = await ipcRenderer.invoke('app:get-version');
```

## Related Concepts

- [[Electron-Security]] - Security model and best practices
- [[libp2p]] - Utility process running P2P networking
- [[React-Patterns]] - Using IPC in React components

## References

### Official Documentation

- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [ipcMain](https://www.electronjs.org/docs/latest/api/ipc-main)
- [ipcRenderer](https://www.electronjs.org/docs/latest/api/ipc-renderer)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)

### WhatNext Implementation

- Preload script: `app/src/main/preload.ts`
- Main handlers: `app/src/main/main.ts`
- Utility process: `app/src/utility/p2p-service.ts`
- Type definitions: `app/src/renderer/electron.d.ts`

### Related Issues

- Issue 3: Setup Electron IPC for Core Functionality

---

__Status__: ✅ Production-ready, running in WhatNext v0.0.0
__Security__: `nodeIntegration: false`, `contextIsolation: true` enforced
__Last Updated__: 2025-11-12

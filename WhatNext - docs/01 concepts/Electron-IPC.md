---
tags:
  - architecture/patterns/ipc
  - core/electron
  - core/net/security
date created: Thursday, November 13th 2025, 4:59:12 am
date modified: Monday, March 9th 2026, 12:20:46 am
---

# Electron IPC

## What It Is

Inter-Process Communication (IPC) in Electron enables secure communication between the main process (Node.js), preload scripts (bridge), and renderer processes (web pages). IPC is the foundation of Electron's security model, allowing renderers to access system capabilities without direct Node.js access.

In WhatNext, IPC provides the bridge between the [[React]] UI (renderer) and system-level operations (main process), with an additional layer for P2P networking (utility process) — see [[Electron]] for the process model.

## Why We Use It

- __Security__: Renderer sandbox enforced (no direct Node.js access)
- __Type safety__: Strongly-typed API surface via TypeScript
- __Modularity__: Clear separation between UI and system concerns
- __Electron architecture__: Industry-standard pattern for desktop apps

__Critical security principle__: `nodeIntegration: false` and `contextIsolation: true` enforced. All system access must go through preload script.

## How It Works

### Four-Process Architecture

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

## Full window.electron API Surface

The complete `window.electron` API as exposed by `app/src/main/preload.ts`:

```typescript
window.electron = {
    // Application info
    app.getVersion()                              → 'app:get-version'
    app.getPlatform()                             → 'app:get-platform'
    app.getPath(name)                             → 'app:get-path'

    // Window controls
    window.minimize()                             → 'window:minimize'
    window.maximize()                             → 'window:maximize'
    window.close()                                → 'window:close'
    window.isMaximized()                          → 'window:is-maximized'
    window.onMaximized(cb)                        → ipcRenderer.on('window-maximized', cb)
    window.onUnmaximized(cb)                      → ipcRenderer.on('window-unmaximized', cb)

    // File system / dialogs
    dialog.openFile(options?)                     → 'dialog:open-file'
    dialog.openDirectory(options?)                → 'dialog:open-directory'
    dialog.saveFile(options?)                     → 'dialog:save-file'

    // File write (export)
    file.write(filePath, content)                 → 'file:write'

    // Artwork caching
    artwork.download(url)                         → 'artwork:download'
    // Returns: { success, localPath?, error? }

    // External links
    shell.openExternal(url)                       → 'shell:open-external'

    // User identity relay
    user.setIdentity({ displayName, avatarUrl?, userId }) → 'user:set-identity'
    // Relays identity to P2P utility for handshake

    // P2P connection management
    p2p.connect(peerId)                           → 'p2p:connect'
    p2p.disconnect(peerId)                        → 'p2p:disconnect'
    p2p.getConnections()                          → 'p2p:get-connections'
    p2p.getStatus()                               → 'p2p:get-status'
    p2p.onNodeStarted(cb)                         → ipcRenderer.on('p2p:node-started', cb)
    p2p.onPeerDiscovered(cb)                      → ipcRenderer.on('p2p:peer-discovered', cb)
    p2p.onConnectionRequest(cb)                   → ipcRenderer.on('p2p:connection-request', cb)
    p2p.onConnectionEstablished(cb)               → ipcRenderer.on('p2p:connection-established', cb)
    p2p.onConnectionFailed(cb)                    → ipcRenderer.on('p2p:connection-failed', cb)
    p2p.onConnectionClosed(cb)                    → ipcRenderer.on('p2p:connection-closed', cb)
    p2p.onNodeError(cb)                           → ipcRenderer.on('p2p:node-error', cb)

    // Replication (renderer ↔ main ↔ utility)
    replication.pushChanges(collection, documents)→ 'replication:push'
    replication.pullChanges(collection, checkpoint)→ 'replication:pull'
    replication.onReplicationChanges(cb)          → ipcRenderer.on('replication:changes', cb)
    replication.onReplicationState(cb)            → ipcRenderer.on('replication:state', cb)

    // Spotify integration
    spotify.startAuth()                           → 'spotify:auth-start'
    spotify.getAuthStatus()                       → 'spotify:auth-status'
    spotify.getPlaylists()                        → 'spotify:get-playlists'
    spotify.getTracks(playlistId)                 → 'spotify:get-tracks'
    spotify.getProfile()                          → 'spotify:get-profile'
    spotify.syncPlaylist(linkedSpotifyId)         → 'spotify:sync-playlist'
    spotify.onAuthComplete(cb)                    → ipcRenderer.on('spotify:auth-complete', cb)
    spotify.onAuthError(cb)                       → ipcRenderer.on('spotify:auth-error', cb)
    // Playback control (Spotify Premium required)
    spotify.getPlaybackState()                    → 'spotify:get-playback-state'
    spotify.getDevices()                          → 'spotify:get-devices'
    spotify.startPlayback(params)                 → 'spotify:start-playback'
    spotify.pausePlayback(params?)                → 'spotify:pause-playback'
    spotify.resumePlayback(params?)               → 'spotify:resume-playback'
    spotify.skipNext(params?)                     → 'spotify:skip-next'
    spotify.skipPrevious(params?)                 → 'spotify:skip-previous'
    // Session polling (returns snapshotId for optimisation)
    spotify.getPlaylistTracksFull(playlistId)     → 'spotify:get-playlist-tracks-full'

    // Low-level escape hatch (for advanced / edge cases)
    ipcRenderer.sendMessage(channel, args)
    ipcRenderer.invoke(channel, ...args)
    ipcRenderer.on(channel, listener)
}
```

All channel names are defined in `IPC_CHANNELS` in `app/src/shared/core/ipc-protocol.ts`. All payload types (`SpotifyFullTrackItem`, `SpotifyPlaybackStateResult`, `SpotifyStartPlaybackParams`, `ReplicationChangesPayload`, etc.) are in the same file.

## Related Concepts

- [[Electron]] - Process model overview
- [[libp2p]] - Utility process running P2P networking
- [[React-Patterns]] - Using IPC in React components
- [[Spotify-Integration]] - Full Spotify IPC surface and OAuth flow
- [[RxDB-Replication]] - The replication traffic that crosses this IPC boundary
- [[Companion-Client]] - Companion server state push rides the same renderer→main bridge
- [[epic-ipc-trust-boundary]] - Hardening spec for validating input at the IPC boundary
- [[adr-251110-electron-process-model]] - Decision record for the four-process split (main + preload + renderer + P2P utility process)

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

__Status__: Production-ready; API surface expanded in Sessions v1 (Spotify playback, artwork, user identity, replication)
__Security__: `nodeIntegration: false`, `contextIsolation: true` enforced
__Last Updated__: 2026-03-08


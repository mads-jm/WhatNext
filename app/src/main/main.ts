/* eslint-disable @typescript-eslint/no-require-imports */
/*
Main Process (main.ts): Node.js context. Manages lifecycle, windows, and OS-level capabilities.

Why this shape:
- Simplicity over framework-specific scaffolding (per @whtnxt-nextspec.md).
- Works with our scripts: tsup builds main/preload into app/dist; Vite serves renderer on 1313 in dev.
*/

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, protocol, shell, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { isDev } from './utils/environment';
import { getAssetPath } from './utils/path';
import {
    parseProtocolUrl,
    createConnectUrl,
    generateShortCode,
    createIPCMessage,
    MainToUtilityMessageType,
    UtilityToMainMessageType,
    IPC_CHANNELS,
    type IPCMessage,
    type PeerMetadata,
    type NodeStartedPayload,
    type PeerDiscoveredPayload,
    type ConnectionEstablishedPayload,
    type ConnectionFailedPayload,
    type ConnectionClosedPayload,
    type NodeErrorPayload,
    type HandshakeCompletePayload,
    type P2PStatusPayload,
    type ReplicationPullRequestPayload,
} from '../shared/core';
import {
    getRelayAddresses,
    addRelayAddress,
    removeRelayAddress,
} from './relay-config-store';

let mainWindow: BrowserWindow | null = null;
let p2pUtilityProcess: UtilityProcess | null = null;

/**
 * Prefer a single preload path in both dev/prod.
 * Our scripts emit preload to app/dist/preload.js, and we run electron on app/dist/main.js,
 * so __dirname resolves to that same dist directory in both dev and packaged builds.
 */
const preloadPath = path.join(__dirname, 'preload.js');

/**
 * Create and configure the main BrowserWindow.
 * - In dev, loads the Vite dev server (fast refresh).
 * - In prod, loads the built index.html from app/dist.
 */
const createMainWindow = (): BrowserWindow => {
    // Remove default application menu (File/Edit/View/etc.)
    Menu.setApplicationMenu(null);

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 800,
        minHeight: 500,
        icon: getAssetPath('png', 'wnorb.png'),
        frame: false,
        webPreferences: {
            // Security posture: no Node APIs in renderer; use preload + contextBridge.
            nodeIntegration: false,
            contextIsolation: true,
            preload: preloadPath,
        },
        show: false,
    });

    // Dev server vs static file
    if (isDev) {
        // Keep this in sync with the port in package.json "dev" script.
        mainWindow.loadURL('http://localhost:1313');
    } else {
        // Vite build outputs to app/dist by default; __dirname points to that folder at runtime.
        // loadFile handles "file://" and escaping for local HTML.
        mainWindow.loadFile(path.join(__dirname, 'index.ejs'));
    }

    // Prevent visual flash
    mainWindow.once('ready-to-show', () => {
        if (!mainWindow) throw new Error('"mainWindow" is not defined');
        mainWindow.show();

        // Toggle DevTools globally: Ctrl/Cmd+Shift+I
        globalShortcut.register('CommandOrControl+Shift+I', () => {
            if (!mainWindow) return;
            if (mainWindow.webContents.isDevToolsOpened()) {
                mainWindow.webContents.closeDevTools();
            } else {
                mainWindow.webContents.openDevTools();
            }
        });
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Forward window state changes to renderer if needed later
    mainWindow.on('maximize', () => {
        mainWindow?.webContents.send('window-maximized');
    });
    mainWindow.on('unmaximize', () => {
        mainWindow?.webContents.send('window-unmaximized');
    });

    // Open external links in the user's default browser (deny new windows in-app)
    mainWindow.webContents.setWindowOpenHandler((edata) => {
        shell.openExternal(edata.url);
        return { action: 'deny' };
    });

    // Optional: auto-open DevTools in dev; comment out if you prefer the shortcut only
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    return mainWindow;
};

/**
 * Spawn P2P utility process
 */
function spawnP2PUtilityProcess(): void {
    const utilityPath = path.join(__dirname, 'p2p-service.mjs');

    console.log('[Main] ========================================');
    console.log('[Main] Starting P2P utility process...');
    console.log('[Main] Utility path:', utilityPath);
    console.log('[Main] File exists:', require('fs').existsSync(utilityPath));
    console.log('[Main] ========================================');

    try {
        p2pUtilityProcess = utilityProcess.fork(utilityPath, [], {
            stdio: 'pipe',
            env: {
                ...process.env,
                NODE_ENV: process.env.NODE_ENV || 'production',
            },
        });

        console.log('[Main] ✓ utilityProcess.fork() returned successfully');

        // Handle messages from utility process
        p2pUtilityProcess.on('message', (message: IPCMessage) => {
            console.log('[Main] ← Received from utility:', message.type);

            // When utility process is ready, start the P2P node with relay addresses
            if (message.type === UtilityToMainMessageType.READY) {
                console.log('[Main] ✓ Utility process is READY, sending START_NODE');
                const relayAddresses = getRelayAddresses();
                console.log('[Main] Relay addresses from settings:', relayAddresses.length);
                sendToUtilityProcess(MainToUtilityMessageType.START_NODE, { relayAddresses });
                return;
            }

            handleUtilityProcessMessage(message);
        });

        // Handle utility process events
        p2pUtilityProcess.on('spawn', () => {
            console.log('[Main] ✓ P2P utility process spawned successfully');
        });

        p2pUtilityProcess.on('exit', (code) => {
            console.error(`[Main] ✗ P2P utility process exited with code ${code}`);
            p2pUtilityProcess = null;

            // Notify renderer of error
            if (mainWindow) {
                mainWindow.webContents.send(IPC_CHANNELS.P2P_NODE_ERROR, {
                    error: `Utility process exited with code ${code}`
                });
            }
        });

        // Handle stdout/stderr
        if (p2pUtilityProcess.stdout) {
            p2pUtilityProcess.stdout.on('data', (data) => {
                console.log('[P2P Utility →]', data.toString().trim());
            });
        }

        if (p2pUtilityProcess.stderr) {
            p2pUtilityProcess.stderr.on('data', (data) => {
                console.error('[P2P Utility ERROR →]', data.toString().trim());
            });
        }

        // Note: We no longer send START_NODE here.
        // We wait for the READY message from the utility process first.
        console.log('[Main] Waiting for utility process READY signal...');

    } catch (error) {
        console.error('[Main] ✗ FATAL: Failed to spawn utility process:', error);
        if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.P2P_NODE_ERROR, {
                error: `Failed to spawn utility process: ${error}`
            });
        }
    }
}

/**
 * Send message to utility process
 */
function sendToUtilityProcess(type: string, payload: Record<string, unknown>): void {
    if (!p2pUtilityProcess) {
        console.error('[Main] Cannot send to utility process: not spawned');
        return;
    }

    const message = createIPCMessage(type, payload);
    p2pUtilityProcess.postMessage(message);
}

/**
 * Handle messages from utility process
 */
function handleUtilityProcessMessage(message: IPCMessage): void {
    // Relay utility process events to renderer
    if (!mainWindow) {
        console.warn('[Main] mainWindow not available, cannot send to renderer');
        return;
    }

    if (!mainWindow.webContents) {
        console.warn('[Main] mainWindow.webContents not available');
        return;
    }

    // Check if the renderer is actually loaded
    if (!mainWindow.webContents.isLoading && !mainWindow.webContents.getURL()) {
        console.warn('[Main] Renderer not loaded yet, cannot send message');
        return;
    }

    console.log('[Main] → Relaying to renderer:', message.type);
    console.log('[Main] Renderer URL:', mainWindow.webContents.getURL());
    console.log('[Main] Renderer is loading:', mainWindow.webContents.isLoading());

    switch (message.type) {
        case UtilityToMainMessageType.NODE_STARTED: {
            const payload = message.payload as NodeStartedPayload;
            console.log('[Main] Sending NODE_STARTED to renderer:', payload);
            p2pState.nodeStarted = true;
            p2pState.peerId = payload.peerId;
            p2pState.multiaddrs = payload.multiaddrs;
            mainWindow.webContents.send(IPC_CHANNELS.P2P_NODE_STARTED, payload);
            break;
        }

        case UtilityToMainMessageType.PEER_DISCOVERED: {
            const payload = message.payload as PeerDiscoveredPayload;
            console.log('[Main] Sending PEER_DISCOVERED to renderer:', payload);
            const exists = p2pState.discoveredPeers.some(p => p.peerId === payload.peer.peerId);
            if (!exists) {
                p2pState.discoveredPeers.push(payload.peer);
            }
            mainWindow.webContents.send(IPC_CHANNELS.P2P_PEER_DISCOVERED, payload);
            break;
        }

        case UtilityToMainMessageType.CONNECTION_REQUEST:
            mainWindow.webContents.send(IPC_CHANNELS.P2P_CONNECTION_REQUEST, message.payload);
            break;

        case UtilityToMainMessageType.CONNECTION_ESTABLISHED: {
            const payload = message.payload as ConnectionEstablishedPayload;
            if (!p2pState.connectedPeers.includes(payload.peerId)) {
                p2pState.connectedPeers.push(payload.peerId);
            }
            mainWindow.webContents.send(IPC_CHANNELS.P2P_CONNECTION_ESTABLISHED, payload);
            break;
        }

        case UtilityToMainMessageType.CONNECTION_FAILED:
            mainWindow.webContents.send(IPC_CHANNELS.P2P_CONNECTION_FAILED, message.payload);
            break;

        case UtilityToMainMessageType.CONNECTION_CLOSED: {
            const payload = message.payload as ConnectionClosedPayload;
            p2pState.connectedPeers = p2pState.connectedPeers.filter(id => id !== payload.peerId);
            mainWindow.webContents.send(IPC_CHANNELS.P2P_CONNECTION_CLOSED, payload);
            break;
        }

        case UtilityToMainMessageType.NODE_ERROR:
            mainWindow.webContents.send(IPC_CHANNELS.P2P_NODE_ERROR, message.payload);
            break;

        case UtilityToMainMessageType.REPLICATION_CHANGES:
            console.log('[Main] Relaying replication changes to renderer');
            mainWindow.webContents.send(IPC_CHANNELS.REPLICATION_CHANGES, message.payload);
            break;

        case UtilityToMainMessageType.REPLICATION_STATE:
            mainWindow.webContents.send(IPC_CHANNELS.REPLICATION_STATE, message.payload);
            break;

        case UtilityToMainMessageType.HANDSHAKE_COMPLETE: {
            const payload = message.payload as HandshakeCompletePayload;
            console.log('[Main] Handshake complete:', payload);
            const discoveredPeer = p2pState.discoveredPeers.find(
                (p) => p.peerId === payload.peerId
            );
            if (discoveredPeer) {
                discoveredPeer.displayName = payload.displayName;
            }
            mainWindow.webContents.send('p2p:handshake-complete', payload);
            break;
        }

        case UtilityToMainMessageType.RELAY_CONNECTED: {
            const payload = message.payload as { connected: boolean; relayMultiaddr: string | null; relayPeerId: string | null };
            activeRelayMultiaddr = payload.relayMultiaddr;
            mainWindow.webContents.send(IPC_CHANNELS.P2P_RELAY_STATUS, payload);
            break;
        }

        case UtilityToMainMessageType.RELAY_DISCONNECTED: {
            activeRelayMultiaddr = null;
            mainWindow.webContents.send(IPC_CHANNELS.P2P_RELAY_STATUS, {
                connected: false,
                relayMultiaddr: null,
                relayPeerId: null,
            });
            break;
        }

        case UtilityToMainMessageType.PEER_PRESENCE_UPDATE:
            mainWindow.webContents.send(IPC_CHANNELS.P2P_PEER_PRESENCE, message.payload);
            break;

        case UtilityToMainMessageType.REPLICATION_PULL_REQUEST: {
            // Utility needs data from renderer's RxDB — forward the request
            const req = message.payload as ReplicationPullRequestPayload;
            mainWindow.webContents.send(IPC_CHANNELS.REPLICATION_PULL_REQUEST, req);
            break;
        }

        default:
            console.warn('[Main] Unknown utility message type:', message.type);
    }
}

/**
 * Handle whtnxt:// protocol URLs
 */
 // TODO : just do a match in the try{} here or route in a more extensible way.
 // Protocol should be a clear API boundary and structurally documented in /docs for easy consumption and provider implementation.
function handleProtocolUrl(url: string): void {
    console.log('[Main] Handling protocol URL:', url);

    // Handle Spotify callback
    if (url.startsWith('whtnxt://spotify-callback')) {
        handleSpotifyCallbackUrl(url);
        return;
    }

    try {
        const parsed = parseProtocolUrl(url);
        console.log('[Main] Parsed protocol URL:', parsed);

        // Forward to utility process
        sendToUtilityProcess(MainToUtilityMessageType.CONNECT_TO_PEER, {
            peerId: parsed.peerId,
            relay: parsed.relay,
        });

        // Bring window to front
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    } catch (error) {
        console.error('[Main] Failed to parse protocol URL:', error);
    }
}

async function handleSpotifyCallbackUrl(url: string): Promise<void> {
    try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get('code');
        const error = parsed.searchParams.get('error');

        if (error) {
            console.error('[Main] Spotify auth error:', error);
            mainWindow?.webContents.send('spotify:auth-error', { error });
            return;
        }

        if (!code) {
            console.error('[Main] Spotify callback missing code');
            return;
        }

        const { handleSpotifyCallback } = await import('./spotify/spotify-auth');
        const result = await handleSpotifyCallback(code);

        if (result.success && result.tokens) {
            // TODO : need a UX pass on token expiry, right now you have to see an error within a flow. We should proactively refresh and/or prompt the user before it becomes an interuption.
            const { saveTokens } = await import('./spotify/token-store');
            const { initSpotifyClient } = await import('./spotify/spotify-client');
            saveTokens(result.tokens);
            initSpotifyClient(result.tokens);
            console.log('[Main] Spotify auth complete!');
            mainWindow?.webContents.send('spotify:auth-complete', { success: true });
        } else {
            console.error('[Main] Spotify auth failed:', result.error);
            mainWindow?.webContents.send('spotify:auth-error', { error: result.error });
        }

        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    } catch (err) {
        console.error('[Main] Spotify callback handling failed:', err);
    }
}

/**
 * Register whtnxt:// protocol handler
 *
 * In dev mode, Electron is launched as: electron dist/main.js
 * setAsDefaultProtocolClient must be told the full launch command,
 * otherwise Windows registers just "electron.exe" with no app path,
 * and protocol URLs get interpreted as the app entry point.
 */
function registerProtocolHandler(): void {
    if (isDev) {
        // In dev: process.execPath = electron.exe, process.argv[1] = dist/main.js
        // We need to register both so Windows re-launches correctly.
        const appPath = path.resolve(process.argv[1]);
        if (!app.isDefaultProtocolClient('whtnxt', process.execPath, [appPath])) {
            app.setAsDefaultProtocolClient('whtnxt', process.execPath, [appPath]);
            console.log('[Main] Registered whtnxt:// protocol (dev mode)');
            console.log('[Main]   execPath:', process.execPath);
            console.log('[Main]   appPath:', appPath);
        }
    } else {
        if (!app.isDefaultProtocolClient('whtnxt')) {
            app.setAsDefaultProtocolClient('whtnxt');
            console.log('[Main] Registered as handler for whtnxt:// protocol');
        }
    }

    // Handle protocol URLs on startup (Windows/Linux)
    if (process.platform !== 'darwin' && process.argv.length > 1) {
        const url = process.argv.find((arg) => arg.startsWith('whtnxt://'));
        if (url) {
            handleProtocolUrl(url);
        }
    }
}

/**
 * Single Instance Lock
 * On Windows/Linux, clicking a whtnxt:// link launches a second app instance.
 * We grab the lock so only one instance runs; the second instance's argv
 * (containing the protocol URL) is forwarded to us via 'second-instance'.
 */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // We are the second instance — the first instance will handle our argv.
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        // On Windows/Linux the protocol URL arrives as a command-line argument
        const url = argv.find((arg) => arg.startsWith('whtnxt://'));
        if (url) {
            handleProtocolUrl(url);
        }

        // Bring existing window to front
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// Must be called before app is ready
protocol.registerSchemesAsPrivileged([
    { scheme: 'wn-art', privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);

/**
 * App lifecycle
 * - Recreate a window on macOS when activating from the dock with no windows open.
 * - Quit on all windows closed (except macOS).
 * - Clean up global shortcuts on quit.
 */
app.whenReady().then(async () => {
    // Serve local artwork files via wn-art:// to work around renderer file:// restrictions.
    // Path is passed as a query param to avoid Chromium mangling Windows absolute paths in URL segments.
    protocol.handle('wn-art', async (request) => {
        const filePath = new URL(request.url).searchParams.get('path');
        if (!filePath) return new Response(null, { status: 400 });
        try {
            const data = await fs.promises.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mime: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.webp': 'image/webp',
            };
            return new Response(data, {
                headers: { 'content-type': mime[ext] ?? 'image/jpeg' },
            });
        } catch {
            console.warn('[wn-art] File not found:', filePath);
            return new Response(null, { status: 404 });
        }
    });

    // Register protocol handler
    registerProtocolHandler();

    // Create main window FIRST so it's ready to receive P2P events
    createMainWindow();

    // Hydrate Spotify client with stored tokens so auth persists across restarts
    await ensureSpotifyModules();

    // THEN spawn P2P utility process after window is created
    // Wait for the window to be ready AND give React time to mount
    mainWindow?.once('ready-to-show', () => {
        console.log('[Main] Window ready, waiting for React to mount...');
        // Give React 500ms to mount and set up IPC listeners
        setTimeout(() => {
            console.log('[Main] Spawning P2P utility process');
            spawnP2PUtilityProcess();
        }, 500);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();

    // Kill utility process
    if (p2pUtilityProcess) {
        p2pUtilityProcess.kill();
        p2pUtilityProcess = null;
    }
});

// Harden: block window creation from renderer unless explicitly allowed
app.on('web-contents-created', (_, contents) => {
    contents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
});

/**
 * IPC: Core functionality handlers (renderer -> main).
 * Keep surface area small; expand via preload-safe APIs as features land.
 */

// ========================================
// Application Info
// ========================================
ipcMain.handle('app:get-version', () => {
    return app.getVersion();
});

ipcMain.handle('app:get-platform', () => {
    return process.platform;
});

ipcMain.handle('app:get-path', (_event, name: string) => {
    // Returns paths like 'userData', 'documents', 'downloads', etc.
    return app.getPath(name as Parameters<typeof app.getPath>[0]);
});

// ========================================
// Window Controls
// ========================================
ipcMain.handle('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
});

ipcMain.handle('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isMaximized()) {
        window.unmaximize();
    } else {
        window?.maximize();
    }
    return window?.isMaximized();
});

ipcMain.handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
});

ipcMain.handle('window:is-maximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window?.isMaximized() ?? false;
});

// ========================================
// File System Operations
// ========================================
ipcMain.handle('dialog:open-file', async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };

    const { dialog } = await import('electron');
    return dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        ...options,
    });
});

ipcMain.handle('dialog:open-directory', async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };

    const { dialog } = await import('electron');
    return dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        ...options,
    });
});

ipcMain.handle('dialog:save-file', async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePath: undefined };

    const { dialog } = await import('electron');
    return dialog.showSaveDialog(mainWindow, options);
});

// ========================================
// File Write (for export)
// ========================================
ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
});

// ========================================
// Artwork Caching
// ========================================

/** Strip filesystem-illegal characters and trim to a safe length. */
function sanitizePathSegment(str: string): string {
    return str.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80);
}

/**
 * Build human-readable base filename from album/artist metadata.
 * Returns null if insufficient metadata — caller falls back to hash.
 */
function artworkBaseName(albumName?: string, artistName?: string): string | null {
    if (!albumName) return null;
    const album = sanitizePathSegment(albumName);
    if (!album) return null;
    if (artistName) {
        const artist = sanitizePathSegment(artistName);
        if (artist) return `${artist} - ${album}`;
    }
    return album;
}

/**
 * Download and cache artwork (album art or playlist cover) from a remote URL.
 * Files are named by album/artist for local-first legibility.
 * An index.json in the artwork directory maps remote URL → local filename
 * for deduplication without re-downloading.
 */
ipcMain.handle('artwork:download', async (_event, req: { url: string; albumName?: string; artistName?: string }) => {
    try {
        const { url, albumName, artistName } = req;
        const artworkDir = path.join(app.getPath('documents'), 'WhatNext', 'artwork');
        await fs.promises.mkdir(artworkDir, { recursive: true });

        // Load index: url → filename
        const indexPath = path.join(artworkDir, 'index.json');
        let index: Record<string, string> = {};
        try {
            index = JSON.parse(await fs.promises.readFile(indexPath, 'utf-8'));
        } catch { /* no index yet */ }

        // Return cached path if index entry exists and file is present
        if (index[url]) {
            const cachedPath = path.join(artworkDir, index[url]);
            try {
                await fs.promises.access(cachedPath);
                return { success: true, localPath: cachedPath };
            } catch {
                delete index[url]; // stale entry — re-download
            }
        }

        // Build human-readable filename; fall back to URL hash
        const indexedNames = new Set(Object.values(index));
        const baseName = artworkBaseName(albumName, artistName);
        let filename: string;
        if (baseName) {
            let candidate = `${baseName}.jpg`;
            let n = 2;
            while (indexedNames.has(candidate)) candidate = `${baseName}-${n++}.jpg`;
            filename = candidate;
        } else {
            const rawId = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
            const imageId = rawId.replace(/[^a-zA-Z0-9_-]/g, '') || Buffer.from(url).toString('base64url').slice(0, 40);
            filename = `${imageId}.jpg`;
        }

        const localPath = path.join(artworkDir, filename);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await fs.promises.writeFile(localPath, Buffer.from(await response.arrayBuffer()));

        // Persist index
        index[url] = filename;
        await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2));

        return { success: true, localPath };
    } catch (error) {
        console.error('[Main] artwork:download failed:', error);
        return { success: false, error: String(error) };
    }
});

// ========================================
// External Links
// ========================================
// TODO : This is worth hardening with a URL whitelist or stricter validation, depending on final use case
// NOTE : Thinking spotify, youtube, soundcloud, tidal, whitelist? tie to feature flag that's coupled to actual feature status / enable
ipcMain.handle('shell:open-external', async (_event, url: string) => {
    // Security: validate URL before opening
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
            await shell.openExternal(url);
            return { success: true };
        }
        return { success: false, error: 'Invalid protocol' };
    } catch (error) {
        return { success: false, error: 'Invalid URL' };
    }
});

// ========================================
// P2P Connection Management
// ========================================

// Store P2P state that the renderer can pull
let p2pState: P2PStatusPayload = {
    nodeStarted: false,
    peerId: '',
    multiaddrs: [],
    discoveredPeers: [],
    connectedPeers: [],
    protocols: [],
};

// Active relay info (populated when relay connects in utility process)
let activeRelayMultiaddr: string | null = null;

ipcMain.handle(IPC_CHANNELS.P2P_CONNECT, async (_event, peerId: string) => {
    console.log('[Main] Renderer requested connection to peer:', peerId.slice(0, 20) + '...');
    sendToUtilityProcess(MainToUtilityMessageType.CONNECT_TO_PEER, { peerId });
    return { success: true };
});

ipcMain.handle(IPC_CHANNELS.P2P_DISCONNECT, async (_event, peerId: string) => {
    sendToUtilityProcess(MainToUtilityMessageType.DISCONNECT_FROM_PEER, { peerId });
    return { success: true };
});

ipcMain.handle(IPC_CHANNELS.P2P_GET_CONNECTIONS, async () => {
    // Return stored state
    return p2pState.connectedPeers;
});

// Add new handler for getting full P2P status
ipcMain.handle('p2p:get-status', async () => {
    console.log('[Main] Renderer requesting P2P status:', p2pState);
    return p2pState;
});

// ========================================
// User Identity Relay (renderer → utility)
// ========================================

ipcMain.handle('user:set-identity', async (_event, identity: { displayName: string; avatarUrl?: string; userId: string }) => {
    console.log('[Main] Setting user identity for P2P:', identity.displayName);
    sendToUtilityProcess(MainToUtilityMessageType.SET_USER_IDENTITY, identity);
    return { success: true };
});

// ========================================
// Replication Relay (renderer ↔ utility)
// ========================================

ipcMain.handle(IPC_CHANNELS.REPLICATION_PUSH, async (_event, payload) => {
    console.log('[Main] Replication push:', payload.collection, payload.documents?.length, 'docs');
    sendToUtilityProcess(MainToUtilityMessageType.REPLICATION_PUSH, payload);
    return { success: true };
});

ipcMain.handle(IPC_CHANNELS.REPLICATION_PULL, async (_event, payload) => {
    console.log('[Main] Replication pull:', payload.collection);
    sendToUtilityProcess(MainToUtilityMessageType.REPLICATION_PULL, payload);
    return { success: true };
});

// ========================================
// Spotify Integration
// ========================================

let spotifyInitialized = false;

async function ensureSpotifyModules(): Promise<void> {
    if (!spotifyInitialized) {
        try {
            const { loadStoredTokens } = await import('./spotify/spotify-client');
            loadStoredTokens();
            spotifyInitialized = true;
        } catch (e) {
            console.log('[Main] Spotify modules not ready yet');
        }
    }
}

ipcMain.handle('spotify:auth-start', async () => {
    const { startSpotifyAuth } = await import('./spotify/spotify-auth');
    return startSpotifyAuth();
});

ipcMain.handle('spotify:auth-status', async () => {
    const { isAuthenticated } = await import('./spotify/spotify-client');
    const { hasTokens } = await import('./spotify/token-store');
    await ensureSpotifyModules();
    return {
        authenticated: isAuthenticated(),
        hasStoredTokens: hasTokens(),
    };
});

ipcMain.handle('spotify:get-playlists', async () => {
    try {
        const { getUserPlaylists } = await import('./spotify/spotify-client');
        const result = await getUserPlaylists();
        return { success: true, playlists: result.items, total: result.total };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle('spotify:get-tracks', async (_event, playlistId: string) => {
    try {
        const { getPlaylistTracks } = await import('./spotify/spotify-client');
        const { mapSpotifyTracks } = await import('./spotify/spotify-mapper');
        const result = await getPlaylistTracks(playlistId);
        const mapped = mapSpotifyTracks(result.items);
        return { success: true, tracks: mapped, total: result.total };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});
// TODO : Asset
ipcMain.handle('spotify:get-profile', async () => {
    try {
        const { getCurrentUser } = await import('./spotify/spotify-client');
        const profile = await getCurrentUser();
        return {
            success: true,
            userId: profile.id,
            displayName: profile.display_name,
            avatarUrl: profile.images?.[0]?.url,
        };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle('spotify:sync-playlist', async (_event, linkedSpotifyId: string) => {
    try {
        const { getPlaylistTracks } = await import('./spotify/spotify-client');
        const { mapSpotifyTracks } = await import('./spotify/spotify-mapper');

        // Paginate through ALL tracks — playlists can exceed 100 tracks
        // TODO : ... is this? Is this limiting to 100?
        const allItems: Awaited<ReturnType<typeof getPlaylistTracks>>['items'] = [];
        let offset = 0;
        const limit = 100;
        let total = Infinity;

        while (offset < total) {
            const page = await getPlaylistTracks(linkedSpotifyId, limit, offset);
            total = page.total;
            allItems.push(...page.items);
            offset += page.items.length;
            if (page.items.length < limit) break;
        }

        const mapped = mapSpotifyTracks(allItems);
        return { success: true, tracks: mapped, total: allItems.length };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

// ========================================
// Spotify Playback Control
// ========================================

ipcMain.handle(IPC_CHANNELS.SPOTIFY_GET_PLAYBACK_STATE, async () => {
    try {
        const { getPlaybackState } = await import('./spotify/spotify-client');
        const state = await getPlaybackState();
        return { success: true, state };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle(IPC_CHANNELS.SPOTIFY_GET_DEVICES, async () => {
    try {
        const { getDevices } = await import('./spotify/spotify-client');
        const devices = await getDevices();
        return { success: true, devices };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle(IPC_CHANNELS.SPOTIFY_START_PLAYBACK, async (_event, params) => {
    try {
        const { startPlayback } = await import('./spotify/spotify-client');
        await startPlayback(params);
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle(IPC_CHANNELS.SPOTIFY_PAUSE_PLAYBACK, async (_event, params?: { deviceId?: string }) => {
    try {
        const { pausePlayback } = await import('./spotify/spotify-client');
        await pausePlayback(params?.deviceId);
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle(IPC_CHANNELS.SPOTIFY_RESUME_PLAYBACK, async (_event, params?: { deviceId?: string }) => {
    try {
        const { resumePlayback } = await import('./spotify/spotify-client');
        await resumePlayback(params?.deviceId);
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle(IPC_CHANNELS.SPOTIFY_SKIP_NEXT, async (_event, params?: { deviceId?: string }) => {
    try {
        const { skipToNext } = await import('./spotify/spotify-client');
        await skipToNext(params?.deviceId);
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle(IPC_CHANNELS.SPOTIFY_SKIP_PREVIOUS, async (_event, params?: { deviceId?: string }) => {
    try {
        const { skipToPrevious } = await import('./spotify/spotify-client');
        await skipToPrevious(params?.deviceId);
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

ipcMain.handle(IPC_CHANNELS.SPOTIFY_GET_PLAYLIST_TRACKS_FULL, async (_event, playlistId: string) => {
    try {
        const { getPlaylistTracksFull } = await import('./spotify/spotify-client');
        const result = await getPlaylistTracksFull(playlistId);
        return { success: true, tracks: result.tracks, total: result.total, snapshotId: result.snapshotId };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

// ========================================
// Relay Configuration
// ========================================

ipcMain.handle(IPC_CHANNELS.P2P_RELAY_GET, () => {
    return { addresses: getRelayAddresses() };
});

ipcMain.handle(IPC_CHANNELS.P2P_RELAY_ADD, async (_event, multiaddr: string) => {
    const addresses = addRelayAddress(multiaddr);
    // Notify utility process to attempt connection to the new relay
    sendToUtilityProcess(MainToUtilityMessageType.UPDATE_RELAY_ADDRESSES, { addresses });
    return { success: true, addresses };
});

ipcMain.handle(IPC_CHANNELS.P2P_RELAY_REMOVE, async (_event, multiaddr: string) => {
    const addresses = removeRelayAddress(multiaddr);
    sendToUtilityProcess(MainToUtilityMessageType.UPDATE_RELAY_ADDRESSES, { addresses });
    return { success: true, addresses };
});

// ========================================
// Session Invite URL
// ========================================

ipcMain.handle(IPC_CHANNELS.P2P_GET_INVITE_URL, (_event, sessionId?: string) => {
    const peerId = p2pState.peerId;
    if (!peerId) {
        return { success: false, error: 'P2P node not started' };
    }

    const url = createConnectUrl(peerId, {
        relay: activeRelayMultiaddr ?? undefined,
        sessionId,
    });

    const shortCode = generateShortCode(sessionId ?? peerId);

    return {
        success: true,
        url,
        shortCode,
        peerId,
        relayAddr: activeRelayMultiaddr,
    };
});

// Join a session by parsing a whtnxt:// URL or a short code
ipcMain.handle(IPC_CHANNELS.P2P_JOIN_SESSION, (_event, urlOrCode: string) => {
    const trimmed = urlOrCode.trim();
    if (trimmed.startsWith('whtnxt://')) {
        handleProtocolUrl(trimmed);
        return { success: true };
    }
    // Short codes can't be resolved without a rendezvous server (Phase 2).
    // For now, return a helpful error.
    return { success: false, error: 'Short codes require a rendezvous server (coming in Phase 2). Please use the full whtnxt:// link.' };
});

// ========================================
// Replication Pull Response (renderer → utility bridge)
// ========================================

// Renderer responds to a REPLICATION_PULL_REQUEST with the data from its RxDB
ipcMain.handle(IPC_CHANNELS.REPLICATION_PULL_RESPONSE, (_event, payload) => {
    // Forward the response to the utility process so it can serve the data
    // to the remote peer's pull-request stream
    sendToUtilityProcess(MainToUtilityMessageType.REPLICATION_PULL_RESPONSE, payload);
    return { success: true };
});

// Handle protocol URLs on macOS (open-url event)
app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
});

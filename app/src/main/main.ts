/* eslint-disable @typescript-eslint/no-require-imports */
/*
Main Process (main.ts): Node.js context. Manages lifecycle, windows, and OS-level capabilities.

Why this shape:
- Simplicity over framework-specific scaffolding (per @whtnxt-nextspec.md).
- Works with our scripts: tsup builds main/preload into app/dist; Vite serves renderer on 1313 in dev.
*/

import { app, BrowserWindow, globalShortcut, ipcMain, shell } from 'electron';
import * as path from 'path';
import { isDev } from './utils/environment';

let mainWindow: BrowserWindow | null = null;

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
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
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
 * App lifecycle
 * - Recreate a window on macOS when activating from the dock with no windows open.
 * - Quit on all windows closed (except macOS).
 * - Clean up global shortcuts on quit.
 */
app.whenReady().then(() => {
    createMainWindow();

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
    return app.getPath(name as any);
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
// External Links
// ========================================
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

/* eslint-disable @typescript-eslint/no-explicit-any */
/*
Preload runs in an isolated, privileged context.
Expose a minimal, explicit API to the renderer via contextBridge.
This adheres to Electron security guidance.
*/

import { contextBridge, ipcRenderer, OpenDialogOptions, SaveDialogOptions } from 'electron';

const electronHandler = {
    // ========================================
    // Application Info
    // ========================================
    app: {
        getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
        getPlatform: (): Promise<NodeJS.Platform> =>
            ipcRenderer.invoke('app:get-platform'),
        getPath: (
            name: 'home' | 'userData' | 'documents' | 'downloads' | 'temp'
        ): Promise<string> => ipcRenderer.invoke('app:get-path', name),
    },

    // ========================================
    // Window Controls
    // ========================================
    window: {
        minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
        maximize: (): Promise<boolean> =>
            ipcRenderer.invoke('window:maximize'),
        close: (): Promise<void> => ipcRenderer.invoke('window:close'),
        isMaximized: (): Promise<boolean> =>
            ipcRenderer.invoke('window:is-maximized'),
        onMaximized: (callback: () => void) => {
            ipcRenderer.on('window-maximized', callback);
            return () => ipcRenderer.removeListener('window-maximized', callback);
        },
        onUnmaximized: (callback: () => void) => {
            ipcRenderer.on('window-unmaximized', callback);
            return () =>
                ipcRenderer.removeListener('window-unmaximized', callback);
        },
    },

    // ========================================
    // File System Operations
    // ========================================
    dialog: {
        openFile: (
            options?: OpenDialogOptions
        ): Promise<{ canceled: boolean; filePaths: string[] }> =>
            ipcRenderer.invoke('dialog:open-file', options),
        openDirectory: (
            options?: OpenDialogOptions
        ): Promise<{ canceled: boolean; filePaths: string[] }> =>
            ipcRenderer.invoke('dialog:open-directory', options),
        saveFile: (
            options?: SaveDialogOptions
        ): Promise<{ canceled: boolean; filePath?: string }> =>
            ipcRenderer.invoke('dialog:save-file', options),
    },

    // ========================================
    // External Links
    // ========================================
    shell: {
        openExternal: (
            url: string
        ): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('shell:open-external', url),
    },

    // ========================================
    // Low-level IPC (for advanced use cases)
    // ========================================
    ipcRenderer: {
        /**
         * Fire-and-forget to main.
         */
        sendMessage(channel: string, args: any[]): void {
            ipcRenderer.send(channel, args);
        },
        /**
         * Request/response to main (matches ipcMain.handle).
         */
        invoke<T = any>(channel: string, ...args: any[]): Promise<T> {
            return ipcRenderer.invoke(channel, ...args);
        },
        /**
         * Subscribe to async events from main.
         */
        on(channel: string, listener: (event: any, ...args: any[]) => void) {
            ipcRenderer.on(channel, listener as any);
            return () => ipcRenderer.removeListener(channel, listener as any);
        },
    },
};

// Expose once; fail-soft if already present (dev hot reloads).
if (typeof (window as any).electron === 'undefined') {
    contextBridge.exposeInMainWorld('electron', electronHandler);
} else {
    // eslint-disable-next-line no-console
    console.error(
        'Cannot bind `electron` API: property already exists on the window object.'
    );
}

export type ElectronHandler = typeof electronHandler;

declare global {
    interface Window {
        electron?: ElectronHandler;
    }
}

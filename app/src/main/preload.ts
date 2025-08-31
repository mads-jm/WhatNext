/* eslint-disable @typescript-eslint/no-explicit-any */
/*
Preload runs in an isolated, privileged context.
Expose a minimal, explicit API to the renderer via contextBridge.
This adheres to Electron security guidance.
*/

import { contextBridge, ipcRenderer } from 'electron';

const electronHandler = {
    // app
    getVersion: () => ipcRenderer.invoke('app:get-version'),

    // window controls
    minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
    maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
    unmaximizeWindow: () => ipcRenderer.invoke('unmaximize-window'),
    closeWindow: () => ipcRenderer.invoke('close-window'),

    // window maximize events
    onWindowMaximize: (callback: () => void) =>
        ipcRenderer.on('window-maximized', callback),
    onWindowUnmaximize: (callback: () => void) =>
        ipcRenderer.on('window-unmaximized', callback),
    removeWindowMaximizeListeners: () => {
        ipcRenderer.removeAllListeners('window-maximized');
        ipcRenderer.removeAllListeners('window-unmaximized');
    },
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

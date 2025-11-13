/* eslint-disable @typescript-eslint/no-explicit-any */
/*
Preload runs in an isolated, privileged context.
Expose a minimal, explicit API to the renderer via contextBridge.
This adheres to Electron security guidance.
*/

import { contextBridge, ipcRenderer, OpenDialogOptions, SaveDialogOptions } from 'electron';
import { IPC_CHANNELS } from '../shared/core';

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
    // P2P Connection Management
    // ========================================
    p2p: {
        /**
         * Connect to a peer by peer ID
         */
        connect: (peerId: string): Promise<{ success: boolean }> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_CONNECT, peerId),

        /**
         * Disconnect from a peer
         */
        disconnect: (peerId: string): Promise<{ success: boolean }> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_DISCONNECT, peerId),

        /**
         * Get list of connected peers
         */
        getConnections: (): Promise<any[]> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_GET_CONNECTIONS),

        /**
         * Get current P2P status (pull-based, more reliable than push events)
         */
        getStatus: (): Promise<any> =>
            ipcRenderer.invoke('p2p:get-status'),

        /**
         * Subscribe to P2P node started event
         */
        onNodeStarted: (callback: (data: any) => void) => {
            console.log('[Preload] Setting up listener for channel:', IPC_CHANNELS.P2P_NODE_STARTED);
            const listener = (_: any, data: any) => {
                console.log('[Preload] ← Received on channel', IPC_CHANNELS.P2P_NODE_STARTED, data);
                callback(data);
            };
            ipcRenderer.on(IPC_CHANNELS.P2P_NODE_STARTED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_NODE_STARTED, listener);
        },

        /**
         * Subscribe to peer discovered events
         */
        onPeerDiscovered: (callback: (data: any) => void) => {
            console.log('[Preload] Setting up listener for channel:', IPC_CHANNELS.P2P_PEER_DISCOVERED);
            const listener = (_: any, data: any) => {
                console.log('[Preload] ← Received on channel', IPC_CHANNELS.P2P_PEER_DISCOVERED, data);
                callback(data);
            };
            ipcRenderer.on(IPC_CHANNELS.P2P_PEER_DISCOVERED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_PEER_DISCOVERED, listener);
        },

        /**
         * Subscribe to connection request events
         */
        onConnectionRequest: (callback: (data: any) => void) => {
            const listener = (_: any, data: any) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_CONNECTION_REQUEST, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_CONNECTION_REQUEST, listener);
        },

        /**
         * Subscribe to connection established events
         */
        onConnectionEstablished: (callback: (data: any) => void) => {
            const listener = (_: any, data: any) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_CONNECTION_ESTABLISHED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_CONNECTION_ESTABLISHED, listener);
        },

        /**
         * Subscribe to connection failed events
         */
        onConnectionFailed: (callback: (data: any) => void) => {
            const listener = (_: any, data: any) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_CONNECTION_FAILED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_CONNECTION_FAILED, listener);
        },

        /**
         * Subscribe to connection closed events
         */
        onConnectionClosed: (callback: (data: any) => void) => {
            const listener = (_: any, data: any) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_CONNECTION_CLOSED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_CONNECTION_CLOSED, listener);
        },

        /**
         * Subscribe to node error events
         */
        onNodeError: (callback: (data: any) => void) => {
            const listener = (_: any, data: any) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_NODE_ERROR, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_NODE_ERROR, listener);
        },
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

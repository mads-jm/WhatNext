/*
Preload runs in an isolated, privileged context.
Expose a minimal, explicit API to the renderer via contextBridge.
This adheres to Electron security guidance.
*/

import { contextBridge, ipcRenderer, IpcRendererEvent, OpenDialogOptions, SaveDialogOptions } from 'electron';
import {
    IPC_CHANNELS,
    type NodeStartedPayload,
    type PeerDiscoveredPayload,
    type ConnectionRequestPayload,
    type ConnectionEstablishedPayload,
    type ConnectionFailedPayload,
    type ConnectionClosedPayload,
    type NodeErrorPayload,
    type P2PStatusPayload,
    type ReplicationChangesPayload,
    type ReplicationStatePayload,
} from '../shared/core';
import type { SpotifyPlaylistItem } from './types';
import type { MappedTrack } from './spotify/spotify-mapper';
import type {
    SpotifyPlaybackStateResult,
    SpotifyDevice,
    SpotifyStartPlaybackParams,
    SpotifyPlaylistTracksFullResult,
} from '../shared/core/ipc-protocol';

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
    // File Write (for export)
    // ========================================
    file: {
        write: (
            filePath: string,
            content: string
        ): Promise<{ success: boolean }> =>
            ipcRenderer.invoke('file:write', filePath, content),
    },

    // ========================================
    // Artwork Caching
    // ========================================
    artwork: {
        download: (url: string, meta?: { albumName?: string; artistName?: string }): Promise<{ success: boolean; localPath?: string; error?: string }> =>
            ipcRenderer.invoke('artwork:download', { url, albumName: meta?.albumName, artistName: meta?.artistName }),
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
    // User Identity
    // ========================================
    user: {
        setIdentity: (identity: { displayName: string; avatarUrl?: string; userId: string }): Promise<{ success: boolean }> =>
            ipcRenderer.invoke('user:set-identity', identity),
    },

    // ========================================
    // P2P Connection Management
    // ========================================
    p2p: {
        connect: (peerId: string): Promise<{ success: boolean }> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_CONNECT, peerId),

        disconnect: (peerId: string): Promise<{ success: boolean }> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_DISCONNECT, peerId),

        getConnections: (): Promise<string[]> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_GET_CONNECTIONS),

        getStatus: (): Promise<P2PStatusPayload> =>
            ipcRenderer.invoke('p2p:get-status'),

        onNodeStarted: (callback: (data: NodeStartedPayload) => void) => {
            console.log('[Preload] Setting up listener for channel:', IPC_CHANNELS.P2P_NODE_STARTED);
            const listener = (_event: IpcRendererEvent, data: NodeStartedPayload) => {
                console.log('[Preload] ← Received on channel', IPC_CHANNELS.P2P_NODE_STARTED, data);
                callback(data);
            };
            ipcRenderer.on(IPC_CHANNELS.P2P_NODE_STARTED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_NODE_STARTED, listener);
        },

        onPeerDiscovered: (callback: (data: PeerDiscoveredPayload) => void) => {
            console.log('[Preload] Setting up listener for channel:', IPC_CHANNELS.P2P_PEER_DISCOVERED);
            const listener = (_event: IpcRendererEvent, data: PeerDiscoveredPayload) => {
                console.log('[Preload] ← Received on channel', IPC_CHANNELS.P2P_PEER_DISCOVERED, data);
                callback(data);
            };
            ipcRenderer.on(IPC_CHANNELS.P2P_PEER_DISCOVERED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_PEER_DISCOVERED, listener);
        },

        onConnectionRequest: (callback: (data: ConnectionRequestPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: ConnectionRequestPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_CONNECTION_REQUEST, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_CONNECTION_REQUEST, listener);
        },

        onConnectionEstablished: (callback: (data: ConnectionEstablishedPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: ConnectionEstablishedPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_CONNECTION_ESTABLISHED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_CONNECTION_ESTABLISHED, listener);
        },

        onConnectionFailed: (callback: (data: ConnectionFailedPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: ConnectionFailedPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_CONNECTION_FAILED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_CONNECTION_FAILED, listener);
        },

        onConnectionClosed: (callback: (data: ConnectionClosedPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: ConnectionClosedPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_CONNECTION_CLOSED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_CONNECTION_CLOSED, listener);
        },

        onNodeError: (callback: (data: NodeErrorPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: NodeErrorPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_NODE_ERROR, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_NODE_ERROR, listener);
        },
    },

    // ========================================
    // Replication
    // ========================================
    replication: {
        pushChanges: (collection: string, documents: Array<{ id: string; data: Record<string, unknown>; updatedAt: string; deleted?: boolean }>): Promise<{ success: boolean }> =>
            ipcRenderer.invoke(IPC_CHANNELS.REPLICATION_PUSH, { collection, documents }),

        pullChanges: (collection: string, checkpoint: string | null): Promise<{ success: boolean }> =>
            ipcRenderer.invoke(IPC_CHANNELS.REPLICATION_PULL, { collection, checkpoint }),

        onReplicationChanges: (callback: (data: ReplicationChangesPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: ReplicationChangesPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.REPLICATION_CHANGES, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.REPLICATION_CHANGES, listener);
        },

        onReplicationState: (callback: (data: ReplicationStatePayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: ReplicationStatePayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.REPLICATION_STATE, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.REPLICATION_STATE, listener);
        },
    },

    // ========================================
    // Spotify Integration
    // ========================================
    spotify: {
        startAuth: (): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('spotify:auth-start'),

        getAuthStatus: (): Promise<{ authenticated: boolean; hasStoredTokens: boolean }> =>
            ipcRenderer.invoke('spotify:auth-status'),

        getPlaylists: (): Promise<{ success: boolean; playlists?: SpotifyPlaylistItem[]; total?: number; error?: string }> =>
            ipcRenderer.invoke('spotify:get-playlists'),

        getTracks: (playlistId: string): Promise<{ success: boolean; tracks?: MappedTrack[]; total?: number; error?: string }> =>
            ipcRenderer.invoke('spotify:get-tracks', playlistId),

        getProfile: (): Promise<{ success: boolean; userId?: string; displayName?: string; avatarUrl?: string; error?: string }> =>
            ipcRenderer.invoke('spotify:get-profile'),

        syncPlaylist: (linkedSpotifyId: string): Promise<{ success: boolean; tracks?: MappedTrack[]; total?: number; error?: string }> =>
            ipcRenderer.invoke('spotify:sync-playlist', linkedSpotifyId),

        onAuthComplete: (callback: (data: { success: boolean }) => void) => {
            const listener = (_event: IpcRendererEvent, data: { success: boolean }) => callback(data);
            ipcRenderer.on('spotify:auth-complete', listener);
            return () => ipcRenderer.removeListener('spotify:auth-complete', listener);
        },

        onAuthError: (callback: (data: { error: string }) => void) => {
            const listener = (_event: IpcRendererEvent, data: { error: string }) => callback(data);
            ipcRenderer.on('spotify:auth-error', listener);
            return () => ipcRenderer.removeListener('spotify:auth-error', listener);
        },

        // Playback control
        getPlaybackState: (): Promise<{ success: boolean; state?: SpotifyPlaybackStateResult; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_GET_PLAYBACK_STATE),

        getDevices: (): Promise<{ success: boolean; devices?: SpotifyDevice[]; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_GET_DEVICES),

        startPlayback: (params: SpotifyStartPlaybackParams): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_START_PLAYBACK, params),

        pausePlayback: (params?: { deviceId?: string }): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_PAUSE_PLAYBACK, params),

        resumePlayback: (params?: { deviceId?: string }): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_RESUME_PLAYBACK, params),

        skipNext: (params?: { deviceId?: string }): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_SKIP_NEXT, params),

        skipPrevious: (params?: { deviceId?: string }): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_SKIP_PREVIOUS, params),

        // Enhanced playlist polling
        getPlaylistTracksFull: (playlistId: string): Promise<SpotifyPlaylistTracksFullResult> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_GET_PLAYLIST_TRACKS_FULL, playlistId),
    },

    // ========================================
    // Low-level IPC (for advanced use cases)
    // ========================================
    ipcRenderer: {
        sendMessage(channel: string, args: unknown[]): void {
            ipcRenderer.send(channel, args);
        },
        invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
            return ipcRenderer.invoke(channel, ...args);
        },
        on(channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void) {
            ipcRenderer.on(channel, listener);
            return () => ipcRenderer.removeListener(channel, listener);
        },
    },
};

// Expose once; fail-soft if already present (dev hot reloads).
if (typeof window.electron === 'undefined') {
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

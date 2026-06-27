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
    type RelayStatusPayload,
    type PeerPresencePayload,
    type GetInviteUrlResult,
    type ReplicationPullRequestPayload,
    type ReplicationPullResponsePayload,
    type HandshakeCompletePayload,
} from '../shared/core';
import type { SpotifyPlaylistItem } from './types';
import type { MappedTrack } from './spotify/spotify-mapper';
import type {
    SpotifyPlaybackStateResult,
    SpotifyDevice,
    SpotifyStartPlaybackParams,
    SpotifyPlaylistTracksFullResult,
    SpotifyPlaylistSnapshotResult,
    CompanionStartResult,
    CompanionInfoResult,
    CompanionClientEventPayload,
    CompanionReactionPayload,
    CompanionTimeRequestPayload,
    ScanDirectoryResult,
    BackendStatusResult,
    DownloadResolveRequest,
    PurchaseResolvePayload,
    PurchaseLinkResult,
} from '../shared/core/ipc-protocol';
// Download service types (service module — pure Node, no Electron)
// Import only the types we need for the preload bridge signature.
import type { ResolvedTrack, DownloadStartRequest, DownloadEvent } from '../../../service/downloader/types';
import type {
    FileEntry,
    FileManifest,
    ActiveTransfer,
    TransferProgress,
    TransferComplete,
    TransferError,
} from '../shared/core/file-transfer-types';

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
        openPath: (
            dirPath: string
        ): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('shell:open-path', dirPath),
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

        // Session invite / join
        getInviteUrl: (sessionId?: string): Promise<GetInviteUrlResult & { success: boolean; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_GET_INVITE_URL, sessionId),

        joinSession: (urlOrCode: string): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_JOIN_SESSION, urlOrCode),

        // Relay configuration
        getRelays: (): Promise<{ addresses: string[] }> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_RELAY_GET),

        addRelay: (multiaddr: string): Promise<{ success: boolean; addresses: string[]; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_RELAY_ADD, multiaddr),

        removeRelay: (multiaddr: string): Promise<{ success: boolean; addresses: string[]; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.P2P_RELAY_REMOVE, multiaddr),

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

        onHandshakeComplete: (callback: (data: HandshakeCompletePayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: HandshakeCompletePayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_HANDSHAKE_COMPLETE, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_HANDSHAKE_COMPLETE, listener);
        },

        onNodeError: (callback: (data: NodeErrorPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: NodeErrorPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_NODE_ERROR, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_NODE_ERROR, listener);
        },

        onRelayStatus: (callback: (data: RelayStatusPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: RelayStatusPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_RELAY_STATUS, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_RELAY_STATUS, listener);
        },

        onPeerPresence: (callback: (data: PeerPresencePayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: PeerPresencePayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.P2P_PEER_PRESENCE, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.P2P_PEER_PRESENCE, listener);
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

        // Respond to a pull request from the utility process (renderer provides the data)
        respondToPullRequest: (response: ReplicationPullResponsePayload): Promise<{ success: boolean }> =>
            ipcRenderer.invoke(IPC_CHANNELS.REPLICATION_PULL_RESPONSE, response),

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

        // Listen for pull requests from main (forwarded from utility when a remote peer requests data)
        onPullRequest: (callback: (data: ReplicationPullRequestPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: ReplicationPullRequestPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.REPLICATION_PULL_REQUEST, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.REPLICATION_PULL_REQUEST, listener);
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

        seekPlayback: (params: { positionMs: number; deviceId?: string }): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_SEEK_PLAYBACK, params),

        // Enhanced playlist polling
        getPlaylistTracksFull: (playlistId: string): Promise<SpotifyPlaylistTracksFullResult> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_GET_PLAYLIST_TRACKS_FULL, playlistId),

        getPlaylistSnapshot: (playlistId: string): Promise<SpotifyPlaylistSnapshotResult> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_GET_PLAYLIST_SNAPSHOT, playlistId),

        getPlaylistTracksFrom: (playlistId: string, offset: number, knownSnapshotId?: string): Promise<SpotifyPlaylistTracksFullResult> =>
            ipcRenderer.invoke(IPC_CHANNELS.SPOTIFY_GET_PLAYLIST_TRACKS_FROM, playlistId, offset, knownSnapshotId),
    },

    // ========================================
    // Companion Server
    // ========================================
    companion: {
        start: (): Promise<CompanionStartResult> =>
            ipcRenderer.invoke(IPC_CHANNELS.COMPANION_START),

        stop: (): Promise<void> =>
            ipcRenderer.invoke(IPC_CHANNELS.COMPANION_STOP),

        getInfo: (): Promise<CompanionInfoResult | null> =>
            ipcRenderer.invoke(IPC_CHANNELS.COMPANION_GET_INFO),

        respondToTimeRequest: (clientId: string, action: 'seen' | 'granted'): Promise<void> =>
            ipcRenderer.invoke(IPC_CHANNELS.COMPANION_TIME_REQUEST_RESPOND, { clientId, action }),

        generateQrCode: (url: string): Promise<string> =>
            ipcRenderer.invoke(IPC_CHANNELS.COMPANION_QR_CODE, url),

        // Relay tunnel
        startRelayTunnel: (relayHost: string): Promise<{ sessionCode: string; relayUrl: string }> =>
            ipcRenderer.invoke(IPC_CHANNELS.COMPANION_RELAY_START, relayHost),

        stopRelayTunnel: (): Promise<void> =>
            ipcRenderer.invoke(IPC_CHANNELS.COMPANION_RELAY_STOP),

        getRelayTunnelInfo: (): Promise<{ sessionCode: string; relayUrl: string } | null> =>
            ipcRenderer.invoke(IPC_CHANNELS.COMPANION_RELAY_INFO),

        // State push (renderer → main → phone clients)
        pushPlayback: (state: unknown): void => {
            ipcRenderer.send(IPC_CHANNELS.COMPANION_PUSH_PLAYBACK, state);
        },
        pushTracks: (tracks: unknown): void => {
            ipcRenderer.send(IPC_CHANNELS.COMPANION_PUSH_TRACKS, tracks);
        },
        pushParticipants: (participants: unknown): void => {
            ipcRenderer.send(IPC_CHANNELS.COMPANION_PUSH_PARTICIPANTS, participants);
        },
        pushTurn: (turnState: unknown): void => {
            ipcRenderer.send(IPC_CHANNELS.COMPANION_PUSH_TURN, turnState);
        },
        pushSessionSnapshot: (snapshot: unknown): void => {
            ipcRenderer.send(IPC_CHANNELS.COMPANION_PUSH_SESSION_SNAPSHOT, snapshot);
        },

        // Events (main → renderer)
        onClientJoined: (callback: (data: CompanionClientEventPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: CompanionClientEventPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.COMPANION_CLIENT_JOINED, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.COMPANION_CLIENT_JOINED, listener);
        },
        onClientLeft: (callback: (data: CompanionClientEventPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: CompanionClientEventPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.COMPANION_CLIENT_LEFT, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.COMPANION_CLIENT_LEFT, listener);
        },
        onReaction: (callback: (data: CompanionReactionPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: CompanionReactionPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.COMPANION_REACTION, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.COMPANION_REACTION, listener);
        },
        onTimeRequest: (callback: (data: CompanionTimeRequestPayload) => void) => {
            const listener = (_event: IpcRendererEvent, data: CompanionTimeRequestPayload) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.COMPANION_TIME_REQUEST, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.COMPANION_TIME_REQUEST, listener);
        },
    },

    // ========================================
    // Media / Local File Import
    // ========================================
    media: {
        scanDirectory: (dirPath: string): Promise<ScanDirectoryResult> =>
            ipcRenderer.invoke(IPC_CHANNELS.MEDIA_SCAN_DIRECTORY, dirPath),
    },

    // ========================================
    // Download Service
    // ========================================
    download: {
        checkBackends: (): Promise<BackendStatusResult[]> =>
            ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_CHECK_BACKENDS),

        suggestBackend: (url: string): Promise<string> =>
            ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_SUGGEST_BACKEND, url),

        resolve: (req: DownloadResolveRequest): Promise<ResolvedTrack[]> =>
            ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_RESOLVE, req),

        start: (req: DownloadStartRequest): Promise<void> =>
            ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_START, req),

        cancel: (): Promise<void> =>
            ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_CANCEL),

        onProgress: (cb: (event: DownloadEvent) => void) => {
            const listener = (_e: IpcRendererEvent, ev: DownloadEvent) => cb(ev);
            ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_PROGRESS, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_PROGRESS, listener);
        },

        onTrackComplete: (cb: (event: DownloadEvent) => void) => {
            const listener = (_e: IpcRendererEvent, ev: DownloadEvent) => cb(ev);
            ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_TRACK_COMPLETE, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_TRACK_COMPLETE, listener);
        },

        onError: (cb: (event: DownloadEvent) => void) => {
            const listener = (_e: IpcRendererEvent, ev: DownloadEvent) => cb(ev);
            ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_ERROR, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_ERROR, listener);
        },
    },

    // ========================================
    // File Transfer
    // ========================================
    fileTransfer: {
        requestManifest: (peerId: string, playlistId: string): Promise<unknown> =>
            ipcRenderer.invoke(IPC_CHANNELS.FILE_TRANSFER_REQUEST_MANIFEST, { peerId, playlistId }),

        requestFiles: (peerId: string, files: FileEntry[]): Promise<unknown> =>
            ipcRenderer.invoke(IPC_CHANNELS.FILE_TRANSFER_REQUEST_FILES, { peerId, files }),

        cancel: (sha256: string): Promise<unknown> =>
            ipcRenderer.invoke(IPC_CHANNELS.FILE_TRANSFER_CANCEL, { sha256 }),

        getTransfers: (): Promise<ActiveTransfer[]> =>
            ipcRenderer.invoke(IPC_CHANNELS.FILE_TRANSFER_GET_TRANSFERS),

        setSharing: (playlistId: string, enabled: boolean): Promise<unknown> =>
            ipcRenderer.invoke(IPC_CHANNELS.FILE_TRANSFER_SET_SHARING, { playlistId, enabled }),

        registerTracks: (
            playlistId: string,
            coverArtPath: string | undefined,
            tracks: Array<{ trackId: string; audioPath?: string; artworkPath?: string }>,
        ): Promise<unknown> =>
            ipcRenderer.invoke(IPC_CHANNELS.FILE_TRANSFER_REGISTER_TRACKS, {
                playlistId,
                coverArtPath,
                tracks,
            }),

        onManifest: (callback: (manifest: FileManifest) => void) => {
            const listener = (_event: IpcRendererEvent, data: FileManifest) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.FILE_TRANSFER_MANIFEST, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_TRANSFER_MANIFEST, listener);
        },

        onProgress: (callback: (progress: TransferProgress) => void) => {
            const listener = (_event: IpcRendererEvent, data: TransferProgress) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.FILE_TRANSFER_PROGRESS, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_TRANSFER_PROGRESS, listener);
        },

        onComplete: (callback: (result: TransferComplete) => void) => {
            const listener = (_event: IpcRendererEvent, data: TransferComplete) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.FILE_TRANSFER_COMPLETE, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_TRANSFER_COMPLETE, listener);
        },

        onError: (callback: (error: TransferError) => void) => {
            const listener = (_event: IpcRendererEvent, data: TransferError) => callback(data);
            ipcRenderer.on(IPC_CHANNELS.FILE_TRANSFER_ERROR, listener);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_TRANSFER_ERROR, listener);
        },
    },

    // ========================================
    // Purchase Link Resolution
    // ========================================
    purchase: {
        resolve: (req: PurchaseResolvePayload): Promise<PurchaseLinkResult[]> =>
            ipcRenderer.invoke(IPC_CHANNELS.PURCHASE_RESOLVE, req),

        resolveBatch: (reqs: PurchaseResolvePayload[]): Promise<PurchaseLinkResult[][]> =>
            ipcRenderer.invoke(IPC_CHANNELS.PURCHASE_RESOLVE_BATCH, reqs),
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

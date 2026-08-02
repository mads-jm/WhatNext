/**
 * IPC Protocol Definitions
 *
 * Message contracts for communication between:
 * - Main Process ↔ Utility Process (via MessagePort)
 * - Main Process ↔ Renderer (via IPC)
 *
 * This defines the "language" that different processes use to talk to each other.
 */

import type { PeerId, ConnectionState, P2PConnection, PeerMetadata } from './types';

/**
 * Message types for Main → Utility communication
 */
export enum MainToUtilityMessageType {
    // Connection management
    CONNECT_TO_PEER = 'connect_to_peer',
    DISCONNECT_FROM_PEER = 'disconnect_from_peer',

    // Node lifecycle
    START_NODE = 'start_node',
    STOP_NODE = 'stop_node',

    // Discovery
    GET_DISCOVERED_PEERS = 'get_discovered_peers',
    GET_CONNECTED_PEERS = 'get_connected_peers',

    // Replication
    REPLICATION_PUSH = 'replication_push',
    REPLICATION_PULL = 'replication_pull',

    // Replication pull response (renderer data returned to utility via main)
    REPLICATION_PULL_RESPONSE = 'replication_pull_response',

    // User identity
    SET_USER_IDENTITY = 'set_user_identity',

    // Relay configuration (dynamic, loaded from settings store)
    UPDATE_RELAY_ADDRESSES = 'update_relay_addresses',

    // File transfer — main → utility commands
    FILE_TRANSFER_REQUEST_MANIFEST = 'file_transfer_request_manifest',
    FILE_TRANSFER_REQUEST_FILE = 'file_transfer_request_file',
    FILE_TRANSFER_CANCEL = 'file_transfer_cancel',
    FILE_TRANSFER_SERVE_CHUNK = 'file_transfer_serve_chunk',
    FILE_TRANSFER_MANIFEST_RESPONSE = 'file_transfer_manifest_response',
}

/**
 * Message types for Utility → Main communication
 */
export enum UtilityToMainMessageType {
    // Utility process lifecycle
    READY = 'utility_ready',

    // Connection events
    CONNECTION_REQUEST = 'connection_request',
    CONNECTION_ESTABLISHED = 'connection_established',
    CONNECTION_FAILED = 'connection_failed',
    CONNECTION_CLOSED = 'connection_closed',

    // Discovery events
    PEER_DISCOVERED = 'peer_discovered',
    PEER_LOST = 'peer_lost',

    // Node lifecycle events
    NODE_STARTED = 'node_started',
    NODE_STOPPED = 'node_stopped',
    NODE_ERROR = 'node_error',

    // Replication
    REPLICATION_CHANGES = 'replication_changes',
    REPLICATION_STATE = 'replication_state',

    // Replication pull request (utility needs data from renderer via main)
    REPLICATION_PULL_REQUEST = 'replication_pull_request',

    // Handshake
    HANDSHAKE_COMPLETE = 'handshake_complete',

    // Relay
    RELAY_CONNECTED = 'relay_connected',
    RELAY_DISCONNECTED = 'relay_disconnected',

    // Presence
    PEER_PRESENCE_UPDATE = 'peer_presence_update',

    // File transfer — utility → main events
    FILE_TRANSFER_MANIFEST_RECEIVED = 'file_transfer_manifest_received',
    FILE_TRANSFER_INCOMING_REQUEST = 'file_transfer_incoming_request',
    FILE_TRANSFER_CHUNK_RECEIVED = 'file_transfer_chunk_received',
    FILE_TRANSFER_COMPLETE = 'file_transfer_complete',
    FILE_TRANSFER_ERROR = 'file_transfer_error',
}

/**
 * Base IPC message structure
 */
export interface IPCMessage<T = unknown> {
    type: string;
    payload: T;
    requestId?: string; // For request/response pattern
    timestamp: string; // ISO timestamp
}

// ========================================
// Main → Utility Message Payloads
// ========================================

export interface ConnectToPeerPayload {
    peerId: PeerId;
    relay?: string; // Optional relay multiaddr
}

export interface DisconnectFromPeerPayload {
    peerId: PeerId;
}

// ========================================
// Utility → Main Message Payloads
// ========================================

export interface ConnectionRequestPayload {
    peerId: PeerId;
    metadata: PeerMetadata;
}

export interface ConnectionEstablishedPayload {
    peerId: PeerId;
    connection: P2PConnection;
}

export interface ConnectionFailedPayload {
    peerId: PeerId;
    error: string;
    errorCode?: string;
}

export interface ConnectionClosedPayload {
    peerId: PeerId;
    reason?: string;
}

export interface PeerDiscoveredPayload {
    peer: PeerMetadata;
    multiaddrs: string[];
}

export interface PeerLostPayload {
    peerId: PeerId;
}

export interface NodeStartedPayload {
    peerId: PeerId; // Our own peer ID
    multiaddrs: string[]; // Our listening addresses
}

export interface NodeStoppedPayload {
    reason?: string;
}

export interface NodeErrorPayload {
    error: string;
    errorCode?: string;
}

// ========================================
// IPC Channel Names (for main ↔ renderer)
// ========================================

/**
 * IPC channel names for Electron's ipcMain/ipcRenderer
 *
 * Convention: "domain:action"
 */
export const IPC_CHANNELS = {
    // P2P connection management (renderer → main)
    P2P_CONNECT: 'p2p:connect',
    P2P_DISCONNECT: 'p2p:disconnect',
    P2P_GET_CONNECTIONS: 'p2p:get-connections',
    P2P_ACCEPT_CONNECTION: 'p2p:accept-connection',
    P2P_REJECT_CONNECTION: 'p2p:reject-connection',

    // P2P invite/join (renderer ↔ main)
    P2P_GET_INVITE_URL: 'p2p:get-invite-url',
    P2P_JOIN_SESSION: 'p2p:join-session',

    // Relay configuration (renderer ↔ main)
    P2P_RELAY_GET: 'p2p:relay-get',
    P2P_RELAY_ADD: 'p2p:relay-add',
    P2P_RELAY_REMOVE: 'p2p:relay-remove',

    // Relay + presence events (main → renderer)
    P2P_RELAY_STATUS: 'p2p:relay-status',
    P2P_PEER_PRESENCE: 'p2p:peer-presence',

    // P2P events (main → renderer)
    P2P_CONNECTION_REQUEST: 'p2p:connection-request',
    P2P_CONNECTION_ESTABLISHED: 'p2p:connection-established',
    P2P_CONNECTION_FAILED: 'p2p:connection-failed',
    P2P_CONNECTION_CLOSED: 'p2p:connection-closed',
    P2P_PEER_DISCOVERED: 'p2p:peer-discovered',
    P2P_PEER_LOST: 'p2p:peer-lost',
    P2P_HANDSHAKE_COMPLETE: 'p2p:handshake-complete',

    // Node status (main → renderer)
    P2P_NODE_STARTED: 'p2p:node-started',
    P2P_NODE_STOPPED: 'p2p:node-stopped',
    P2P_NODE_ERROR: 'p2p:node-error',

    // Replication (renderer ↔ main ↔ utility)
    REPLICATION_PUSH: 'replication:push',
    REPLICATION_PULL: 'replication:pull',
    REPLICATION_CHANGES: 'replication:changes',
    REPLICATION_STATE: 'replication:state',

    // Replication pull request/response bridge (main → renderer request; renderer → main response)
    REPLICATION_PULL_REQUEST: 'replication:pull-request',
    REPLICATION_PULL_RESPONSE: 'replication:pull-response',

    // Spotify integration (renderer -> main)
    SPOTIFY_AUTH_START: 'spotify:auth-start',
    SPOTIFY_AUTH_STATUS: 'spotify:auth-status',
    SPOTIFY_GET_PLAYLISTS: 'spotify:get-playlists',
    SPOTIFY_GET_TRACKS: 'spotify:get-tracks',
    SPOTIFY_SYNC_PLAYLIST: 'spotify:sync-playlist',

    // Spotify playback control (renderer → main)
    SPOTIFY_GET_PLAYBACK_STATE: 'spotify:get-playback-state',
    SPOTIFY_GET_DEVICES: 'spotify:get-devices',
    SPOTIFY_START_PLAYBACK: 'spotify:start-playback',
    SPOTIFY_PAUSE_PLAYBACK: 'spotify:pause-playback',
    SPOTIFY_RESUME_PLAYBACK: 'spotify:resume-playback',
    SPOTIFY_SKIP_NEXT: 'spotify:skip-next',
    SPOTIFY_SKIP_PREVIOUS: 'spotify:skip-previous',
    SPOTIFY_SEEK_PLAYBACK: 'spotify:seek-playback',

    // Enhanced playlist polling with attribution data (renderer → main)
    SPOTIFY_GET_PLAYLIST_TRACKS_FULL: 'spotify:get-playlist-tracks-full',
    SPOTIFY_GET_PLAYLIST_SNAPSHOT: 'spotify:get-playlist-snapshot',
    SPOTIFY_GET_PLAYLIST_TRACKS_FROM: 'spotify:get-playlist-tracks-from',

    // Companion server (renderer ↔ main)
    COMPANION_START: 'companion:start',
    COMPANION_STOP: 'companion:stop',
    COMPANION_GET_INFO: 'companion:get-info',
    COMPANION_TIME_REQUEST_RESPOND: 'companion:time-request-respond',
    COMPANION_QR_CODE: 'companion:qr-code',
    COMPANION_RELAY_START: 'companion:relay-start',
    COMPANION_RELAY_STOP: 'companion:relay-stop',
    COMPANION_RELAY_INFO: 'companion:relay-info',

    // Companion state push (renderer → main, forwarded to phone clients)
    COMPANION_PUSH_PLAYBACK: 'companion:push-playback',
    COMPANION_PUSH_TRACKS: 'companion:push-tracks',
    COMPANION_PUSH_PARTICIPANTS: 'companion:push-participants',
    COMPANION_PUSH_TURN: 'companion:push-turn',
    COMPANION_PUSH_SESSION_SNAPSHOT: 'companion:push-session-snapshot',

    // Companion events (main → renderer)
    COMPANION_CLIENT_JOINED: 'companion:client-joined',
    COMPANION_CLIENT_LEFT: 'companion:client-left',
    COMPANION_REACTION: 'companion:reaction',
    COMPANION_TIME_REQUEST: 'companion:time-request',

    // Media / local file import (renderer → main)
    MEDIA_SCAN_DIRECTORY: 'media:scan-directory',

    // Download service (renderer ↔ main)
    DOWNLOAD_CHECK_BACKENDS: 'download:check-backends',
    DOWNLOAD_SUGGEST_BACKEND: 'download:suggest-backend',
    DOWNLOAD_RESOLVE: 'download:resolve',
    DOWNLOAD_START: 'download:start',
    DOWNLOAD_CANCEL: 'download:cancel',
    DOWNLOAD_GET_BACKEND_PATHS: 'download:get-backend-paths',
    DOWNLOAD_SET_BACKEND_PATH: 'download:set-backend-path',

    // Download events (main → renderer)
    DOWNLOAD_PROGRESS: 'download:progress',
    DOWNLOAD_TRACK_COMPLETE: 'download:track-complete',
    DOWNLOAD_ERROR: 'download:error',

    // Purchase link resolution (renderer ↔ main)
    PURCHASE_RESOLVE: 'purchase:resolve',
    PURCHASE_RESOLVE_BATCH: 'purchase:resolve-batch',

    // File transfer — invoke channels (renderer → main)
    FILE_TRANSFER_REQUEST_MANIFEST: 'file-transfer:request-manifest',
    FILE_TRANSFER_REQUEST_FILES: 'file-transfer:request-files',
    FILE_TRANSFER_CANCEL: 'file-transfer:cancel',
    FILE_TRANSFER_GET_TRANSFERS: 'file-transfer:get-transfers',
    FILE_TRANSFER_SET_SHARING: 'file-transfer:set-sharing',

    // File transfer — event channels (main → renderer)
    FILE_TRANSFER_MANIFEST: 'file-transfer:manifest',
    FILE_TRANSFER_PROGRESS: 'file-transfer:progress',
    FILE_TRANSFER_COMPLETE: 'file-transfer:complete',
    FILE_TRANSFER_ERROR: 'file-transfer:error',

    // File transfer — side-map registration (renderer → main)
    FILE_TRANSFER_REGISTER_TRACKS: 'file-transfer:register-tracks',
} as const;

// ========================================
// Spotify Playback Payloads
// ========================================

export interface SpotifyPlaybackStateResult {
    isPlaying: boolean;
    track: {
        spotifyId: string;
        title: string;
        artists: string[];
        album: string;
        durationMs: number;
        albumArtUrl?: string;
    } | null;
    progressMs: number;
    deviceName: string | null;
    deviceId: string | null;
}

export interface SpotifyDevice {
    id: string;
    name: string;
    type: string;
    isActive: boolean;
}

export interface SpotifyStartPlaybackParams {
    deviceId?: string;
    contextUri?: string;     // e.g. 'spotify:playlist:abc123'
    offsetIndex?: number;    // track position in context
}

export interface SpotifySkipParams {
    deviceId?: string;
}

// ========================================
// Spotify Playlist Polling (full, with attribution)
// ========================================

export interface SpotifyFullTrackItem {
    spotifyId: string;
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    albumArtUrl?: string;
    addedAt: string;
    addedBySpotifyId: string;   // Spotify user ID for attribution
    addedByDisplayName?: string; // Spotify display name (when available)
}

export interface SpotifyPlaylistSnapshotResult {
    success: boolean;
    snapshotId?: string;
    total?: number;
    error?: string;
}

export interface SpotifyPlaylistTracksFullResult {
    success: boolean;
    tracks?: SpotifyFullTrackItem[];
    total?: number;
    snapshotId?: string;   // Spotify playlist version — skip re-parse if unchanged
    error?: string;
}

// ========================================
// Replication Payloads
// ========================================

export interface ReplicationPushPayload {
    collection: string;
    // NOTE: when pushing track documents, callers MUST strip localFilePath and
    // localFileSize before including them in data. These are device-local paths
    // and must never be shared with P2P peers.
    documents: Array<{
        id: string;
        data: Record<string, unknown>;
        updatedAt: string;
        deleted?: boolean;
    }>;
}

export interface ReplicationPullPayload {
    collection: string;
    checkpoint: string | null; // ISO timestamp of last sync
    limit?: number;
}

export interface ReplicationChangesPayload {
    collection: string;
    documents: Array<{
        id: string;
        data: Record<string, unknown>;
        updatedAt: string;
        deleted?: boolean;
    }>;
    checkpoint: string; // New checkpoint after these changes
}

export interface ReplicationStatePayload {
    peerId: string;
    state: 'idle' | 'pulling' | 'pushing' | 'error';
    collections: Record<string, {
        lastCheckpoint: string | null;
        documentCount: number;
    }>;
    error?: string;
}

export interface HandshakeCompletePayload {
    peerId: string;
    displayName: string;
    version: string;
    capabilities: string[];
}

export interface P2PStatusPayload {
    nodeStarted: boolean;
    peerId: string | null;
    multiaddrs: string[];
    connectedPeers: string[];
    discoveredPeers: PeerMetadata[];
    protocols?: string[];
}

// ========================================
// Relay Payloads
// ========================================

export interface RelayConnectedPayload {
    relayMultiaddr: string; // The relay address we're connected through
    relayPeerId: string;
}

export interface RelayStatusPayload {
    connected: boolean;
    relayMultiaddr: string | null;
    relayPeerId: string | null;
}

// ========================================
// Invite URL Payloads
// ========================================

export interface GetInviteUrlRequest {
    sessionId?: string; // Optional: include session ID in URL for short-code lookup
}

export interface GetInviteUrlResult {
    url: string;        // Full whtnxt:// URL
    shortCode: string;  // Human-readable short code (e.g. "3K7X")
    peerId: string;
    relayAddr: string | null;
}

// ========================================
// Presence Payloads
// ========================================

export interface PeerPresencePayload {
    peerId: string;
    online: boolean;
    lastSeenAt: string; // ISO timestamp
}

// ========================================
// Replication Pull Request/Response (bridge)
// ========================================

export interface ReplicationPullRequestPayload {
    requestId: string;      // Correlation ID
    collection: string;
    checkpoint: string | null;
    limit?: number;
}

export interface ReplicationPullResponsePayload {
    requestId: string;      // Must match request
    collection: string;
    documents: Array<{
        id: string;
        data: Record<string, unknown>;
        updatedAt: string;
        deleted?: boolean;
    }>;
    checkpoint: string;
}

// ========================================
// Companion Payloads
// ========================================

export interface CompanionStartResult {
    port: number;
    localIp: string;
}

export interface CompanionInfoResult {
    port: number;
    localIp: string;
    connectedClients: number;
}

export interface CompanionClientEventPayload {
    clientId: string;
    displayName: string;
}

export interface CompanionReactionPayload {
    clientId: string;
    displayName: string;
    emoji: string;
    trackId: string | null;
}

export interface CompanionTimeRequestPayload {
    clientId: string;
    displayName: string;
    trackId: string | null;
}

// ========================================
// Media / Local File Import
// ========================================

/**
 * A mapped local track ready for import into RxDB.
 * Mirrors MappedLocalTrack from local-media-mapper.ts but defined here
 * so it can be used as the IPC wire type without importing from main process code.
 */
export interface ScanDirectoryTrack {
    id: string;
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    localFilePath: string;
    localFileSize: number;
    source: 'local';
    addedAt: string;
    audioFormat?: string;
    audioBitrate?: number;
}

export interface ScanDirectoryResult {
    success: boolean;
    tracks?: ScanDirectoryTrack[];
    stats?: {
        scanned: number;
        supported: number;
        skipped: number;
    };
    error?: string;
}

// ========================================
// Download Service Payloads
// ========================================

export interface BackendStatusResult {
    id: string;
    name: string;
    installed: boolean;
    version?: string;
    /** Configured custom executable path, when one is set (else PATH lookup). */
    path?: string;
    error?: string;
}

export type DownloaderBackendId = 'ytdlp' | 'spotdl' | 'spytify';

/** Map of per-backend custom executable paths. Absent = resolve via PATH. */
export type BackendPathMap = Partial<Record<DownloaderBackendId, string>>;

export interface SetBackendPathPayload {
    id: DownloaderBackendId;
    /** Custom executable path, or null/empty to clear and fall back to PATH. */
    path: string | null;
}

export interface DownloadResolveRequest {
    backend: string;
    input: { type: 'url' | 'spotify-ids'; url?: string; spotifyIds?: string[] };
}

// ========================================
// Purchase Link Resolution Payloads
// ========================================

export interface PurchaseResolvePayload {
    title: string;
    artists: string[];
    album?: string;
}

// Re-export the canonical PurchaseLink type as PurchaseLinkResult so that IPC
// return values are directly assignable to UpdateTrackInput.purchaseLinks without
// a cast — the two were structurally identical duplicates.
export type { PurchaseLink as PurchaseLinkResult } from './download-types';

/**
 * Type-safe IPC message creator
 */
export function createIPCMessage<T>(
    type: string,
    payload: T,
    requestId?: string
): IPCMessage<T> {
    return {
        type,
        payload,
        requestId,
        timestamp: new Date().toISOString(),
    };
}

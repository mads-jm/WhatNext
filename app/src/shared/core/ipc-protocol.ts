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

    // User identity
    SET_USER_IDENTITY = 'set_user_identity',
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

    // Handshake
    HANDSHAKE_COMPLETE = 'handshake_complete',
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

    // P2P events (main → renderer)
    P2P_CONNECTION_REQUEST: 'p2p:connection-request',
    P2P_CONNECTION_ESTABLISHED: 'p2p:connection-established',
    P2P_CONNECTION_FAILED: 'p2p:connection-failed',
    P2P_CONNECTION_CLOSED: 'p2p:connection-closed',
    P2P_PEER_DISCOVERED: 'p2p:peer-discovered',
    P2P_PEER_LOST: 'p2p:peer-lost',

    // Node status (main → renderer)
    P2P_NODE_STARTED: 'p2p:node-started',
    P2P_NODE_STOPPED: 'p2p:node-stopped',
    P2P_NODE_ERROR: 'p2p:node-error',

    // Replication (renderer ↔ main ↔ utility)
    REPLICATION_PUSH: 'replication:push',
    REPLICATION_PULL: 'replication:pull',
    REPLICATION_CHANGES: 'replication:changes',
    REPLICATION_STATE: 'replication:state',

    // Spotify integration (renderer -> main)
    SPOTIFY_AUTH_START: 'spotify:auth-start',
    SPOTIFY_AUTH_STATUS: 'spotify:auth-status',
    SPOTIFY_GET_PLAYLISTS: 'spotify:get-playlists',
    SPOTIFY_GET_TRACKS: 'spotify:get-tracks',
    SPOTIFY_SYNC_PLAYLIST: 'spotify:sync-playlist',
} as const;

// ========================================
// Replication Payloads
// ========================================

export interface ReplicationPushPayload {
    collection: string;
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

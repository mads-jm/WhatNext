/**
 * Shared P2P Types
 *
 * Core type definitions used across main process, utility process, and renderer.
 * These types define the contract for P2P communication in WhatNext.
 */

/**
 * Peer identifier (libp2p PeerID as string)
 */
export type PeerId = string;

/**
 * P2P connection states
 */
export enum ConnectionState {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    FAILED = 'failed',
    CLOSED = 'closed',
}

/**
 * Peer metadata
 */
export interface PeerMetadata {
    peerId: PeerId;
    displayName: string;
    avatarUrl?: string;
    lastSeenAt: string; // ISO timestamp
    discovered: 'manual' | 'mdns' | 'relay' | 'dht';
}

/**
 * P2P connection information
 */
export interface P2PConnection {
    peerId: PeerId;
    state: ConnectionState;
    connectedAt?: string; // ISO timestamp
    metadata?: PeerMetadata;
    multiaddrs: string[]; // libp2p multiaddrs
    latency?: number; // milliseconds
    protocols?: string[]; // Active protocol handlers
    streams?: number; // Number of active streams
}

/**
 * Detailed peer information for developer UI
 */
export interface DetailedPeerInfo {
    peerId: PeerId;
    displayName: string;
    multiaddrs: string[];
    protocols: string[];
    connection?: {
        state: ConnectionState;
        connectedAt?: string;
        latency?: number;
        direction: 'inbound' | 'outbound';
        transport: string; // e.g., 'tcp', 'websocket', 'webrtc'
        streams: number;
    };
    metadata?: {
        appVersion?: string;
        protocolVersion?: string;
        capabilities?: string[];
    };
    stats?: {
        bytesReceived: number;
        bytesSent: number;
        messagesReceived: number;
        messagesSent: number;
    };
    discovered: 'manual' | 'mdns' | 'relay' | 'dht';
    discoveredAt: string;
    lastSeenAt: string;
}

/**
 * P2P message types for custom protocols
 */
export enum P2PMessageType {
    HANDSHAKE = 'handshake',
    RXDB_REPLICATION = 'rxdb_replication',
    PRESENCE = 'presence',
    PING = 'ping',
    PONG = 'pong',
    DATA_TEST = 'data_test',
    FILE_TRANSFER = 'file_transfer',
}

/**
 * Base P2P message structure
 */
export interface P2PMessage<T = unknown> {
    type: P2PMessageType;
    payload: T;
    senderId: PeerId;
    timestamp: string; // ISO timestamp
    messageId: string; // Unique message ID
}

/**
 * Handshake message payload
 */
export interface HandshakePayload {
    displayName: string;
    avatarUrl?: string;
    version: string; // WhatNext protocol version
    capabilities: string[]; // Supported features
}

/**
 * Presence message payload (heartbeat)
 */
export interface PresencePayload {
    status: 'online' | 'away' | 'busy';
    currentPlaylistId?: string;
}

/**
 * Data test message payload (for learning/testing)
 */
export interface DataTestPayload {
    testId: string;
    dataSize: number;
    data: string;
    echo?: boolean; // If true, receiver should echo back
}

/**
 * File transfer metadata
 */
export interface FileTransferMetadata {
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    chunks: number;
}

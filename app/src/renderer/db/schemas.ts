/**
 * RxDB Schemas for WhatNext
 * Defines the structure for core data entities with P2P collaboration support
 * Per spec section 2.4
 */

import type {
    RxJsonSchema,
    RxDocument,
    RxCollection,
    RxDatabase,
} from 'rxdb';

// ========================================
// User/Peer Schema
// ========================================
/**
 * Represents a user/peer in the P2P network
 * Tracks identity, display information, and peer status
 */
export interface UserDocType {
    id: string; // Unique peer ID (generated locally or from P2P handshake)
    displayName: string;
    avatarUrl?: string;
    isLocal: boolean; // True if this is the local user
    lastSeenAt: string; // ISO timestamp of last activity
    publicKey?: string; // For future encryption/verification
    createdAt: string; // ISO timestamp
}

export type UserDocument = RxDocument<UserDocType>;
export type UserCollection = RxCollection<UserDocType>;

export const userSchema: RxJsonSchema<UserDocType> = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100,
        },
        displayName: {
            type: 'string',
        },
        avatarUrl: {
            type: 'string',
        },
        isLocal: {
            type: 'boolean',
        },
        lastSeenAt: {
            type: 'string',
            format: 'date-time',
            maxLength: 30,
        },
        publicKey: {
            type: 'string',
        },
        createdAt: {
            type: 'string',
            format: 'date-time',
            maxLength: 30,
        },
    },
    required: ['id', 'displayName', 'isLocal', 'lastSeenAt', 'createdAt'],
    indexes: ['isLocal', 'lastSeenAt'],
};

// ========================================
// Track Schema
// ========================================
/**
 * Represents a music track with attribution
 * Tracks who added it and when for collaborative contexts
 */
export interface TrackDocType {
    id: string;
    title: string;
    artists: string[]; // Array of artist names
    album: string;
    durationMs: number;
    spotifyId?: string; // Optional Spotify track ID
    addedAt: string; // ISO timestamp
    addedBy: string; // User ID of who added this track
    notes?: string; // User notes (local user only)
}

export type TrackDocument = RxDocument<TrackDocType>;
export type TrackCollection = RxCollection<TrackDocType>;

export const trackSchema: RxJsonSchema<TrackDocType> = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100,
        },
        title: {
            type: 'string',
        },
        artists: {
            type: 'array',
            items: {
                type: 'string',
            },
        },
        album: {
            type: 'string',
        },
        durationMs: {
            type: 'number',
            minimum: 0,
        },
        spotifyId: {
            type: 'string',
            maxLength: 100, // Spotify track IDs are ~22 chars
        },
        addedAt: {
            type: 'string',
            format: 'date-time',
            maxLength: 30, // ISO 8601 timestamp
        },
        addedBy: {
            type: 'string',
            maxLength: 100, // User ID reference
        },
        notes: {
            type: 'string',
        },
    },
    required: ['id', 'title', 'artists', 'album', 'durationMs', 'addedAt', 'addedBy'],
    indexes: ['addedAt', 'addedBy'], // Removed 'spotifyId' - optional fields can't be indexed with Dexie
};

// ========================================
// Track Interaction Schema
// ========================================
/**
 * Represents user interactions with tracks (votes, likes, plays, etc.)
 * Enables social features and collaborative queue management
 * Input: userId (who), trackId (what), interactionType (how)
 * Output: Queryable relationships for UI features like "who liked this?"
 */
export interface TrackInteractionDocType {
    id: string; // Composite: `${userId}_${trackId}_${interactionType}`
    userId: string;
    trackId: string;
    playlistId?: string; // Optional: context of where interaction occurred
    interactionType: 'vote' | 'like' | 'skip' | 'play' | 'queue'; // Extensible interaction types
    value?: number; // For votes (+1/-1) or play counts
    createdAt: string; // ISO timestamp
    updatedAt: string; // ISO timestamp (for vote changes)
    metadata?: string; // JSON string for extensible interaction data
}

export type TrackInteractionDocument = RxDocument<TrackInteractionDocType>;
export type TrackInteractionCollection = RxCollection<TrackInteractionDocType>;

export const trackInteractionSchema: RxJsonSchema<TrackInteractionDocType> = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 250, // Composite key can be long
        },
        userId: {
            type: 'string',
            maxLength: 100,
        },
        trackId: {
            type: 'string',
            maxLength: 100,
        },
        playlistId: {
            type: 'string',
            maxLength: 100,
        },
        interactionType: {
            type: 'string',
            enum: ['vote', 'like', 'skip', 'play', 'queue'],
            maxLength: 10, // Longest enum value is 'queue' (5 chars), set to 10 for safety
        },
        value: {
            type: 'number',
        },
        createdAt: {
            type: 'string',
            format: 'date-time',
            maxLength: 30,
        },
        updatedAt: {
            type: 'string',
            format: 'date-time',
            maxLength: 30,
        },
        metadata: {
            type: 'string',
        },
    },
    required: ['id', 'userId', 'trackId', 'interactionType', 'createdAt', 'updatedAt'],
    indexes: ['userId', 'trackId', 'interactionType', 'updatedAt'], // Removed 'playlistId' - optional fields can't be indexed with Dexie
};

// ========================================
// Playlist Schema
// ========================================
/**
 * Represents a playlist with collaborative features
 * Input: Owner creates, invites collaborators, sets permissions
 * Output: Shared playlist state synchronized via P2P replication
 * Side effects: Changes broadcast to all connected peers
 */
export interface PlaylistDocType {
    id: string;
    playlistName: string;
    description?: string;
    trackIds: string[]; // Ordered list of track IDs
    createdAt: string; // ISO timestamp
    updatedAt: string; // ISO timestamp
    ownerId: string; // User ID of playlist creator
    collaboratorIds: string[]; // Array of user IDs with write access
    isCollaborative: boolean; // Whether P2P collaboration is enabled
    isPublic: boolean; // Whether playlist is discoverable (future feature)
    linkedSpotifyId?: string; // Optional Spotify playlist ID
    spotifySyncMode?: 'accessory' | 'true_collaborate' | 'proxy_owner'; // Sync strategy (per spec §8.1)
    tags: string[]; // User-defined tags
    queueMode?: 'free_for_all' | 'turn_taking' | 'vote_based'; // Collaborative queue behavior
    currentTurnUserId?: string; // For turn_taking mode: whose turn it is
}

export type PlaylistDocument = RxDocument<PlaylistDocType>;
export type PlaylistCollection = RxCollection<PlaylistDocType>;

export const playlistSchema: RxJsonSchema<PlaylistDocType> = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100,
        },
        playlistName: {
            type: 'string',
        },
        description: {
            type: 'string',
        },
        trackIds: {
            type: 'array',
            items: {
                type: 'string',
            },
        },
        createdAt: {
            type: 'string',
            format: 'date-time',
            maxLength: 30, // ISO 8601 timestamp
        },
        updatedAt: {
            type: 'string',
            format: 'date-time',
            maxLength: 30, // ISO 8601 timestamp (indexed)
        },
        ownerId: {
            type: 'string',
            maxLength: 100,
        },
        collaboratorIds: {
            type: 'array',
            items: {
                type: 'string',
            },
        },
        isCollaborative: {
            type: 'boolean',
        },
        isPublic: {
            type: 'boolean',
        },
        linkedSpotifyId: {
            type: 'string',
            maxLength: 100, // Spotify playlist IDs (indexed)
        },
        spotifySyncMode: {
            type: 'string',
            enum: ['accessory', 'true_collaborate', 'proxy_owner'],
        },
        tags: {
            type: 'array',
            items: {
                type: 'string',
            },
        },
        queueMode: {
            type: 'string',
            enum: ['free_for_all', 'turn_taking', 'vote_based'],
        },
        currentTurnUserId: {
            type: 'string',
            maxLength: 100,
        },
    },
    required: [
        'id',
        'playlistName',
        'trackIds',
        'createdAt',
        'updatedAt',
        'ownerId',
        'collaboratorIds',
        'isCollaborative',
        'isPublic',
        'tags',
    ],
    indexes: ['updatedAt', 'ownerId', 'isCollaborative'], // Removed 'linkedSpotifyId' - optional fields can't be indexed with Dexie
};

// ========================================
// Database Collections Type
// ========================================
/**
 * Complete WhatNext database schema with P2P collaboration support
 * Collections:
 * - users: Peer identity and status tracking
 * - tracks: Music tracks with attribution
 * - trackInteractions: User-track relationships (votes, likes, etc.)
 * - playlists: Collaborative playlists with ownership and permissions
 */
export interface WhatNextCollections {
    users: UserCollection;
    tracks: TrackCollection;
    trackInteractions: TrackInteractionCollection;
    playlists: PlaylistCollection;
}

export type WhatNextDatabase = RxDatabase<WhatNextCollections>;

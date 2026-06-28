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
import type { PurchaseLink } from '../../shared/core/download-types';

// ========================================
// Device-local field contract
// ========================================

/**
 * Fields that describe a document's state on THIS device only (cached file
 * locations/sizes) and are meaningless to other peers. They are stripped before
 * a document is transmitted (see useSessionReplication push) and MUST also be
 * excluded from the LWW equal-timestamp content tie-break key (see lww.contentKey)
 * so both peers compute the key over the identical field set and converge on the
 * same winner. This is the single source of truth so the sender-strip and the
 * tiebreak-strip cannot drift apart.
 */
export const DEVICE_LOCAL_FIELDS = [
    'localFilePath',
    'localFileSize',
    'albumArtLocalPath',
    'coverArtLocalPath',
] as const;

// ========================================
// User/Peer Schema
// ========================================

/**
 * Represents a linked external service account (Spotify, Apple Music, etc.)
 */
export interface LinkedAccount {
    provider: string; // 'spotify' | 'apple_music' | 'youtube_music'
    providerUserId: string;
    displayName?: string;
    avatarUrl?: string;
    linkedAt: string; // ISO timestamp
}

/**
 * Represents a user/peer in the P2P network
 * Tracks identity, display information, and peer status
 */
export interface UserDocType {
    id: string; // Unique peer ID (generated locally or from P2P handshake)
    displayName: string;
    avatarSource: 'local' | 'spotify' | 'apple_music' | 'none'; // Where the avatar comes from
    avatarLocalPath?: string; // Relative path to local avatar file in userData
    avatarUrl?: string; // Resolved URL (service-provided or data: URI)
    bio?: string; // Short bio (Phase 2)
    isLocal: boolean; // True if this is the local user
    linkedAccounts: LinkedAccount[]; // Linked service accounts
    lastSeenAt: string; // ISO timestamp of last activity
    publicKey?: string; // For future encryption/verification
    createdAt: string; // ISO timestamp
    updatedAt: string; // ISO timestamp (for LWW)
}

export type UserDocument = RxDocument<UserDocType>;
export type UserCollection = RxCollection<UserDocType>;

export const userSchema: RxJsonSchema<UserDocType> = {
    version: 1,
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
        avatarSource: {
            type: 'string',
            enum: ['local', 'spotify', 'apple_music', 'none'],
            maxLength: 20,
        },
        avatarLocalPath: {
            type: 'string',
        },
        avatarUrl: {
            type: 'string',
        },
        bio: {
            type: 'string',
        },
        isLocal: {
            type: 'boolean',
        },
        linkedAccounts: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    provider: { type: 'string', maxLength: 30 },
                    providerUserId: { type: 'string', maxLength: 200 },
                    displayName: { type: 'string' },
                    avatarUrl: { type: 'string' },
                    linkedAt: { type: 'string', format: 'date-time', maxLength: 30 },
                },
                required: ['provider', 'providerUserId', 'linkedAt'],
            },
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
        updatedAt: {
            type: 'string',
            format: 'date-time',
            maxLength: 30,
        },
    },
    required: ['id', 'displayName', 'avatarSource', 'isLocal', 'linkedAccounts', 'lastSeenAt', 'createdAt', 'updatedAt'],
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
    albumArtUrl?: string; // Remote album art URL (Spotify CDN or other source)
    albumArtLocalPath?: string; // Absolute path to locally cached album art file
    addedAt: string; // ISO timestamp
    addedBy: string; // User ID of who added this track
    updatedAt: string; // ISO timestamp (for LWW replication)
    notes?: string; // User notes (local user only)
    // Audio Acquisition Service fields (v2)
    localFilePath?: string; // Absolute path to audio file on disk
    localFileSize?: number; // File size in bytes
    source?: string; // 'spotify' | 'youtube' | 'soundcloud' | 'bandcamp' | 'local' | 'manual'
    sourceUrl?: string; // Original URL (YouTube, SoundCloud, Bandcamp page)
    audioFormat?: string; // 'opus' | 'aac' | 'mp3' | 'flac' | 'wav'
    audioBitrate?: number; // kbps
    purchaseLinks?: PurchaseLink[]; // Bandcamp, Beatport, etc.
    userPurchased?: boolean; // Self-reported "I bought this"
}

export type TrackDocument = RxDocument<TrackDocType>;
export type TrackCollection = RxCollection<TrackDocType>;

export const trackSchema: RxJsonSchema<TrackDocType> = {
    version: 3,
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
        albumArtUrl: {
            type: 'string',
        },
        albumArtLocalPath: {
            type: 'string',
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
        updatedAt: {
            type: 'string',
            format: 'date-time',
            maxLength: 30,
        },
        notes: {
            type: 'string',
        },
        // Audio Acquisition Service fields (v2)
        localFilePath: {
            type: 'string',
        },
        localFileSize: {
            type: 'number',
            minimum: 0,
        },
        source: {
            type: 'string',
            maxLength: 20, // 'spotify' | 'youtube' | 'soundcloud' | 'bandcamp' | 'local' | 'manual'
        },
        sourceUrl: {
            type: 'string',
        },
        audioFormat: {
            type: 'string',
            maxLength: 10, // 'opus' | 'aac' | 'mp3' | 'flac' | 'wav'
        },
        audioBitrate: {
            type: 'number',
            minimum: 0,
        },
        purchaseLinks: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    provider: { type: 'string', maxLength: 30 },
                    url: { type: 'string' },
                    label: { type: 'string' },
                    resolvedAt: { type: 'string', maxLength: 30 },
                },
                required: ['provider', 'url', 'resolvedAt'],
            },
        },
        userPurchased: {
            type: 'boolean',
        },
    },
    required: ['id', 'title', 'artists', 'album', 'durationMs', 'addedAt', 'addedBy', 'updatedAt'],
    indexes: ['addedAt', 'addedBy', 'updatedAt'],
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
    interactionType: 'vote' | 'like' | 'skip' | 'play' | 'queue' | 'reaction'; // Extensible interaction types
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
            enum: ['vote', 'like', 'skip', 'play', 'queue', 'reaction'],
            maxLength: 10, // Longest enum value is 'reaction' (8 chars), set to 10 for safety
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
    turnOrder?: string[]; // Explicit ordered list of user IDs for turn rotation (falls back to [ownerId, ...collaboratorIds])
    tracksPerTurn?: number; // How many tracks each participant adds before turn advances (default 1)
    turnTracksAdded?: number; // Tracks added so far in the current turn (reset to 0 when turn advances)
    maxTurns?: number; // Total person-turns allowed before auto-complete (undefined = unlimited)
    turnsCompleted?: number; // How many person-turns have been completed (increments each advance)
    maxDurationMs?: number; // Max total playlist playtime in ms before auto-complete (undefined = unlimited)
    isComplete?: boolean; // Marks the collaborative playlist as complete — freezes turn-taking
    completedFromMode?: 'free_for_all' | 'turn_taking' | 'vote_based'; // queueMode snapshotted at completion time — used to restore on reopen
    coverArtUrl?: string; // Remote cover art URL (Spotify CDN or other source)
    coverArtLocalPath?: string; // Absolute path to locally cached cover art file
    coHostIds?: string[]; // User IDs of co-hosts who can control playback
}

export type PlaylistDocument = RxDocument<PlaylistDocType>;
export type PlaylistCollection = RxCollection<PlaylistDocType>;

export const playlistSchema: RxJsonSchema<PlaylistDocType> = {
    version: 5,
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
        turnOrder: {
            type: 'array',
            items: { type: 'string' },
        },
        tracksPerTurn: {
            type: 'number',
            minimum: 1,
        },
        turnTracksAdded: {
            type: 'number',
            minimum: 0,
        },
        maxTurns: {
            type: 'number',
            minimum: 1,
        },
        turnsCompleted: {
            type: 'number',
            minimum: 0,
        },
        maxDurationMs: {
            type: 'number',
            minimum: 0,
        },
        isComplete: {
            type: 'boolean',
        },
        completedFromMode: {
            type: 'string',
            enum: ['free_for_all', 'turn_taking', 'vote_based'],
        },
        coverArtUrl: {
            type: 'string',
        },
        coverArtLocalPath: {
            type: 'string',
        },
        coHostIds: {
            type: 'array',
            items: { type: 'string' },
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
// Comment Schema
// ========================================
/**
 * Represents a comment on a playlist or a specific track within a playlist.
 * Supports single-level threaded replies via parentId.
 * Uses soft delete (isDeleted: boolean) for P2P tombstoning.
 */
export interface CommentDocType {
    id: string; // UUID v4 (P2P-safe)
    playlistId: string; // Scoped to a playlist
    trackId?: string; // If set → track comment; if absent → playlist-level comment
    userId: string; // Author's user ID
    userDisplayName: string;
    userAvatarUrl?: string; // Snapshot of author's avatar at comment time
    body: string; // Comment text
    parentId?: string; // For threaded replies; absent = top-level comment
    createdAt: string; // ISO timestamp
    updatedAt: string; // ISO timestamp (for LWW conflict resolution)
    isDeleted: boolean; // Soft delete for P2P tombstoning
}

export type CommentDocument = RxDocument<CommentDocType>;
export type CommentCollection = RxCollection<CommentDocType>;

export const commentSchema: RxJsonSchema<CommentDocType> = {
    version: 1,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100,
        },
        playlistId: {
            type: 'string',
            maxLength: 100,
        },
        trackId: {
            type: 'string',
            maxLength: 100,
        },
        userId: {
            type: 'string',
            maxLength: 100,
        },
        userDisplayName: {
            type: 'string',
            maxLength: 100,
        },
        userAvatarUrl: {
            type: 'string',
        },
        body: {
            type: 'string',
        },
        parentId: {
            type: 'string',
            maxLength: 100,
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
        isDeleted: {
            type: 'boolean',
        },
    },
    required: ['id', 'playlistId', 'userId', 'userDisplayName', 'body', 'createdAt', 'updatedAt', 'isDeleted'],
    indexes: ['playlistId', 'updatedAt'],
};

// ========================================
// Database Collections Type
// ========================================
/**
 * Complete WhatNext database schema with P2P collaboration support
 * Collections:
 * - users: Peer identity and status tracking
 * - tracks: Music tracks with attribution
 * - trackInteractions: User-track relationships (votes, likes, reactions, etc.)
 * - playlists: Collaborative playlists with ownership and permissions
 * - comments: Comments on playlists and tracks with threading support
 */
export interface WhatNextCollections {
    users: UserCollection;
    tracks: TrackCollection;
    trackInteractions: TrackInteractionCollection;
    playlists: PlaylistCollection;
    comments: CommentCollection;
}

export type WhatNextDatabase = RxDatabase<WhatNextCollections>;

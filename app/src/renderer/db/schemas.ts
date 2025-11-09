/**
 * RxDB Schemas for WhatNext
 * Defines the structure for core data entities: Playlist and Track
 * Per spec section 2.4
 */

import type {
    RxJsonSchema,
    RxDocument,
    RxCollection,
    RxDatabase,
} from 'rxdb';

// ========================================
// Track Schema
// ========================================
export interface TrackDocType {
    id: string;
    title: string;
    artists: string[]; // Array of artist names
    album: string;
    durationMs: number;
    spotifyId?: string; // Optional Spotify track ID
    addedAt: string; // ISO timestamp
    notes?: string; // User notes
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
        },
        addedAt: {
            type: 'string',
            format: 'date-time',
        },
        notes: {
            type: 'string',
        },
    },
    required: ['id', 'title', 'artists', 'album', 'durationMs', 'addedAt'],
    indexes: ['addedAt', 'spotifyId'],
};

// ========================================
// Playlist Schema
// ========================================
export interface PlaylistDocType {
    id: string;
    playlistName: string;
    description?: string;
    trackIds: string[]; // Ordered list of track IDs
    createdAt: string; // ISO timestamp
    updatedAt: string; // ISO timestamp
    linkedSpotifyId?: string; // Optional Spotify playlist ID
    tags: string[]; // User-defined tags
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
        },
        updatedAt: {
            type: 'string',
            format: 'date-time',
        },
        linkedSpotifyId: {
            type: 'string',
        },
        tags: {
            type: 'array',
            items: {
                type: 'string',
            },
        },
    },
    required: [
        'id',
        'playlistName',
        'trackIds',
        'createdAt',
        'updatedAt',
        'tags',
    ],
    indexes: ['updatedAt', 'linkedSpotifyId'],
};

// ========================================
// Database Collections Type
// ========================================
export interface WhatNextCollections {
    playlists: PlaylistCollection;
    tracks: TrackCollection;
}

export type WhatNextDatabase = RxDatabase<WhatNextCollections>;

/**
 * RxDB Domain Types
 *
 * Consolidated type definitions for database operations.
 * Re-exports schema doc types and defines view models + service input types.
 */

// Re-export document types from schemas for convenience
export type {
    LinkedAccount,
    TrackDocType,
    TrackDocument,
    PlaylistDocType,
    PlaylistDocument,
    UserDocType,
    UserDocument,
    TrackInteractionDocType,
    TrackInteractionDocument,
    WhatNextDatabase,
} from './schemas';

/**
 * Flat track object for UI rendering.
 * Used by PlaylistView, SessionView, and any component displaying track lists.
 */
export interface TrackViewModel {
    id: string;
    title: string;
    artists: string[];
    album: string;
    addedBy: string; // User ID — preserved for cross-provider bridging
    addedByName?: string; // Resolved display name for UI rendering
    durationMs: number;
    albumArtUrl?: string;
    albumArtLocalPath?: string;
}

/**
 * Input for creating a new playlist
 */
export interface CreatePlaylistInput {
    playlistName: string;
    description?: string;
    tags?: string[];
    linkedSpotifyId?: string;
    spotifySyncMode?: 'accessory' | 'true_collaborate' | 'proxy_owner';
    ownerId?: string;
    collaboratorIds?: string[];
    isCollaborative?: boolean;
    isPublic?: boolean;
    queueMode?: 'free_for_all' | 'turn_taking' | 'vote_based';
    coverArtUrl?: string;
}

/**
 * Input for updating playlist metadata
 */
export interface UpdatePlaylistInput {
    playlistName?: string;
    description?: string;
    tags?: string[];
    linkedSpotifyId?: string;
}

/**
 * Input for creating a new track
 */
export interface CreateTrackInput {
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    spotifyId?: string;
    albumArtUrl?: string;
    notes?: string;
    addedBy?: string;
}

/**
 * Input for updating track metadata
 */
export interface UpdateTrackInput {
    title?: string;
    artists?: string[];
    album?: string;
    durationMs?: number;
    spotifyId?: string;
    albumArtUrl?: string;
    albumArtLocalPath?: string;
    notes?: string;
}

/**
 * Result type for playlist with populated track data
 */
export interface PlaylistWithTracks {
    playlist: import('./schemas').PlaylistDocument;
    tracks: import('./schemas').TrackDocument[];
}

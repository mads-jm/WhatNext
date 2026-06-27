/**
 * Session Provider Interfaces
 * Platform-agnostic contracts for TrackSource and PlaybackProvider adapters.
 * The session layer depends only on these types, never on platform-specific modules.
 */

/** A track arriving from any external source, before normalization to TrackDocType */
export interface IncomingTrack {
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    externalId?: string;          // e.g. Spotify track ID, MusicBrainz ID
    externalSource?: string;      // 'spotify' | 'musicbrainz' | 'manual' | 'local'
    albumArtUrl?: string;
    localFilePath?: string;       // Absolute path when backed by a scanned local file
    addedAt: string;              // ISO timestamp
    addedByExternalId?: string;   // external user ID for attribution mapping
}

/** Playback state returned by any playback provider */
export interface PlaybackState {
    isPlaying: boolean;
    currentTrackExternalId: string | null;
    progressMs: number;
    durationMs: number;
    deviceName: string | null;
    // Enriched display fields (populated by Spotify provider)
    trackTitle?: string;
    trackArtists?: string[];
}

/** Track source configuration — discriminated union, serialisable for Zustand */
export type TrackSourceConfig =
    | { type: 'spotify-collab'; spotifyPlaylistId: string }
    | { type: 'manual' }
    | { type: 'p2p' };

/** Playback provider configuration — discriminated union, serialisable for Zustand */
export type PlaybackProviderConfig =
    | { type: 'spotify' }
    | { type: 'none' };

/** Active session state stored in the navigation store */
export interface SessionState {
    status: 'active' | 'ended';
    playlistId: string;
    trackSource: TrackSourceConfig;
    playbackProvider: PlaybackProviderConfig;
    participantIds: string[];   // WhatNext user IDs
    hostId: string;             // WhatNext user ID of the session host
    coHostIds: string[];        // Additional coordinators with edit rights
    playbackOwnerId: string;    // Who currently has Spotify playback control (mutex)
    startedAt: string;          // ISO timestamp
}

/** Input for starting a new session */
export interface StartSessionConfig {
    playlistId: string;
    trackSource: TrackSourceConfig;
    playbackProvider: PlaybackProviderConfig;
    participantIds: string[];
    hostId: string;
    coHostIds?: string[];       // Optional at start; defaults to []
}

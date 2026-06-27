/**
 * Maps Spotify API data to WhatNext RxDB document types.
 * Keeps mapping logic isolated for easy testing and maintenance.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SpotifyTrackItem } from './spotify-client';

export interface MappedTrack {
    id: string;
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    spotifyId: string;
    albumArtUrl?: string;
    addedAt: string;
    addedBySpotifyId: string; // Spotify user ID — resolved to WhatNext userId in the renderer
    addedByDisplayName?: string; // Spotify display name (when available)
}

/**
 * Map a Spotify track to WhatNext TrackDocType format.
 * Attribution is taken from item.added_by.id; resolving to a WhatNext userId
 * is the renderer's responsibility (see useSpotifyImport / useSpotifySync).
 */
export function mapSpotifyTrack(item: SpotifyTrackItem): MappedTrack {
    return {
        id: uuidv4(),
        title: item.track.name,
        artists: item.track.artists.map(a => a.name),
        album: item.track.album.name,
        durationMs: item.track.duration_ms,
        spotifyId: item.track.id,
        albumArtUrl: item.track.album.images[0]?.url,
        addedAt: item.added_at || new Date().toISOString(),
        addedBySpotifyId: item.added_by.id,
    };
}

/**
 * Map multiple Spotify tracks
 */
export function mapSpotifyTracks(items: SpotifyTrackItem[]): MappedTrack[] {
    return items
        .filter(item => item.track && item.track.id) // Filter out null/local tracks
        .map(item => mapSpotifyTrack(item));
}

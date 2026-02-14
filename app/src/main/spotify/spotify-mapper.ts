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
    addedAt: string;
    addedBy: string;
}

/**
 * Map a Spotify track to WhatNext TrackDocType format
 */
export function mapSpotifyTrack(item: SpotifyTrackItem, addedBy: string): MappedTrack {
    return {
        id: uuidv4(),
        title: item.track.name,
        artists: item.track.artists.map(a => a.name),
        album: item.track.album.name,
        durationMs: item.track.duration_ms,
        spotifyId: item.track.id,
        addedAt: item.added_at || new Date().toISOString(),
        addedBy,
    };
}

/**
 * Map multiple Spotify tracks
 */
export function mapSpotifyTracks(items: SpotifyTrackItem[], addedBy: string): MappedTrack[] {
    return items
        .filter(item => item.track && item.track.id) // Filter out null/local tracks
        .map(item => mapSpotifyTrack(item, addedBy));
}

/**
 * Playback State Normalization
 * Transforms raw Spotify playback API responses into canonical PlaybackState.
 * Pure function — no React, no IPC, no I/O.
 */

import type { PlaybackState } from '../../shared/session-interfaces';

export interface RawSpotifyPlaybackState {
    isPlaying: boolean;
    progressMs: number;
    deviceName: string | null;
    track: {
        spotifyId?: string;
        title?: string;
        artists?: string[];
        durationMs?: number;
    } | null;
}

/**
 * Normalize a raw Spotify playback response into a canonical PlaybackState.
 * Returns null if the raw state is null/undefined (nothing playing).
 */
export function normalizePlaybackState(
    raw: RawSpotifyPlaybackState | null | undefined,
): PlaybackState | null {
    if (!raw) return null;

    return {
        isPlaying: raw.isPlaying,
        currentTrackExternalId: raw.track?.spotifyId ?? null,
        progressMs: raw.progressMs,
        durationMs: raw.track?.durationMs ?? 0,
        deviceName: raw.deviceName,
        trackTitle: raw.track?.title,
        trackArtists: raw.track?.artists,
    };
}

/**
 * Playback State Normalization
 * Transforms raw Spotify playback API responses into canonical PlaybackState.
 * Pure function — no React, no IPC, no I/O.
 */

import type { PlaybackState, SessionState } from '../../shared/session-interfaces';

/**
 * Whether this device should render a playback surface for the given session.
 *
 * The answer depends on the local session's `playbackProvider` and on nothing
 * else — deliberately *not* on the local user id, the host id, or any notion of
 * who "owns" playback. Phase 1 has no session-message channel, so peers cannot
 * agree on an owner and any owner-derived surface would be a claim the app
 * cannot back (see [[epic-session-liveness-fixes]] §WB5).
 *
 * A participant whose session has `playbackProvider: 'none'` therefore gets no
 * playback surface at all — absent, not disabled.
 */
export function hasLocalPlaybackSurface(session: SessionState | null | undefined): boolean {
    return session?.playbackProvider.type === 'spotify';
}

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

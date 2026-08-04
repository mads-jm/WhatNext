/**
 * Playback surface visibility — honest-ownership contract ([[epic-session-liveness-fixes]] §WB5).
 *
 * These tests exist to fail loudly if cross-peer playback ownership is
 * reintroduced without a protocol to back it. Phase 1 has no session-message
 * channel, so "who owns playback" is not a question the app can answer; the
 * only honest input to "show a playback surface?" is this device's own
 * `playbackProvider`.
 */

import { describe, it, expect } from 'vitest';
import { hasLocalPlaybackSurface, normalizePlaybackState } from '../playback-helpers';
import type { SessionState } from '../../../shared/session-interfaces';

function session(overrides: Partial<SessionState> = {}): SessionState {
    return {
        status: 'active',
        playlistId: 'playlist-1',
        trackSource: { type: 'manual' },
        playbackProvider: { type: 'spotify' },
        participantIds: ['user-host', 'user-guest'],
        hostId: 'user-host',
        startedAt: '2026-08-03T00:00:00.000Z',
        ...overrides,
    };
}

describe('hasLocalPlaybackSurface', () => {
    it('shows a playback surface when this device drives Spotify', () => {
        expect(hasLocalPlaybackSurface(session())).toBe(true);
    });

    it('shows NO playback surface at all when the provider is none', () => {
        // Absent, not disabled: a participant running metadata-only gets no
        // greyed control and no "playback owned by ..." placeholder.
        expect(hasLocalPlaybackSurface(session({ playbackProvider: { type: 'none' } }))).toBe(false);
    });

    it('shows no playback surface with no active session', () => {
        expect(hasLocalPlaybackSurface(null)).toBe(false);
        expect(hasLocalPlaybackSurface(undefined)).toBe(false);
    });

    it('does not depend on who hosts the session', () => {
        // Guest and host devices with the same provider get the same answer.
        // If this ever diverges, an ownership notion has crept back in.
        const asHost = session({ hostId: 'user-host' });
        const asGuest = session({ hostId: 'someone-else' });
        expect(hasLocalPlaybackSurface(asGuest)).toBe(hasLocalPlaybackSurface(asHost));
    });

    it('takes no identity argument — visibility cannot be identity-derived', () => {
        // A one-arg signature is the structural guarantee behind the test
        // above: there is no user id to compare an owner against.
        expect(hasLocalPlaybackSurface.length).toBe(1);
    });
});

describe('normalizePlaybackState', () => {
    it('returns null when nothing is playing', () => {
        expect(normalizePlaybackState(null)).toBeNull();
    });

    it('maps a raw Spotify response onto the canonical shape', () => {
        expect(
            normalizePlaybackState({
                isPlaying: true,
                progressMs: 1000,
                deviceName: 'Kitchen',
                track: { spotifyId: 'track-1', title: 'Song', artists: ['A'], durationMs: 5000 },
            }),
        ).toEqual({
            isPlaying: true,
            currentTrackExternalId: 'track-1',
            progressMs: 1000,
            durationMs: 5000,
            deviceName: 'Kitchen',
            trackTitle: 'Song',
            trackArtists: ['A'],
        });
    });
});

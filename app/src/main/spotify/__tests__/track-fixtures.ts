/**
 * Shared Spotify playlist-item fixture.
 *
 * The mapper suite here and the `spotify:get-tracks` / `spotify:sync-playlist`
 * handler suites in `main/__tests__/ipc.test.ts` both feed the mapper the same
 * well-formed wire item, so it is built in one place.
 *
 * Returns a fresh object per call — the handler suites push these through
 * pagination loops and must not share mutable state.
 *
 * NOT a test file itself (no `.test.ts` suffix) — imported by the suites.
 */

import type { SpotifyTrackItem } from '../../types';

/** Minimal valid SpotifyTrackItem fixture */
export function makeTrackItem(
    overrides: Partial<SpotifyTrackItem> = {},
): SpotifyTrackItem {
    return {
        track: {
            id: 'spotify-track-id-1',
            name: 'Test Track',
            artists: [{ name: 'Artist A', id: 'artist-a' }],
            album: {
                name: 'Test Album',
                images: [
                    { url: 'https://cdn/image.jpg', height: 300, width: 300 },
                ],
            },
            duration_ms: 200000,
            external_urls: { spotify: 'https://open.spotify.com/track/123' },
        },
        added_at: '2024-01-15T12:00:00Z',
        added_by: { id: 'spotify-user-abc' },
        ...overrides,
    };
}

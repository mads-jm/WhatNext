/**
 * Unit tests for the source-agnostic track sink (#37).
 *
 * The sink is the shared normalize→write tail every TrackSource arm funnels
 * through, so its normalization rules (provenance mapping, attribution,
 * playlist append) are the load-bearing contract for the Manual arm today and
 * the P2P arm (#38) later. DB access is mocked — these assert the mapping and
 * call sequence, not RxDB behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingTrack } from '../../../../shared/session-interfaces';
import type { CreateTrackInput } from '../../types';

const createTrack = vi.fn();
const bulkAddTracksToPlaylist = vi.fn();

vi.mock('../track-service', () => ({
    createTrack: (input: CreateTrackInput) => createTrack(input),
}));
vi.mock('../playlist-service', () => ({
    bulkAddTracksToPlaylist: (playlistId: string, ids: string[]) =>
        bulkAddTracksToPlaylist(playlistId, ids),
}));

// Imported after the mocks are registered.
import { addIncomingTrack } from '../track-sink';

const PLAYLIST_ID = 'playlist-1';
const ADDER = 'user-abc';

function baseIncoming(overrides: Partial<IncomingTrack> = {}): IncomingTrack {
    return {
        title: 'Song',
        artists: ['Artist A', 'Artist B'],
        album: 'Album',
        durationMs: 180000,
        addedAt: '2026-06-27T12:00:00.000Z',
        ...overrides,
    };
}

describe('addIncomingTrack', () => {
    beforeEach(() => {
        createTrack.mockReset();
        bulkAddTracksToPlaylist.mockReset();
        createTrack.mockResolvedValue({ id: 'track-123' });
        bulkAddTracksToPlaylist.mockResolvedValue(null);
    });

    it('persists a manual entry attributed to the adder and appends it', async () => {
        const result = await addIncomingTrack(
            baseIncoming({ externalSource: 'manual' }),
            PLAYLIST_ID,
            ADDER,
        );

        expect(createTrack).toHaveBeenCalledTimes(1);
        const input = createTrack.mock.calls[0][0] as CreateTrackInput;
        expect(input).toMatchObject({
            title: 'Song',
            artists: ['Artist A', 'Artist B'],
            album: 'Album',
            durationMs: 180000,
            addedBy: ADDER,
            addedAt: '2026-06-27T12:00:00.000Z',
            source: 'manual',
        });
        expect(input.spotifyId).toBeUndefined();
        expect(input.localFilePath).toBeUndefined();

        expect(bulkAddTracksToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, [
            'track-123',
        ]);
        expect(result).toEqual({ trackId: 'track-123' });
    });

    it('maps externalId to spotifyId only for the spotify source', async () => {
        await addIncomingTrack(
            baseIncoming({ externalSource: 'spotify', externalId: 'spfy-99' }),
            PLAYLIST_ID,
            ADDER,
        );
        const input = createTrack.mock.calls[0][0] as CreateTrackInput;
        expect(input.spotifyId).toBe('spfy-99');
        expect(input.source).toBe('spotify');
    });

    it('does NOT map externalId to spotifyId for non-spotify sources', async () => {
        await addIncomingTrack(
            baseIncoming({ externalSource: 'musicbrainz', externalId: 'mb-1' }),
            PLAYLIST_ID,
            ADDER,
        );
        const input = createTrack.mock.calls[0][0] as CreateTrackInput;
        expect(input.spotifyId).toBeUndefined();
        expect(input.source).toBe('musicbrainz');
    });

    it('preserves localFilePath and source for a library-backed local add', async () => {
        await addIncomingTrack(
            baseIncoming({
                externalSource: 'local',
                localFilePath: '/music/song.flac',
                albumArtUrl: 'file:///art.jpg',
            }),
            PLAYLIST_ID,
            ADDER,
        );
        const input = createTrack.mock.calls[0][0] as CreateTrackInput;
        expect(input.source).toBe('local');
        expect(input.localFilePath).toBe('/music/song.flac');
        expect(input.albumArtUrl).toBe('file:///art.jpg');
        expect(input.spotifyId).toBeUndefined();
    });

    it('appends only after the track is created (create → append order)', async () => {
        const order: string[] = [];
        createTrack.mockImplementation(async () => {
            order.push('create');
            return { id: 'track-xyz' };
        });
        bulkAddTracksToPlaylist.mockImplementation(async () => {
            order.push('append');
            return null;
        });

        await addIncomingTrack(
            baseIncoming({ externalSource: 'manual' }),
            PLAYLIST_ID,
            ADDER,
        );
        expect(order).toEqual(['create', 'append']);
    });
});

/**
 * Playlist service — track-list mutations (#26).
 *
 * `trackIds` is an ordered array the P2P layer replicates wholesale, so the
 * dedup and validation rules that guard it are load-bearing: a duplicate id
 * would render the same track twice, and an id that is not already in the
 * playlist must not be able to sneak in through `reorderPlaylistTracks`.
 *
 * These exercise the free-for-all path only — `addTrackToPlaylist`'s
 * turn-taking side effects are covered in `playlist-service.turns.test.ts`.
 * Creation/metadata/search live in `playlist-service.crud.test.ts`. Shared DB
 * scaffolding is in `./harness.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createTestDatabase,
    closeTestDatabase,
    freezeClock,
    playlistInput,
    trackInput,
} from './harness';

vi.mock('../../database', async () => {
    const { getTestDatabase } = await import('./harness');
    return { getDatabase: getTestDatabase };
});

// Imported after the mock is registered.
import {
    createPlaylist,
    getPlaylist,
    getPlaylistWithTracks,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    reorderPlaylistTracks,
    bulkAddTracksToPlaylist,
    clearPlaylist,
} from '../playlist-service';
import { createTrack } from '../track-service';

beforeEach(async () => {
    freezeClock();
    await createTestDatabase();
});

afterEach(async () => {
    await closeTestDatabase();
    vi.useRealTimers();
});

/** Create a playlist plus `count` tracks; returns the playlist id and track ids. */
async function seed(count: number) {
    const playlist = await createPlaylist(playlistInput());
    const trackIds: string[] = [];
    for (let i = 0; i < count; i++) {
        const track = await createTrack(trackInput({ title: `Track ${i}` }));
        trackIds.push(track.id);
    }
    return { playlistId: playlist.id, trackIds };
}

async function storedTrackIds(playlistId: string): Promise<string[]> {
    const doc = await getPlaylist(playlistId);
    return doc?.trackIds ?? [];
}

describe('addTrackToPlaylist', () => {
    it('appends the track', async () => {
        const { playlistId, trackIds } = await seed(2);

        await addTrackToPlaylist(playlistId, trackIds[0]);
        await addTrackToPlaylist(playlistId, trackIds[1]);

        expect(await storedTrackIds(playlistId)).toEqual(trackIds);
    });

    it('skips a duplicate without touching updatedAt', async () => {
        const { playlistId, trackIds } = await seed(1);
        await addTrackToPlaylist(playlistId, trackIds[0]);
        const afterFirst = await getPlaylist(playlistId);

        vi.setSystemTime(new Date('2026-03-01T12:05:00.000Z'));
        await addTrackToPlaylist(playlistId, trackIds[0]);

        const afterSecond = await getPlaylist(playlistId);
        expect(afterSecond?.trackIds).toEqual(trackIds);
        // The early return means no write happened at all.
        expect(afterSecond?.updatedAt).toBe(afterFirst?.updatedAt);
    });

    it('returns null for an unknown playlist', async () => {
        const { trackIds } = await seed(1);
        expect(await addTrackToPlaylist('nope', trackIds[0])).toBeNull();
    });
});

describe('removeTrackFromPlaylist', () => {
    it('removes only the named track and preserves order', async () => {
        const { playlistId, trackIds } = await seed(3);
        await bulkAddTracksToPlaylist(playlistId, trackIds);

        await removeTrackFromPlaylist(playlistId, trackIds[1]);

        expect(await storedTrackIds(playlistId)).toEqual([
            trackIds[0],
            trackIds[2],
        ]);
    });

    it('is a no-op for a track that is not in the playlist', async () => {
        const { playlistId, trackIds } = await seed(2);
        await bulkAddTracksToPlaylist(playlistId, [trackIds[0]]);

        await removeTrackFromPlaylist(playlistId, trackIds[1]);

        expect(await storedTrackIds(playlistId)).toEqual([trackIds[0]]);
    });

    it('returns null for an unknown playlist', async () => {
        expect(await removeTrackFromPlaylist('nope', 'track-1')).toBeNull();
    });
});

describe('reorderPlaylistTracks', () => {
    it('applies the new order', async () => {
        const { playlistId, trackIds } = await seed(3);
        await bulkAddTracksToPlaylist(playlistId, trackIds);

        const reversed = [...trackIds].reverse();
        await reorderPlaylistTracks(playlistId, reversed);

        expect(await storedTrackIds(playlistId)).toEqual(reversed);
    });

    it('drops ids that are not already in the playlist', async () => {
        const { playlistId, trackIds } = await seed(2);
        await bulkAddTracksToPlaylist(playlistId, trackIds);

        await reorderPlaylistTracks(playlistId, [
            trackIds[1],
            'not-in-playlist',
            trackIds[0],
        ]);

        expect(await storedTrackIds(playlistId)).toEqual([
            trackIds[1],
            trackIds[0],
        ]);
    });

    it('truncates the list when the new order omits existing tracks', async () => {
        // The filter validates inbound ids but does not re-add missing ones, so
        // a partial order is destructive. Pinned deliberately: callers pass the
        // full list, and changing this would be a behavior change.
        const { playlistId, trackIds } = await seed(3);
        await bulkAddTracksToPlaylist(playlistId, trackIds);

        await reorderPlaylistTracks(playlistId, [trackIds[0]]);

        expect(await storedTrackIds(playlistId)).toEqual([trackIds[0]]);
    });

    it('returns null for an unknown playlist', async () => {
        expect(await reorderPlaylistTracks('nope', [])).toBeNull();
    });
});

describe('bulkAddTracksToPlaylist', () => {
    it('appends all new ids in the given order', async () => {
        const { playlistId, trackIds } = await seed(3);

        await bulkAddTracksToPlaylist(playlistId, trackIds);

        expect(await storedTrackIds(playlistId)).toEqual(trackIds);
    });

    it('filters out ids already in the playlist', async () => {
        const { playlistId, trackIds } = await seed(3);
        await bulkAddTracksToPlaylist(playlistId, [trackIds[0]]);

        await bulkAddTracksToPlaylist(playlistId, [
            trackIds[0],
            trackIds[1],
            trackIds[2],
        ]);

        expect(await storedTrackIds(playlistId)).toEqual(trackIds);
    });

    it('does NOT dedup within a single batch', async () => {
        // The filter only compares against ids already stored, so a batch that
        // repeats an id inserts it twice. Pinned as current behavior; no caller
        // passes a batch with internal duplicates today.
        const { playlistId, trackIds } = await seed(1);

        await bulkAddTracksToPlaylist(playlistId, [trackIds[0], trackIds[0]]);

        expect(await storedTrackIds(playlistId)).toEqual([
            trackIds[0],
            trackIds[0],
        ]);
    });

    it('returns null for an unknown playlist', async () => {
        expect(await bulkAddTracksToPlaylist('nope', [])).toBeNull();
    });
});

describe('clearPlaylist', () => {
    it('empties trackIds', async () => {
        const { playlistId, trackIds } = await seed(2);
        await bulkAddTracksToPlaylist(playlistId, trackIds);

        await clearPlaylist(playlistId);

        expect(await storedTrackIds(playlistId)).toEqual([]);
    });

    it('returns null for an unknown playlist', async () => {
        expect(await clearPlaylist('nope')).toBeNull();
    });
});

describe('getPlaylistWithTracks', () => {
    it('populates track documents in playlist order', async () => {
        const { playlistId, trackIds } = await seed(3);
        await bulkAddTracksToPlaylist(playlistId, [
            trackIds[2],
            trackIds[0],
            trackIds[1],
        ]);

        const result = await getPlaylistWithTracks(playlistId);

        expect(result?.playlist.id).toBe(playlistId);
        expect(result?.tracks.map((t) => t.title)).toEqual([
            'Track 2',
            'Track 0',
            'Track 1',
        ]);
    });

    it('silently drops ids with no matching track document', async () => {
        const { playlistId, trackIds } = await seed(1);
        await bulkAddTracksToPlaylist(playlistId, [trackIds[0], 'ghost-track']);

        const result = await getPlaylistWithTracks(playlistId);

        expect(result?.playlist.trackIds).toHaveLength(2);
        expect(result?.tracks.map((t) => t.id)).toEqual([trackIds[0]]);
    });

    it('returns null for an unknown playlist', async () => {
        expect(await getPlaylistWithTracks('nope')).toBeNull();
    });
});

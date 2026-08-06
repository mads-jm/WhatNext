/**
 * Track service — CRUD, bulk import and search (#26).
 *
 * Two contracts carry weight beyond plain CRUD. First, the timestamp defaulting:
 * `addedAt`/`updatedAt` fall back to now but a caller-supplied value wins, which
 * is what lets an import preserve a source platform's original added-at instead
 * of restamping every track to import time — and `updatedAt` is the LWW
 * checkpoint field the P2P layer sorts on. Second, `searchTracks` escapes regex
 * metacharacters before interpolating into `$regex`; that is the established
 * contract here and the shape `searchPlaylists` will be brought to by #67.
 *
 * Shared DB scaffolding is in `./harness.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createTestDatabase,
    closeTestDatabase,
    freezeClock,
    tickClock,
    FIXED_NOW,
    OWNER_ID,
    trackInput,
} from './harness';

vi.mock('../../database', async () => {
    const { getTestDatabase } = await import('./harness');
    return { getDatabase: getTestDatabase };
});

// Imported after the mock is registered.
import {
    createTrack,
    getTrack,
    getAllTracks,
    searchTracks,
    updateTrack,
    deleteTrack,
    getTracksByIds,
    bulkImportTracks,
} from '../track-service';

beforeEach(async () => {
    freezeClock();
    await createTestDatabase();
});

afterEach(async () => {
    await closeTestDatabase();
    vi.useRealTimers();
});

describe('createTrack', () => {
    it('generates an id and defaults both timestamps to now', async () => {
        const doc = await createTrack(trackInput());

        expect(doc.id).toEqual(expect.any(String));
        expect(doc.addedAt).toBe(FIXED_NOW);
        expect(doc.updatedAt).toBe(FIXED_NOW);
        expect(doc.addedBy).toBe(OWNER_ID);
    });

    it('preserves caller-supplied timestamps', async () => {
        const doc = await createTrack(
            trackInput({
                addedAt: '2019-05-04T09:00:00.000Z',
                updatedAt: '2020-06-05T10:00:00.000Z',
            }),
        );

        expect(doc.addedAt).toBe('2019-05-04T09:00:00.000Z');
        expect(doc.updatedAt).toBe('2020-06-05T10:00:00.000Z');
    });

    it('carries optional metadata through untouched', async () => {
        const doc = await createTrack(
            trackInput({
                spotifyId: 'spfy-track-1',
                albumArtUrl: 'https://example.test/art.jpg',
                notes: 'a note',
                source: 'spotify',
                sourceUrl: 'https://example.test/track',
                audioFormat: 'opus',
                audioBitrate: 160,
                userPurchased: true,
            }),
        );

        expect(doc.spotifyId).toBe('spfy-track-1');
        expect(doc.albumArtUrl).toBe('https://example.test/art.jpg');
        expect(doc.notes).toBe('a note');
        expect(doc.source).toBe('spotify');
        expect(doc.sourceUrl).toBe('https://example.test/track');
        expect(doc.audioFormat).toBe('opus');
        expect(doc.audioBitrate).toBe(160);
        expect(doc.userPurchased).toBe(true);
    });

    it('gives each track a distinct id', async () => {
        const a = await createTrack(trackInput());
        const b = await createTrack(trackInput());
        expect(a.id).not.toBe(b.id);
    });
});

describe('getTrack', () => {
    it('returns the stored track', async () => {
        const created = await createTrack(trackInput({ title: 'Findable' }));
        expect((await getTrack(created.id))?.title).toBe('Findable');
    });

    it('returns null for an unknown id', async () => {
        expect(await getTrack('does-not-exist')).toBeNull();
    });
});

describe('getAllTracks', () => {
    it('returns a query sorted by addedAt descending', async () => {
        const older = await createTrack(
            trackInput({ addedAt: '2020-01-01T00:00:00.000Z' }),
        );
        const newer = await createTrack(
            trackInput({ addedAt: '2024-01-01T00:00:00.000Z' }),
        );

        const docs = await (await getAllTracks()).exec();
        expect(docs.map((d) => d.id)).toEqual([newer.id, older.id]);
    });
});

describe('updateTrack', () => {
    it('applies the update and bumps updatedAt', async () => {
        const created = await createTrack(
            trackInput({ updatedAt: '2020-01-01T00:00:00.000Z' }),
        );
        const later = tickClock(60000);

        await updateTrack(created.id, { title: 'Retitled', durationMs: 1000 });

        const stored = await getTrack(created.id);
        expect(stored?.title).toBe('Retitled');
        expect(stored?.durationMs).toBe(1000);
        expect(stored?.updatedAt).toBe(later);
    });

    it('overrides a caller-supplied updatedAt with the current time', async () => {
        // `updatedAt` is the LWW checkpoint; the service always restamps it so a
        // caller cannot accidentally write a stale replication timestamp.
        const created = await createTrack(trackInput());
        const later = tickClock(60000);

        await updateTrack(created.id, {
            updatedAt: '2001-01-01T00:00:00.000Z',
        });

        expect((await getTrack(created.id))?.updatedAt).toBe(later);
    });

    it('leaves addedAt and addedBy alone', async () => {
        const created = await createTrack(
            trackInput({ addedAt: '2019-05-04T09:00:00.000Z' }),
        );
        tickClock(60000);

        await updateTrack(created.id, { title: 'Retitled' });

        const stored = await getTrack(created.id);
        expect(stored?.addedAt).toBe('2019-05-04T09:00:00.000Z');
        expect(stored?.addedBy).toBe(OWNER_ID);
    });

    it('returns null for an unknown id', async () => {
        expect(await updateTrack('does-not-exist', { title: 'x' })).toBeNull();
    });
});

describe('deleteTrack', () => {
    it('removes the track and reports true', async () => {
        const created = await createTrack(trackInput());
        expect(await deleteTrack(created.id)).toBe(true);
        expect(await getTrack(created.id)).toBeNull();
    });

    it('returns false for an unknown id', async () => {
        expect(await deleteTrack('does-not-exist')).toBe(false);
    });
});

describe('getTracksByIds', () => {
    it('returns the matching documents', async () => {
        const a = await createTrack(trackInput({ title: 'A' }));
        const b = await createTrack(trackInput({ title: 'B' }));
        await createTrack(trackInput({ title: 'C' }));

        const found = await getTracksByIds([a.id, b.id]);

        expect(found.map((t) => t.title).sort()).toEqual(['A', 'B']);
    });

    it('silently skips ids with no document', async () => {
        const a = await createTrack(trackInput({ title: 'A' }));

        const found = await getTracksByIds([a.id, 'ghost']);

        expect(found.map((t) => t.id)).toEqual([a.id]);
    });

    it('returns an empty array for an empty id list', async () => {
        expect(await getTracksByIds([])).toEqual([]);
    });
});

describe('bulkImportTracks', () => {
    it('returns the generated ids in input order', async () => {
        const ids = await bulkImportTracks([
            trackInput({ title: 'First' }),
            trackInput({ title: 'Second' }),
            trackInput({ title: 'Third' }),
        ]);

        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);
        const titles = await Promise.all(
            ids.map(async (id) => (await getTrack(id))?.title),
        );
        expect(titles).toEqual(['First', 'Second', 'Third']);
    });

    it('defaults missing timestamps to a single shared now', async () => {
        const ids = await bulkImportTracks([trackInput(), trackInput()]);

        const docs = await getTracksByIds(ids);
        expect(docs.map((d) => d.addedAt)).toEqual([FIXED_NOW, FIXED_NOW]);
        expect(docs.map((d) => d.updatedAt)).toEqual([FIXED_NOW, FIXED_NOW]);
    });

    it('preserves per-track supplied timestamps', async () => {
        const [id] = await bulkImportTracks([
            trackInput({ addedAt: '2018-02-03T04:05:06.000Z' }),
        ]);

        expect((await getTrack(id))?.addedAt).toBe('2018-02-03T04:05:06.000Z');
    });

    it('returns an empty array for an empty import', async () => {
        expect(await bulkImportTracks([])).toEqual([]);
    });
});

describe('searchTracks', () => {
    it('matches a title substring', async () => {
        await createTrack(trackInput({ title: 'Blue Monday' }));
        await createTrack(trackInput({ title: 'Red Tuesday' }));

        const docs = await (await searchTracks('Monday')).exec();

        expect(docs.map((d) => d.title)).toEqual(['Blue Monday']);
    });

    it('returns nothing when no title matches', async () => {
        await createTrack(trackInput({ title: 'Blue Monday' }));

        const docs = await (await searchTracks('Wednesday')).exec();

        expect(docs).toEqual([]);
    });

    it('treats regex metacharacters as literal text', async () => {
        // escapeRegex is the contract: `a.c` must match the literal "a.c" and
        // not "abc". Without it, user input reinterprets the query — and a
        // pathological pattern becomes a ReDoS vector.
        await createTrack(trackInput({ title: 'a.c' }));
        await createTrack(trackInput({ title: 'abc' }));

        const dotted = await (await searchTracks('a.c')).exec();
        expect(dotted.map((d) => d.title)).toEqual(['a.c']);
    });

    it('does not let a metacharacter-only query match everything', async () => {
        await createTrack(trackInput({ title: 'Blue Monday' }));

        const docs = await (await searchTracks('.*')).exec();

        expect(docs).toEqual([]);
    });

    it('handles bracket and quantifier characters literally', async () => {
        await createTrack(trackInput({ title: 'Song (Remix)' }));
        await createTrack(trackInput({ title: 'Song Remix' }));

        const docs = await (await searchTracks('(Remix)')).exec();

        expect(docs.map((d) => d.title)).toEqual(['Song (Remix)']);
    });
});

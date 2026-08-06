/**
 * Reaction service — composite-key toggling and replication fan-out (#26).
 *
 * Reactions ride on the generic `trackInteractions` collection, so the composite
 * primary key `${userId}_${trackId}_reaction_${emoji}` is the whole uniqueness
 * mechanism: it is what makes a second toggle from the same user find the same
 * row instead of stacking duplicates. Un-reacting flips `value` to 0 rather than
 * deleting the row — a deleted row cannot be tombstoned to peers, who would
 * simply replicate the reaction back. Both paths must reach the
 * `ReplicationSink`, and both must work without one.
 *
 * Shared DB scaffolding is in `./harness.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createTestDatabase,
    closeTestDatabase,
    freezeClock,
    getTestDatabase,
} from './harness';
import type { ReplicationSink } from '../../../../shared/core/types';

vi.mock('../../database', async () => {
    const { getTestDatabase } = await import('./harness');
    return { getDatabase: getTestDatabase };
});

// Imported after the mock is registered.
import { toggleReaction, getTrackReactions } from '../reaction-service';

const USER = 'user-1';
const TRACK = 'track-1';
const PLAYLIST = 'playlist-1';

interface SinkDoc {
    id: string;
    data: Record<string, unknown>;
    updatedAt: string;
}

let sink: ReplicationSink;
let sinkCalls: Array<{ collection: string; documents: SinkDoc[] }>;

beforeEach(async () => {
    freezeClock();
    await createTestDatabase();
    sinkCalls = [];
    sink = vi.fn(async (collection: string, documents: SinkDoc[]) => {
        sinkCalls.push({ collection, documents });
    });
});

afterEach(async () => {
    await closeTestDatabase();
    vi.useRealTimers();
});

async function storedReaction(id: string) {
    const db = await getTestDatabase();
    return db.trackInteractions.findOne(id).exec();
}

describe('toggleReaction', () => {
    it('builds the composite id from user, track and emoji', async () => {
        const doc = await toggleReaction(USER, TRACK, PLAYLIST, 'fire');

        expect(doc.id).toBe(`${USER}_${TRACK}_reaction_fire`);
    });

    it('inserts with value 1 and the full interaction shape on first toggle', async () => {
        const doc = await toggleReaction(USER, TRACK, PLAYLIST, 'fire');

        expect(doc.userId).toBe(USER);
        expect(doc.trackId).toBe(TRACK);
        expect(doc.playlistId).toBe(PLAYLIST);
        expect(doc.interactionType).toBe('reaction');
        expect(doc.value).toBe(1);
        expect(doc.createdAt).toBe(doc.updatedAt);
        expect(JSON.parse(doc.metadata ?? '{}')).toEqual({ emoji: 'fire' });
    });

    it('flips to 0 on the second toggle without deleting the row', async () => {
        const first = await toggleReaction(USER, TRACK, PLAYLIST, 'fire');

        await toggleReaction(USER, TRACK, PLAYLIST, 'fire');

        const stored = await storedReaction(first.id);
        expect(stored).not.toBeNull();
        expect(stored?.value).toBe(0);
    });

    it('flips back to 1 on the third toggle', async () => {
        const first = await toggleReaction(USER, TRACK, PLAYLIST, 'fire');
        await toggleReaction(USER, TRACK, PLAYLIST, 'fire');

        await toggleReaction(USER, TRACK, PLAYLIST, 'fire');

        expect((await storedReaction(first.id))?.value).toBe(1);
    });

    it('keeps createdAt and bumps updatedAt when toggling off', async () => {
        const first = await toggleReaction(USER, TRACK, PLAYLIST, 'fire');
        vi.setSystemTime(new Date('2026-03-01T12:30:00.000Z'));

        await toggleReaction(USER, TRACK, PLAYLIST, 'fire');

        const stored = await storedReaction(first.id);
        expect(stored?.createdAt).toBe(first.createdAt);
        expect(stored?.updatedAt).toBe('2026-03-01T12:30:00.000Z');
    });

    it('keeps different emoji, users and tracks on separate rows', async () => {
        await toggleReaction(USER, TRACK, PLAYLIST, 'fire');
        await toggleReaction(USER, TRACK, PLAYLIST, 'heart');
        await toggleReaction('user-2', TRACK, PLAYLIST, 'fire');
        await toggleReaction(USER, 'track-2', PLAYLIST, 'fire');

        const db = await getTestDatabase();
        expect(await db.trackInteractions.find().exec()).toHaveLength(4);
    });

    it('pushes the insert to the replication sink', async () => {
        const doc = await toggleReaction(USER, TRACK, PLAYLIST, 'fire', sink);

        expect(sink).toHaveBeenCalledTimes(1);
        const { collection, documents } = sinkCalls[0];
        expect(collection).toBe('trackInteractions');
        expect(documents).toHaveLength(1);
        expect(documents[0].id).toBe(doc.id);
        expect(documents[0].updatedAt).toBe(doc.updatedAt);
        expect(documents[0].data).toMatchObject({
            id: doc.id,
            value: 1,
            interactionType: 'reaction',
        });
    });

    it('pushes the flip-to-zero update to the replication sink', async () => {
        const doc = await toggleReaction(USER, TRACK, PLAYLIST, 'fire');
        vi.setSystemTime(new Date('2026-03-01T12:30:00.000Z'));

        await toggleReaction(USER, TRACK, PLAYLIST, 'fire', sink);

        const { collection, documents } = sinkCalls[0];
        expect(collection).toBe('trackInteractions');
        expect(documents[0].id).toBe(doc.id);
        expect(documents[0].updatedAt).toBe('2026-03-01T12:30:00.000Z');
        expect(documents[0].data).toMatchObject({
            value: 0,
            updatedAt: '2026-03-01T12:30:00.000Z',
        });
    });

    it('works without a sink on both the insert and the update path', async () => {
        await expect(
            toggleReaction(USER, TRACK, PLAYLIST, 'fire'),
        ).resolves.toBeTruthy();
        await expect(
            toggleReaction(USER, TRACK, PLAYLIST, 'fire'),
        ).resolves.toBeTruthy();
    });
});

describe('getTrackReactions', () => {
    it('returns every reaction on the track, including toggled-off ones', async () => {
        // Value-0 rows are tombstones, not absences; filtering them out is the
        // UI's job (a consumer counting reactions must check `value`).
        await toggleReaction(USER, TRACK, PLAYLIST, 'fire');
        await toggleReaction('user-2', TRACK, PLAYLIST, 'heart');
        await toggleReaction('user-2', TRACK, PLAYLIST, 'heart'); // off again

        const docs = await (await getTrackReactions(TRACK)).exec();

        expect(docs).toHaveLength(2);
        expect(docs.map((d) => d.value).sort()).toEqual([0, 1]);
    });

    it('excludes reactions on other tracks', async () => {
        await toggleReaction(USER, TRACK, PLAYLIST, 'fire');
        await toggleReaction(USER, 'track-2', PLAYLIST, 'fire');

        const docs = await (await getTrackReactions(TRACK)).exec();

        expect(docs.map((d) => d.trackId)).toEqual([TRACK]);
    });

    it('excludes non-reaction interactions on the same track', async () => {
        await toggleReaction(USER, TRACK, PLAYLIST, 'fire');
        const db = await getTestDatabase();
        await db.trackInteractions.insert({
            id: `${USER}_${TRACK}_vote`,
            userId: USER,
            trackId: TRACK,
            playlistId: PLAYLIST,
            interactionType: 'vote',
            value: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        const docs = await (await getTrackReactions(TRACK)).exec();

        expect(docs.map((d) => d.interactionType)).toEqual(['reaction']);
    });

    it('returns nothing for a track with no reactions', async () => {
        expect(await (await getTrackReactions('untouched')).exec()).toEqual([]);
    });
});

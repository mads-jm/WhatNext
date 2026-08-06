/**
 * Comment service — CRUD, the author-only guard and replication fan-out (#26).
 *
 * Two things here are more than CRUD. Deletion is soft (`isDeleted: true`)
 * because a hard delete cannot be tombstoned across peers — a removed row would
 * simply be re-replicated back by anyone who still has it. And every mutation
 * feeds an optional `ReplicationSink`: if the payload or collection name drifts,
 * peers silently stop seeing comments while the local UI looks fine. The sink
 * is optional, so each path is also asserted to work without one.
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
import {
    createComment,
    updateComment,
    deleteComment,
    getPlaylistComments,
} from '../comment-service';
import type { CreateCommentInput } from '../comment-service';

const PLAYLIST_ID = 'playlist-1';
const AUTHOR = 'user-author';
const OTHER = 'user-other';

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

function commentInput(
    overrides: Partial<CreateCommentInput> = {},
): CreateCommentInput {
    return {
        playlistId: PLAYLIST_ID,
        userId: AUTHOR,
        userDisplayName: 'Author',
        body: 'Nice track',
        ...overrides,
    };
}

async function listComments(playlistId = PLAYLIST_ID) {
    return (await getPlaylistComments(playlistId)).exec();
}

describe('createComment', () => {
    it('stores a playlist-level comment with the expected shape', async () => {
        const doc = await createComment(commentInput());

        expect(doc.id).toEqual(expect.any(String));
        expect(doc.playlistId).toBe(PLAYLIST_ID);
        expect(doc.userId).toBe(AUTHOR);
        expect(doc.userDisplayName).toBe('Author');
        expect(doc.body).toBe('Nice track');
        expect(doc.isDeleted).toBe(false);
        expect(doc.createdAt).toBe(doc.updatedAt);
        expect(doc.trackId).toBeUndefined();
        expect(doc.parentId).toBeUndefined();
    });

    it('carries trackId, parentId and avatar through', async () => {
        const parent = await createComment(commentInput());
        const doc = await createComment(
            commentInput({
                trackId: 'track-1',
                parentId: parent.id,
                userAvatarUrl: 'https://example.test/a.jpg',
                body: 'A reply',
            }),
        );

        expect(doc.trackId).toBe('track-1');
        expect(doc.parentId).toBe(parent.id);
        expect(doc.userAvatarUrl).toBe('https://example.test/a.jpg');
    });

    it('pushes the new comment to the replication sink', async () => {
        const doc = await createComment(commentInput(), sink);

        expect(sink).toHaveBeenCalledTimes(1);
        const { collection, documents } = sinkCalls[0];
        expect(collection).toBe('comments');
        expect(documents).toHaveLength(1);
        expect(documents[0].id).toBe(doc.id);
        expect(documents[0].updatedAt).toBe(doc.updatedAt);
        expect(documents[0].data).toMatchObject({
            id: doc.id,
            body: 'Nice track',
            isDeleted: false,
        });
    });

    it('works without a sink', async () => {
        await expect(createComment(commentInput())).resolves.toBeTruthy();
    });
});

describe('updateComment', () => {
    it('lets the author edit the body and bumps updatedAt', async () => {
        const created = await createComment(commentInput());
        vi.setSystemTime(new Date('2026-03-01T12:10:00.000Z'));

        await updateComment(created.id, { body: 'Edited' }, AUTHOR);

        const [stored] = await listComments();
        expect(stored.body).toBe('Edited');
        expect(stored.updatedAt).toBe('2026-03-01T12:10:00.000Z');
    });

    it('refuses a non-author and changes nothing', async () => {
        const created = await createComment(commentInput());

        const result = await updateComment(
            created.id,
            { body: 'Hijacked' },
            OTHER,
            sink,
        );

        expect(result).toBeNull();
        expect(sink).not.toHaveBeenCalled();
        expect((await listComments())[0].body).toBe('Nice track');
    });

    it('returns null for an unknown comment', async () => {
        expect(await updateComment('nope', { body: 'x' }, AUTHOR)).toBeNull();
    });

    it('pushes the edited body to the replication sink', async () => {
        const created = await createComment(commentInput());
        vi.setSystemTime(new Date('2026-03-01T12:10:00.000Z'));

        await updateComment(created.id, { body: 'Edited' }, AUTHOR, sink);

        const { collection, documents } = sinkCalls[0];
        expect(collection).toBe('comments');
        expect(documents[0].id).toBe(created.id);
        expect(documents[0].updatedAt).toBe('2026-03-01T12:10:00.000Z');
        expect(documents[0].data).toMatchObject({
            body: 'Edited',
            updatedAt: '2026-03-01T12:10:00.000Z',
        });
    });

    it('works without a sink', async () => {
        const created = await createComment(commentInput());
        await expect(
            updateComment(created.id, { body: 'Edited' }, AUTHOR),
        ).resolves.toBeTruthy();
    });
});

describe('deleteComment', () => {
    it('soft-deletes rather than removing the row', async () => {
        const created = await createComment(commentInput());

        expect(await deleteComment(created.id, AUTHOR)).toBe(true);

        // Gone from the playlist query...
        expect(await listComments()).toEqual([]);
        // ...but the tombstone is still on disk for peers to replicate.
        const db = await getTestDatabase();
        const tombstone = await db.comments.findOne(created.id).exec();
        expect(tombstone?.isDeleted).toBe(true);
        expect(tombstone?.body).toBe('Nice track');
    });

    it('refuses a non-author and changes nothing', async () => {
        const created = await createComment(commentInput());

        expect(await deleteComment(created.id, OTHER, sink)).toBe(false);
        expect(sink).not.toHaveBeenCalled();
        expect(await listComments()).toHaveLength(1);
    });

    it('returns false for an unknown comment', async () => {
        expect(await deleteComment('nope', AUTHOR)).toBe(false);
    });

    it('pushes the tombstone to the replication sink', async () => {
        const created = await createComment(commentInput());
        vi.setSystemTime(new Date('2026-03-01T12:20:00.000Z'));

        await deleteComment(created.id, AUTHOR, sink);

        const { collection, documents } = sinkCalls[0];
        expect(collection).toBe('comments');
        expect(documents[0].id).toBe(created.id);
        expect(documents[0].updatedAt).toBe('2026-03-01T12:20:00.000Z');
        expect(documents[0].data).toMatchObject({ isDeleted: true });
    });

    it('works without a sink', async () => {
        const created = await createComment(commentInput());
        await expect(deleteComment(created.id, AUTHOR)).resolves.toBe(true);
    });
});

describe('getPlaylistComments', () => {
    it('returns comments for the playlist sorted by createdAt ascending', async () => {
        await createComment(commentInput({ body: 'First' }));
        vi.setSystemTime(new Date('2026-03-01T12:01:00.000Z'));
        await createComment(commentInput({ body: 'Second' }));

        expect((await listComments()).map((c) => c.body)).toEqual([
            'First',
            'Second',
        ]);
    });

    it('excludes deleted comments', async () => {
        const kept = await createComment(commentInput({ body: 'Kept' }));
        const removed = await createComment(commentInput({ body: 'Removed' }));
        await deleteComment(removed.id, AUTHOR);

        expect((await listComments()).map((c) => c.id)).toEqual([kept.id]);
    });

    it('excludes comments belonging to another playlist', async () => {
        await createComment(commentInput({ body: 'Mine' }));
        await createComment(
            commentInput({ playlistId: 'playlist-2', body: 'Theirs' }),
        );

        expect((await listComments()).map((c) => c.body)).toEqual(['Mine']);
    });

    it('includes both playlist-level and track-level comments', async () => {
        await createComment(commentInput({ body: 'On the playlist' }));
        vi.setSystemTime(new Date('2026-03-01T12:01:00.000Z'));
        await createComment(
            commentInput({ trackId: 'track-1', body: 'On the track' }),
        );

        expect((await listComments()).map((c) => c.body)).toEqual([
            'On the playlist',
            'On the track',
        ]);
    });
});

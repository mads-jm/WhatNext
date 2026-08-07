/**
 * Playlist service — creation, retrieval, metadata update, deletion, search (#26).
 *
 * Pins the field derivation `createPlaylist` performs (notably the turn-taking
 * vs. non-turn-taking branch, which decides whether six optional turn fields are
 * seeded or left undefined) and the not-found return contracts (`null` from
 * readers/updaters, `false` from `deletePlaylist`) that callers branch on.
 *
 * Track-list mutations live in `playlist-service.tracks.test.ts`; turn rotation
 * and completion live in `playlist-service.turns.test.ts`. Shared DB scaffolding
 * is in `./harness.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createTestDatabase,
    closeTestDatabase,
    freezeClock,
    FIXED_NOW,
    OWNER_ID,
    playlistInput,
} from './harness';

vi.mock('../../database', async () => {
    const { getTestDatabase } = await import('./harness');
    return { getDatabase: getTestDatabase };
});

// Imported after the mock is registered.
import {
    createPlaylist,
    getPlaylist,
    getAllPlaylists,
    searchPlaylists,
    updatePlaylist,
    deletePlaylist,
} from '../playlist-service';
import type { CreatePlaylistInput } from '../../types';

beforeEach(async () => {
    freezeClock();
    await createTestDatabase();
});

afterEach(async () => {
    await closeTestDatabase();
    vi.useRealTimers();
});

describe('createPlaylist', () => {
    it('derives defaults for a plain playlist and leaves turn fields unset', async () => {
        const doc = await createPlaylist(
            playlistInput({ playlistName: 'Road Trip' }),
        );

        expect(doc.playlistName).toBe('Road Trip');
        expect(doc.ownerId).toBe(OWNER_ID);
        expect(doc.trackIds).toEqual([]);
        expect(doc.collaboratorIds).toEqual([]);
        expect(doc.tags).toEqual([]);
        expect(doc.isCollaborative).toBe(false);
        expect(doc.isPublic).toBe(false);
        expect(doc.isComplete).toBe(false);
        expect(doc.createdAt).toBe(FIXED_NOW);
        expect(doc.updatedAt).toBe(FIXED_NOW);
        expect(doc.id).toEqual(expect.any(String));

        // Non-turn-taking: every turn field stays undefined.
        expect(doc.currentTurnUserId).toBeUndefined();
        expect(doc.turnOrder).toBeUndefined();
        expect(doc.tracksPerTurn).toBeUndefined();
        expect(doc.turnTracksAdded).toBeUndefined();
        expect(doc.maxTurns).toBeUndefined();
        expect(doc.turnsCompleted).toBeUndefined();
    });

    it('preserves caller-supplied metadata', async () => {
        const doc = await createPlaylist(
            playlistInput({
                description: 'A description',
                tags: ['road', 'summer'],
                collaboratorIds: ['user-b'],
                isCollaborative: true,
                isPublic: true,
                linkedSpotifyId: 'spfy-playlist-1',
                spotifySyncMode: 'accessory',
                coverArtUrl: 'https://example.test/cover.jpg',
            }),
        );

        expect(doc.description).toBe('A description');
        expect(doc.tags).toEqual(['road', 'summer']);
        expect(doc.collaboratorIds).toEqual(['user-b']);
        expect(doc.isCollaborative).toBe(true);
        expect(doc.isPublic).toBe(true);
        expect(doc.linkedSpotifyId).toBe('spfy-playlist-1');
        expect(doc.spotifySyncMode).toBe('accessory');
        expect(doc.coverArtUrl).toBe('https://example.test/cover.jpg');
    });

    it('seeds turn state and hands the first turn to the owner in turn_taking mode', async () => {
        const doc = await createPlaylist(
            playlistInput({
                queueMode: 'turn_taking',
                collaboratorIds: ['user-b', 'user-c'],
                maxTurns: 6,
            }),
        );

        expect(doc.currentTurnUserId).toBe(OWNER_ID);
        expect(doc.tracksPerTurn).toBe(1);
        expect(doc.turnTracksAdded).toBe(0);
        expect(doc.turnsCompleted).toBe(0);
        expect(doc.maxTurns).toBe(6);
        // No explicit order given — rotation falls back to owner + collaborators.
        expect(doc.turnOrder).toBeUndefined();
    });

    it('honours an explicit turnOrder and tracksPerTurn', async () => {
        const doc = await createPlaylist(
            playlistInput({
                queueMode: 'turn_taking',
                turnOrder: ['user-b', OWNER_ID],
                tracksPerTurn: 3,
            }),
        );

        expect(doc.turnOrder).toEqual(['user-b', OWNER_ID]);
        expect(doc.tracksPerTurn).toBe(3);
    });

    it('requires ownerId at the type level', () => {
        // `ownerId` used to be optional, compensated for by a non-null
        // assertion in the service — so an attribution-less playlist was
        // constructible and only failed at schema-validation time. Now the
        // compiler rejects it, which means the old "omitting ownerId fails"
        // runtime test is no longer expressible. This is its replacement:
        // `tsc --noEmit` fails on an unused `@ts-expect-error`, so making
        // `ownerId` optional again breaks the typecheck gate.
        // @ts-expect-error ownerId is non-optional on CreatePlaylistInput
        const input: CreatePlaylistInput = { playlistName: 'No owner' };
        expect(input.playlistName).toBe('No owner');
    });

    it('ignores turn config supplied for a non-turn-taking queue mode', async () => {
        const doc = await createPlaylist(
            playlistInput({
                queueMode: 'free_for_all',
                turnOrder: ['user-b'],
                tracksPerTurn: 4,
                maxTurns: 9,
            }),
        );

        expect(doc.queueMode).toBe('free_for_all');
        expect(doc.turnOrder).toBeUndefined();
        expect(doc.tracksPerTurn).toBeUndefined();
        expect(doc.maxTurns).toBeUndefined();
        expect(doc.turnTracksAdded).toBeUndefined();
    });
});

describe('getPlaylist', () => {
    it('returns the stored playlist', async () => {
        const created = await createPlaylist(playlistInput());
        const found = await getPlaylist(created.id);
        expect(found?.id).toBe(created.id);
        expect(found?.playlistName).toBe('Test Playlist');
    });

    it('returns null for an unknown id', async () => {
        expect(await getPlaylist('does-not-exist')).toBeNull();
    });
});

describe('getAllPlaylists', () => {
    it('returns a query sorted by updatedAt descending', async () => {
        const first = await createPlaylist(
            playlistInput({ playlistName: 'A' }),
        );
        // Distinct timestamps so the ordering assertion is unambiguous.
        vi.setSystemTime(new Date('2026-03-01T12:00:05.000Z'));
        const second = await createPlaylist(
            playlistInput({ playlistName: 'B' }),
        );

        const docs = await (await getAllPlaylists()).exec();
        expect(docs.map((d) => d.id)).toEqual([second.id, first.id]);
    });
});

describe('searchPlaylists', () => {
    // Happy path only, deliberately: `searchPlaylists` interpolates raw query
    // text into `$regex` (#67 will route it through `escapeRegex` the way
    // `track-service` does). Asserting today's metacharacter behavior would
    // encode the defect as a contract and force the fix to rewrite this suite.
    beforeEach(async () => {
        await createPlaylist(playlistInput({ playlistName: 'Summer Vibes' }));
        await createPlaylist(playlistInput({ playlistName: 'Winter Chill' }));
    });

    it('matches a full name', async () => {
        const docs = await (await searchPlaylists('Summer Vibes')).exec();
        expect(docs.map((d) => d.playlistName)).toEqual(['Summer Vibes']);
    });

    it('matches a substring', async () => {
        const docs = await (await searchPlaylists('Chill')).exec();
        expect(docs.map((d) => d.playlistName)).toEqual(['Winter Chill']);
    });

    it('returns nothing when no name matches', async () => {
        const docs = await (await searchPlaylists('Autumn')).exec();
        expect(docs).toEqual([]);
    });
});

describe('updatePlaylist', () => {
    it('applies the update and bumps updatedAt', async () => {
        const created = await createPlaylist(playlistInput());
        vi.setSystemTime(new Date('2026-03-01T12:00:10.000Z'));

        await updatePlaylist(created.id, {
            playlistName: 'Renamed',
            tags: ['fresh'],
        });

        const stored = await getPlaylist(created.id);
        expect(stored?.playlistName).toBe('Renamed');
        expect(stored?.tags).toEqual(['fresh']);
        expect(stored?.updatedAt).toBe('2026-03-01T12:00:10.000Z');
        expect(stored?.createdAt).toBe(FIXED_NOW);
    });

    it('returns the pre-update snapshot, not the updated document', async () => {
        // RxDocuments are immutable: `doc.update()` writes a new revision and
        // leaves the handle the service is holding pointing at the old one. No
        // caller reads these return values today (the UI re-renders off
        // reactive queries), but the signature says `PlaylistDocument`, so the
        // trap is worth pinning. Every mutator in this service shares it —
        // `user-service` is the only one that re-fetches before returning.
        const created = await createPlaylist(playlistInput());

        const returned = await updatePlaylist(created.id, {
            playlistName: 'Renamed',
        });

        expect(returned?.playlistName).toBe('Test Playlist');
        expect(returned?.getLatest().playlistName).toBe('Renamed');
    });

    it('returns null for an unknown id', async () => {
        expect(await updatePlaylist('does-not-exist', { tags: [] })).toBeNull();
    });
});

describe('deletePlaylist', () => {
    it('removes the playlist and reports true', async () => {
        const created = await createPlaylist(playlistInput());
        expect(await deletePlaylist(created.id)).toBe(true);
        expect(await getPlaylist(created.id)).toBeNull();
    });

    it('returns false for an unknown id', async () => {
        expect(await deletePlaylist('does-not-exist')).toBe(false);
    });
});

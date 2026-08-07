/**
 * Playlist service — turn-taking rotation and completion (#26).
 *
 * The most intricate uncovered logic in the renderer: adding one track can
 * increment a per-turn quota, roll the quota over, hand the turn to the next
 * participant, tick the completed-turns counter, and auto-complete the playlist
 * on either a turn cap or a total-duration cap — all inside a single
 * `addTrackToPlaylist` call. Every one of those effects is replicated to peers,
 * so a silent change here desynchronises a live session.
 *
 * Free-for-all track mutations are in `playlist-service.tracks.test.ts`;
 * creation and metadata are in `playlist-service.crud.test.ts`. Shared DB
 * scaffolding is in `./harness.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createTestDatabase,
    closeTestDatabase,
    freezeClock,
    OWNER_ID,
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
    addTrackToPlaylist,
    advanceTurn,
    setTurnOrder,
    setTurnConfig,
    markPlaylistComplete,
    reopenPlaylist,
    updatePlaylist,
} from '../playlist-service';
import { createTrack } from '../track-service';
import type { CreatePlaylistInput } from '../../types';
import type { PlaylistDocument } from '../../schemas';

const USER_B = 'user-b';
const USER_C = 'user-c';

beforeEach(async () => {
    freezeClock();
    await createTestDatabase();
});

afterEach(async () => {
    await closeTestDatabase();
    vi.useRealTimers();
});

/** A turn-taking playlist owned by OWNER_ID with user-b and user-c collaborating. */
async function turnPlaylist(
    overrides: Partial<CreatePlaylistInput> = {},
): Promise<string> {
    const doc = await createPlaylist(
        playlistInput({
            queueMode: 'turn_taking',
            collaboratorIds: [USER_B, USER_C],
            ...overrides,
        }),
    );
    return doc.id;
}

/** Add a brand-new track (never a duplicate) to the playlist. */
async function addNewTrack(playlistId: string, durationMs = 180000) {
    const track = await createTrack(trackInput({ durationMs }));
    await addTrackToPlaylist(playlistId, track.id);
    return track.id;
}

async function load(playlistId: string): Promise<PlaylistDocument> {
    const doc = await getPlaylist(playlistId);
    if (!doc) throw new Error(`playlist ${playlistId} not found`);
    return doc;
}

describe('addTrackToPlaylist — turn quota', () => {
    it('advances the turn immediately when tracksPerTurn defaults to 1', async () => {
        const id = await turnPlaylist();

        await addNewTrack(id);

        const doc = await load(id);
        expect(doc.currentTurnUserId).toBe(USER_B);
        expect(doc.turnsCompleted).toBe(1);
        expect(doc.turnTracksAdded).toBe(0);
    });

    it('accumulates the quota and only advances on the final track of a turn', async () => {
        const id = await turnPlaylist({ tracksPerTurn: 3 });

        await addNewTrack(id);
        let doc = await load(id);
        expect(doc.turnTracksAdded).toBe(1);
        expect(doc.currentTurnUserId).toBe(OWNER_ID);
        expect(doc.turnsCompleted).toBe(0);

        await addNewTrack(id);
        doc = await load(id);
        expect(doc.turnTracksAdded).toBe(2);
        expect(doc.currentTurnUserId).toBe(OWNER_ID);

        await addNewTrack(id);
        doc = await load(id);
        expect(doc.turnTracksAdded).toBe(0);
        expect(doc.currentTurnUserId).toBe(USER_B);
        expect(doc.turnsCompleted).toBe(1);
    });

    it('leaves turn state untouched when the track is a duplicate', async () => {
        const id = await turnPlaylist({ tracksPerTurn: 3 });
        const trackId = await addNewTrack(id);

        await addTrackToPlaylist(id, trackId);

        const doc = await load(id);
        expect(doc.trackIds).toEqual([trackId]);
        expect(doc.turnTracksAdded).toBe(1);
    });

    it('does not touch turn state in a non-turn-taking playlist', async () => {
        const doc = await createPlaylist(
            playlistInput({ queueMode: 'free_for_all' }),
        );

        await addNewTrack(doc.id);

        const stored = await load(doc.id);
        expect(stored.turnTracksAdded).toBeUndefined();
        expect(stored.currentTurnUserId).toBeUndefined();
        expect(stored.turnsCompleted).toBeUndefined();
    });

    it('stops advancing turns once the playlist is complete', async () => {
        const id = await turnPlaylist();
        await markPlaylistComplete(id);

        await addNewTrack(id);

        const doc = await load(id);
        expect(doc.trackIds).toHaveLength(1); // the track still lands
        expect(doc.currentTurnUserId).toBe(OWNER_ID); // but the turn does not move
        expect(doc.turnsCompleted).toBe(0);
    });
});

describe('advanceTurn', () => {
    it('rotates through [ownerId, ...collaboratorIds] and wraps around', async () => {
        const id = await turnPlaylist();

        await advanceTurn(id);
        expect((await load(id)).currentTurnUserId).toBe(USER_B);

        await advanceTurn(id);
        expect((await load(id)).currentTurnUserId).toBe(USER_C);

        await advanceTurn(id);
        expect((await load(id)).currentTurnUserId).toBe(OWNER_ID);

        expect((await load(id)).turnsCompleted).toBe(3);
    });

    it('prefers an explicit turnOrder over the owner/collaborator fallback', async () => {
        const id = await turnPlaylist({ turnOrder: [USER_C, OWNER_ID] });

        await advanceTurn(id);
        expect((await load(id)).currentTurnUserId).toBe(USER_C);

        await advanceTurn(id);
        expect((await load(id)).currentTurnUserId).toBe(OWNER_ID);
    });

    it('falls back to the owner/collaborator order when turnOrder is empty', async () => {
        const id = await turnPlaylist();
        await setTurnOrder(id, []);

        await advanceTurn(id);

        expect((await load(id)).currentTurnUserId).toBe(USER_B);
    });

    it('restarts at the head of the order when the current holder is not in it', async () => {
        // `indexOf` returns -1 for an unknown holder, so `nextIndex` lands on 0.
        // Reachable if a collaborator is removed mid-session while holding the turn.
        const id = await turnPlaylist();
        await updatePlaylist(id, { currentTurnUserId: 'user-who-left' });

        await advanceTurn(id);

        expect((await load(id)).currentTurnUserId).toBe(OWNER_ID);
    });

    it('resets the per-turn quota on every advance', async () => {
        const id = await turnPlaylist({ tracksPerTurn: 3 });
        await addNewTrack(id);
        expect((await load(id)).turnTracksAdded).toBe(1);

        await advanceTurn(id);

        expect((await load(id)).turnTracksAdded).toBe(0);
    });

    it('auto-completes at maxTurns, snapshotting the queue mode', async () => {
        const id = await turnPlaylist({ maxTurns: 2 });

        await advanceTurn(id);
        expect((await load(id)).isComplete).toBe(false);

        await advanceTurn(id);
        const doc = await load(id);
        expect(doc.isComplete).toBe(true);
        expect(doc.completedFromMode).toBe('turn_taking');
        expect(doc.turnsCompleted).toBe(2);
    });

    it('is a no-op on a completed playlist', async () => {
        const id = await turnPlaylist();
        await markPlaylistComplete(id);
        const before = await load(id);

        await advanceTurn(id);

        const after = await load(id);
        expect(after.currentTurnUserId).toBe(before.currentTurnUserId);
        expect(after.turnsCompleted).toBe(before.turnsCompleted);
    });

    it('is a no-op on a non-turn-taking playlist', async () => {
        const doc = await createPlaylist(
            playlistInput({ queueMode: 'free_for_all' }),
        );

        await advanceTurn(doc.id);

        expect((await load(doc.id)).turnsCompleted).toBeUndefined();
    });

    it('is a no-op for an unknown playlist', async () => {
        await expect(advanceTurn('nope')).resolves.toBeUndefined();
    });
});

describe('addTrackToPlaylist — maxDurationMs auto-complete', () => {
    it('completes the playlist once total track duration reaches the cap', async () => {
        const id = await turnPlaylist();
        await setTurnConfig(id, { maxDurationMs: 300000 });

        await addNewTrack(id, 180000);
        expect((await load(id)).isComplete).toBe(false);

        await addNewTrack(id, 120000);

        const doc = await load(id);
        expect(doc.isComplete).toBe(true);
        expect(doc.completedFromMode).toBe('turn_taking');
    });

    it('applies to free-for-all playlists too', async () => {
        const doc = await createPlaylist(
            playlistInput({ queueMode: 'free_for_all' }),
        );
        await setTurnConfig(doc.id, { maxDurationMs: 100000 });

        await addNewTrack(doc.id, 150000);

        const stored = await load(doc.id);
        expect(stored.isComplete).toBe(true);
        expect(stored.completedFromMode).toBe('free_for_all');
    });

    it('leaves the playlist open while under the cap', async () => {
        const id = await turnPlaylist();
        await setTurnConfig(id, { maxDurationMs: 600000 });

        await addNewTrack(id, 180000);

        expect((await load(id)).isComplete).toBe(false);
    });

    it('ignores maxDurationMs passed to createPlaylist', async () => {
        // `createPlaylist` never copies `maxDurationMs` out of its input; the
        // cap is only settable afterwards via `setTurnConfig`/`updatePlaylist`.
        // No caller passes it at creation time, so this is pinned, not fixed.
        const doc = await createPlaylist(
            playlistInput({ queueMode: 'turn_taking', maxDurationMs: 1000 }),
        );

        expect(doc.maxDurationMs).toBeUndefined();

        await addNewTrack(doc.id, 180000);
        expect((await load(doc.id)).isComplete).toBe(false);
    });
});

describe('setTurnOrder', () => {
    it('stores the order', async () => {
        const id = await turnPlaylist();

        await setTurnOrder(id, [USER_C, USER_B, OWNER_ID]);

        expect((await load(id)).turnOrder).toEqual([USER_C, USER_B, OWNER_ID]);
    });

    it('is a no-op for an unknown playlist', async () => {
        await expect(setTurnOrder('nope', [OWNER_ID])).resolves.toBeUndefined();
    });
});

describe('setTurnConfig', () => {
    it('sets each cap independently and leaves omitted keys alone', async () => {
        const id = await turnPlaylist({ tracksPerTurn: 2, maxTurns: 5 });

        await setTurnConfig(id, { maxDurationMs: 900000 });

        const doc = await load(id);
        expect(doc.maxDurationMs).toBe(900000);
        expect(doc.tracksPerTurn).toBe(2);
        expect(doc.maxTurns).toBe(5);
    });

    it('clears maxTurns when passed null', async () => {
        const id = await turnPlaylist({ maxTurns: 5 });

        await setTurnConfig(id, { maxTurns: null });

        expect((await load(id)).maxTurns).toBeUndefined();
    });

    it('clears maxDurationMs when passed null', async () => {
        const id = await turnPlaylist();
        await setTurnConfig(id, { maxDurationMs: 900000 });

        await setTurnConfig(id, { maxDurationMs: null });

        expect((await load(id)).maxDurationMs).toBeUndefined();
    });

    it('updates tracksPerTurn', async () => {
        const id = await turnPlaylist();

        await setTurnConfig(id, { tracksPerTurn: 4 });

        expect((await load(id)).tracksPerTurn).toBe(4);
    });

    it('bumps updatedAt even when no cap is supplied', async () => {
        const id = await turnPlaylist();
        vi.setSystemTime(new Date('2026-03-01T12:30:00.000Z'));

        await setTurnConfig(id, {});

        expect((await load(id)).updatedAt).toBe('2026-03-01T12:30:00.000Z');
    });

    it('is a no-op for an unknown playlist', async () => {
        await expect(
            setTurnConfig('nope', { tracksPerTurn: 2 }),
        ).resolves.toBeUndefined();
    });
});

describe('markPlaylistComplete / reopenPlaylist', () => {
    it('round-trips a turn-taking playlist through completion and back', async () => {
        const id = await turnPlaylist();

        await markPlaylistComplete(id);
        let doc = await load(id);
        expect(doc.isComplete).toBe(true);
        expect(doc.completedFromMode).toBe('turn_taking');

        await reopenPlaylist(id);
        doc = await load(id);
        expect(doc.isComplete).toBe(false);
        expect(doc.queueMode).toBe('turn_taking');
        expect(doc.completedFromMode).toBeUndefined();
    });

    it('restores the snapshotted mode when queueMode drifted while complete', async () => {
        // The snapshot is the whole point: completion freezes the mode the
        // playlist was in, so reopening puts it back even if something wrote a
        // different queueMode in the meantime.
        const id = await turnPlaylist();
        await markPlaylistComplete(id);
        await updatePlaylist(id, { queueMode: 'free_for_all' });

        await reopenPlaylist(id);

        expect((await load(id)).queueMode).toBe('turn_taking');
    });

    it('does nothing when reopening a playlist that is not complete', async () => {
        const id = await turnPlaylist();
        const before = await load(id);

        await reopenPlaylist(id);

        expect((await load(id)).updatedAt).toBe(before.updatedAt);
    });

    it('are no-ops for an unknown playlist', async () => {
        await expect(markPlaylistComplete('nope')).resolves.toBeUndefined();
        await expect(reopenPlaylist('nope')).resolves.toBeUndefined();
    });
});

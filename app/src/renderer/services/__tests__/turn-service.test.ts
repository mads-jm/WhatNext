/**
 * Turn-service tests (#32, residual of N13).
 *
 * `turn-service` is the db-backed read side of turn taking: the UI asks it "is it
 * my turn?" before offering the add-track affordance. Its defaults are
 * deliberately permissive — a missing or non-turn-taking playlist answers *yes* —
 * so these pin exactly how permissive, since anything stricter would lock users
 * out of their own playlists and anything looser would make turns decorative.
 *
 * The db module is mocked (precedent: `db/services/__tests__/track-sink.test.ts`);
 * this asserts the service's branching, not RxDB behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Stand-in for the RxDocument the service reads (only the fields it touches). */
interface StubPlaylist {
    ownerId: string;
    collaboratorIds: string[];
    queueMode?: string;
    currentTurnUserId?: string;
    turnOrder?: string[];
    update: ReturnType<typeof vi.fn>;
}

const findOne = vi.fn();

vi.mock('../../db/database', () => ({
    getDatabase: async () => ({ playlists: { findOne } }),
}));

// Imported after the mock is registered.
import {
    getCurrentTurnUser,
    getTurnOrder,
    initializeTurns,
    isMyTurn,
} from '../turn-service';

const PLAYLIST_ID = 'playlist-1';
const OWNER = 'user-owner';
const COLLAB = 'user-collab';

function makePlaylist(overrides: Partial<StubPlaylist> = {}): StubPlaylist {
    return {
        ownerId: OWNER,
        collaboratorIds: [COLLAB],
        queueMode: 'turn_taking',
        update: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

/** What `db.playlists.findOne(id).exec()` resolves to for the next call. */
function stubFindOne(playlist: StubPlaylist | null): void {
    findOne.mockReturnValue({ exec: async () => playlist });
}

beforeEach(() => {
    findOne.mockReset();
});

describe('isMyTurn', () => {
    it('says yes when the playlist is missing', async () => {
        stubFindOne(null);
        await expect(isMyTurn(PLAYLIST_ID, COLLAB)).resolves.toBe(true);
    });

    it('says yes when the playlist is not in turn_taking mode', async () => {
        stubFindOne(makePlaylist({ queueMode: 'free_for_all' }));
        await expect(isMyTurn(PLAYLIST_ID, COLLAB)).resolves.toBe(true);
    });

    it('says yes when no turn has been assigned yet', async () => {
        stubFindOne(makePlaylist({ currentTurnUserId: undefined }));
        await expect(isMyTurn(PLAYLIST_ID, COLLAB)).resolves.toBe(true);
    });

    it('says yes to the user whose turn it is', async () => {
        stubFindOne(makePlaylist({ currentTurnUserId: COLLAB }));
        await expect(isMyTurn(PLAYLIST_ID, COLLAB)).resolves.toBe(true);
    });

    it('says no to everyone else while a turn is assigned', async () => {
        stubFindOne(makePlaylist({ currentTurnUserId: OWNER }));
        await expect(isMyTurn(PLAYLIST_ID, COLLAB)).resolves.toBe(false);
    });
});

describe('getCurrentTurnUser', () => {
    it('returns null for a missing playlist', async () => {
        stubFindOne(null);
        await expect(getCurrentTurnUser(PLAYLIST_ID)).resolves.toBeNull();
    });

    it('returns the stored turn user', async () => {
        stubFindOne(makePlaylist({ currentTurnUserId: COLLAB }));
        await expect(getCurrentTurnUser(PLAYLIST_ID)).resolves.toBe(COLLAB);
    });

    it('falls back to the owner when no turn is stored', async () => {
        stubFindOne(makePlaylist({ currentTurnUserId: undefined }));
        await expect(getCurrentTurnUser(PLAYLIST_ID)).resolves.toBe(OWNER);
    });
});

describe('getTurnOrder', () => {
    it('returns owner-first, then collaborators', async () => {
        stubFindOne(makePlaylist());
        await expect(getTurnOrder(PLAYLIST_ID)).resolves.toEqual([
            OWNER,
            COLLAB,
        ]);
    });

    it('returns an empty order for a missing playlist', async () => {
        stubFindOne(null);
        await expect(getTurnOrder(PLAYLIST_ID)).resolves.toEqual([]);
    });

    it('ignores an explicit turnOrder — pinned divergence from resolvedTurnOrder', async () => {
        // `utils/turn-helpers.resolvedTurnOrder` and
        // `db/services/playlist-service.advanceTurn` both honour `turnOrder`;
        // this reader does not. Pinned as-is (no behaviour change this cycle);
        // reconciling the three is #43 / debt-inventory material.
        stubFindOne(makePlaylist({ turnOrder: [COLLAB, OWNER] }));
        await expect(getTurnOrder(PLAYLIST_ID)).resolves.toEqual([
            OWNER,
            COLLAB,
        ]);
    });
});

describe('initializeTurns', () => {
    it('seeds the first turn with the owner', async () => {
        const playlist = makePlaylist();
        stubFindOne(playlist);

        await initializeTurns(PLAYLIST_ID);

        expect(playlist.update).toHaveBeenCalledTimes(1);
        const update = playlist.update.mock.calls[0][0] as {
            $set: Record<string, unknown>;
        };
        expect(update.$set.currentTurnUserId).toBe(OWNER);
        expect(typeof update.$set.updatedAt).toBe('string');
    });

    it('no-ops for a playlist that is not turn_taking', async () => {
        const playlist = makePlaylist({ queueMode: 'vote_based' });
        stubFindOne(playlist);

        await initializeTurns(PLAYLIST_ID);

        expect(playlist.update).not.toHaveBeenCalled();
    });

    it('no-ops for a missing playlist', async () => {
        stubFindOne(null);
        await expect(initializeTurns(PLAYLIST_ID)).resolves.toBeUndefined();
    });
});

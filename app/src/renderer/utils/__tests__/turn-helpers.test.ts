/**
 * Turn-derivation tests (#32, residual of N13).
 *
 * `turn-helpers` derives "whose turn is it, really" from the track list rather
 * than trusting the stored counters, so it is the layer every turn-taking view
 * agrees on. These are behaviour pins of the CURRENT logic — quirks included and
 * called out as quirks — not an endorsement of it. Pure functions, no db, no DOM.
 */

import { describe, it, expect } from 'vitest';
import type { PlaylistDocType } from '../../db/schemas';
import {
    computeEffectiveTurn,
    inferTurnTracksAdded,
    resolvedTurnOrder,
} from '../turn-helpers';

const OWNER = 'user-owner';
const COLLAB_A = 'user-a';
const COLLAB_B = 'user-b';

/**
 * Minimal playlist fixture. A builder rather than inline literals so a schema
 * change (`db/schemas.ts` is being tightened in parallel) lands in one place.
 */
function makePlaylist(
    overrides: Partial<PlaylistDocType> = {},
): PlaylistDocType {
    return {
        id: 'playlist-1',
        playlistName: 'Session',
        trackIds: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ownerId: OWNER,
        collaboratorIds: [COLLAB_A, COLLAB_B],
        isCollaborative: true,
        isPublic: false,
        tags: [],
        queueMode: 'turn_taking',
        ...overrides,
    };
}

/** Track list shorthand: `tracksBy(OWNER, COLLAB_A)` is two tracks, in order. */
function tracksBy(...addedBy: string[]): Array<{ addedBy: string }> {
    return addedBy.map((who) => ({ addedBy: who }));
}

describe('inferTurnTracksAdded', () => {
    it('returns 0 with no current turn user or no tracks', () => {
        expect(inferTurnTracksAdded(tracksBy(OWNER), undefined, 2)).toBe(0);
        expect(inferTurnTracksAdded([], OWNER, 2)).toBe(0);
    });

    it('counts only the trailing run belonging to the turn user', () => {
        expect(
            inferTurnTracksAdded(
                tracksBy(COLLAB_A, OWNER, OWNER, OWNER),
                OWNER,
                3,
            ),
        ).toBe(3);
    });

    it('stops at the first foreign addedBy, ignoring earlier tracks of the same user', () => {
        // The user added 2 tracks this "turn" but someone else's track sits
        // between them, so the backwards walk breaks and only sees 1.
        expect(
            inferTurnTracksAdded(tracksBy(OWNER, COLLAB_A, OWNER), OWNER, 3),
        ).toBe(1);
    });

    it('caps the count at tracksPerTurn', () => {
        expect(
            inferTurnTracksAdded(tracksBy(OWNER, OWNER, OWNER), OWNER, 2),
        ).toBe(2);
    });
});

describe('resolvedTurnOrder', () => {
    it('prefers an explicit turnOrder over [ownerId, ...collaboratorIds]', () => {
        const playlist = makePlaylist({ turnOrder: [COLLAB_B, OWNER] });
        expect(resolvedTurnOrder(playlist)).toEqual([COLLAB_B, OWNER]);
    });

    it('falls back to owner-first when turnOrder is unset or empty', () => {
        expect(resolvedTurnOrder(makePlaylist())).toEqual([
            OWNER,
            COLLAB_A,
            COLLAB_B,
        ]);
        expect(resolvedTurnOrder(makePlaylist({ turnOrder: [] }))).toEqual([
            OWNER,
            COLLAB_A,
            COLLAB_B,
        ]);
    });
});

describe('computeEffectiveTurn', () => {
    it('defaults tracksPerTurn to 1, so one track fills the quota and advances', () => {
        const playlist = makePlaylist({ currentTurnUserId: OWNER });

        expect(computeEffectiveTurn(playlist, tracksBy(OWNER))).toEqual({
            effectiveTurnUserId: COLLAB_A,
            // Reset to 0 for the *next* user rather than reported as 1 for the
            // user who just filled the quota.
            turnTracksAdded: 0,
            turnQuotaFull: true,
        });
    });

    it('stays on the current user while the quota is unfilled', () => {
        const playlist = makePlaylist({
            currentTurnUserId: OWNER,
            tracksPerTurn: 2,
        });

        expect(computeEffectiveTurn(playlist, tracksBy(OWNER))).toEqual({
            effectiveTurnUserId: OWNER,
            turnTracksAdded: 1,
            turnQuotaFull: false,
        });
    });

    it('starts at the head of the order when no turn is stored', () => {
        const playlist = makePlaylist({ turnOrder: [COLLAB_B, OWNER] });

        expect(computeEffectiveTurn(playlist, [])).toMatchObject({
            effectiveTurnUserId: COLLAB_B,
            turnQuotaFull: false,
        });
    });

    it('wraps around from the last participant to the first', () => {
        const playlist = makePlaylist({ currentTurnUserId: COLLAB_B });

        expect(
            computeEffectiveTurn(playlist, tracksBy(COLLAB_B)),
        ).toMatchObject({
            effectiveTurnUserId: OWNER,
            turnQuotaFull: true,
        });
    });

    it('freezes advancement once the playlist is complete', () => {
        const playlist = makePlaylist({
            currentTurnUserId: OWNER,
            isComplete: true,
        });

        expect(computeEffectiveTurn(playlist, tracksBy(OWNER))).toEqual({
            effectiveTurnUserId: OWNER,
            // isComplete suppresses turnQuotaFull, so the count survives.
            turnTracksAdded: 1,
            turnQuotaFull: false,
        });
    });

    it('keeps an unknown stored turn user when their quota is unfilled (indexOf === -1)', () => {
        const playlist = makePlaylist({ currentTurnUserId: 'user-departed' });

        // storedTurnIndex is -1, so the effective index is -1 too, `order[-1]`
        // is undefined and the stored (unknown) user is echoed back.
        expect(computeEffectiveTurn(playlist, [])).toEqual({
            effectiveTurnUserId: 'user-departed',
            turnTracksAdded: 0,
            turnQuotaFull: false,
        });
    });

    it('hands the turn to the head of the order when an unknown user fills the quota', () => {
        const playlist = makePlaylist({ currentTurnUserId: 'user-departed' });

        // (-1 + 1) % length === 0 — the departed user's quota rolls to the owner.
        expect(
            computeEffectiveTurn(playlist, tracksBy('user-departed')),
        ).toEqual({
            effectiveTurnUserId: OWNER,
            turnTracksAdded: 0,
            turnQuotaFull: true,
        });
    });
});

describe('concurrent adds mis-attribute the turn — KNOWN BUG, pinned for #43', () => {
    /*
     * This describe pins WRONG behaviour on purpose. Do not "fix" the
     * expectations; fix the race and then update them.
     *
     * The race (map for whoever fixes #43), line numbers as of 2026-08-06:
     *  - Write-path trigger: `renderer/db/services/playlist-service.ts`
     *    `addTrackToPlaylist:136` increments `turnTracksAdded` and calls
     *    `advanceTurn:203` — two peers adding concurrently interleave those
     *    steps, and LWW merges the two track lists without merging the counters.
     *  - Two independent auto-advance effects can each fire on the merged state:
     *    `components/Playlist/TurnManagementPanel.tsx:206-210` and
     *    `components/Session/SessionView.tsx:212-216`.
     *  - The derivation is triplicated: `computeEffectiveTurn` here, an inline
     *    copy in `TurnManagementPanel.tsx:163-189`, and `SessionView.tsx:205-210`
     *    which calls the helper. All three must agree for any fix to hold — and
     *    they do not start from the same order: the panel resolves it through
     *    `resolvedOrder(playlist, participants)` (`TurnManagementPanel.tsx:143`),
     *    the helper through `resolvedTurnOrder(playlist)`.
     *
     * The pins below use the derivation layer only — no db, no components — so
     * they show the *consequence* of the interleaving without touching the
     * racy write path (owned by the parallel db-services cycle).
     */

    it('loses a concurrent add: a foreign trailing track resets the turn user to 0 tracks', () => {
        // Turn is stored as OWNER. OWNER adds a track; COLLAB_A adds one at the
        // same moment (their client thought it was their turn). The merged list
        // ends with COLLAB_A's track, so the backwards walk breaks immediately.
        const playlist = makePlaylist({ currentTurnUserId: OWNER });

        const result = computeEffectiveTurn(
            playlist,
            tracksBy(OWNER, COLLAB_A),
        );

        // WRONG: OWNER already used their turn, but the quota reads as unfilled
        // and the turn stays with OWNER — COLLAB_A's add bought them nothing.
        expect(result).toEqual({
            effectiveTurnUserId: OWNER,
            turnTracksAdded: 0,
            turnQuotaFull: false,
        });
    });

    it('undercounts a split run: an interleaved track hides earlier adds this turn', () => {
        // tracksPerTurn 2, OWNER added two tracks this turn but COLLAB_A's
        // concurrent add landed between them.
        const playlist = makePlaylist({
            currentTurnUserId: OWNER,
            tracksPerTurn: 2,
        });

        const result = computeEffectiveTurn(
            playlist,
            tracksBy(OWNER, COLLAB_A, OWNER),
        );

        // WRONG: OWNER has added 2 of 2 this turn; the derivation sees 1 and
        // grants them a third add.
        expect(result).toEqual({
            effectiveTurnUserId: OWNER,
            turnTracksAdded: 1,
            turnQuotaFull: false,
        });
    });
});

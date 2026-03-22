/**
 * Turn-Taking Helpers
 * Shared logic for deriving turn state from the actual track list,
 * rather than relying solely on stored counters which can drift.
 */

import type { PlaylistDocType } from '../db/schemas';

interface TrackWithAddedBy {
    addedBy: string;
}

/**
 * Derive how many tracks the current turn user has added this turn by walking
 * backwards through the track list and counting their consecutive trailing additions,
 * up to tracksPerTurn. This is resilient to stored counter drift.
 */
export function inferTurnTracksAdded(
    tracks: TrackWithAddedBy[],
    currentTurnUserId: string | undefined,
    tracksPerTurn: number
): number {
    if (!currentTurnUserId || tracks.length === 0) return 0;
    let count = 0;
    for (let i = tracks.length - 1; i >= 0 && count < tracksPerTurn; i--) {
        if (tracks[i].addedBy === currentTurnUserId) count++;
        else break;
    }
    return count;
}

/**
 * Get the resolved turn order for a playlist.
 * Uses explicit turnOrder if set, otherwise falls back to [ownerId, ...collaboratorIds].
 */
export function resolvedTurnOrder(playlist: PlaylistDocType): string[] {
    if (playlist.turnOrder?.length) return playlist.turnOrder;
    return [playlist.ownerId, ...playlist.collaboratorIds];
}

/**
 * Compute the effective turn state by examining the actual tracks in the playlist.
 * Returns who really has the current turn and whether the quota is full.
 */
export function computeEffectiveTurn(
    playlist: PlaylistDocType,
    tracks: TrackWithAddedBy[]
): {
    effectiveTurnUserId: string | undefined;
    turnTracksAdded: number;
    turnQuotaFull: boolean;
} {
    const tracksPerTurn = playlist.tracksPerTurn ?? 1;
    const isComplete = playlist.isComplete ?? false;
    const order = resolvedTurnOrder(playlist);
    const storedTurnUserId = playlist.currentTurnUserId ?? order[0];
    const storedTurnIndex = order.indexOf(storedTurnUserId);

    const turnTracksAdded = inferTurnTracksAdded(tracks, storedTurnUserId, tracksPerTurn);
    const turnQuotaFull = !isComplete && turnTracksAdded >= tracksPerTurn;

    const effectiveTurnIndex = turnQuotaFull
        ? (storedTurnIndex + 1) % order.length
        : storedTurnIndex;
    const effectiveTurnUserId = order[effectiveTurnIndex] ?? storedTurnUserId;

    return { effectiveTurnUserId, turnTracksAdded: turnQuotaFull ? 0 : turnTracksAdded, turnQuotaFull };
}

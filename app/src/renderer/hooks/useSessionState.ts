/**
 * useSessionState — derives turn-taking state from a playlist document + user ID.
 * Extracted from SessionView for clarity.
 */

import type { PlaylistDocType } from '../db/schemas';

export function useSessionState(playlist: PlaylistDocType | null, userId: string) {
    const isTurnTaking = playlist?.queueMode === 'turn_taking';
    const isMyTurn = isTurnTaking && (playlist.currentTurnUserId === userId || !playlist.currentTurnUserId);
    const currentTurnUser = playlist?.currentTurnUserId || userId;

    return { isTurnTaking, isMyTurn, currentTurnUser };
}

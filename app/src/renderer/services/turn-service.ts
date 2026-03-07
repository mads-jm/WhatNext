/**
 * Turn-Taking Service
 * Manages turn state for collaborative playlists with turn_taking queue mode.
 */

import { getDatabase } from '../db/database';

/**
 * Check if it's the local user's turn
 */
export async function isMyTurn(playlistId: string, localUserId: string): Promise<boolean> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist || playlist.queueMode !== 'turn_taking') return true;
    return playlist.currentTurnUserId === localUserId || !playlist.currentTurnUserId;
}

/**
 * Get current turn user ID for a playlist
 */
export async function getCurrentTurnUser(playlistId: string): Promise<string | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist) return null;
    return playlist.currentTurnUserId || playlist.ownerId;
}

/**
 * Get the ordered list of collaborators for turn rotation
 */
export async function getTurnOrder(playlistId: string): Promise<string[]> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist) return [];
    return [playlist.ownerId, ...playlist.collaboratorIds];
}

/**
 * Initialize turn state for a new collaborative playlist
 */
export async function initializeTurns(playlistId: string): Promise<void> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist || playlist.queueMode !== 'turn_taking') return;

    await playlist.update({
        $set: {
            currentTurnUserId: playlist.ownerId,
            updatedAt: new Date().toISOString(),
        },
    });
}

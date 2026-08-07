/**
 * Playlist CRUD Service
 * Issue #6: Implement Basic Local Playlist & Track CRUD
 *
 * Provides clean API for playlist operations
 */

import { getDatabase } from '../database';
import type { PlaylistDocType, PlaylistDocument } from '../schemas';
import type {
    CreatePlaylistInput,
    UpdatePlaylistInput,
    PlaylistWithTracks,
} from '../types';
import { findTracksByIds } from '../query-helpers';
import { v4 as uuidv4 } from 'uuid';

// Re-export for consumers that imported from here
export type { CreatePlaylistInput, UpdatePlaylistInput };

/**
 * Create a new playlist
 */
export async function createPlaylist(
    input: CreatePlaylistInput,
): Promise<PlaylistDocument> {
    const db = await getDatabase();

    const now = new Date().toISOString();
    const isTurnTaking = input.queueMode === 'turn_taking';
    const playlist: PlaylistDocType = {
        id: uuidv4(),
        playlistName: input.playlistName,
        description: input.description,
        trackIds: [],
        createdAt: now,
        updatedAt: now,
        ownerId: input.ownerId,
        collaboratorIds: input.collaboratorIds || [],
        isCollaborative: input.isCollaborative ?? false,
        isPublic: input.isPublic ?? false,
        linkedSpotifyId: input.linkedSpotifyId,
        spotifySyncMode: input.spotifySyncMode,
        tags: input.tags || [],
        queueMode: input.queueMode,
        currentTurnUserId: isTurnTaking ? input.ownerId : undefined,
        turnOrder: isTurnTaking ? (input.turnOrder ?? undefined) : undefined,
        tracksPerTurn: isTurnTaking ? (input.tracksPerTurn ?? 1) : undefined,
        turnTracksAdded: isTurnTaking ? 0 : undefined,
        maxTurns: isTurnTaking ? input.maxTurns : undefined,
        turnsCompleted: isTurnTaking ? 0 : undefined,
        isComplete: false,
        coverArtUrl: input.coverArtUrl,
    };

    return db.playlists.insert(playlist);
}

/**
 * Get a playlist by ID
 */
export async function getPlaylist(
    id: string,
): Promise<PlaylistDocument | null> {
    const db = await getDatabase();
    return db.playlists.findOne(id).exec();
}

/**
 * Get all playlists
 * Returns reactive observable - subscribe to get updates
 */
export async function getAllPlaylists() {
    const db = await getDatabase();
    return db.playlists.find().sort({ updatedAt: 'desc' });
}

/**
 * Search playlists by name or tags
 */
export async function searchPlaylists(query: string) {
    const db = await getDatabase();

    // Using $regex with string pattern for RxDB compatibility
    return db.playlists.find({
        selector: {
            playlistName: {
                $regex: `.*${query}.*`,
            },
        },
    });
}

/**
 * Update playlist metadata
 */
export async function updatePlaylist(
    id: string,
    updates: UpdatePlaylistInput,
): Promise<PlaylistDocument | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(id).exec();

    if (!playlist) {
        return null;
    }

    await playlist.update({
        $set: {
            ...updates,
            updatedAt: new Date().toISOString(),
        },
    });

    return playlist;
}

/**
 * Delete a playlist
 */
export async function deletePlaylist(id: string): Promise<boolean> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(id).exec();

    if (!playlist) {
        return false;
    }

    await playlist.remove();
    return true;
}

/**
 * Add track to playlist
 */
export async function addTrackToPlaylist(
    playlistId: string,
    trackId: string,
): Promise<PlaylistDocument | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();

    if (!playlist) {
        return null;
    }

    // Avoid duplicates
    if (playlist.trackIds.includes(trackId)) {
        return playlist;
    }

    const isTurnTaking =
        playlist.queueMode === 'turn_taking' && !playlist.isComplete;
    const tracksPerTurn = playlist.tracksPerTurn ?? 1;
    const turnTracksAdded = (playlist.turnTracksAdded ?? 0) + 1;
    const turnFull = isTurnTaking && turnTracksAdded >= tracksPerTurn;

    await playlist.update({
        $set: {
            trackIds: [...playlist.trackIds, trackId],
            updatedAt: new Date().toISOString(),
            ...(isTurnTaking && {
                turnTracksAdded: turnFull ? 0 : turnTracksAdded,
            }),
        },
    });

    if (turnFull) {
        await advanceTurn(playlistId);
    }

    // Check duration limit (after adding; re-fetch updated playlist for current trackIds)
    const maxDurationMs = playlist.maxDurationMs;
    if (maxDurationMs !== undefined) {
        const updated = await db.playlists.findOne(playlistId).exec();
        if (updated && !updated.isComplete) {
            const trackDocs = await db.tracks
                .findByIds(updated.trackIds)
                .exec();
            const totalMs = Array.from(trackDocs.values()).reduce(
                (sum, t) => sum + t.durationMs,
                0,
            );
            if (totalMs >= maxDurationMs) {
                await updated.update({
                    $set: {
                        isComplete: true,
                        completedFromMode: updated.queueMode,
                        updatedAt: new Date().toISOString(),
                    },
                });
            }
        }
    }

    return playlist;
}

/**
 * Advance turn to the next participant.
 * Respects explicit turnOrder; increments turnsCompleted; auto-completes at maxTurns.
 */
export async function advanceTurn(playlistId: string): Promise<void> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (
        !playlist ||
        playlist.queueMode !== 'turn_taking' ||
        playlist.isComplete
    )
        return;

    const order = playlist.turnOrder?.length
        ? playlist.turnOrder
        : [playlist.ownerId, ...playlist.collaboratorIds];

    const currentIndex = order.indexOf(playlist.currentTurnUserId || order[0]);
    const nextIndex = (currentIndex + 1) % order.length;
    const turnsCompleted = (playlist.turnsCompleted ?? 0) + 1;
    const maxTurns = playlist.maxTurns;
    const autoComplete = maxTurns !== undefined && turnsCompleted >= maxTurns;

    await playlist.update({
        $set: {
            currentTurnUserId: order[nextIndex],
            turnsCompleted,
            turnTracksAdded: 0,
            updatedAt: new Date().toISOString(),
            ...(autoComplete && {
                isComplete: true,
                completedFromMode: playlist.queueMode,
            }),
        },
    });
}

/**
 * Update the explicit turn order for a playlist.
 */
export async function setTurnOrder(
    playlistId: string,
    order: string[],
): Promise<void> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist) return;

    await playlist.update({
        $set: { turnOrder: order, updatedAt: new Date().toISOString() },
    });
}

/**
 * Configure tracks-per-turn, max-turns cap, and/or max-duration cap.
 * Pass null to remove a cap.
 */
export async function setTurnConfig(
    playlistId: string,
    config: {
        tracksPerTurn?: number;
        maxTurns?: number | null;
        maxDurationMs?: number | null;
    },
): Promise<void> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist) return;

    const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
    };
    if (config.tracksPerTurn !== undefined)
        updates.tracksPerTurn = config.tracksPerTurn;
    if (config.maxTurns !== undefined)
        updates.maxTurns = config.maxTurns ?? undefined;
    if (config.maxDurationMs !== undefined)
        updates.maxDurationMs = config.maxDurationMs ?? undefined;

    await playlist.update({ $set: updates });
}

/**
 * Mark a collaborative playlist as complete, freezing turn-taking.
 * Snapshots the current queueMode into completedFromMode so reopen can restore it.
 */
export async function markPlaylistComplete(playlistId: string): Promise<void> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist) return;

    await playlist.update({
        $set: {
            isComplete: true,
            completedFromMode: playlist.queueMode,
            updatedAt: new Date().toISOString(),
        },
    });
}

/**
 * Reopen a completed playlist, restoring it to its previous active mode.
 */
export async function reopenPlaylist(playlistId: string): Promise<void> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist || !playlist.isComplete) return;

    await playlist.update({
        $set: {
            isComplete: false,
            queueMode: playlist.completedFromMode ?? playlist.queueMode,
            completedFromMode: undefined,
            updatedAt: new Date().toISOString(),
        },
    });
}

/**
 * Remove track from playlist
 */
export async function removeTrackFromPlaylist(
    playlistId: string,
    trackId: string,
): Promise<PlaylistDocument | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();

    if (!playlist) {
        return null;
    }

    await playlist.update({
        $set: {
            trackIds: playlist.trackIds.filter((id: string) => id !== trackId),
            updatedAt: new Date().toISOString(),
        },
    });

    return playlist;
}

/**
 * Reorder tracks in playlist
 */
export async function reorderPlaylistTracks(
    playlistId: string,
    newOrder: string[],
): Promise<PlaylistDocument | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();

    if (!playlist) {
        return null;
    }

    // Validate that all tracks exist in the playlist
    const validTracks = newOrder.filter((trackId) =>
        playlist.trackIds.includes(trackId),
    );

    await playlist.update({
        $set: {
            trackIds: validTracks,
            updatedAt: new Date().toISOString(),
        },
    });

    return playlist;
}

/**
 * Add multiple tracks to playlist
 */
export async function bulkAddTracksToPlaylist(
    playlistId: string,
    trackIds: string[],
): Promise<PlaylistDocument | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();

    if (!playlist) {
        return null;
    }

    // Filter out duplicates
    const newTrackIds = trackIds.filter(
        (id) => !playlist.trackIds.includes(id),
    );

    await playlist.update({
        $set: {
            trackIds: [...playlist.trackIds, ...newTrackIds],
            updatedAt: new Date().toISOString(),
        },
    });

    return playlist;
}

/**
 * Clear all tracks from playlist
 */
export async function clearPlaylist(
    playlistId: string,
): Promise<PlaylistDocument | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();

    if (!playlist) {
        return null;
    }

    await playlist.update({
        $set: {
            trackIds: [],
            updatedAt: new Date().toISOString(),
        },
    });

    return playlist;
}

/**
 * Get playlist with populated track data
 */
export async function getPlaylistWithTracks(
    playlistId: string,
): Promise<PlaylistWithTracks | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();

    if (!playlist) {
        return null;
    }

    const tracks = await findTracksByIds(db, playlist.trackIds);

    return {
        playlist,
        tracks,
    };
}

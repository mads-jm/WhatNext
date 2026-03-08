/**
 * Playlist CRUD Service
 * Issue #6: Implement Basic Local Playlist & Track CRUD
 *
 * Provides clean API for playlist operations
 */

import { getDatabase } from '../database';
import type { PlaylistDocType, PlaylistDocument } from '../schemas';
import type { CreatePlaylistInput, UpdatePlaylistInput, PlaylistWithTracks } from '../types';
import { findTracksByIds } from '../query-helpers';
import { v4 as uuidv4 } from 'uuid';

// Re-export for consumers that imported from here
export type { CreatePlaylistInput, UpdatePlaylistInput };

/**
 * Create a new playlist
 */
export async function createPlaylist(
    input: CreatePlaylistInput
): Promise<PlaylistDocument> {
    const db = await getDatabase();

    const now = new Date().toISOString();
    const playlist: PlaylistDocType = {
        id: uuidv4(),
        playlistName: input.playlistName,
        description: input.description,
        trackIds: [],
        createdAt: now,
        updatedAt: now,
        ownerId: input.ownerId!,
        collaboratorIds: input.collaboratorIds || [],
        isCollaborative: input.isCollaborative ?? false,
        isPublic: input.isPublic ?? false,
        linkedSpotifyId: input.linkedSpotifyId,
        spotifySyncMode: input.spotifySyncMode,
        tags: input.tags || [],
        queueMode: input.queueMode,
        currentTurnUserId: input.queueMode === 'turn_taking' ? input.ownerId : undefined,
        coverArtUrl: input.coverArtUrl,
    };

    return db.playlists.insert(playlist);
}

/**
 * Get a playlist by ID
 */
export async function getPlaylist(
    id: string
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
    updates: UpdatePlaylistInput
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
    trackId: string
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

    await playlist.update({
        $set: {
            trackIds: [...playlist.trackIds, trackId],
            updatedAt: new Date().toISOString(),
        },
    });

    // Auto-advance turn for turn_taking playlists
    const updated = await db.playlists.findOne(playlistId).exec();
    if (updated && updated.queueMode === 'turn_taking') {
        await advanceTurn(playlistId);
    }

    return playlist;
}

/**
 * Advance turn to next collaborator after a track is added
 */
export async function advanceTurn(playlistId: string): Promise<void> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();
    if (!playlist || playlist.queueMode !== 'turn_taking') return;

    const allUsers = [playlist.ownerId, ...playlist.collaboratorIds];
    const currentIndex = allUsers.indexOf(playlist.currentTurnUserId || allUsers[0]);
    const nextIndex = (currentIndex + 1) % allUsers.length;

    await playlist.update({
        $set: {
            currentTurnUserId: allUsers[nextIndex],
            updatedAt: new Date().toISOString(),
        },
    });
}

/**
 * Remove track from playlist
 */
export async function removeTrackFromPlaylist(
    playlistId: string,
    trackId: string
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
    newOrder: string[]
): Promise<PlaylistDocument | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();

    if (!playlist) {
        return null;
    }

    // Validate that all tracks exist in the playlist
    const validTracks = newOrder.filter((trackId) =>
        playlist.trackIds.includes(trackId)
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
    trackIds: string[]
): Promise<PlaylistDocument | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();

    if (!playlist) {
        return null;
    }

    // Filter out duplicates
    const newTrackIds = trackIds.filter(
        (id) => !playlist.trackIds.includes(id)
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
    playlistId: string
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
export async function getPlaylistWithTracks(playlistId: string): Promise<PlaylistWithTracks | null> {
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

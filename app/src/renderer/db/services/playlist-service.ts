/**
 * Playlist CRUD Service
 * Issue #6: Implement Basic Local Playlist & Track CRUD
 *
 * Provides clean API for playlist operations
 */

import { getDatabase } from '../database';
import type { PlaylistDocType, PlaylistDocument } from '../schemas';
import { v4 as uuidv4 } from 'uuid';

export interface CreatePlaylistInput {
    playlistName: string;
    description?: string;
    tags?: string[];
    linkedSpotifyId?: string;
}

export interface UpdatePlaylistInput {
    playlistName?: string;
    description?: string;
    tags?: string[];
    linkedSpotifyId?: string;
}

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
        linkedSpotifyId: input.linkedSpotifyId,
        tags: input.tags || [],
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

    return playlist;
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
            trackIds: playlist.trackIds.filter((id) => id !== trackId),
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
export async function getPlaylistWithTracks(playlistId: string): Promise<{
    playlist: PlaylistDocument;
    tracks: any[]; // Will be TrackDocument[] once we implement population
} | null> {
    const db = await getDatabase();
    const playlist = await db.playlists.findOne(playlistId).exec();

    if (!playlist) {
        return null;
    }

    // Get track documents by IDs
    const trackMap = await db.tracks.findByIds(playlist.trackIds).exec();
    const tracks = playlist.trackIds
        .map((id) => trackMap.get(id))
        .filter((track) => track !== undefined);

    return {
        playlist,
        tracks,
    };
}

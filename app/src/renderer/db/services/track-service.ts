/**
 * Track CRUD Service
 * Issue #6: Implement Basic Local Playlist & Track CRUD
 *
 * Provides clean API for track operations
 */

import { getDatabase } from '../database';
import type { TrackDocType, TrackDocument } from '../schemas';
import { v4 as uuidv4 } from 'uuid';

export interface CreateTrackInput {
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    spotifyId?: string;
    notes?: string;
}

export interface UpdateTrackInput {
    title?: string;
    artists?: string[];
    album?: string;
    durationMs?: number;
    spotifyId?: string;
    notes?: string;
}

/**
 * Create a new track
 */
export async function createTrack(
    input: CreateTrackInput
): Promise<TrackDocument> {
    const db = await getDatabase();

    const track: TrackDocType = {
        id: uuidv4(),
        ...input,
        addedAt: new Date().toISOString(),
    };

    return db.tracks.insert(track);
}

/**
 * Get a track by ID
 */
export async function getTrack(id: string): Promise<TrackDocument | null> {
    const db = await getDatabase();
    return db.tracks.findOne(id).exec();
}

/**
 * Get all tracks
 * Returns reactive observable - subscribe to get updates
 */
export async function getAllTracks() {
    const db = await getDatabase();
    return db.tracks.find().sort({ addedAt: 'desc' });
}

/**
 * Search tracks by title or artist
 */
export async function searchTracks(query: string) {
    const db = await getDatabase();

    // Note: For production, consider adding full-text search index
    // Using $regex with string pattern for RxDB compatibility
    return db.tracks.find({
        selector: {
            $or: [
                {
                    title: {
                        $regex: `.*${query}.*`,
                    },
                },
            ],
        },
    });
}

/**
 * Update a track
 */
export async function updateTrack(
    id: string,
    updates: UpdateTrackInput
): Promise<TrackDocument | null> {
    const db = await getDatabase();
    const track = await db.tracks.findOne(id).exec();

    if (!track) {
        return null;
    }

    await track.update({
        $set: updates,
    });

    return track;
}

/**
 * Delete a track
 */
export async function deleteTrack(id: string): Promise<boolean> {
    const db = await getDatabase();
    const track = await db.tracks.findOne(id).exec();

    if (!track) {
        return false;
    }

    await track.remove();
    return true;
}

/**
 * Get tracks by IDs (for playlist display)
 */
export async function getTracksByIds(
    ids: string[]
): Promise<TrackDocument[]> {
    const db = await getDatabase();
    return db.tracks
        .findByIds(ids)
        .exec()
        .then((map) => Array.from(map.values()));
}

/**
 * Bulk import tracks
 */
export async function bulkImportTracks(
    tracks: CreateTrackInput[]
): Promise<void> {
    const db = await getDatabase();

    const trackDocs: TrackDocType[] = tracks.map((track) => ({
        id: uuidv4(),
        ...track,
        addedAt: new Date().toISOString(),
    }));

    await db.tracks.bulkInsert(trackDocs);
}

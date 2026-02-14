/**
 * Typed RxDB Query Helpers
 *
 * Eliminates `any` at every findByIds call site by providing
 * typed wrappers with proper Map handling.
 */

import type { WhatNextDatabase, TrackDocument } from './schemas';
import type { TrackViewModel } from './types';

/**
 * Fetch tracks by IDs, preserving order of input IDs.
 * Filters out any IDs not found in the database.
 */
export async function findTracksByIds(
    db: WhatNextDatabase,
    ids: string[]
): Promise<TrackDocument[]> {
    const map: Map<string, TrackDocument> = await db.tracks.findByIds(ids).exec();
    return ids
        .map((id) => map.get(id))
        .filter((doc): doc is TrackDocument => doc !== undefined);
}

/**
 * Fetch tracks by IDs and map to flat view models for UI rendering.
 * Preserves order of input IDs.
 */
export async function findTrackViewModels(
    db: WhatNextDatabase,
    ids: string[]
): Promise<TrackViewModel[]> {
    const docs = await findTracksByIds(db, ids);
    return docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        artists: doc.artists,
        album: doc.album,
        addedBy: doc.addedBy,
        durationMs: doc.durationMs,
    }));
}

/**
 * Reaction Service
 * Manages emoji reactions on tracks within playlists.
 * Reactions are stored as TrackInteractions with type 'reaction'.
 */

import { getDatabase } from '../database';
import type {
    TrackInteractionDocType,
    TrackInteractionDocument,
} from '../schemas';
import type { ReplicationSink } from '../../../shared/core/types';
import type { ReactionEmoji } from '../../../shared/core/reactions';

// Re-export so barrel (services/index.ts) consumers don't break
export {
    ALLOWED_REACTIONS,
    REACTION_DISPLAY,
    type ReactionEmoji,
} from '../../../shared/core/reactions';

function reactionId(
    userId: string,
    trackId: string,
    emoji: ReactionEmoji,
): string {
    return `${userId}_${trackId}_reaction_${emoji}`;
}

/**
 * Toggle a reaction on a track. Idempotent: calling twice removes the reaction.
 */
export async function toggleReaction(
    userId: string,
    trackId: string,
    playlistId: string,
    emoji: ReactionEmoji,
    replicationSink?: ReplicationSink,
): Promise<TrackInteractionDocument> {
    const db = await getDatabase();
    const id = reactionId(userId, trackId, emoji);
    const existing = await db.trackInteractions.findOne(id).exec();
    const now = new Date().toISOString();

    if (existing) {
        const newValue = existing.value === 1 ? 0 : 1;
        await existing.update({
            $set: {
                value: newValue,
                updatedAt: now,
            },
        });

        await replicationSink?.('trackInteractions', [
            {
                id,
                data: { ...existing.toJSON(), value: newValue, updatedAt: now },
                updatedAt: now,
            },
        ]);

        return existing;
    }

    const reaction: TrackInteractionDocType = {
        id,
        userId,
        trackId,
        playlistId,
        interactionType: 'reaction',
        value: 1,
        createdAt: now,
        updatedAt: now,
        metadata: JSON.stringify({ emoji }),
    };
    const doc = await db.trackInteractions.insert(reaction);

    await replicationSink?.('trackInteractions', [
        {
            id,
            data: reaction as unknown as Record<string, unknown>,
            updatedAt: now,
        },
    ]);

    return doc;
}

/**
 * Get all reactions for a specific track (reactive query).
 */
export async function getTrackReactions(trackId: string) {
    const db = await getDatabase();
    return db.trackInteractions.find({
        selector: {
            trackId,
            interactionType: 'reaction',
        },
    });
}

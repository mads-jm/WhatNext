/**
 * Reaction Service
 * Manages emoji reactions on tracks within playlists.
 * Reactions are stored as TrackInteractions with type 'reaction'.
 */

import { getDatabase } from '../database';
import type { TrackInteractionDocType, TrackInteractionDocument } from '../schemas';
import { pushLocalChanges } from '../replication-handler';

export const ALLOWED_REACTIONS = ['fire', 'heart', 'thumbsdown', 'mindblown', 'sleeping', 'party'] as const;
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];

export const REACTION_DISPLAY: Record<ReactionEmoji, string> = {
    fire: '\uD83D\uDD25',
    heart: '\u2764\uFE0F',
    thumbsdown: '\uD83D\uDC4E',
    mindblown: '\uD83E\uDD2F',
    sleeping: '\uD83D\uDE34',
    party: '\uD83C\uDF89',
};

function reactionId(userId: string, trackId: string, emoji: ReactionEmoji): string {
    return `${userId}_${trackId}_reaction_${emoji}`;
}

/**
 * Toggle a reaction on a track. Idempotent: calling twice removes the reaction.
 */
export async function toggleReaction(
    userId: string,
    trackId: string,
    playlistId: string,
    emoji: ReactionEmoji
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

        await pushLocalChanges('trackInteractions', [{
            id,
            data: { ...existing.toJSON(), value: newValue, updatedAt: now },
            updatedAt: now,
        }]);

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

    await pushLocalChanges('trackInteractions', [{
        id,
        data: reaction as unknown as Record<string, unknown>,
        updatedAt: now,
    }]);

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

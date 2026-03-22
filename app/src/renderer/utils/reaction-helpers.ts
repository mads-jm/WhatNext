/**
 * Reaction Aggregation
 * Aggregates raw reaction documents into per-emoji summary counts.
 * Pure function — no React, no RxDB, no I/O.
 */

import { ALLOWED_REACTIONS, type ReactionEmoji } from '../../shared/core/reactions';

export interface ReactionSummary {
    count: number;
    userReacted: boolean;
}

interface ReactionDoc {
    value?: number;
    metadata?: string;
    userId: string;
}

/**
 * Aggregate raw reaction documents into a per-emoji summary map.
 */
export function aggregateReactions(
    docs: ReactionDoc[],
    currentUserId: string,
): Map<ReactionEmoji, ReactionSummary> {
    const map = new Map<ReactionEmoji, ReactionSummary>();

    for (const emoji of ALLOWED_REACTIONS) {
        map.set(emoji, { count: 0, userReacted: false });
    }

    for (const doc of docs) {
        if (doc.value !== 1) continue;

        let emoji: ReactionEmoji | undefined;
        try {
            const parsed = JSON.parse(doc.metadata || '{}');
            emoji = parsed.emoji as ReactionEmoji;
        } catch {
            continue;
        }

        if (!emoji || !map.has(emoji)) continue;

        const entry = map.get(emoji)!;
        entry.count += 1;
        if (doc.userId === currentUserId) {
            entry.userReacted = true;
        }
    }

    return map;
}

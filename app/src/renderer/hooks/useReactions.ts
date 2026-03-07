/**
 * Reactive hook for track reactions.
 * Subscribes to RxDB and aggregates reaction counts per emoji.
 */

import { useState, useEffect } from 'react';
import { useDatabase } from './useDatabase';
import type { TrackInteractionDocType } from '../db/schemas';
import {
    ALLOWED_REACTIONS,
    type ReactionEmoji,
} from '../db/services/reaction-service';

export interface ReactionSummary {
    count: number;
    userReacted: boolean;
}

export function useReactions(
    trackId: string | undefined,
    userId: string
): { reactions: Map<ReactionEmoji, ReactionSummary>; loading: boolean } {
    const { db } = useDatabase();
    const [reactions, setReactions] = useState<Map<ReactionEmoji, ReactionSummary>>(new Map());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!db || !trackId) {
            setLoading(false);
            return;
        }

        const query = db.trackInteractions.find({
            selector: {
                trackId,
                interactionType: 'reaction',
            },
        });

        const subscription = query.$.subscribe({
            next: (docs) => {
                const map = new Map<ReactionEmoji, ReactionSummary>();

                for (const emoji of ALLOWED_REACTIONS) {
                    map.set(emoji, { count: 0, userReacted: false });
                }

                for (const doc of docs) {
                    const data = doc as unknown as TrackInteractionDocType;
                    if (data.value !== 1) continue;

                    let emoji: ReactionEmoji | undefined;
                    try {
                        const parsed = JSON.parse(data.metadata || '{}');
                        emoji = parsed.emoji as ReactionEmoji;
                    } catch {
                        continue;
                    }

                    if (!emoji || !map.has(emoji)) continue;

                    const entry = map.get(emoji)!;
                    entry.count += 1;
                    if (data.userId === userId) {
                        entry.userReacted = true;
                    }
                }

                setReactions(map);
                setLoading(false);
            },
            error: () => {
                setLoading(false);
            },
        });

        return () => subscription.unsubscribe();
    }, [db, trackId, userId]);

    return { reactions, loading };
}

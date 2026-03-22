/**
 * Reactive hook for track reactions.
 * Subscribes to RxDB and aggregates reaction counts per emoji.
 */

import { useState, useEffect } from 'react';
import { useDatabase } from './useDatabase';
import type { TrackInteractionDocType } from '../db/schemas';
import type { ReactionEmoji } from '../../shared/core/reactions';
import { aggregateReactions, type ReactionSummary } from '../utils/reaction-helpers';

export type { ReactionSummary };

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
                const data = docs.map((d) => d as unknown as TrackInteractionDocType);
                setReactions(aggregateReactions(data, userId));
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

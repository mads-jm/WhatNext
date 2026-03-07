/**
 * Reactive hook for comments on a playlist or track.
 * Subscribes to RxDB and separates top-level comments from replies.
 */

import { useState, useEffect, useMemo } from 'react';
import { useDatabase } from './useDatabase';
import type { CommentDocType } from '../db/schemas';
import type { RxDocument } from 'rxdb';

export interface CommentWithReplies {
    comment: CommentDocType;
    replies: CommentDocType[];
}

export function useComments(
    playlistId: string | undefined,
    trackId?: string
): { comments: CommentWithReplies[]; loading: boolean } {
    const { db } = useDatabase();
    const [allComments, setAllComments] = useState<CommentDocType[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!db || !playlistId) {
            setLoading(false);
            return;
        }

        const query = db.comments.find({
            selector: {
                playlistId,
                isDeleted: false,
            },
            sort: [{ createdAt: 'asc' }],
        });

        const subscription = query.$.subscribe({
            next: (docs: RxDocument<CommentDocType>[]) => {
                const plain = docs.map((d) => d.toJSON() as CommentDocType);
                setAllComments(plain);
                setLoading(false);
            },
            error: () => {
                setLoading(false);
            },
        });

        return () => subscription.unsubscribe();
    }, [db, playlistId]);

    const comments = useMemo(() => {
        // Filter by trackId context
        const filtered = allComments.filter((c) => {
            if (trackId !== undefined) {
                return c.trackId === trackId;
            }
            // Playlist-level comments: no trackId
            return !c.trackId;
        });

        // Separate top-level from replies
        const topLevel = filtered.filter((c) => !c.parentId);
        const replyMap = new Map<string, CommentDocType[]>();

        for (const c of filtered) {
            if (c.parentId) {
                const existing = replyMap.get(c.parentId) || [];
                existing.push(c);
                replyMap.set(c.parentId, existing);
            }
        }

        return topLevel.map((comment) => ({
            comment,
            replies: replyMap.get(comment.id) || [],
        }));
    }, [allComments, trackId]);

    return { comments, loading };
}

/**
 * Reactive hook for comments on a playlist or track.
 * Subscribes to RxDB and separates top-level comments from replies.
 */

import { useState, useEffect, useMemo } from 'react';
import { useDatabase } from './useDatabase';
import type { CommentDocType } from '../db/schemas';
import type { RxDocument } from 'rxdb';
import { buildCommentTree, type CommentWithReplies } from '../utils/comment-helpers';

export type { CommentWithReplies };

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

    const comments = useMemo(
        () => buildCommentTree(allComments, trackId),
        [allComments, trackId],
    );

    return { comments, loading };
}

/**
 * Comment Tree Building
 * Groups flat comment lists into threaded structures.
 * Pure function — no React, no RxDB, no I/O.
 */

import type { CommentDocType } from '../db/schemas';

export interface CommentWithReplies {
    comment: CommentDocType;
    replies: CommentDocType[];
}

/**
 * Build a threaded comment tree from a flat list.
 * Filters by trackId context: pass a trackId for track-level comments,
 * or undefined for playlist-level comments (those without a trackId).
 */
export function buildCommentTree(
    allComments: CommentDocType[],
    trackId?: string,
): CommentWithReplies[] {
    const filtered = allComments.filter((c) => {
        if (trackId !== undefined) {
            return c.trackId === trackId;
        }
        return !c.trackId;
    });

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
}

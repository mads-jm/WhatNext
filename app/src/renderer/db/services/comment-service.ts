/**
 * Comment Service
 * CRUD operations for comments on playlists and tracks.
 * Uses soft delete for P2P tombstoning.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';
import type { CommentDocType, CommentDocument } from '../schemas';
import type { ReplicationSink } from '../../../shared/core/types';

export interface CreateCommentInput {
    playlistId: string;
    trackId?: string;
    userId: string;
    userDisplayName: string;
    userAvatarUrl?: string;
    body: string;
    parentId?: string;
}

export interface UpdateCommentInput {
    body: string;
}

/**
 * Create a new comment and push to peers.
 */
export async function createComment(
    input: CreateCommentInput,
    replicationSink?: ReplicationSink,
): Promise<CommentDocument> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const comment: CommentDocType = {
        id: uuidv4(),
        playlistId: input.playlistId,
        trackId: input.trackId,
        userId: input.userId,
        userDisplayName: input.userDisplayName,
        userAvatarUrl: input.userAvatarUrl,
        body: input.body,
        parentId: input.parentId,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
    };
    const doc = await db.comments.insert(comment);

    await replicationSink?.('comments', [{
        id: comment.id,
        data: comment as unknown as Record<string, unknown>,
        updatedAt: now,
    }]);

    return doc;
}

/**
 * Update a comment body. Only the author can edit.
 */
export async function updateComment(
    id: string,
    updates: UpdateCommentInput,
    userId: string,
    replicationSink?: ReplicationSink,
): Promise<CommentDocument | null> {
    const db = await getDatabase();
    const comment = await db.comments.findOne(id).exec();
    if (!comment || comment.userId !== userId) return null;

    const now = new Date().toISOString();
    await comment.update({
        $set: {
            body: updates.body,
            updatedAt: now,
        },
    });

    await replicationSink?.('comments', [{
        id,
        data: { ...comment.toJSON(), body: updates.body, updatedAt: now },
        updatedAt: now,
    }]);

    return comment;
}

/**
 * Soft-delete a comment. Only the author can delete.
 */
export async function deleteComment(
    id: string,
    userId: string,
    replicationSink?: ReplicationSink,
): Promise<boolean> {
    const db = await getDatabase();
    const comment = await db.comments.findOne(id).exec();
    if (!comment || comment.userId !== userId) return false;

    const now = new Date().toISOString();
    await comment.update({
        $set: {
            isDeleted: true,
            updatedAt: now,
        },
    });

    await replicationSink?.('comments', [{
        id,
        data: { ...comment.toJSON(), isDeleted: true, updatedAt: now },
        updatedAt: now,
    }]);

    return true;
}

/**
 * Get all non-deleted comments for a playlist (reactive query).
 * Includes both playlist-level and track-level comments.
 */
export async function getPlaylistComments(playlistId: string) {
    const db = await getDatabase();
    return db.comments.find({
        selector: {
            playlistId,
            isDeleted: false,
        },
        sort: [{ createdAt: 'asc' }],
    });
}

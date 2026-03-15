/**
 * Comment thread: list of comments + input for adding new ones.
 * Works for both playlist-level and track-level comments.
 */

import { useState } from 'react';
import { useComments } from '../../hooks/useComments';
import { useUserStore } from '../../stores/user-store';
import { createComment, updateComment, deleteComment } from '../../db/services/comment-service';
import { CommentItem } from './CommentItem';

interface CommentThreadProps {
    playlistId: string;
    trackId?: string;
}

export function CommentThread({ playlistId, trackId }: CommentThreadProps) {
    const userId = useUserStore((s) => s.userId);
    const userDisplayName = useUserStore((s) => s.user?.displayName ?? '');
    const { comments, loading } = useComments(playlistId, trackId);
    const [newBody, setNewBody] = useState('');
    const [replyingTo, setReplyingTo] = useState<string | undefined>();

    const handleSubmit = async () => {
        const body = newBody.trim();
        if (!body) return;

        await createComment({
            playlistId,
            trackId,
            userId,
            userDisplayName,
            body,
            parentId: replyingTo,
        });
        setNewBody('');
        setReplyingTo(undefined);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
        if (e.key === 'Escape') {
            setReplyingTo(undefined);
            setNewBody('');
        }
    };

    const handleEdit = async (id: string, body: string) => {
        await updateComment(id, { body }, userId);
    };

    const handleDelete = async (id: string) => {
        await deleteComment(id, userId);
    };

    const handleReply = (parentId: string) => {
        setReplyingTo(parentId);
    };

    if (loading) {
        return <div className="text-xs text-gray-600 py-2">Loading comments...</div>;
    }

    return (
        <div>
            {comments.length === 0 && (
                <div className="text-xs text-gray-600 py-2">No comments yet</div>
            )}

            {comments.map(({ comment, replies }) => (
                <CommentItem
                    key={comment.id}
                    comment={comment}
                    isOwn={comment.userId === userId}
                    onReply={handleReply}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    replies={replies}
                />
            ))}

            {/* Comment input */}
            <div className="mt-2">
                {replyingTo && (
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-blue-400">Replying to comment</span>
                        <button
                            onClick={() => setReplyingTo(undefined)}
                            className="text-xs text-gray-500 hover:text-gray-300"
                        >
                            Cancel
                        </button>
                    </div>
                )}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newBody}
                        onChange={(e) => setNewBody(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={replyingTo ? 'Write a reply...' : 'Add a comment...'}
                        className="flex-1 bg-gray-800/60 border border-gray-700/50 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500/50 focus:outline-none"
                    />
                    <button
                        onClick={handleSubmit}
                        disabled={!newBody.trim()}
                        className="px-3 py-1.5 bg-blue-600/80 text-white text-sm rounded disabled:opacity-30 hover:bg-blue-500/80 transition-colors"
                    >
                        <i className="fa-solid fa-paper-plane" />
                    </button>
                </div>
            </div>
        </div>
    );
}

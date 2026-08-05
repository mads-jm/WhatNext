/**
 * Single comment display with edit/delete/reply actions.
 * Shows nested replies at a single level of depth.
 */

import { useState } from 'react';
import type { CommentDocType } from '../../db/schemas';

interface CommentItemProps {
    comment: CommentDocType;
    isOwn: boolean;
    onReply: (parentId: string) => void;
    onEdit: (id: string, body: string) => void;
    onDelete: (id: string) => void;
    replies?: CommentDocType[];
    depth?: number;
}

const EMPTY_REPLIES: CommentDocType[] = [];

export function CommentItem({
    comment,
    isOwn,
    onReply,
    onEdit,
    onDelete,
    replies = EMPTY_REPLIES,
    depth = 0,
}: CommentItemProps) {
    const [editing, setEditing] = useState(false);
    const [editBody, setEditBody] = useState(comment.body);

    const handleSaveEdit = () => {
        if (editBody.trim() && editBody !== comment.body) {
            onEdit(comment.id, editBody.trim());
        }
        setEditing(false);
    };

    const handleCancelEdit = () => {
        setEditBody(comment.body);
        setEditing(false);
    };

    const timeAgo = formatTimeAgo(comment.createdAt);
    const displayName = comment.userDisplayName || comment.userId;

    return (
        <div
            className={`${depth > 0 ? 'ml-6 border-l border-outline-variant/50 pl-3' : ''}`}
        >
            <div className="py-2">
                <div className="flex items-center gap-2 mb-1">
                    <div className="w-5 h-5 rounded-full bg-primary-dim/60 flex items-center justify-center text-on-surface text-[10px] font-bold shrink-0 overflow-hidden">
                        {comment.userAvatarUrl ? (
                            <img
                                src={comment.userAvatarUrl}
                                alt=""
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            (displayName || '?')[0].toUpperCase()
                        )}
                    </div>
                    <span className="text-xs font-medium text-on-surface">
                        {displayName}
                    </span>
                    <span className="text-xs text-on-surface-variant">
                        {timeAgo}
                    </span>
                </div>

                {editing ? (
                    <div className="ml-7">
                        <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            className="w-full bg-surface-high border border-outline-variant rounded px-2 py-1 text-sm text-on-surface resize-none"
                            rows={2}
                        />
                        <div className="flex gap-1 mt-1">
                            <button
                                onClick={handleSaveEdit}
                                className="text-xs text-primary hover:text-primary-dim"
                            >
                                Save
                            </button>
                            <button
                                onClick={handleCancelEdit}
                                className="text-xs text-on-surface-variant hover:text-on-surface"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="ml-7">
                        <p className="text-sm text-on-surface">
                            {comment.body}
                        </p>
                        <div className="flex gap-2 mt-1">
                            {depth === 0 && (
                                <button
                                    onClick={() => onReply(comment.id)}
                                    className="text-xs text-on-surface-variant hover:text-on-surface"
                                >
                                    Reply
                                </button>
                            )}
                            {isOwn && (
                                <>
                                    <button
                                        onClick={() => setEditing(true)}
                                        className="text-xs text-on-surface-variant hover:text-on-surface"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => onDelete(comment.id)}
                                        className="text-xs text-on-surface-variant hover:text-error"
                                    >
                                        Delete
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Nested replies (single level) */}
            {replies.map((reply) => (
                <CommentItem
                    key={reply.id}
                    comment={reply}
                    isOwn={reply.userId === comment.userId}
                    onReply={onReply}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    depth={depth + 1}
                />
            ))}
        </div>
    );
}

function formatTimeAgo(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

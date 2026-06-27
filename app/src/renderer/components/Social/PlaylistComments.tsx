/**
 * Collapsible playlist-level comment section.
 * Wraps CommentThread with a toggle header.
 */

import { useState } from 'react';
import { CommentThread } from './CommentThread';
import { useComments } from '../../hooks/useComments';

interface PlaylistCommentsProps {
    playlistId: string;
}

export function PlaylistComments({ playlistId }: PlaylistCommentsProps) {
    const [expanded, setExpanded] = useState(false);
    const { comments } = useComments(playlistId);
    const commentCount = comments.length;

    return (
        <div className="card mb-4">
            <button
                onClick={() => setExpanded(!expanded)}
                className="card-header w-full flex items-center justify-between cursor-pointer hover:bg-surface-high/30 transition-colors"
            >
                <span className="font-medium">
                    <i className="fa-solid fa-comments mr-2 text-on-surface-variant" />
                    Discussion {commentCount > 0 && `(${commentCount})`}
                </span>
                <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-on-surface-variant text-sm`} />
            </button>
            {expanded && (
                <div className="card-body">
                    <CommentThread playlistId={playlistId} />
                </div>
            )}
        </div>
    );
}

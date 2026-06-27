/**
 * Horizontal row of emoji reaction buttons for a track.
 * Shows all available reactions with counts and toggle behavior.
 */

import { useReactions } from '../../hooks/useReactions';
import { useUserStore } from '../../stores/user-store';
import { toggleReaction } from '../../db/services/reaction-service';
import { ALLOWED_REACTIONS, type ReactionEmoji } from '../../../shared/core/reactions';
import { pushLocalChanges } from '../../db/replication-handler';
import { ReactionButton } from './ReactionButton';

interface ReactionBarProps {
    trackId: string;
    playlistId: string;
}

export function ReactionBar({ trackId, playlistId }: ReactionBarProps) {
    const userId = useUserStore((s) => s.userId);
    const { reactions, loading } = useReactions(trackId, userId);

    if (loading) return null;

    const handleToggle = (emoji: ReactionEmoji) => {
        toggleReaction(userId, trackId, playlistId, emoji, pushLocalChanges);
    };

    return (
        <div className="flex items-center gap-1 mt-1">
            {ALLOWED_REACTIONS.map((emoji) => {
                const summary = reactions.get(emoji);
                return (
                    <ReactionButton
                        key={emoji}
                        emoji={emoji}
                        count={summary?.count ?? 0}
                        userReacted={summary?.userReacted ?? false}
                        onClick={() => handleToggle(emoji)}
                    />
                );
            })}
        </div>
    );
}

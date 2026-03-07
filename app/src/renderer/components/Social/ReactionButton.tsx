/**
 * Single emoji reaction button with count badge.
 * Highlighted when the local user has reacted.
 */

import { REACTION_DISPLAY, type ReactionEmoji } from '../../db/services/reaction-service';

interface ReactionButtonProps {
    emoji: ReactionEmoji;
    count: number;
    userReacted: boolean;
    onClick: () => void;
}

export function ReactionButton({ emoji, count, userReacted, onClick }: ReactionButtonProps) {
    return (
        <button
            onClick={onClick}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                userReacted
                    ? 'bg-blue-900/60 border border-blue-500/50 text-blue-300'
                    : 'bg-gray-800/60 border border-gray-700/50 text-gray-400 hover:bg-gray-700/60'
            }`}
            title={emoji}
        >
            <span>{REACTION_DISPLAY[emoji]}</span>
            {count > 0 && <span className="font-medium">{count}</span>}
        </button>
    );
}

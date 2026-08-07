/**
 * Single emoji reaction button with count badge.
 * Highlighted when the local user has reacted.
 */

import {
    REACTION_DISPLAY,
    type ReactionEmoji,
} from '../../../shared/core/reactions';

interface ReactionButtonProps {
    emoji: ReactionEmoji;
    count: number;
    userReacted: boolean;
    onClick: () => void;
}

export function ReactionButton({
    emoji,
    count,
    userReacted,
    onClick,
}: ReactionButtonProps) {
    return (
        <button
            onClick={onClick}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                userReacted
                    ? 'bg-primary/15 border border-primary/50 text-primary'
                    : 'bg-surface-high/60 border border-outline-variant/50 text-on-surface-variant hover:bg-surface-high/80'
            }`}
            title={emoji}
        >
            <span>{REACTION_DISPLAY[emoji]}</span>
            {count > 0 && <span className="font-medium">{count}</span>}
        </button>
    );
}

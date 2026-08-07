/**
 * Reaction domain constants.
 * Pure data — no framework or service dependencies.
 */

export const ALLOWED_REACTIONS = [
    'fire',
    'heart',
    'thumbsdown',
    'mindblown',
    'sleeping',
    'party',
] as const;
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];

export const REACTION_DISPLAY: Record<ReactionEmoji, string> = {
    fire: '\uD83D\uDD25',
    heart: '\u2764\uFE0F',
    thumbsdown: '\uD83D\uDC4E',
    mindblown: '\uD83E\uDD2F',
    sleeping: '\uD83D\uDE34',
    party: '\uD83C\uDF89',
};

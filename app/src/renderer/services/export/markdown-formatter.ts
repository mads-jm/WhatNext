/**
 * Markdown Formatter
 * Generates Obsidian-friendly markdown with YAML frontmatter.
 */

import type { ExportPlaylist, ExportComment } from './export-types';
import {
    REACTION_DISPLAY,
    type ReactionEmoji,
} from '../../../shared/core/reactions';

export function formatAsMarkdown(data: ExportPlaylist): string {
    const lines: string[] = [];

    // YAML frontmatter
    lines.push('---');
    lines.push(`title: "${escapeYaml(data.name)}"`);
    lines.push(`owner: "${escapeYaml(data.owner)}"`);
    lines.push(`created: ${data.createdAt}`);
    lines.push(`updated: ${data.updatedAt}`);
    lines.push(`tracks: ${data.trackCount}`);
    lines.push(`duration: "${formatDuration(data.totalDurationMs)}"`);
    if (data.tags.length > 0) {
        lines.push(
            `tags: [${data.tags.map((t) => `"${escapeYaml(t)}"`).join(', ')}]`,
        );
    }
    if (data.collaborators.length > 0) {
        lines.push(
            `collaborators: [${data.collaborators.map((c) => `"${escapeYaml(c)}"`).join(', ')}]`,
        );
    }
    lines.push('source: WhatNext');
    lines.push('---');
    lines.push('');

    // Title
    lines.push(`# ${data.name}`);
    lines.push('');
    if (data.coverArtUrl) {
        lines.push(`![Cover Art](${data.coverArtUrl})`);
        lines.push('');
    }
    if (data.description) {
        lines.push(`> ${data.description}`);
        lines.push('');
    }

    // Playlist-level comments
    if (data.comments.length > 0) {
        lines.push('## Discussion');
        lines.push('');
        for (const comment of data.comments) {
            lines.push(...formatComment(comment, 0));
        }
        lines.push('');
    }

    // Track list
    lines.push('## Tracks');
    lines.push('');

    data.tracks.forEach((track, i) => {
        lines.push(`### ${i + 1}. ${track.title}`);
        if (track.albumArtUrl) {
            lines.push(`![${escapeYaml(track.album)}](${track.albumArtUrl})`);
            lines.push('');
        }
        lines.push(`- **Artists:** ${track.artists.join(', ')}`);
        lines.push(`- **Album:** ${track.album}`);
        lines.push(`- **Duration:** ${formatDuration(track.durationMs)}`);
        lines.push(`- **Added by:** ${track.addedBy}`);
        if (track.spotifyId) {
            lines.push(
                `- **Spotify:** [Open](https://open.spotify.com/track/${track.spotifyId})`,
            );
        }

        // Reactions
        const activeReactions = Object.entries(track.reactions)
            .filter(([, count]) => count > 0)
            .map(
                ([emoji, count]) =>
                    `${REACTION_DISPLAY[emoji as ReactionEmoji]} ${count}`,
            );
        if (activeReactions.length > 0) {
            lines.push(`- **Reactions:** ${activeReactions.join('  ')}`);
        }

        // Track comments
        if (track.comments.length > 0) {
            lines.push('');
            lines.push('**Comments:**');
            for (const comment of track.comments) {
                lines.push(...formatComment(comment, 0));
            }
        }

        lines.push('');
    });

    // Footer
    lines.push('---');
    lines.push(
        `*Exported from WhatNext on ${new Date().toISOString().split('T')[0]}*`,
    );

    return lines.join('\n');
}

function formatComment(comment: ExportComment, depth: number): string[] {
    const indent = '  '.repeat(depth);
    const lines: string[] = [];
    const date = new Date(comment.createdAt).toLocaleDateString();
    lines.push(`${indent}- **${comment.author}** (${date}): ${comment.body}`);
    for (const reply of comment.replies) {
        lines.push(...formatComment(reply, depth + 1));
    }
    return lines;
}

function formatDuration(ms: number): string {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function escapeYaml(s: string): string {
    return s.replace(/"/g, '\\"');
}

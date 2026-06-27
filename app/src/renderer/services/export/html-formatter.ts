/**
 * HTML Formatter
 * Generates a self-contained HTML file with embedded CSS.
 * No external dependencies — works offline as a standalone file.
 */

import type { ExportPlaylist, ExportComment } from './export-types';
import { REACTION_DISPLAY, type ReactionEmoji } from '../../../shared/core/reactions';

export function formatAsHtml(data: ExportPlaylist): string {
    const tracksHtml = data.tracks.map((track, i) => {
        const reactionsHtml = Object.entries(track.reactions)
            .filter(([, count]) => count > 0)
            .map(([emoji, count]) =>
                `<span class="reaction">${REACTION_DISPLAY[emoji as ReactionEmoji]} ${count}</span>`
            )
            .join('');

        const commentsHtml = track.comments.map((c) => renderCommentHtml(c)).join('');
        const artHtml = track.albumArtUrl
            ? `<img class="track-art" src="${escapeHtml(track.albumArtUrl)}" alt="${escapeHtml(track.album)}" loading="lazy">`
            : '';

        return `
    <div class="track">
        ${artHtml}
        <div class="track-num">${i + 1}</div>
        <div class="track-info">
            <div class="track-title">${escapeHtml(track.title)}</div>
            <div class="track-artist">${escapeHtml(track.artists.join(', '))} &bull; ${escapeHtml(track.album)}</div>
            ${reactionsHtml ? `<div class="reactions">${reactionsHtml}</div>` : ''}
            ${commentsHtml ? `<div class="comments">${commentsHtml}</div>` : ''}
        </div>
        <div class="track-duration">${formatDuration(track.durationMs)}</div>
    </div>`;
    }).join('');

    const playlistCommentsHtml = data.comments.length > 0
        ? `<div class="section">
            <h2>Discussion</h2>
            ${data.comments.map((c) => renderCommentHtml(c)).join('')}
        </div>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(data.name)} - WhatNext Playlist</title>
    <style>
        :root { --bg: #0f0f0f; --card: #1a1a1a; --border: #2a2a2a; --text: #e5e5e5; --muted: #888; --accent: #3b82f6; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); max-width: 800px; margin: 0 auto; padding: 2rem 1rem; }
        .header { margin-bottom: 2rem; }
        .header h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
        .header .desc { color: var(--muted); margin-bottom: 0.5rem; }
        .meta { color: var(--muted); font-size: 0.875rem; }
        .tags { margin-top: 0.5rem; }
        .tag { display: inline-block; background: #333; border-radius: 4px; padding: 2px 8px; margin-right: 4px; font-size: 0.75rem; color: var(--muted); }
        .section { margin-bottom: 1.5rem; }
        .section h2 { font-size: 1.125rem; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
        .cover-art { width: 200px; height: 200px; object-fit: cover; border-radius: 8px; margin-bottom: 1rem; display: block; }
        .track { display: flex; align-items: flex-start; gap: 0.75rem; background: var(--card); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
        .track-art { width: 48px; height: 48px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
        .track-num { color: var(--muted); font-size: 0.875rem; min-width: 1.5rem; text-align: right; padding-top: 2px; }
        .track-info { flex: 1; }
        .track-title { font-weight: 600; }
        .track-artist { color: var(--muted); font-size: 0.875rem; margin-top: 2px; }
        .track-duration { color: var(--muted); font-size: 0.875rem; white-space: nowrap; padding-top: 2px; }
        .reactions { margin-top: 0.5rem; }
        .reaction { display: inline-block; background: #333; border-radius: 12px; padding: 2px 8px; margin-right: 4px; font-size: 0.8rem; }
        .comments { margin-top: 0.5rem; }
        .comment { border-left: 2px solid #333; padding-left: 0.75rem; margin-top: 0.5rem; font-size: 0.875rem; }
        .comment-author { font-weight: 600; }
        .comment-date { color: var(--muted); font-size: 0.75rem; margin-left: 0.5rem; }
        .comment-body { margin-top: 2px; }
        .comment-replies { margin-left: 1rem; }
        .footer { margin-top: 3rem; text-align: center; color: var(--muted); font-size: 0.75rem; border-top: 1px solid var(--border); padding-top: 1rem; }
    </style>
</head>
<body>
    <div class="header">
        ${data.coverArtUrl ? `<img class="cover-art" src="${escapeHtml(data.coverArtUrl)}" alt="${escapeHtml(data.name)} cover art">` : ''}
        <h1>${escapeHtml(data.name)}</h1>
        ${data.description ? `<p class="desc">${escapeHtml(data.description)}</p>` : ''}
        <p class="meta">${data.trackCount} tracks &bull; ${formatDuration(data.totalDurationMs)} &bull; by ${escapeHtml(data.owner)}</p>
        ${data.tags.length > 0 ? `<div class="tags">${data.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>

    ${playlistCommentsHtml}

    <div class="section">
        <h2>Tracks</h2>
        ${tracksHtml}
    </div>

    <div class="footer">Exported from WhatNext on ${new Date().toISOString().split('T')[0]}</div>
</body>
</html>`;
}

function renderCommentHtml(comment: ExportComment): string {
    const date = new Date(comment.createdAt).toLocaleDateString();
    const repliesHtml = comment.replies.length > 0
        ? `<div class="comment-replies">${comment.replies.map((r) => renderCommentHtml(r)).join('')}</div>`
        : '';

    return `<div class="comment">
    <span class="comment-author">${escapeHtml(comment.author)}</span>
    <span class="comment-date">${date}</span>
    <div class="comment-body">${escapeHtml(comment.body)}</div>
    ${repliesHtml}
</div>`;
}

function formatDuration(ms: number): string {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

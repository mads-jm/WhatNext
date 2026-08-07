import { describe, it, expect } from 'vitest';

import { formatAsMarkdown } from '../markdown-formatter';
import type { ReactionEmoji } from '../../../../shared/core/reactions';
import { makeTrack, makePlaylist, makeComment } from './fixtures';

describe('formatAsMarkdown — YAML frontmatter', () => {
    it('includes title in frontmatter', () => {
        const md = formatAsMarkdown(makePlaylist({ name: 'My Playlist' }));
        expect(md).toContain('title: "My Playlist"');
    });

    it('includes owner in frontmatter', () => {
        const md = formatAsMarkdown(makePlaylist({ owner: 'Alice' }));
        expect(md).toContain('owner: "Alice"');
    });

    it('includes created and updated timestamps', () => {
        const md = formatAsMarkdown(makePlaylist());
        expect(md).toContain('created: 2024-01-01T00:00:00Z');
        expect(md).toContain('updated: 2024-01-15T12:00:00Z');
    });

    it('includes tracks count', () => {
        const md = formatAsMarkdown(makePlaylist({ trackCount: 3 }));
        expect(md).toContain('tracks: 3');
    });

    it('includes a duration field', () => {
        const md = formatAsMarkdown(makePlaylist());
        expect(md).toMatch(/duration: "/);
    });

    it('omits tags line when tags array is empty', () => {
        const md = formatAsMarkdown(makePlaylist({ tags: [] }));
        expect(md).not.toContain('tags:');
    });

    it('includes tags line when tags are present', () => {
        const md = formatAsMarkdown(makePlaylist({ tags: ['chill', 'study'] }));
        expect(md).toContain('tags:');
        expect(md).toContain('"chill"');
        expect(md).toContain('"study"');
    });

    it('omits collaborators line when array is empty', () => {
        const md = formatAsMarkdown(makePlaylist({ collaborators: [] }));
        expect(md).not.toContain('collaborators:');
    });

    it('includes collaborators when present', () => {
        const md = formatAsMarkdown(
            makePlaylist({ collaborators: ['Bob', 'Carol'] }),
        );
        expect(md).toContain('collaborators:');
        expect(md).toContain('"Bob"');
    });

    it('escapes double-quotes in the title', () => {
        const md = formatAsMarkdown(
            makePlaylist({ name: 'My "Best" Playlist' }),
        );
        expect(md).toContain('title: "My \\"Best\\" Playlist"');
    });
});

describe('formatAsMarkdown — body structure', () => {
    it('omits cover art line when coverArtUrl is absent', () => {
        const md = formatAsMarkdown(makePlaylist({ coverArtUrl: undefined }));
        expect(md).not.toContain('![Cover Art]');
    });

    it('includes cover art image when coverArtUrl is present', () => {
        const md = formatAsMarkdown(
            makePlaylist({ coverArtUrl: 'https://cdn/cover.jpg' }),
        );
        expect(md).toContain('![Cover Art](https://cdn/cover.jpg)');
    });

    it('omits description block when description is absent', () => {
        const md = formatAsMarkdown(makePlaylist({ description: undefined }));
        // No blockquote line
        const lines = md.split('\n').filter((l) => l.startsWith('> '));
        expect(lines).toHaveLength(0);
    });

    it('includes description as a block quote', () => {
        const md = formatAsMarkdown(
            makePlaylist({ description: 'A great mix' }),
        );
        expect(md).toContain('> A great mix');
    });

    it('omits Discussion section when no playlist comments', () => {
        const md = formatAsMarkdown(makePlaylist({ comments: [] }));
        expect(md).not.toContain('## Discussion');
    });

    it('includes Discussion section when playlist comments exist', () => {
        const md = formatAsMarkdown(
            makePlaylist({ comments: [makeComment()] }),
        );
        expect(md).toContain('## Discussion');
    });

    it('always includes Tracks section', () => {
        const md = formatAsMarkdown(makePlaylist());
        expect(md).toContain('## Tracks');
    });

    it('numbers tracks starting at 1', () => {
        const playlist = makePlaylist({
            tracks: [
                makeTrack({ title: 'First' }),
                makeTrack({ title: 'Second' }),
            ],
        });
        const md = formatAsMarkdown(playlist);
        expect(md).toContain('### 1. First');
        expect(md).toContain('### 2. Second');
    });

    it('includes footer', () => {
        const md = formatAsMarkdown(makePlaylist());
        expect(md).toContain('Exported from WhatNext');
    });
});

describe('formatAsMarkdown — track fields', () => {
    it('includes album art when albumArtUrl present', () => {
        const md = formatAsMarkdown(
            makePlaylist({
                tracks: [
                    makeTrack({
                        albumArtUrl: 'https://cdn/art.jpg',
                        album: 'Test Album',
                    }),
                ],
            }),
        );
        expect(md).toContain('![Test Album](https://cdn/art.jpg)');
    });

    it('omits album art when albumArtUrl absent', () => {
        const md = formatAsMarkdown(
            makePlaylist({ tracks: [makeTrack({ albumArtUrl: undefined })] }),
        );
        // No img syntax in tracks section
        expect(md).not.toMatch(/!\[.*\]\(.*\)/);
    });

    it('renders non-zero reactions', () => {
        const track = makeTrack({
            reactions: {
                fire: 2,
                heart: 0,
                thumbsdown: 0,
                mindblown: 0,
                sleeping: 0,
                party: 0,
            } as Record<ReactionEmoji, number>,
        });
        const md = formatAsMarkdown(makePlaylist({ tracks: [track] }));
        expect(md).toContain('🔥 2');
    });

    it('omits reactions line when all counts are 0', () => {
        const md = formatAsMarkdown(makePlaylist({ tracks: [makeTrack()] }));
        expect(md).not.toContain('Reactions:');
    });
});

describe('formatAsMarkdown — comment nesting', () => {
    it('renders a top-level comment without indent', () => {
        const comment = makeComment({ author: 'Alice', body: 'Nice!' });
        const md = formatAsMarkdown(makePlaylist({ comments: [comment] }));
        expect(md).toContain('- **Alice**');
        expect(md).toContain('Nice!');
    });

    it('indents replies by two spaces per depth level', () => {
        const reply = makeComment({ author: 'Bob', body: 'Agreed' });
        const parent = makeComment({
            author: 'Alice',
            body: 'Nice!',
            replies: [reply],
        });
        const md = formatAsMarkdown(makePlaylist({ comments: [parent] }));
        // Reply should appear with two-space indent
        expect(md).toContain('  - **Bob**');
    });
});

describe('formatAsMarkdown — duration formatting', () => {
    it('uses m:ss format for sub-hour durations in frontmatter', () => {
        const md = formatAsMarkdown(
            makePlaylist({ totalDurationMs: 3 * 60000 + 30000 }),
        );
        expect(md).toContain('duration: "3:30"');
    });

    it('uses Xh Ym format for durations >= 1 hour in frontmatter', () => {
        const md = formatAsMarkdown(
            makePlaylist({ totalDurationMs: 90 * 60000 }),
        );
        expect(md).toContain('duration: "1h 30m"');
    });
});

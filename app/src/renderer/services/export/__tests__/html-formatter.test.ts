import { describe, it, expect } from 'vitest';

import { formatAsHtml } from '../html-formatter';
import type { ExportPlaylist, ExportTrack, ExportComment } from '../export-types';
import type { ReactionEmoji } from '../../../../shared/core/reactions';

function makeTrack(overrides: Partial<ExportTrack> = {}): ExportTrack {
    return {
        title: 'Test Track',
        artists: ['Artist A'],
        album: 'Test Album',
        durationMs: 200000,
        addedBy: 'user-1',
        addedAt: '2024-01-15T12:00:00Z',
        reactions: {
            fire: 0,
            heart: 0,
            thumbsdown: 0,
            mindblown: 0,
            sleeping: 0,
            party: 0,
        } as Record<ReactionEmoji, number>,
        comments: [],
        ...overrides,
    };
}

function makePlaylist(overrides: Partial<ExportPlaylist> = {}): ExportPlaylist {
    return {
        name: 'My Playlist',
        owner: 'Alice',
        collaborators: [],
        tags: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T12:00:00Z',
        trackCount: 1,
        totalDurationMs: 200000,
        tracks: [makeTrack()],
        comments: [],
        isCollaborative: false,
        ...overrides,
    };
}

function makeComment(overrides: Partial<ExportComment> = {}): ExportComment {
    return {
        author: 'Bob',
        body: 'Great track!',
        createdAt: '2024-01-15T12:00:00Z',
        replies: [],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Security: escapeHtml must neutralise XSS vectors in user-supplied content
// ---------------------------------------------------------------------------

describe('formatAsHtml — XSS escaping (security)', () => {
    it('escapes <script> in playlist name in <title>', () => {
        const html = formatAsHtml(makePlaylist({ name: '<script>alert(1)</script>' }));
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('escapes <script> in playlist name in visible heading', () => {
        const html = formatAsHtml(makePlaylist({ name: '<script>alert(1)</script>' }));
        // The raw tag must not appear anywhere
        expect(html).not.toContain('<script>alert(1)');
    });

    it('escapes "> in artist name — raw <img> tag is neutralised', () => {
        const html = formatAsHtml(
            makePlaylist({ tracks: [makeTrack({ artists: ['"><img src=x onerror=alert(1)>'] })] })
        );
        // The raw unescaped tag must not appear (browser would execute the handler)
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        // The opening angle bracket is escaped — tag is inert text
        expect(html).toContain('&quot;&gt;&lt;img');
    });

    it('escapes & in album name as &amp;', () => {
        const html = formatAsHtml(
            makePlaylist({ tracks: [makeTrack({ album: 'Rock & Roll' })] })
        );
        expect(html).toContain('Rock &amp; Roll');
        // Raw ampersand must not appear in that position
        expect(html).not.toContain('Rock & Roll');
    });

    it('escapes <img onerror> injection in track title', () => {
        const html = formatAsHtml(
            makePlaylist({ tracks: [makeTrack({ title: '<img src=x onerror=alert(1)>' })] })
        );
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).toContain('&lt;img');
    });

    it('escapes HTML in comment body', () => {
        const comment = makeComment({ body: '<b>bold</b> and <script>evil()</script>' });
        const html = formatAsHtml(
            makePlaylist({ tracks: [makeTrack({ comments: [comment] })] })
        );
        expect(html).not.toContain('<b>bold</b>');
        expect(html).not.toContain('<script>evil()');
        expect(html).toContain('&lt;b&gt;');
    });

    it('escapes HTML in comment author name', () => {
        const comment = makeComment({ author: '<script>hack</script>' });
        const html = formatAsHtml(makePlaylist({ comments: [comment] }));
        expect(html).not.toContain('<script>hack');
        expect(html).toContain('&lt;script&gt;');
    });

    it('escapes albumArtUrl to prevent attribute injection', () => {
        const maliciousUrl = 'x" onerror="alert(1)';
        const html = formatAsHtml(
            makePlaylist({ tracks: [makeTrack({ albumArtUrl: maliciousUrl })] })
        );
        expect(html).not.toContain('onerror="alert(1)');
    });
});

// ---------------------------------------------------------------------------
// Structure: document shape, sections, conditional rendering
// ---------------------------------------------------------------------------

describe('formatAsHtml — document structure', () => {
    it('is a valid HTML5 document starting with <!DOCTYPE html>', () => {
        const html = formatAsHtml(makePlaylist());
        expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    });

    it('includes playlist name in <title>', () => {
        const html = formatAsHtml(makePlaylist({ name: 'Summer Mix' }));
        expect(html).toContain('<title>Summer Mix');
    });

    it('renders one track div per track', () => {
        const playlist = makePlaylist({
            tracks: [makeTrack({ title: 'Track 1' }), makeTrack({ title: 'Track 2' })],
        });
        const html = formatAsHtml(playlist);
        const matches = html.match(/class="track"/g);
        expect(matches).toHaveLength(2);
    });

    it('omits discussion section when no playlist-level comments', () => {
        const html = formatAsHtml(makePlaylist({ comments: [] }));
        expect(html).not.toContain('<h2>Discussion</h2>');
    });

    it('includes discussion section when playlist comments exist', () => {
        const html = formatAsHtml(makePlaylist({ comments: [makeComment()] }));
        expect(html).toContain('<h2>Discussion</h2>');
    });

    it('omits cover art img when coverArtUrl absent', () => {
        const html = formatAsHtml(makePlaylist({ coverArtUrl: undefined }));
        expect(html).not.toContain('class="cover-art"');
    });

    it('includes cover art img when coverArtUrl present', () => {
        const html = formatAsHtml(makePlaylist({ coverArtUrl: 'https://cdn/cover.jpg' }));
        expect(html).toContain('https://cdn/cover.jpg');
    });

    it('omits track art img when albumArtUrl absent', () => {
        const html = formatAsHtml(
            makePlaylist({ tracks: [makeTrack({ albumArtUrl: undefined })] })
        );
        expect(html).not.toContain('class="track-art"');
    });

    it('includes track art img when albumArtUrl present', () => {
        const html = formatAsHtml(
            makePlaylist({ tracks: [makeTrack({ albumArtUrl: 'https://cdn/art.jpg' })] })
        );
        expect(html).toContain('class="track-art"');
    });
});

describe('formatAsHtml — reactions', () => {
    it('omits reaction spans when all counts are 0', () => {
        const html = formatAsHtml(makePlaylist({ tracks: [makeTrack()] }));
        expect(html).not.toContain('class="reaction"');
    });

    it('renders reaction span for non-zero counts', () => {
        const track = makeTrack({
            reactions: { fire: 3, heart: 0, thumbsdown: 0, mindblown: 0, sleeping: 0, party: 0 } as Record<ReactionEmoji, number>,
        });
        const html = formatAsHtml(makePlaylist({ tracks: [track] }));
        expect(html).toContain('class="reaction"');
        expect(html).toContain('3');
    });
});

/**
 * Shared export-formatter fixtures.
 *
 * `html-formatter.test.ts` and `markdown-formatter.test.ts` render the *same*
 * canonical export shapes through two different formatters, so they opened with
 * a byte-identical set of builders. They live here once; each suite still asserts
 * only its own output.
 *
 * Every builder returns a fresh object, so the two suites (and individual tests)
 * cannot leak fixture mutations into each other.
 *
 * NOT a test file itself (no `.test.ts` suffix) — imported by the suites.
 */

import type {
    ExportPlaylist,
    ExportTrack,
    ExportComment,
} from '../export-types';
import type { ReactionEmoji } from '../../../../shared/core/reactions';

export function makeTrack(overrides: Partial<ExportTrack> = {}): ExportTrack {
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

export function makePlaylist(
    overrides: Partial<ExportPlaylist> = {},
): ExportPlaylist {
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

export function makeComment(
    overrides: Partial<ExportComment> = {},
): ExportComment {
    return {
        author: 'Bob',
        body: 'Great track!',
        createdAt: '2024-01-15T12:00:00Z',
        replies: [],
        ...overrides,
    };
}

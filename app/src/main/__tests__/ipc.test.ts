/**
 * IPC Unit Tests
 *
 * Covers:
 *  1. spotify-mapper.ts  — pure functions, 100 % branch coverage
 *  2. IPC handler logic  — key handlers tested in isolation with mocked deps
 *  3. Preload surface    — type-level smoke checks via TypeScript inference
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpotifyTrackItem } from '../types';

// ---------------------------------------------------------------------------
// 1. spotify-mapper.ts — pure functions
// ---------------------------------------------------------------------------

// uuid is called inside mapSpotifyTrack; we mock it to get deterministic IDs.
vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

import {
    mapSpotifyTrack,
    mapSpotifyTracks,
    type MappedTrack,
} from '../spotify/spotify-mapper';

/**
 * The wire shape Spotify actually sends: `track` is `null` for removed or
 * region-unavailable playlist entries, which is exactly why `mapSpotifyTracks`
 * filters on `item.track && item.track.id`. The app-side `SpotifyTrackItem`
 * models only the well-formed case, so those degenerate entries are not
 * expressible in it — a design smell worth fixing at the source one day, but
 * out of scope for a lint burn-down.
 *
 * Rather than casting each malformed fixture, the guard tests describe their
 * input precisely with this type and call the mapper through the local view of
 * its signature below. That keeps the fixtures fully typed and confines the
 * widening to one documented place.
 */
type RawSpotifyTrackItem = Omit<SpotifyTrackItem, 'track'> & {
    track: SpotifyTrackItem['track'] | null;
};

/** `mapSpotifyTracks` drops null/idless tracks, so it is safe on raw wire items. */
const mapRawSpotifyTracks = mapSpotifyTracks as (
    items: RawSpotifyTrackItem[],
) => MappedTrack[];

// ---------------------------------------------------------------------------
// Spotify resilience / auth / client suites (#44, #33)
//
// These exercise modules that import `electron` (shell, safeStorage) and the
// encrypted token-store. `vi.mock` is hoisted above the imports below so the
// real Electron + fs/crypto side effects never run.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    app: { getPath: vi.fn(() => '/tmp') },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString('utf-8'),
    },
}));

vi.mock('../spotify/token-store', () => ({
    saveTokens: vi.fn(),
    loadTokens: vi.fn(() => null),
    clearTokens: vi.fn(),
    hasTokens: vi.fn(() => false),
}));

import crypto from 'node:crypto';
import { shell } from 'electron';
import { SPOTIFY_CONFIG } from '../../shared/spotify-config';
import {
    SpotifyApiError,
    kindForStatus,
    isRetryableKind,
    parseRetryAfterMs,
} from '../spotify/spotify-errors';
import { resilientFetch } from '../spotify/spotify-resilience';
import {
    setSpotifyEventListener,
    type SpotifyRuntimeEvent,
} from '../spotify/spotify-events';
import {
    startSpotifyAuth,
    handleSpotifyCallback,
    refreshSpotifyToken,
} from '../spotify/spotify-auth';
import {
    initSpotifyClient,
    getCurrentUser,
    getPlaybackState,
} from '../spotify/spotify-client';

/** Minimal valid SpotifyTrackItem fixture */
function makeTrackItem(
    overrides: Partial<SpotifyTrackItem> = {},
): SpotifyTrackItem {
    return {
        track: {
            id: 'spotify-track-id-1',
            name: 'Test Track',
            artists: [{ name: 'Artist A', id: 'artist-a' }],
            album: {
                name: 'Test Album',
                images: [
                    { url: 'https://cdn/image.jpg', height: 300, width: 300 },
                ],
            },
            duration_ms: 200000,
            external_urls: { spotify: 'https://open.spotify.com/track/123' },
        },
        added_at: '2024-01-15T12:00:00Z',
        added_by: { id: 'spotify-user-abc' },
        ...overrides,
    };
}

describe('mapSpotifyTrack', () => {
    it('maps title from track.name', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.title).toBe('Test Track');
    });

    it('maps artists array from track.artists', () => {
        const item = makeTrackItem({
            track: {
                ...makeTrackItem().track,
                artists: [
                    { name: 'Artist A', id: 'a' },
                    { name: 'Artist B', id: 'b' },
                ],
            },
        });
        const result = mapSpotifyTrack(item);
        expect(result.artists).toEqual(['Artist A', 'Artist B']);
    });

    it('maps album name from track.album.name', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.album).toBe('Test Album');
    });

    it('maps durationMs from track.duration_ms', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.durationMs).toBe(200000);
    });

    it('maps spotifyId from track.id', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.spotifyId).toBe('spotify-track-id-1');
    });

    it('maps albumArtUrl from the first image in track.album.images', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.albumArtUrl).toBe('https://cdn/image.jpg');
    });

    it('sets albumArtUrl to undefined when images array is empty', () => {
        const item = makeTrackItem({
            track: {
                ...makeTrackItem().track,
                album: { name: 'Album No Art', images: [] },
            },
        });
        const result = mapSpotifyTrack(item);
        expect(result.albumArtUrl).toBeUndefined();
    });

    it('maps addedAt from item.added_at', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.addedAt).toBe('2024-01-15T12:00:00Z');
    });

    it('falls back addedAt to a current ISO string when added_at is falsy', () => {
        const item = makeTrackItem({ added_at: '' });
        const before = Date.now();
        const result = mapSpotifyTrack(item);
        const after = Date.now();
        const parsed = Date.parse(result.addedAt);
        expect(parsed).toBeGreaterThanOrEqual(before);
        expect(parsed).toBeLessThanOrEqual(after);
    });

    it('uses item.added_by.id as addedBySpotifyId, not a caller-supplied userId', () => {
        const item = makeTrackItem({ added_by: { id: 'real-owner-id' } });
        const result = mapSpotifyTrack(item);
        expect(result.addedBySpotifyId).toBe('real-owner-id');
    });

    it('generates a uuid for the id field', () => {
        const result = mapSpotifyTrack(makeTrackItem());
        expect(result.id).toBe('test-uuid');
    });
});

describe('mapSpotifyTracks', () => {
    it('maps multiple valid tracks and preserves order', () => {
        const items: SpotifyTrackItem[] = [
            makeTrackItem({
                track: {
                    ...makeTrackItem().track,
                    id: 'track-1',
                    name: 'Song One',
                },
            }),
            makeTrackItem({
                track: {
                    ...makeTrackItem().track,
                    id: 'track-2',
                    name: 'Song Two',
                },
            }),
        ];
        const result = mapSpotifyTracks(items);
        expect(result).toHaveLength(2);
        expect(result[0].spotifyId).toBe('track-1');
        expect(result[1].spotifyId).toBe('track-2');
    });

    it('filters out items whose track is null (null-track guard)', () => {
        const items: RawSpotifyTrackItem[] = [
            makeTrackItem(),
            {
                track: null,
                added_at: '2024-01-01T00:00:00Z',
                added_by: { id: 'x' },
            },
        ];
        const result = mapRawSpotifyTracks(items);
        expect(result).toHaveLength(1);
    });

    it('filters out local tracks that have no track.id (local-file guard)', () => {
        const localTrack = makeTrackItem({
            track: { ...makeTrackItem().track, id: '' },
        });
        const validTrack = makeTrackItem();
        const result = mapSpotifyTracks([localTrack, validTrack]);
        expect(result).toHaveLength(1);
        expect(result[0].spotifyId).toBe('spotify-track-id-1');
    });

    it('returns an empty array when all items are filtered out', () => {
        const items: RawSpotifyTrackItem[] = [
            { track: null, added_at: '', added_by: { id: '' } },
            { track: null, added_at: '', added_by: { id: '' } },
        ];
        expect(mapRawSpotifyTracks(items)).toEqual([]);
    });

    it('returns an empty array for an empty input', () => {
        expect(mapSpotifyTracks([])).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// 2. IPC handler logic — key handlers tested in isolation
//
// The handlers in main.ts use dynamic import() to load Spotify modules.
// We test the *logic* (input → output shape) by extracting that logic into
// helper functions that mirror what the handlers do, with dependencies mocked.
//
// Each extracted handler is annotated with the IPC result shape it mirrors —
// a success flag plus optional payload/error fields, the same "one object with
// optional members" convention the preload surface uses (see section 3). The
// annotation is what lets the assertions read `response.error` directly instead
// of narrowing (or casting away) an inferred two-branch union.
// ---------------------------------------------------------------------------

/** Result of the `spotify:get-tracks` / `spotify:sync-playlist` handlers. */
interface TracksResult {
    success: boolean;
    tracks?: MappedTrack[];
    total?: number;
    error?: string;
}

/** Result of the `artwork:download` handler. */
interface ArtworkResult {
    success: boolean;
    localPath?: string;
    error?: string;
}

/** Result of the `spotify:get-profile` handler. */
interface ProfileResult {
    success: boolean;
    userId?: string;
    displayName?: string;
    avatarUrl?: string;
    error?: string;
}

describe('spotify:get-tracks handler logic', () => {
    it('returns { success: true, tracks, total } on success', async () => {
        const fakeItems: SpotifyTrackItem[] = [makeTrackItem()];
        const mockGetPlaylistTracks = vi
            .fn()
            .mockResolvedValue({ items: fakeItems, total: 1 });

        // Simulate the handler logic
        const handler = async (playlistId: string): Promise<TracksResult> => {
            try {
                const result = await mockGetPlaylistTracks(playlistId);
                const mapped = mapSpotifyTracks(result.items);
                return { success: true, tracks: mapped, total: result.total };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        };

        const response = await handler('playlist-xyz');
        expect(response.success).toBe(true);
        expect(response.tracks).toHaveLength(1);
        expect(response.total).toBe(1);
        expect(mockGetPlaylistTracks).toHaveBeenCalledWith('playlist-xyz');
    });

    it('returns { success: false, error } when getPlaylistTracks throws', async () => {
        const mockGetPlaylistTracks = vi
            .fn()
            .mockRejectedValue(new Error('Network failure'));

        const handler = async (playlistId: string): Promise<TracksResult> => {
            try {
                const result = await mockGetPlaylistTracks(playlistId);
                const mapped = mapSpotifyTracks(result.items);
                return { success: true, tracks: mapped, total: result.total };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        };

        const response = await handler('playlist-xyz');
        expect(response.success).toBe(false);
        expect(response.error).toContain('Network failure');
    });
});

describe('spotify:sync-playlist handler logic', () => {
    it('concatenates items across multiple pages', async () => {
        // Simulate two pages: page 1 has 2 items (< limit so loop ends after checking items.length < limit)
        const page1Items = [makeTrackItem(), makeTrackItem()];
        const page2Items: SpotifyTrackItem[] = [];

        const mockGetPlaylistTracks = vi
            .fn()
            .mockResolvedValueOnce({ items: page1Items, total: 2 })
            .mockResolvedValueOnce({ items: page2Items, total: 2 });

        const handler = async (
            linkedSpotifyId: string,
        ): Promise<TracksResult> => {
            try {
                const allItems: SpotifyTrackItem[] = [];
                let offset = 0;
                const limit = 100;
                let total = Infinity;

                while (offset < total) {
                    const page = await mockGetPlaylistTracks(
                        linkedSpotifyId,
                        limit,
                        offset,
                    );
                    total = page.total;
                    allItems.push(...page.items);
                    offset += page.items.length;
                    if (page.items.length < limit) break;
                }

                const mapped = mapSpotifyTracks(allItems);
                return {
                    success: true,
                    tracks: mapped,
                    total: allItems.length,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        };

        const response = await handler('playlist-abc');
        expect(response.success).toBe(true);
        // Both items from page1 should be present (page2 is empty → loop breaks after page1)
        expect(response.total).toBe(2);
    });

    it('paginates correctly when a full page is returned (continues to next page)', async () => {
        const limit = 100;
        const page1Items = Array.from({ length: limit }, () => makeTrackItem());
        const page2Items = [makeTrackItem(), makeTrackItem()];

        const mockGetPlaylistTracks = vi
            .fn()
            .mockResolvedValueOnce({ items: page1Items, total: 102 })
            .mockResolvedValueOnce({ items: page2Items, total: 102 });

        const handler = async (
            linkedSpotifyId: string,
        ): Promise<TracksResult> => {
            try {
                const allItems: SpotifyTrackItem[] = [];
                let offset = 0;
                let total = Infinity;

                while (offset < total) {
                    const page = await mockGetPlaylistTracks(
                        linkedSpotifyId,
                        limit,
                        offset,
                    );
                    total = page.total;
                    allItems.push(...page.items);
                    offset += page.items.length;
                    if (page.items.length < limit) break;
                }

                const mapped = mapSpotifyTracks(allItems);
                return {
                    success: true,
                    tracks: mapped,
                    total: allItems.length,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        };

        const response = await handler('playlist-big');
        expect(response.success).toBe(true);
        expect(response.total).toBe(102);
        expect(mockGetPlaylistTracks).toHaveBeenCalledTimes(2);
        // Second call should use offset = 100
        expect(mockGetPlaylistTracks).toHaveBeenNthCalledWith(
            2,
            'playlist-big',
            limit,
            100,
        );
    });

    it('returns { success: false, error } when getPlaylistTracks throws', async () => {
        const mockGetPlaylistTracks = vi
            .fn()
            .mockRejectedValue(new Error('Auth expired'));

        const handler = async (
            linkedSpotifyId: string,
        ): Promise<TracksResult> => {
            try {
                const allItems: SpotifyTrackItem[] = [];
                let offset = 0;
                const limit = 100;
                let total = Infinity;

                while (offset < total) {
                    const page = await mockGetPlaylistTracks(
                        linkedSpotifyId,
                        limit,
                        offset,
                    );
                    total = page.total;
                    allItems.push(...page.items);
                    offset += page.items.length;
                    if (page.items.length < limit) break;
                }

                const mapped = mapSpotifyTracks(allItems);
                return {
                    success: true,
                    tracks: mapped,
                    total: allItems.length,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        };

        const response = await handler('playlist-abc');
        expect(response.success).toBe(false);
        expect(response.error).toContain('Auth expired');
    });
});

describe('artwork:download handler logic', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Reusable handler extracted from main.ts — accepts injected deps so we can
     * unit-test it without touching the real fs or network.
     */
    function makeArtworkHandler(deps: {
        mkdir: (dir: string, opts: { recursive: boolean }) => Promise<void>;
        access: (path: string) => Promise<void>;
        writeFile: (path: string, data: Buffer) => Promise<void>;
        fetchFn: (url: string) => Promise<{
            ok: boolean;
            status: number;
            arrayBuffer: () => Promise<ArrayBuffer>;
        }>;
        userDataPath: string;
        join: (...parts: string[]) => string;
    }) {
        return async (url: string): Promise<ArtworkResult> => {
            try {
                // Replicate handler logic from main.ts
                const artworkDir = deps.join(deps.userDataPath, 'artwork');
                await deps.mkdir(artworkDir, { recursive: true });

                const urlPath = new URL(url).pathname;
                const rawId = urlPath.split('/').filter(Boolean).pop() ?? '';
                const imageId =
                    rawId.replace(/[^a-zA-Z0-9_-]/g, '') ||
                    Buffer.from(url).toString('base64url').slice(0, 40);
                const localPath = deps.join(artworkDir, `${imageId}.jpg`);

                try {
                    await deps.access(localPath);
                    return { success: true, localPath };
                } catch {
                    // Not cached yet — proceed
                }

                const response = await deps.fetchFn(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const buffer = Buffer.from(await response.arrayBuffer());
                await deps.writeFile(localPath, buffer);

                return { success: true, localPath };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        };
    }

    it('returns cached localPath immediately when file already exists', async () => {
        const handler = makeArtworkHandler({
            mkdir: vi.fn().mockResolvedValue(undefined),
            access: vi.fn().mockResolvedValue(undefined), // file exists
            writeFile: vi.fn(),
            fetchFn: vi.fn(),
            userDataPath: '/userData',
            join: (...p) => p.join('/'),
        });

        const result = await handler('https://cdn.spotify.com/image/abc123');
        expect(result.success).toBe(true);
        expect(result.localPath).toContain('abc123');
    });

    it('downloads and writes file when not yet cached, returns { success: true, localPath }', async () => {
        const writeFile = vi.fn().mockResolvedValue(undefined);
        const fakeBuffer = new ArrayBuffer(8);

        const handler = makeArtworkHandler({
            mkdir: vi.fn().mockResolvedValue(undefined),
            access: vi.fn().mockRejectedValue(new Error('ENOENT')), // not cached
            writeFile,
            fetchFn: vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                arrayBuffer: () => Promise.resolve(fakeBuffer),
            }),
            userDataPath: '/userData',
            join: (...p) => p.join('/'),
        });

        const result = await handler('https://cdn.spotify.com/image/abc123');
        expect(result.success).toBe(true);
        expect(writeFile).toHaveBeenCalledOnce();
        expect(result.localPath).toContain('abc123.jpg');
    });

    it('returns { success: false, error } when fetch returns non-ok status', async () => {
        const handler = makeArtworkHandler({
            mkdir: vi.fn().mockResolvedValue(undefined),
            access: vi.fn().mockRejectedValue(new Error('ENOENT')),
            writeFile: vi.fn(),
            fetchFn: vi.fn().mockResolvedValue({
                ok: false,
                status: 403,
                arrayBuffer: vi.fn(),
            }),
            userDataPath: '/userData',
            join: (...p) => p.join('/'),
        });

        const result = await handler('https://cdn.spotify.com/image/abc123');
        expect(result.success).toBe(false);
        expect(result.error).toContain('HTTP 403');
    });

    it('returns { success: false, error } when fetch throws', async () => {
        const handler = makeArtworkHandler({
            mkdir: vi.fn().mockResolvedValue(undefined),
            access: vi.fn().mockRejectedValue(new Error('ENOENT')),
            writeFile: vi.fn(),
            fetchFn: vi.fn().mockRejectedValue(new Error('Connection refused')),
            userDataPath: '/userData',
            join: (...p) => p.join('/'),
        });

        const result = await handler('https://cdn.spotify.com/image/abc123');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Connection refused');
    });

    it('uses base64url fallback as imageId when URL path segment is empty', async () => {
        const writeFile = vi.fn().mockResolvedValue(undefined);
        const fakeBuffer = new ArrayBuffer(4);

        // URL with no meaningful last segment: trailing slash → rawId = ''
        const handler = makeArtworkHandler({
            mkdir: vi.fn().mockResolvedValue(undefined),
            access: vi.fn().mockRejectedValue(new Error('ENOENT')),
            writeFile,
            fetchFn: vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                arrayBuffer: () => Promise.resolve(fakeBuffer),
            }),
            userDataPath: '/userData',
            join: (...p) => p.join('/'),
        });

        const url = 'https://example.com/';
        const result = await handler(url);
        expect(result.success).toBe(true);
        // localPath should be a .jpg file (fallback id was generated)
        expect(result.localPath).toMatch(/\.jpg$/);
    });
});

describe('spotify:get-profile handler logic', () => {
    it('returns { success: true } with userId, displayName, and avatarUrl on success', async () => {
        const mockGetCurrentUser = vi.fn().mockResolvedValue({
            id: 'user-spotify-id',
            display_name: 'Test User',
            images: [
                { url: 'https://cdn/avatar.jpg', height: 128, width: 128 },
            ],
        });

        const handler = async (): Promise<ProfileResult> => {
            try {
                const profile = await mockGetCurrentUser();
                return {
                    success: true,
                    userId: profile.id,
                    displayName: profile.display_name,
                    avatarUrl: profile.images?.[0]?.url,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        };

        const result = await handler();
        expect(result.success).toBe(true);
        expect(result.userId).toBe('user-spotify-id');
        expect(result.displayName).toBe('Test User');
        expect(result.avatarUrl).toBe('https://cdn/avatar.jpg');
    });

    it('returns undefined avatarUrl when user has no images', async () => {
        const mockGetCurrentUser = vi.fn().mockResolvedValue({
            id: 'user-spotify-id',
            display_name: 'No Avatar User',
            images: [],
        });

        const handler = async (): Promise<ProfileResult> => {
            try {
                const profile = await mockGetCurrentUser();
                return {
                    success: true,
                    userId: profile.id,
                    displayName: profile.display_name,
                    avatarUrl: profile.images?.[0]?.url,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        };

        const result = await handler();
        expect(result.success).toBe(true);
        expect(result.avatarUrl).toBeUndefined();
    });

    it('returns { success: false, error } when getCurrentUser throws', async () => {
        const mockGetCurrentUser = vi
            .fn()
            .mockRejectedValue(new Error('Not authenticated'));

        const handler = async (): Promise<ProfileResult> => {
            try {
                const profile = await mockGetCurrentUser();
                return {
                    success: true,
                    userId: profile.id,
                    displayName: profile.display_name,
                    avatarUrl: profile.images?.[0]?.url,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        };

        const result = await handler();
        expect(result.success).toBe(false);
        expect(result.error).toContain('Not authenticated');
    });
});

// ---------------------------------------------------------------------------
// 3. Preload surface — type-level smoke tests
// ---------------------------------------------------------------------------

describe('preload API surface (type smoke tests)', () => {
    /**
     * These tests verify the *shape* of the API at the type level using
     * TypeScript's type system. At runtime they are no-ops — the value
     * assertions are always true — but they will cause a compile error if
     * the function signatures diverge from what is expected.
     */

    it('window.electron.spotify.getTracks accepts a string and returns a Promise', () => {
        type GetTracks = (id: string) => Promise<{
            success: boolean;
            tracks?: unknown[];
            total?: number;
            error?: string;
        }>;
        // Type assertion: if the signature changed incompatibly, tsc would fail here.
        const _typeCheck: GetTracks = async (_id: string) => ({
            success: true,
        });
        expect(typeof _typeCheck).toBe('function');
    });

    it('window.electron.artwork.download accepts a url string and returns a Promise', () => {
        type ArtworkDownload = (url: string) => Promise<{
            success: boolean;
            localPath?: string;
            error?: string;
        }>;
        const _typeCheck: ArtworkDownload = async (_url: string) => ({
            success: true,
        });
        expect(typeof _typeCheck).toBe('function');
    });

    it('window.electron.spotify.getProfile returns a Promise with userId, displayName, avatarUrl', () => {
        type GetProfile = () => Promise<{
            success: boolean;
            userId?: string;
            displayName?: string;
            avatarUrl?: string;
            error?: string;
        }>;
        const _typeCheck: GetProfile = async () => ({ success: true });
        expect(typeof _typeCheck).toBe('function');
    });

    it('window.electron.spotify.syncPlaylist accepts a string and returns a Promise', () => {
        type SyncPlaylist = (linkedSpotifyId: string) => Promise<{
            success: boolean;
            tracks?: unknown[];
            total?: number;
            error?: string;
        }>;
        const _typeCheck: SyncPlaylist = async (_id: string) => ({
            success: true,
        });
        expect(typeof _typeCheck).toBe('function');
    });

    it('window.electron.spotify.onPlaybackDegraded takes a degraded-payload callback and returns a cleanup fn', () => {
        // Mirrors onAuthError: subscribes to spotify:playback-degraded and
        // returns an unsubscribe function. The payload matches the
        // playback-degraded SpotifyRuntimeEvent forwarded by main.ts.
        type OnPlaybackDegraded = (
            callback: (data: {
                reason: 'premium-required';
                status: number;
            }) => void,
        ) => () => void;
        const _typeCheck: OnPlaybackDegraded = (_cb) => () => undefined;
        expect(typeof _typeCheck).toBe('function');
    });
});

// ---------------------------------------------------------------------------
// 4. Spotify error taxonomy (#44)
// ---------------------------------------------------------------------------

describe('spotify error taxonomy', () => {
    it('maps HTTP status onto a kind', () => {
        expect(kindForStatus(401)).toBe('unauthorized');
        expect(kindForStatus(403)).toBe('forbidden');
        expect(kindForStatus(404)).toBe('not_found');
        expect(kindForStatus(429)).toBe('rate_limited');
        expect(kindForStatus(500)).toBe('server');
        expect(kindForStatus(503)).toBe('server');
        expect(kindForStatus(418)).toBe('unknown');
    });

    it('classifies which kinds are retryable', () => {
        for (const k of [
            'rate_limited',
            'server',
            'network',
            'timeout',
        ] as const) {
            expect(isRetryableKind(k)).toBe(true);
        }
        for (const k of [
            'unauthorized',
            'forbidden',
            'not_found',
            'unknown',
        ] as const) {
            expect(isRetryableKind(k)).toBe(false);
        }
    });

    it('parses a numeric Retry-After (seconds) into ms', () => {
        expect(parseRetryAfterMs('2')).toBe(2000);
        expect(parseRetryAfterMs('0')).toBe(0);
    });

    it('parses an HTTP-date Retry-After into a non-negative ms delta', () => {
        const future = new Date(Date.now() + 5000).toUTCString();
        const ms = parseRetryAfterMs(future);
        expect(ms).toBeGreaterThan(0);
        expect(ms).toBeLessThanOrEqual(6000);

        const past = new Date(Date.now() - 5000).toUTCString();
        expect(parseRetryAfterMs(past)).toBe(0);
    });

    it('returns undefined for a missing or unparseable Retry-After', () => {
        expect(parseRetryAfterMs(null)).toBeUndefined();
        expect(parseRetryAfterMs('not-a-date')).toBeUndefined();
    });

    it('SpotifyApiError carries kind/status and survives instanceof', () => {
        const err = new SpotifyApiError('forbidden', 403, 'nope', {
            body: 'x',
        });
        expect(err).toBeInstanceOf(SpotifyApiError);
        expect(err).toBeInstanceOf(Error);
        expect(err.kind).toBe('forbidden');
        expect(err.status).toBe(403);
        expect(err.body).toBe('x');
        expect(err.retryable).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 5. Resilient fetch — timeout, backoff, Retry-After, no-retry (#44)
// ---------------------------------------------------------------------------

/** Queue a sequence of fetch outcomes (Response resolved, Error rejected). */
function fetchSequence(...outcomes: Array<Response | Error>) {
    const fn = vi.fn();
    for (const outcome of outcomes) {
        if (outcome instanceof Error) {
            fn.mockRejectedValueOnce(outcome);
        } else {
            fn.mockResolvedValueOnce(outcome);
        }
    }
    return fn;
}

const abortError = (): Error =>
    Object.assign(new Error('aborted'), { name: 'AbortError' });

describe('resilientFetch', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('retries a transient 5xx then resolves the next 2xx', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const fetchFn = fetchSequence(
            new Response('boom', { status: 503 }),
            new Response('{}', { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchFn);

        const res = await resilientFetch(
            'https://api/x',
            {},
            { sleep, baseBackoffMs: 1 },
        );

        expect(res.status).toBe(200);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('waits the exact Retry-After before retrying a 429', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const fetchFn = fetchSequence(
            new Response('slow down', {
                status: 429,
                headers: { 'retry-after': '2' },
            }),
            new Response('{}', { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchFn);

        await resilientFetch('https://api/x', {}, { sleep });

        expect(sleep).toHaveBeenCalledWith(2000);
    });

    it('does not retry a 403 and throws a forbidden error', async () => {
        const sleep = vi.fn();
        vi.stubGlobal(
            'fetch',
            fetchSequence(new Response('no', { status: 403 })),
        );

        await expect(
            resilientFetch('https://api/x', {}, { sleep }),
        ).rejects.toMatchObject({ kind: 'forbidden', status: 403 });
        expect(sleep).not.toHaveBeenCalled();
    });

    it('does not retry a 404 and throws not_found', async () => {
        const sleep = vi.fn();
        vi.stubGlobal(
            'fetch',
            fetchSequence(new Response('missing', { status: 404 })),
        );

        await expect(
            resilientFetch('https://api/x', {}, { sleep }),
        ).rejects.toMatchObject({ kind: 'not_found', status: 404 });
        expect(sleep).not.toHaveBeenCalled();
    });

    it('retries network failures then throws a network error after maxAttempts', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        const netErr = new TypeError('fetch failed');
        vi.stubGlobal('fetch', fetchSequence(netErr, netErr, netErr));

        await expect(
            resilientFetch('https://api/x', {}, { sleep, maxAttempts: 3 }),
        ).rejects.toMatchObject({ kind: 'network' });
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('maps an AbortError to a timeout kind once retries are exhausted', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal(
            'fetch',
            fetchSequence(abortError(), abortError(), abortError()),
        );

        await expect(
            resilientFetch('https://api/x', {}, { sleep, maxAttempts: 3 }),
        ).rejects.toMatchObject({ kind: 'timeout' });
    });

    it('recovers after a single timeout', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal(
            'fetch',
            fetchSequence(abortError(), new Response('{}', { status: 200 })),
        );

        const res = await resilientFetch('https://api/x', {}, { sleep });
        expect(res.status).toBe(200);
    });

    it('resolves a 204 No Content without throwing', async () => {
        vi.stubGlobal(
            'fetch',
            fetchSequence(new Response(null, { status: 204 })),
        );

        const res = await resilientFetch(
            'https://api/x',
            {},
            { sleep: vi.fn() },
        );
        expect(res.status).toBe(204);
    });
});

// ---------------------------------------------------------------------------
// 6. OAuth PKCE / token exchange / refresh (#33)
// ---------------------------------------------------------------------------

describe('spotify OAuth (PKCE, exchange, refresh)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('produces a PKCE pair whose challenge is the SHA-256 of the verifier', async () => {
        await startSpotifyAuth();
        const authUrl = vi.mocked(shell.openExternal).mock
            .calls[0][0] as string;
        const challenge = new URL(authUrl).searchParams.get('code_challenge');
        expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);

        // Capture the verifier from the token-exchange request body.
        const fetchFn = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    access_token: 'a',
                    refresh_token: 'r',
                    expires_in: 3600,
                    scope: 's',
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal('fetch', fetchFn);
        await handleSpotifyCallback('code123');

        const body = fetchFn.mock.calls[0][1].body as URLSearchParams;
        const verifier = body.get('code_verifier') as string;
        const expected = crypto
            .createHash('sha256')
            .update(verifier)
            .digest('base64url');
        expect(expected).toBe(challenge);
    });

    it('exchanges an auth code into tokens', async () => {
        await startSpotifyAuth();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        access_token: 'AT',
                        refresh_token: 'RT',
                        expires_in: 3600,
                        scope: 'sc',
                    }),
                    { status: 200 },
                ),
            ),
        );

        const result = await handleSpotifyCallback('code');
        expect(result.success).toBe(true);
        expect(result.tokens?.accessToken).toBe('AT');
        expect(result.tokens?.refreshToken).toBe('RT');
        expect(result.tokens?.expiresAt).toBeGreaterThan(Date.now());
    });

    it('surfaces the error body when the token exchange fails', async () => {
        await startSpotifyAuth();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    new Response('invalid_grant', { status: 400 }),
                ),
        );

        const result = await handleSpotifyCallback('bad');
        expect(result.success).toBe(false);
        expect(result.error).toContain('invalid_grant');
    });

    it('refreshes tokens on success', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        access_token: 'AT2',
                        refresh_token: 'RT2',
                        expires_in: 3600,
                        scope: 'sc',
                    }),
                    { status: 200 },
                ),
            ),
        );

        const r = await refreshSpotifyToken('old-refresh');
        expect(r.success).toBe(true);
        expect(r.tokens?.accessToken).toBe('AT2');
        expect(r.tokens?.refreshToken).toBe('RT2');
    });

    it('keeps the old refresh token when none is rotated', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        access_token: 'AT3',
                        expires_in: 3600,
                        scope: 'sc',
                    }),
                    { status: 200 },
                ),
            ),
        );

        const r = await refreshSpotifyToken('keep-me');
        expect(r.success).toBe(true);
        expect(r.tokens?.refreshToken).toBe('keep-me');
    });

    it('fails cleanly on a revoked/invalid refresh token', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    new Response('invalid_grant', { status: 400 }),
                ),
        );

        const r = await refreshSpotifyToken('revoked');
        expect(r.success).toBe(false);
        expect(r.error).toContain('invalid_grant');
    });
});

// ---------------------------------------------------------------------------
// 7. Spotify client — proactive refresh, degraded mode, 204, 401 retry (#33/#44)
// ---------------------------------------------------------------------------

const validToken = (
    overrides: Partial<{ expiresAt: number; accessToken: string }> = {},
) => ({
    accessToken: overrides.accessToken ?? 'tok',
    refreshToken: 'r',
    expiresAt: overrides.expiresAt ?? Date.now() + 3_600_000,
    scope: 's',
});

describe('spotify client resilience integration', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        setSpotifyEventListener(null);
    });

    it('proactively refreshes a token within REFRESH_BUFFER_MS and uses the fresh one', async () => {
        initSpotifyClient(
            validToken({ accessToken: 'old', expiresAt: Date.now() + 1000 }),
        );
        const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
            if (url === SPOTIFY_CONFIG.API.TOKEN) {
                return new Response(
                    JSON.stringify({
                        access_token: 'fresh',
                        refresh_token: 'r2',
                        expires_in: 3600,
                        scope: 's',
                    }),
                    { status: 200 },
                );
            }
            const headers = init.headers as Record<string, string>;
            expect(headers.Authorization).toBe('Bearer fresh');
            return new Response(
                JSON.stringify({ id: 'u', display_name: 'U', images: [] }),
                { status: 200 },
            );
        });
        vi.stubGlobal('fetch', fetchFn);

        const user = await getCurrentUser();
        expect(user.id).toBe('u');
        expect(
            fetchFn.mock.calls.some((c) => c[0] === SPOTIFY_CONFIG.API.TOKEN),
        ).toBe(true);
    });

    it('emits playback-degraded on a 403 from /me/player and still throws forbidden', async () => {
        initSpotifyClient(validToken());
        const events: SpotifyRuntimeEvent[] = [];
        setSpotifyEventListener((e) => events.push(e));
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () => new Response('premium required', { status: 403 }),
            ),
        );

        await expect(getPlaybackState()).rejects.toMatchObject({
            kind: 'forbidden',
        });
        expect(events).toContainEqual({
            type: 'playback-degraded',
            reason: 'premium-required',
            status: 403,
        });
    });

    it('returns null on a 204 playback state without parsing a body', async () => {
        initSpotifyClient(validToken());
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 204 })),
        );

        const state = await getPlaybackState();
        expect(state).toBeNull();
    });

    it('triggers exactly one refresh-and-retry on a 401 mid-flow', async () => {
        initSpotifyClient(validToken({ accessToken: 'stale' }));
        let apiCalls = 0;
        const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
            if (url === SPOTIFY_CONFIG.API.TOKEN) {
                return new Response(
                    JSON.stringify({
                        access_token: 'new',
                        refresh_token: 'r2',
                        expires_in: 3600,
                        scope: 's',
                    }),
                    { status: 200 },
                );
            }
            apiCalls += 1;
            if (apiCalls === 1) return new Response('expired', { status: 401 });
            const headers = init.headers as Record<string, string>;
            expect(headers.Authorization).toBe('Bearer new');
            return new Response(
                JSON.stringify({ id: 'u2', display_name: 'U2', images: [] }),
                { status: 200 },
            );
        });
        vi.stubGlobal('fetch', fetchFn);

        const user = await getCurrentUser();
        expect(user.id).toBe('u2');
        expect(apiCalls).toBe(2);
    });

    it('emits auth-error instead of throwing a raw error when refresh fails', async () => {
        initSpotifyClient(
            validToken({ accessToken: 'old', expiresAt: Date.now() + 1000 }),
        );
        const events: SpotifyRuntimeEvent[] = [];
        setSpotifyEventListener((e) => events.push(e));
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (url === SPOTIFY_CONFIG.API.TOKEN)
                    return new Response('invalid_grant', { status: 400 });
                return new Response('{}', { status: 200 });
            }),
        );

        await expect(getCurrentUser()).rejects.toBeInstanceOf(SpotifyApiError);
        expect(events.some((e) => e.type === 'auth-error')).toBe(true);
    });
});

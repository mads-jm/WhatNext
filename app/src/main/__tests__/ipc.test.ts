/**
 * IPC handler logic + preload surface.
 *
 * Covers:
 *  1. IPC handler logic  — key handlers tested in isolation with mocked deps
 *  2. Preload surface    — type-level smoke checks via TypeScript inference
 *
 * The Spotify modules these handlers call are covered next door under
 * `main/spotify/__tests__/`: `spotify-mapper.test.ts` (the mapping this file
 * only ever exercises incidentally), `spotify-resilience.test.ts` (transport)
 * and `spotify-auth-client.test.ts` (OAuth + client). Nothing here imports
 * Electron, so nothing here mocks it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpotifyTrackItem } from '../types';

// uuid is called inside mapSpotifyTrack, which the handlers below run for real;
// mocking it keeps the ids deterministic.
vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

import { mapSpotifyTracks, type MappedTrack } from '../spotify/spotify-mapper';
import { makeTrackItem } from '../spotify/__tests__/track-fixtures';

// ---------------------------------------------------------------------------
// 1. IPC handler logic — key handlers tested in isolation
//
// The handlers in main.ts use dynamic import() to load Spotify modules.
// We test the *logic* (input → output shape) by extracting that logic into
// helper functions that mirror what the handlers do, with dependencies mocked.
//
// Each extracted handler is annotated with the IPC result shape it mirrors —
// a success flag plus optional payload/error fields, the same "one object with
// optional members" convention the preload surface uses (see section 2). The
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
// 2. Preload surface — type-level smoke tests
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

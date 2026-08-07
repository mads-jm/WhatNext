/**
 * Spotify auth + client — OAuth PKCE (#33) and the client's resilience
 * integration (#33/#44).
 *
 * These two layers share one file because they share one state machine: the
 * client's proactive refresh and its 401 refresh-and-retry both run through
 * `spotify-auth`, so exercising them against the same module instance is the
 * point, not an accident.
 *
 * They are the only Spotify suites that need Electron mocked — `spotify-auth`
 * imports `shell` and the token store reaches for `app.getPath` / `safeStorage`.
 * The token store itself is mocked out so no encrypted file is ever written.
 * The transport layer underneath is covered in `spotify-resilience.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('electron', () => ({
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    app: { getPath: vi.fn(() => '/tmp') },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString('utf-8'),
    },
}));

vi.mock('../token-store', () => ({
    saveTokens: vi.fn(),
    loadTokens: vi.fn(() => null),
    clearTokens: vi.fn(),
    hasTokens: vi.fn(() => false),
}));

import crypto from 'node:crypto';
import { shell } from 'electron';
import { SPOTIFY_CONFIG } from '../../../shared/spotify-config';
import { SpotifyApiError } from '../spotify-errors';
import {
    setSpotifyEventListener,
    type SpotifyRuntimeEvent,
} from '../spotify-events';
import {
    startSpotifyAuth,
    handleSpotifyCallback,
    refreshSpotifyToken,
} from '../spotify-auth';
import {
    initSpotifyClient,
    getCurrentUser,
    getPlaybackState,
} from '../spotify-client';

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
// Spotify client — proactive refresh, degraded mode, 204, 401 retry (#33/#44)
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

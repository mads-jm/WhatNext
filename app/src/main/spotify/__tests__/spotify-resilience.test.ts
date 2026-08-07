/**
 * Spotify transport layer — error taxonomy and resilient fetch (#44).
 *
 * Owns `spotify-errors.ts` (status → kind, retryability, `Retry-After` parsing,
 * the `SpotifyApiError` shape) and `spotify-resilience.ts` (retry, backoff,
 * timeout, and the statuses that must *not* be retried).
 *
 * Both modules are deliberately transport-only — they know nothing about tokens
 * or Electron — so this file mocks nothing but the global `fetch`. The auth and
 * client layers built on top are covered in `spotify-auth-client.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    SpotifyApiError,
    kindForStatus,
    isRetryableKind,
    parseRetryAfterMs,
} from '../spotify-errors';
import { resilientFetch } from '../spotify-resilience';

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

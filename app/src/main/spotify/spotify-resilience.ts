/**
 * Resilience wrapper around `fetch` for the Spotify client.
 *
 * Deliberately transport-only — it knows nothing about tokens or auth, which
 * stay in spotify-client. Responsibilities:
 *  - per-request timeout via `AbortController`
 *  - bounded exponential backoff for transient failures
 *  - `Retry-After`-aware waiting for 429 rate limits
 *
 * Non-retryable kinds (401/403/404) are thrown immediately so the caller can
 * branch (refresh-and-retry for 401, degrade for 403, etc.).
 */

import { SpotifyApiError, errorFromResponse } from './spotify-errors';

export interface ResilienceOptions {
    /** Abort a single attempt after this many ms. */
    timeoutMs: number;
    /** Total attempts including the first (so 3 = 1 try + 2 retries). */
    maxAttempts: number;
    /** First backoff step; doubles each retry. */
    baseBackoffMs: number;
    /** Upper bound on a single backoff wait. */
    maxBackoffMs: number;
    /** Injectable delay — overridden in tests to avoid real timers. */
    sleep: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/** Conservative defaults suitable for both reads and playback control. */
export const DEFAULT_RESILIENCE: ResilienceOptions = {
    timeoutMs: 15_000,
    maxAttempts: 3,
    baseBackoffMs: 500,
    maxBackoffMs: 8_000,
    sleep: realSleep,
};

/** Exponential backoff for a 1-based attempt number, capped at maxBackoffMs. */
function backoffDelayMs(
    attempt: number,
    baseBackoffMs: number,
    maxBackoffMs: number,
): number {
    const exp = baseBackoffMs * 2 ** (attempt - 1);
    return Math.min(exp, maxBackoffMs);
}

async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function toTransportError(err: unknown): SpotifyApiError {
    if (err instanceof SpotifyApiError) return err;
    if (err instanceof Error && err.name === 'AbortError') {
        return new SpotifyApiError('timeout', 0, 'Spotify request timed out');
    }
    const message = err instanceof Error ? err.message : String(err);
    return new SpotifyApiError(
        'network',
        0,
        `Spotify network error: ${message}`,
    );
}

/**
 * Perform a fetch with timeout + bounded retry/backoff.
 *
 * Resolves with the raw `Response` for any 2xx (including 204). Throws a
 * `SpotifyApiError` for non-retryable failures, or after exhausting retries.
 */
export async function resilientFetch(
    url: string,
    init: RequestInit = {},
    options: Partial<ResilienceOptions> = {},
): Promise<Response> {
    const opts: ResilienceOptions = { ...DEFAULT_RESILIENCE, ...options };
    let lastError: SpotifyApiError | undefined;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        let response: Response;
        try {
            response = await fetchWithTimeout(url, init, opts.timeoutMs);
        } catch (err) {
            // Transport failure (network/timeout) — always retryable.
            lastError = toTransportError(err);
            if (attempt < opts.maxAttempts) {
                await opts.sleep(
                    backoffDelayMs(
                        attempt,
                        opts.baseBackoffMs,
                        opts.maxBackoffMs,
                    ),
                );
                continue;
            }
            throw lastError;
        }

        if (response.ok) {
            return response;
        }

        const apiError = await errorFromResponse(response);
        if (!apiError.retryable || attempt >= opts.maxAttempts) {
            throw apiError;
        }

        lastError = apiError;
        // Honor Retry-After exactly (rate-limit compliance) rather than capping
        // it; maxAttempts already bounds total exposure. Fall back to backoff
        // when the header is missing/unparseable.
        const delay =
            apiError.kind === 'rate_limited' &&
            apiError.retryAfterMs !== undefined
                ? apiError.retryAfterMs
                : backoffDelayMs(
                      attempt,
                      opts.baseBackoffMs,
                      opts.maxBackoffMs,
                  );
        console.warn(
            `[Spotify] ${apiError.kind} (status ${apiError.status}); ` +
                `retry ${attempt}/${opts.maxAttempts - 1} in ${delay}ms`,
        );
        await opts.sleep(delay);
    }

    // The loop always returns or throws, but TypeScript needs a terminal throw.
    throw (
        lastError ?? new SpotifyApiError('unknown', 0, 'Spotify request failed')
    );
}

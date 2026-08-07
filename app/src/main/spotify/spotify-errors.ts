/**
 * Spotify API error taxonomy.
 *
 * Replaces the previous single generic `throw new Error('Spotify API error …')`
 * with a typed error that callers and the renderer can branch on. The `kind`
 * discriminator maps Spotify's HTTP semantics onto a small closed set, plus the
 * two transport failures (`network`, `timeout`) that carry no status code.
 */

export type SpotifyErrorKind =
    | 'unauthorized' // 401 — token rejected; trigger a single refresh-and-retry
    | 'forbidden' // 403 — Premium-or-scope; on playback this degrades the session
    | 'not_found' // 404
    | 'rate_limited' // 429 — honor Retry-After, then retry
    | 'server' // 5xx — transient, retry with backoff
    | 'network' // fetch rejected without a response
    | 'timeout' // AbortController fired before a response arrived
    | 'unknown'; // any other non-2xx status

/** Kinds that are safe to retry. 401/403/404 are deliberately excluded. */
export function isRetryableKind(kind: SpotifyErrorKind): boolean {
    return (
        kind === 'rate_limited' ||
        kind === 'server' ||
        kind === 'network' ||
        kind === 'timeout'
    );
}

/** Map a non-2xx HTTP status onto a taxonomy kind. */
export function kindForStatus(status: number): SpotifyErrorKind {
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'server';
    return 'unknown';
}

/**
 * Parse a `Retry-After` header into milliseconds.
 *
 * Spotify documents this as an integer number of seconds, but the HTTP spec
 * also permits an HTTP-date, so both are handled. Returns `undefined` when the
 * header is absent or unparseable, leaving the caller to fall back to backoff.
 */
export function parseRetryAfterMs(header: string | null): number | undefined {
    if (!header) return undefined;

    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.round(seconds * 1000);
    }

    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
        const delta = dateMs - Date.now();
        return delta > 0 ? delta : 0;
    }

    return undefined;
}

export interface SpotifyApiErrorOptions {
    retryAfterMs?: number;
    body?: string;
}

/** Typed Spotify API error carrying the taxonomy kind, status, and context. */
export class SpotifyApiError extends Error {
    readonly kind: SpotifyErrorKind;
    /** HTTP status, or 0 for transport failures (`network`/`timeout`). */
    readonly status: number;
    /** Present (and honored by the retry layer) only for `rate_limited`. */
    readonly retryAfterMs?: number;
    /** Raw response body, when one was read. */
    readonly body: string;

    constructor(
        kind: SpotifyErrorKind,
        status: number,
        message: string,
        options: SpotifyApiErrorOptions = {},
    ) {
        super(message);
        this.name = 'SpotifyApiError';
        this.kind = kind;
        this.status = status;
        this.retryAfterMs = options.retryAfterMs;
        this.body = options.body ?? '';
        // Restore the prototype chain so `instanceof` survives transpilation of
        // a built-in `Error` subclass to older targets.
        Object.setPrototypeOf(this, SpotifyApiError.prototype);
    }

    get retryable(): boolean {
        return isRetryableKind(this.kind);
    }
}

/**
 * Build a typed error from a non-ok `Response`, consuming its body once.
 * Only call this when `response.ok` is false.
 */
export async function errorFromResponse(
    response: Response,
): Promise<SpotifyApiError> {
    const body = await response.text().catch(() => '(no body)');
    const kind = kindForStatus(response.status);
    const retryAfterMs =
        kind === 'rate_limited'
            ? parseRetryAfterMs(response.headers.get('retry-after'))
            : undefined;

    return new SpotifyApiError(
        kind,
        response.status,
        `Spotify API error ${response.status}: ${body}`,
        { retryAfterMs, body },
    );
}

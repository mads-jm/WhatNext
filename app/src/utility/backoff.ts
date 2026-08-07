/**
 * Exponential backoff with jitter (#41).
 *
 * Pure, dependency-free helper so the schedule is unit-testable independent of
 * any libp2p/relay wiring. Replaces the fixed-interval relay reconnect that
 * hammered a downed relay every 10s in lockstep.
 */

export interface BackoffOptions {
    /** Base delay in ms (the delay before/at attempt 0, pre-jitter). */
    baseMs: number;
    /** Hard ceiling for a single computed delay, pre-jitter. */
    maxMs: number;
    /** Multiplier applied per attempt (e.g. 2 doubles each time). */
    factor: number;
    /**
     * Jitter fraction in [0, 1]. With "equal jitter" the returned delay is
     * randomized within [d/2, d] when jitter is 1, scaling linearly: the random
     * portion spans `jitter * d / 2`. 0 disables jitter (deterministic).
     */
    jitter: number;
}

/**
 * Compute the delay (ms) before the given retry `attempt` (0-indexed).
 *
 * The deterministic component is `min(maxMs, baseMs * factor^attempt)`. Jitter
 * then subtracts up to `jitter * d / 2` so concurrent peers desynchronize. The
 * `rng` parameter is injectable for deterministic tests (defaults to Math.random).
 */
export function computeBackoffDelay(
    attempt: number,
    options: BackoffOptions,
    rng: () => number = Math.random,
): number {
    const safeAttempt = attempt < 0 ? 0 : attempt;
    const raw = options.baseMs * Math.pow(options.factor, safeAttempt);
    const capped = Math.min(options.maxMs, raw);

    const jitter = Math.max(0, Math.min(1, options.jitter));
    if (jitter === 0) {
        return capped;
    }

    // Equal-jitter: keep the lower half fixed, randomize the upper portion.
    const randomSpan = (jitter * capped) / 2;
    const delay = capped - randomSpan + rng() * randomSpan;
    return Math.round(delay);
}

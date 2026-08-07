import { describe, it, expect } from 'vitest';
import { computeBackoffDelay, type BackoffOptions } from '../backoff';

const OPTS: BackoffOptions = {
    baseMs: 1000,
    maxMs: 30000,
    factor: 2,
    jitter: 0,
};

describe('computeBackoffDelay', () => {
    it('grows exponentially with no jitter', () => {
        expect(computeBackoffDelay(0, OPTS)).toBe(1000);
        expect(computeBackoffDelay(1, OPTS)).toBe(2000);
        expect(computeBackoffDelay(2, OPTS)).toBe(4000);
        expect(computeBackoffDelay(3, OPTS)).toBe(8000);
    });

    it('caps at maxMs', () => {
        expect(computeBackoffDelay(100, OPTS)).toBe(30000);
    });

    it('treats negative attempts as attempt 0', () => {
        expect(computeBackoffDelay(-5, OPTS)).toBe(1000);
    });

    it('keeps jittered delays within [d/2, d] of the capped value', () => {
        const jittered: BackoffOptions = { ...OPTS, jitter: 1 };
        const d = 4000; // attempt 2 capped value
        for (let i = 0; i < 100; i++) {
            const delay = computeBackoffDelay(2, jittered);
            expect(delay).toBeGreaterThanOrEqual(d / 2);
            expect(delay).toBeLessThanOrEqual(d);
        }
    });

    it('uses the injected rng deterministically (equal jitter)', () => {
        const jittered: BackoffOptions = { ...OPTS, jitter: 1 };
        // rng=1 -> top of the range == capped value; rng=0 -> bottom == d/2.
        expect(computeBackoffDelay(2, jittered, () => 1)).toBe(4000);
        expect(computeBackoffDelay(2, jittered, () => 0)).toBe(2000);
    });

    it('produces strictly increasing un-jittered intervals across attempts', () => {
        const delays = [0, 1, 2, 3, 4].map((a) => computeBackoffDelay(a, OPTS));
        for (let i = 1; i < delays.length; i++) {
            expect(delays[i]).toBeGreaterThan(delays[i - 1]);
        }
    });
});

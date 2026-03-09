import { describe, it, expect } from 'vitest';
import { formatDuration, formatTotalDuration, formatTimeAgo } from '../format';

describe('formatDuration', () => {
    it('formats 0ms as 0:00', () => {
        expect(formatDuration(0)).toBe('0:00');
    });

    it('formats sub-minute (45s)', () => {
        expect(formatDuration(45000)).toBe('0:45');
    });

    it('formats exactly 1 minute', () => {
        expect(formatDuration(60000)).toBe('1:00');
    });

    it('formats 90 seconds as 1:30', () => {
        expect(formatDuration(90000)).toBe('1:30');
    });

    it('pads seconds with leading zero', () => {
        expect(formatDuration(65000)).toBe('1:05');
    });

    it('formats large values without hours (3661s = 61:01)', () => {
        // formatDuration only does m:ss — no hour handling
        expect(formatDuration(3661000)).toBe('61:01');
    });
});

describe('formatTotalDuration', () => {
    it('formats 0ms as 0m', () => {
        expect(formatTotalDuration(0)).toBe('0m');
    });

    it('formats 59 minutes', () => {
        expect(formatTotalDuration(59 * 60000)).toBe('59m');
    });

    it('formats exactly 1 hour as 1h 0m', () => {
        expect(formatTotalDuration(3600000)).toBe('1h 0m');
    });

    it('formats 1 hour 30 minutes', () => {
        expect(formatTotalDuration(90 * 60000)).toBe('1h 30m');
    });

    it('formats sub-minute duration as 0m', () => {
        expect(formatTotalDuration(30000)).toBe('0m');
    });
});

describe('formatTimeAgo', () => {
    function ago(ms: number): string {
        return formatTimeAgo(new Date(Date.now() - ms).toISOString());
    }

    it('returns "just now" for less than 1 minute ago', () => {
        expect(ago(30000)).toBe('just now');
        expect(ago(59999)).toBe('just now');
    });

    it('returns "1m ago" at exactly 1 minute', () => {
        expect(ago(60000)).toBe('1m ago');
    });

    it('returns "59m ago" at 59 minutes', () => {
        expect(ago(59 * 60000)).toBe('59m ago');
    });

    it('returns "1h ago" at exactly 1 hour', () => {
        expect(ago(60 * 60000)).toBe('1h ago');
    });

    it('returns "23h ago" at 23 hours', () => {
        expect(ago(23 * 60 * 60000)).toBe('23h ago');
    });

    it('returns "1d ago" at exactly 24 hours', () => {
        expect(ago(24 * 60 * 60000)).toBe('1d ago');
    });

    it('returns "7d ago" at 7 days', () => {
        expect(ago(7 * 24 * 60 * 60000)).toBe('7d ago');
    });
});

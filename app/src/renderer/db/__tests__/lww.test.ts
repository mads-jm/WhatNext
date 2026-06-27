import { describe, it, expect } from 'vitest';
import { parseTimestampMs, resolveTimestampMs, incomingWins, stableStringify, contentKey } from '../lww';

describe('parseTimestampMs', () => {
    it('parses an ISO-8601 string to epoch ms', () => {
        expect(parseTimestampMs('2026-06-27T00:00:00.000Z')).toBe(Date.parse('2026-06-27T00:00:00.000Z'));
    });

    it('parses ISO strings of differing precision to the same instant', () => {
        // The exact bug string comparison missed: same instant, different precision.
        const a = parseTimestampMs('2026-06-27T12:00:00Z');
        const b = parseTimestampMs('2026-06-27T12:00:00.000Z');
        expect(a).toBe(b);
    });

    it('accepts a numeric epoch-ms value as-is', () => {
        expect(parseTimestampMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    });

    it.each([undefined, null, '', '   ', 'not-a-date', {}, NaN])(
        'maps unparseable/missing value %p to 0',
        (value) => {
            expect(parseTimestampMs(value as unknown)).toBe(0);
        }
    );
});

describe('resolveTimestampMs', () => {
    it('prefers updatedAt over addedAt', () => {
        const ms = resolveTimestampMs({
            updatedAt: '2026-06-27T00:00:00.000Z',
            addedAt: '2020-01-01T00:00:00.000Z',
        });
        expect(ms).toBe(Date.parse('2026-06-27T00:00:00.000Z'));
    });

    it('falls back to addedAt when updatedAt is missing', () => {
        const ms = resolveTimestampMs({ addedAt: '2020-01-01T00:00:00.000Z' });
        expect(ms).toBe(Date.parse('2020-01-01T00:00:00.000Z'));
    });

    it('returns 0 when neither field is parseable', () => {
        expect(resolveTimestampMs({ updatedAt: 'x', addedAt: 'y' })).toBe(0);
    });
});

describe('incomingWins', () => {
    it('lets the strictly-later timestamp win', () => {
        expect(
            incomingWins(
                { updatedAt: '2026-06-27T00:00:01.000Z' },
                { updatedAt: '2026-06-27T00:00:00.000Z' }
            )
        ).toBe(true);
    });

    it('keeps the existing version when incoming is older', () => {
        expect(
            incomingWins(
                { updatedAt: '2026-06-27T00:00:00.000Z' },
                { updatedAt: '2026-06-27T00:00:01.000Z' }
            )
        ).toBe(false);
    });

    it('treats differing-precision equal instants as a tie (not a win)', () => {
        // Pure string compare would treat these as unequal; epoch-ms sees a tie.
        expect(
            incomingWins(
                { updatedAt: '2026-06-27T12:00:00Z', tiebreak: 'a' },
                { updatedAt: '2026-06-27T12:00:00.000Z', tiebreak: 'a' }
            )
        ).toBe(false);
    });

    it('breaks an exact timestamp tie deterministically by content key', () => {
        const older = { updatedAt: '2026-06-27T12:00:00.000Z', tiebreak: 'aaa' };
        const newerKey = { updatedAt: '2026-06-27T12:00:00.000Z', tiebreak: 'zzz' };
        // The larger key wins, and the decision is symmetric: whichever side is
        // "incoming", the SAME version (zzz) ends up the winner → peers converge.
        expect(incomingWins(newerKey, older)).toBe(true);
        expect(incomingWins(older, newerKey)).toBe(false);
    });

    it('does not overwrite when timestamps and tiebreak are identical', () => {
        const v = { updatedAt: '2026-06-27T12:00:00.000Z', tiebreak: 'same' };
        expect(incomingWins({ ...v }, { ...v })).toBe(false);
    });

    it('treats a missing/unparseable incoming timestamp as oldest (loses)', () => {
        expect(
            incomingWins({ updatedAt: undefined }, { updatedAt: '2026-06-27T12:00:00.000Z' })
        ).toBe(false);
    });
});

describe('contentKey (cross-peer tie-break symmetry)', () => {
    it('drops id, timestamps, and RxDB-internal underscore fields', () => {
        // The exact asymmetry the bug had: a transmitted `data` payload (no id,
        // no updatedAt) vs a full RxDocument.toJSON() (id, updatedAt, addedAt,
        // _rev, _meta) must project to the SAME key.
        const transmitted = { name: 'Road Trip', tracks: 3 };
        const stored = {
            id: 'pl-1',
            name: 'Road Trip',
            tracks: 3,
            updatedAt: '2026-06-27T12:00:00.000Z',
            addedAt: '2026-01-01T00:00:00.000Z',
            _rev: '5-abc',
            _meta: { lwt: 123 },
            _attachments: {},
            _deleted: false,
        };
        expect(contentKey(transmitted)).toBe(contentKey(stored));
    });

    it('still distinguishes genuinely different content', () => {
        expect(contentKey({ name: 'A' })).not.toBe(contentKey({ name: 'B' }));
    });

    it('is order-independent for user keys', () => {
        expect(contentKey({ a: 1, b: 2 })).toBe(contentKey({ b: 2, a: 1 }));
    });

    it('makes the LWW tie-break converge across peers despite shape asymmetry', () => {
        // Two versions, identical timestamp. Peer P holds vP and receives vQ;
        // peer Q holds vQ and receives vP. The transmitted payload is user-only;
        // the stored doc carries RxDB internals. Both peers must elect the SAME
        // winner. Without contentKey, P and Q compared heterogeneous strings and
        // could diverge.
        const ts = '2026-06-27T12:00:00.000Z';
        const vP_data = { name: 'P-edit' };
        const vQ_data = { name: 'Q-edit' };
        const stored = (data: Record<string, unknown>) => ({
            id: 'pl-1',
            ...data,
            updatedAt: ts,
            _rev: '9-zzz',
            _meta: { lwt: 999 },
        });

        // On P: incoming = vQ payload, existing = stored vP.
        const qWinsOnP = incomingWins(
            { updatedAt: ts, tiebreak: contentKey(vQ_data) },
            { updatedAt: ts, tiebreak: contentKey(stored(vP_data)) }
        );
        // On Q: incoming = vP payload, existing = stored vQ.
        const pWinsOnQ = incomingWins(
            { updatedAt: ts, tiebreak: contentKey(vP_data) },
            { updatedAt: ts, tiebreak: contentKey(stored(vQ_data)) }
        );

        // Convergence: exactly one side's version is the winner on BOTH peers.
        // qWinsOnP === true  ⟺  pWinsOnQ === false (they agree vQ wins), and
        // qWinsOnP === false ⟺  pWinsOnQ === true  (they agree vP wins).
        expect(qWinsOnP).toBe(!pWinsOnQ);
    });
});

describe('stableStringify', () => {
    it('produces identical output regardless of key order', () => {
        expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    });

    it('sorts nested object keys too', () => {
        expect(stableStringify({ outer: { y: 1, x: 2 } })).toBe(
            stableStringify({ outer: { x: 2, y: 1 } })
        );
    });

    it('preserves array order (arrays are not reordered)', () => {
        expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
    });
});

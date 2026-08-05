import { describe, it, expect } from 'vitest';
import {
    parseTimestampMs,
    resolveTimestampMs,
    incomingWins,
    stableStringify,
    contentKey,
    envelopeCandidate,
    storedCandidate,
} from '../lww';

describe('parseTimestampMs', () => {
    it('parses an ISO-8601 string to epoch ms', () => {
        expect(parseTimestampMs('2026-06-27T00:00:00.000Z')).toBe(
            Date.parse('2026-06-27T00:00:00.000Z'),
        );
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
        },
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
                { updatedAt: '2026-06-27T00:00:00.000Z' },
            ),
        ).toBe(true);
    });

    it('keeps the existing version when incoming is older', () => {
        expect(
            incomingWins(
                { updatedAt: '2026-06-27T00:00:00.000Z' },
                { updatedAt: '2026-06-27T00:00:01.000Z' },
            ),
        ).toBe(false);
    });

    it('treats differing-precision equal instants as a tie (not a win)', () => {
        // Pure string compare would treat these as unequal; epoch-ms sees a tie.
        expect(
            incomingWins(
                { updatedAt: '2026-06-27T12:00:00Z', tiebreak: 'a' },
                { updatedAt: '2026-06-27T12:00:00.000Z', tiebreak: 'a' },
            ),
        ).toBe(false);
    });

    it('breaks an exact timestamp tie deterministically by content key', () => {
        const older = {
            updatedAt: '2026-06-27T12:00:00.000Z',
            tiebreak: 'aaa',
        };
        const newerKey = {
            updatedAt: '2026-06-27T12:00:00.000Z',
            tiebreak: 'zzz',
        };
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
            incomingWins(
                { updatedAt: undefined },
                { updatedAt: '2026-06-27T12:00:00.000Z' },
            ),
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
            { updatedAt: ts, tiebreak: contentKey(stored(vP_data)) },
        );
        // On Q: incoming = vP payload, existing = stored vQ.
        const pWinsOnQ = incomingWins(
            { updatedAt: ts, tiebreak: contentKey(vP_data) },
            { updatedAt: ts, tiebreak: contentKey(stored(vQ_data)) },
        );

        // Convergence: exactly one side's version is the winner on BOTH peers.
        // qWinsOnP === true  ⟺  pWinsOnQ === false (they agree vQ wins), and
        // qWinsOnP === false ⟺  pWinsOnQ === true  (they agree vP wins).
        expect(qWinsOnP).toBe(!pWinsOnQ);
    });

    it('excludes device-local fields so the existing-side key matches the stripped incoming key', () => {
        // The sender strips device-local fields (localFilePath etc.) from the
        // transmitted payload; the receiver's stored doc retains them. Both keys
        // must still match for the same user content.
        const transmitted = { name: 'Song', artist: 'Band' };
        const stored = {
            id: 'tr-1',
            name: 'Song',
            artist: 'Band',
            updatedAt: '2026-06-27T12:00:00.000Z',
            localFilePath: '/home/peer/music/song.flac',
            localFileSize: 4096,
            albumArtLocalPath: '/home/peer/art/song.jpg',
            coverArtLocalPath: '/home/peer/art/cover.jpg',
            _rev: '3-xyz',
        };
        expect(contentKey(transmitted)).toBe(contentKey(stored));
    });

    it('converges on a tie even when only one peer has device-local fields set', () => {
        // Regression for the non-convergent tie-break: peer P has downloaded the
        // file (localFilePath set on its STORED doc) while peer Q has not. Each
        // peer receives the other's stripped payload at the exact same timestamp.
        // Both must elect the SAME winner. Before the fix, the existing-side key
        // carried localFilePath (sorting before `name`), so the incoming side
        // always won on BOTH peers — they swapped content and oscillated forever.
        const ts = '2026-06-27T12:00:00.000Z';
        const vP_data = { name: 'P-edit', artist: 'Band' };
        const vQ_data = { name: 'Q-edit', artist: 'Band' };
        // P has the local file downloaded; Q does not.
        const storedP = {
            id: 'tr-1',
            ...vP_data,
            updatedAt: ts,
            localFilePath: '/home/p/song.flac',
            localFileSize: 4096,
            _rev: '7-aaa',
        };
        const storedQ = {
            id: 'tr-1',
            ...vQ_data,
            updatedAt: ts,
            _rev: '7-bbb',
        };

        // On P: incoming = vQ stripped payload, existing = stored vP (with localFilePath).
        const qWinsOnP = incomingWins(
            { updatedAt: ts, tiebreak: contentKey(vQ_data) },
            { updatedAt: ts, tiebreak: contentKey(storedP) },
        );
        // On Q: incoming = vP stripped payload, existing = stored vQ (no localFilePath).
        const pWinsOnQ = incomingWins(
            { updatedAt: ts, tiebreak: contentKey(vP_data) },
            { updatedAt: ts, tiebreak: contentKey(storedQ) },
        );

        // Convergence: the peers must agree on a single winner.
        expect(qWinsOnP).toBe(!pWinsOnQ);
    });
});

describe('stableStringify', () => {
    it('produces identical output regardless of key order', () => {
        expect(stableStringify({ a: 1, b: 2 })).toBe(
            stableStringify({ b: 2, a: 1 }),
        );
    });

    it('sorts nested object keys too', () => {
        expect(stableStringify({ outer: { y: 1, x: 2 } })).toBe(
            stableStringify({ outer: { x: 2, y: 1 } }),
        );
    });

    it('preserves array order (arrays are not reordered)', () => {
        expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
    });
});

describe('app ↔ test-peer LWW parity (#58)', () => {
    // These exercise the exact functions BOTH peers run. The app merges an
    // incoming envelope against a stored RxDocument
    // (replication-handler.ts: incomingWins(envelopeCandidate, storedCandidate));
    // the test peer merges an incoming envelope against a stored envelope
    // (test-peer/src/session-store.js applyLWW: incomingWins(envelopeCandidate,
    // envelopeCandidate)). Both import app/src/shared/lww/index.js, so covering
    // the shared functions here covers the test peer's merge by construction —
    // no test runner is added to test-peer/.
    const TS = '2026-06-27T12:00:00.000Z';

    /** The wire shape: {id, data, updatedAt}. `data` still carries id/updatedAt. */
    const envelope = (data: Record<string, unknown>) => ({
        id: data.id as string,
        data,
        updatedAt: TS,
    });

    const appEdit = {
        id: 'tr-1',
        title: 'App edit',
        artists: ['Band'],
        updatedAt: TS,
    };
    const peerEdit = {
        id: 'tr-1',
        title: 'Peer edit',
        artists: ['Band'],
        updatedAt: TS,
    };

    it('converges on the same winner when both sides edit the same doc at the same timestamp', () => {
        // The app's stored copy is an RxDocument: RxDB internals plus a
        // device-local field the wire payload never carried.
        const appStored = {
            ...appEdit,
            _rev: '4-aaa',
            _meta: { lwt: 1 },
            localFilePath: '/home/a/tr-1.flac',
        };

        // App receives the peer's edit.
        const peerWinsOnApp = incomingWins(
            envelopeCandidate(envelope(peerEdit)),
            storedCandidate(appStored),
        );
        // Test peer receives the app's edit; its stored copy is the peer's own envelope.
        const appWinsOnPeer = incomingWins(
            envelopeCandidate(envelope(appEdit)),
            envelopeCandidate(envelope(peerEdit)),
        );

        // Exactly one version survives, and it is the SAME one on both sides.
        expect(peerWinsOnApp).toBe(!appWinsOnPeer);
        const appHolds = peerWinsOnApp ? peerEdit.title : appEdit.title;
        const peerHolds = appWinsOnPeer ? appEdit.title : peerEdit.title;
        expect(appHolds).toBe(peerHolds);
    });

    it('is the divergence the test peer had: a raw string compare never breaks a tie', () => {
        // Regression pin for the pre-#54 semantics the test peer still carried:
        // `incoming.updatedAt > existing.updatedAt` is false on an exact tie, so
        // the peer ALWAYS kept its own copy while the app picked by content —
        // one of the two orderings below is guaranteed to disagree with it.
        const rawStringCompareAcceptsApp =
            envelope(appEdit).updatedAt > envelope(peerEdit).updatedAt;
        expect(rawStringCompareAcceptsApp).toBe(false);

        const sharedAcceptsApp = incomingWins(
            envelopeCandidate(envelope(appEdit)),
            envelopeCandidate(envelope(peerEdit)),
        );
        const sharedAcceptsPeer = incomingWins(
            envelopeCandidate(envelope(peerEdit)),
            envelopeCandidate(envelope(appEdit)),
        );
        // The shared comparator is antisymmetric on a tie — it does break it.
        expect(sharedAcceptsApp).toBe(!sharedAcceptsPeer);
    });

    it('still prefers the strictly-newer timestamp regardless of content key', () => {
        const older = envelope({ id: 'tr-1', title: 'zzz-old', updatedAt: TS });
        const newer = {
            id: 'tr-1',
            data: { id: 'tr-1', title: 'aaa-new' },
            updatedAt: '2026-06-27T12:00:01.000Z',
        };

        expect(
            incomingWins(envelopeCandidate(newer), envelopeCandidate(older)),
        ).toBe(true);
        expect(
            incomingWins(envelopeCandidate(older), envelopeCandidate(newer)),
        ).toBe(false);
    });

    it('ignores device-local fields on the stored side when breaking a tie', () => {
        // Only the app can hold device-local fields (the test peer never receives
        // them). If storedCandidate did not drop them, the app's key would differ
        // from the peer's for identical content and the two would oscillate.
        const shared = { id: 'tr-1', title: 'Same', updatedAt: TS };
        const appStored = {
            ...shared,
            localFilePath: '/x.flac',
            localFileSize: 9,
            _rev: '2-b',
        };

        expect(storedCandidate(appStored).tiebreak).toBe(
            envelopeCandidate(envelope(shared)).tiebreak,
        );
    });
});

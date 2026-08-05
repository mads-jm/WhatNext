/**
 * Inbound chunk guards — rule-by-rule negative-path tests.
 *
 * These exercise the *shipped* guard (no re-implementation of the rules here), so a
 * regression in what we let onto the disk fails right here. The filesystem-level
 * consequence of each verdict is covered in `file-transfer-ipc.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { evaluateInboundChunk, type InboundChunk } from '../chunk-guards';
import type { ActiveTransfer } from '../../../shared/core/file-transfer-types';

const SHA = 'a'.repeat(64);
const PEER = 'peer-we-asked';

function transfer(overrides: Partial<ActiveTransfer> = {}): ActiveTransfer {
    return {
        sha256: SHA,
        trackId: 'track-1',
        type: 'audio',
        filename: 'song.mp3',
        totalBytes: 100,
        bytesReceived: 0,
        status: 'transferring',
        peerId: PEER,
        startedAt: new Date().toISOString(),
        ...overrides,
    };
}

/** `n` bytes of base64-encoded payload. */
function payload(
    n: number,
    overrides: Partial<InboundChunk> = {},
): InboundChunk {
    return {
        peerId: PEER,
        sha256: SHA,
        offset: 0,
        data: Buffer.alloc(n, 7).toString('base64'),
        ...overrides,
    };
}

describe('evaluateInboundChunk — rejections', () => {
    it('drops a chunk for a hash we hold no transfer for (the disk-fill hole)', () => {
        const verdict = evaluateInboundChunk(payload(10), undefined);
        expect(verdict).toEqual({
            ok: false,
            action: 'drop',
            reason: 'no transfer was requested for this hash',
        });
    });

    it('drops a malformed sha256 before it can be used as a filename', () => {
        const verdict = evaluateInboundChunk(
            payload(10, { sha256: '../../.ssh/authorized_keys' }),
            transfer(),
        );
        expect(verdict).toMatchObject({ ok: false, action: 'drop' });
    });

    it.each([['complete'], ['error'], ['cancelled'], ['verifying']] as const)(
        'drops a chunk for a transfer in status %s',
        (status) => {
            const verdict = evaluateInboundChunk(
                payload(10),
                transfer({ status }),
            );
            expect(verdict).toMatchObject({ ok: false, action: 'drop' });
        },
    );

    it('drops — never fails — a chunk from a peer other than the one we asked', () => {
        // `drop`, deliberately: if a third peer could fail our transfers by spraying
        // chunks, the guard would hand it a denial-of-service instead of closing one.
        const verdict = evaluateInboundChunk(
            payload(10, { peerId: 'someone-else' }),
            transfer(),
        );
        expect(verdict).toMatchObject({ ok: false, action: 'drop' });
    });

    it('fails a chunk that would write past the declared total size', () => {
        const verdict = evaluateInboundChunk(
            payload(10, { offset: 95 }),
            transfer({ totalBytes: 100 }),
        );
        expect(verdict).toMatchObject({ ok: false, action: 'fail' });
    });

    it.each([[-1], [1.5], [Number.NaN], [Number.MAX_SAFE_INTEGER + 2]])(
        'fails an invalid offset (%s) rather than letting it reach pwrite',
        (offset) => {
            const verdict = evaluateInboundChunk(
                payload(1, { offset }),
                transfer(),
            );
            expect(verdict).toMatchObject({ ok: false, action: 'fail' });
        },
    );

    it('fails when the chunk body is not a string', () => {
        const verdict = evaluateInboundChunk(
            payload(1, { data: { length: 1 } as unknown as string }),
            transfer(),
        );
        expect(verdict).toMatchObject({ ok: false, action: 'fail' });
    });
});

describe('evaluateInboundChunk — acceptance and byte accounting', () => {
    it('accepts a chunk that fits and reports the decoded bytes', () => {
        const verdict = evaluateInboundChunk(
            payload(10, { offset: 20 }),
            transfer({ bytesReceived: 20 }),
        );
        expect(verdict.ok).toBe(true);
        if (!verdict.ok) return;
        expect(verdict.chunk.length).toBe(10);
        expect(verdict.bytesReceived).toBe(30);
    });

    it('accepts a chunk that exactly fills the file', () => {
        const verdict = evaluateInboundChunk(
            payload(40, { offset: 60 }),
            transfer({ totalBytes: 100 }),
        );
        expect(verdict).toMatchObject({ ok: true, bytesReceived: 100 });
    });

    it('never moves bytesReceived backwards on a duplicate or overlapping chunk', () => {
        const duplicate = evaluateInboundChunk(
            payload(10),
            transfer({ bytesReceived: 50 }),
        );
        expect(duplicate).toMatchObject({ ok: true, bytesReceived: 50 });

        const overlapping = evaluateInboundChunk(
            payload(10, { offset: 45 }),
            transfer({ bytesReceived: 50 }),
        );
        expect(overlapping).toMatchObject({ ok: true, bytesReceived: 55 });
    });

    it('cannot report more bytes than totalBytes, however the chunks overlap', () => {
        const t = transfer({ totalBytes: 100, bytesReceived: 100 });
        for (const offset of [0, 50, 90]) {
            const verdict = evaluateInboundChunk(payload(10, { offset }), t);
            expect(verdict).toMatchObject({ ok: true });
            if (verdict.ok)
                expect(verdict.bytesReceived).toBeLessThanOrEqual(t.totalBytes);
        }
    });
});

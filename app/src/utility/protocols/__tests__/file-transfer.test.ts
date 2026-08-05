import { describe, it, expect, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import {
    registerFileTransferProtocol,
    sendWithBackpressure,
    sendFileChunk,
    requestFile,
    type FileTransferCallbacks,
} from '../file-transfer';
import {
    FILE_TRANSFER_CONFIG,
    type FileTransferMessage,
} from '../../../shared/core/file-transfer-types';
import {
    MockStream,
    MockConnection,
    MockLibp2p,
    encodeFrame,
    asLibp2p,
} from './harness';

const PROTOCOL = FILE_TRANSFER_CONFIG.PROTOCOL_ID;

function noopCallbacks(
    overrides: Partial<FileTransferCallbacks> = {},
): FileTransferCallbacks {
    return {
        onManifestRequest: vi.fn(async () => ({
            peerId: 'p',
            playlistId: 'pl',
            files: [],
            generatedAt: '',
        })),
        onFileRequest: vi.fn(),
        onFileChunkReceived: vi.fn(),
        onFileComplete: vi.fn(),
        onFileError: vi.fn(),
        onTransferCancel: vi.fn(),
        ...overrides,
    };
}

describe('sendWithBackpressure (#47)', () => {
    it('resolves immediately when the stream accepts the write', async () => {
        const stream = new MockStream();
        await expect(
            sendWithBackpressure(stream as never, new Uint8Array([1, 2, 3])),
        ).resolves.toBeUndefined();
        expect(stream.sent).toHaveLength(1);
    });

    it('waits for drain when the stream signals backpressure', async () => {
        const stream = new MockStream();
        stream.failSends = 1; // first send returns false + sets writableNeedsDrain

        let resolved = false;
        const p = sendWithBackpressure(
            stream as never,
            new Uint8Array([9]),
        ).then(() => {
            resolved = true;
        });

        // Give microtasks a chance — it must NOT resolve while the buffer is full.
        await Promise.resolve();
        expect(resolved).toBe(false);

        stream.drain();
        await p;
        expect(resolved).toBe(true);
    });
});

describe('sendFileChunk', () => {
    it('drops a message when there is no active serve stream (no throw)', async () => {
        const node = new MockLibp2p();
        const peerId = { toString: () => 'peer-no-stream' };
        const msg: FileTransferMessage = {
            type: 'file-chunk',
            sha256: 'abc',
            offset: 0,
            data: '',
        };
        await expect(
            sendFileChunk(node as never, peerId as never, msg),
        ).resolves.toBeUndefined();
    });

    it('serializes ordered writes onto the registered serve stream', async () => {
        const node = new MockLibp2p();
        const callbacks = noopCallbacks();
        registerFileTransferProtocol(asLibp2p(node), callbacks);
        const handler = node.handlers.get(PROTOCOL)!;

        const sha = 'deadbeef';
        const peerId = 'peer-serve';
        // Drive an inbound file-request so the serve stream gets registered.
        const serveStream = new MockStream([
            encodeFrame({
                type: 'file-request',
                sha256: sha,
                offsetBytes: 0,
            } satisfies FileTransferMessage),
        ]);
        await handler(serveStream, new MockConnection(peerId));
        expect(callbacks.onFileRequest).toHaveBeenCalledWith(peerId, sha, 0);

        const peer = { toString: () => peerId };
        await sendFileChunk(node as never, peer as never, {
            type: 'file-header',
            sha256: sha,
            totalBytes: 10,
            chunkSize: 5,
        });
        await sendFileChunk(node as never, peer as never, {
            type: 'file-chunk',
            sha256: sha,
            offset: 0,
            data: 'AAAA',
        });

        const frames = serveStream.sentFrames<FileTransferMessage>();
        expect(frames.map((f) => f.type)).toEqual([
            'file-header',
            'file-chunk',
        ]);
    });
});

describe('inbound stream guards', () => {
    it("does not accept a file-chunk as an inbound stream's first message", async () => {
        // The branch that used to handle this was dead code with no producer in any
        // known peer, and it let an arbitrary peer push bytes straight at main.
        // A chunk-first stream is now just an unexpected first message: logged, closed.
        const node = new MockLibp2p();
        const callbacks = noopCallbacks();
        registerFileTransferProtocol(asLibp2p(node), callbacks);
        const handler = node.handlers.get(PROTOCOL)!;

        const stream = new MockStream([
            encodeFrame({
                type: 'file-chunk',
                sha256: 'a'.repeat(64),
                offset: 0,
                data: Buffer.from('unsolicited').toString('base64'),
            } satisfies FileTransferMessage),
            // A follow-up chunk must not be picked up by a continuation loop either.
            encodeFrame({
                type: 'file-chunk',
                sha256: 'a'.repeat(64),
                offset: 11,
                data: Buffer.from('more').toString('base64'),
            } satisfies FileTransferMessage),
        ]);

        await handler(stream, new MockConnection('hostile-peer'));

        expect(callbacks.onFileChunkReceived).not.toHaveBeenCalled();
        expect(stream.closed).toBe(true);
    });

    it('drops chunks for a sha256 we never requested on this stream', async () => {
        // The provider answers our request for `wanted` but also sprays chunks for a
        // file we never asked for. Only the requested one reaches main.
        const wanted = 'b'.repeat(64);
        const unwanted = 'c'.repeat(64);

        const providerStream = new MockStream([
            encodeFrame({
                type: 'file-header',
                sha256: wanted,
                totalBytes: 4,
                chunkSize: 4,
            } satisfies FileTransferMessage),
            encodeFrame({
                type: 'file-chunk',
                sha256: unwanted,
                offset: 0,
                data: 'AAAA',
            } satisfies FileTransferMessage),
            encodeFrame({
                type: 'file-chunk',
                sha256: wanted,
                offset: 0,
                data: 'BBBB',
            } satisfies FileTransferMessage),
            encodeFrame({
                type: 'file-complete',
                sha256: wanted,
            } satisfies FileTransferMessage),
        ]);

        const seen: string[] = [];
        await new Promise<void>((resolve) => {
            const callbacks = noopCallbacks({
                onFileChunkReceived: (_peer, sha) => {
                    seen.push(sha);
                },
                onFileComplete: () => resolve(),
            });
            const node = { dialProtocol: vi.fn(async () => providerStream) };
            void requestFile(
                node as never,
                { toString: () => 'provider-peer' } as never,
                wanted,
                0,
                callbacks,
            );
        });

        expect(seen).toEqual([wanted]);
    });
});

describe('file-transfer integrity over the receive path (#47)', () => {
    it('reassembles chunks to a byte-identical file with matching sha256', async () => {
        // Build a >10MB payload so the test exercises the large-file path.
        const original = randomBytes(11 * 1024 * 1024);
        const sha = createHash('sha256').update(original).digest('hex');

        // Frame it the way a provider would: file-header → N chunks → file-complete.
        const chunkSize = FILE_TRANSFER_CONFIG.CHUNK_SIZE;
        const frames: Uint8Array[] = [];
        frames.push(
            encodeFrame({
                type: 'file-header',
                sha256: sha,
                totalBytes: original.length,
                chunkSize,
            } satisfies FileTransferMessage),
        );
        for (let offset = 0; offset < original.length; offset += chunkSize) {
            const slice = original.subarray(offset, offset + chunkSize);
            frames.push(
                encodeFrame({
                    type: 'file-chunk',
                    sha256: sha,
                    offset,
                    data: Buffer.from(slice).toString('base64'),
                } satisfies FileTransferMessage),
            );
        }
        frames.push(
            encodeFrame({
                type: 'file-complete',
                sha256: sha,
            } satisfies FileTransferMessage),
        );

        // Collect received chunks via callbacks and reassemble. Drive the real
        // requester receive path (requestFile → handleIncomingFileStream).
        const received: Buffer[] = [];
        const done = new Promise<void>((resolve) => {
            const callbacks = noopCallbacks({
                onFileChunkReceived: (_peer, _sha, offset, data) => {
                    received[offset / chunkSize] = Buffer.from(data, 'base64');
                },
                onFileComplete: () => resolve(),
                onFileError: (_p, _s, err) => {
                    throw new Error(`unexpected file error: ${err}`);
                },
            });

            // The provider's responses arrive on the stream requestFile opens.
            const providerStream = new MockStream(frames);
            const node = {
                dialProtocol: vi.fn(async () => providerStream),
            };
            void requestFile(
                node as never,
                { toString: () => 'provider-peer' } as never,
                sha,
                0,
                callbacks,
            );
        });

        await done;
        const reassembled = Buffer.concat(received);
        expect(reassembled.length).toBe(original.length);
        expect(createHash('sha256').update(reassembled).digest('hex')).toBe(
            sha,
        );
    });
});

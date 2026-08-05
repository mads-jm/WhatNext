/**
 * File-transfer IPC — receive-path and lifecycle tests.
 *
 * These drive the *shipped* module end-to-end inside main: Electron is mocked down to
 * the two things it actually uses (`app.getPath`, `ipcMain.handle`), storage points at
 * a temp dir, and messages are pushed through `handleFileTransferUtilityMessage`
 * exactly as the utility process would. That is the only way to assert the property
 * the guard exists for — *zero filesystem effects* for a chunk we never asked for.
 *
 * Two independent fixtures live here on purpose:
 *   - chunk tests use transfers rehydrated from `.partial/transfers.json` at startup
 *     (the resume path), so they never touch the download queue;
 *   - queue tests go through `file-transfer:request-files`, so their slot accounting
 *     is not perturbed by the chunk tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ActiveTransfer, FileEntry } from '../../../shared/core/file-transfer-types';
import {
    IPC_CHANNELS,
    MainToUtilityMessageType,
    UtilityToMainMessageType,
    createIPCMessage,
} from '../../../shared/core/ipc-protocol';

const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-filetransfer-'));
type IpcHandler = (event: unknown, args: never) => unknown;
const ipcHandlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
    app: { getPath: () => docsDir },
    ipcMain: {
        handle: (channel: string, handler: IpcHandler) => {
            ipcHandlers.set(channel, handler);
        },
    },
}));

import {
    registerFileTransferHandlers,
    handleFileTransferUtilityMessage,
} from '../file-transfer-ipc';

const audioDir = path.join(docsDir, 'WhatNext', 'audio');
const partialDir = path.join(audioDir, '.partial');

/** Distinct valid hashes — one per fixture, so tests cannot leak state into each other. */
const SHA = {
    happy: '1'.repeat(64),
    bounds: '2'.repeat(64),
    otherPeer: '3'.repeat(64),
    duplicate: '4'.repeat(64),
    unsolicited: '5'.repeat(64),
    queueA: 'a'.repeat(64),
    queueB: 'b'.repeat(64),
    queueC: 'c'.repeat(64),
};

const PEER = 'peer-we-asked';
const TOTAL = 64;

const utility = { postMessage: vi.fn() };
const win = { webContents: { send: vi.fn() } };

function seeded(sha256: string): ActiveTransfer {
    return {
        sha256,
        trackId: `track-${sha256.slice(0, 4)}`,
        type: 'audio',
        filename: `${sha256.slice(0, 4)}.mp3`,
        totalBytes: TOTAL,
        bytesReceived: 0,
        status: 'transferring',
        peerId: PEER,
        startedAt: new Date().toISOString(),
    };
}

function chunkMessage(sha256: string, offset: number, body: Buffer, peerId = PEER) {
    return createIPCMessage(UtilityToMainMessageType.FILE_TRANSFER_CHUNK_RECEIVED, {
        peerId,
        sha256,
        offset,
        data: body.toString('base64'),
    });
}

/**
 * Let the `void`-dispatched async handlers settle.
 *
 * Rejections are synchronous (the guard returns before the first `await`), so only
 * the accepted-chunk assertions need to wait for the disk write to land.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = (assertion: () => void) => vi.waitFor(assertion, { timeout: 5000, interval: 10 });

function partialPath(sha256: string): string {
    return path.join(partialDir, `${sha256}.tmp`);
}

function tmpFiles(): string[] {
    return fs.readdirSync(partialDir).filter((f) => f.endsWith('.tmp'));
}

function requestFileMessages(): Array<{ sha256: string }> {
    return utility.postMessage.mock.calls
        .map((c) => c[0])
        .filter((m) => m.type === MainToUtilityMessageType.FILE_TRANSFER_REQUEST_FILE)
        .map((m) => m.payload as { sha256: string });
}

function audioEntry(sha256: string): FileEntry {
    return {
        trackId: `track-${sha256.slice(0, 4)}`,
        type: 'audio',
        sha256,
        sizeBytes: TOTAL,
        mimeType: 'audio/mpeg',
        filename: `${sha256.slice(0, 4)}.mp3`,
    };
}

beforeAll(async () => {
    // Rehydrated at startup by loadTransferState() — the resume path the guard has to
    // keep working ("must be in activeTransfers" must not break resume-after-restart).
    fs.mkdirSync(partialDir, { recursive: true });
    fs.writeFileSync(
        path.join(partialDir, 'transfers.json'),
        JSON.stringify([
            seeded(SHA.happy),
            seeded(SHA.bounds),
            seeded(SHA.otherPeer),
            seeded(SHA.duplicate),
        ]),
        'utf8'
    );

    await registerFileTransferHandlers(win as never, () => utility as never);
});

afterAll(() => {
    fs.rmSync(docsDir, { recursive: true, force: true });
});

describe('inbound chunks — filesystem effects', () => {
    it('writes a chunk belonging to a transfer we requested', async () => {
        handleFileTransferUtilityMessage(chunkMessage(SHA.happy, 0, Buffer.alloc(8, 1)));

        await settled(() => {
            expect(fs.readFileSync(partialPath(SHA.happy))).toEqual(Buffer.alloc(8, 1));
            expect(win.webContents.send).toHaveBeenCalledWith(
                IPC_CHANNELS.FILE_TRANSFER_PROGRESS,
                expect.objectContaining({ sha256: SHA.happy, bytesReceived: 8, totalBytes: TOTAL })
            );
        });
    });

    it('has zero filesystem effects for a chunk we never requested', async () => {
        const before = tmpFiles();

        handleFileTransferUtilityMessage(chunkMessage(SHA.unsolicited, 0, Buffer.alloc(16, 9)));
        // …including one aimed far out into a sparse file, the disk-fill shape.
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.unsolicited, 8 * 1024 * 1024 * 1024, Buffer.alloc(16, 9))
        );
        // …and one whose "hash" is a traversal payload.
        handleFileTransferUtilityMessage(
            chunkMessage('../../../etc/whatnext-owned', 0, Buffer.alloc(16, 9))
        );
        await flush();

        expect(tmpFiles()).toEqual(before);
        expect(fs.existsSync(partialPath(SHA.unsolicited))).toBe(false);
    });

    it('ignores a chunk sent by a peer other than the transfer owner', async () => {
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.otherPeer, 0, Buffer.alloc(8, 3), 'a-different-peer')
        );
        await flush();

        expect(fs.existsSync(partialPath(SHA.otherPeer))).toBe(false);
        // The transfer itself survives — a hostile peer must not be able to kill it.
        const transfers = getTransfers();
        expect(transfers.find((t) => t.sha256 === SHA.otherPeer)?.status).toBe('transferring');
    });

    it('fails the transfer on a chunk that overruns the declared size, and discards the partial', async () => {
        // Get a legitimate partial on disk first, so the assertion below is about the
        // partial being *discarded* rather than never having existed.
        handleFileTransferUtilityMessage(chunkMessage(SHA.bounds, 0, Buffer.alloc(8, 2)));
        await settled(() => expect(fs.existsSync(partialPath(SHA.bounds))).toBe(true));

        win.webContents.send.mockClear();
        utility.postMessage.mockClear();

        handleFileTransferUtilityMessage(chunkMessage(SHA.bounds, TOTAL - 4, Buffer.alloc(64, 2)));

        // Status, renderer error and peer cancel are synchronous; the unlink is not.
        expect(getTransfers().find((t) => t.sha256 === SHA.bounds)?.status).toBe('error');
        expect(win.webContents.send).toHaveBeenCalledWith(
            IPC_CHANNELS.FILE_TRANSFER_ERROR,
            expect.objectContaining({ sha256: SHA.bounds })
        );
        // The sender is told to stop rather than being left streaming into a void.
        expect(
            utility.postMessage.mock.calls
                .map((c) => c[0])
                .some((m) => m.type === MainToUtilityMessageType.FILE_TRANSFER_CANCEL)
        ).toBe(true);
        await settled(() => expect(fs.existsSync(partialPath(SHA.bounds))).toBe(false));
        // Nothing was written at the out-of-bounds offset either — the file is gone,
        // not extended.
        expect(tmpFiles()).not.toContain(`${SHA.bounds}.tmp`);
    });

    it('keeps bytesReceived within totalBytes under duplicate and overlapping chunks', async () => {
        handleFileTransferUtilityMessage(chunkMessage(SHA.duplicate, 0, Buffer.alloc(32, 5)));
        handleFileTransferUtilityMessage(chunkMessage(SHA.duplicate, 0, Buffer.alloc(32, 5)));
        handleFileTransferUtilityMessage(chunkMessage(SHA.duplicate, 16, Buffer.alloc(32, 5)));
        handleFileTransferUtilityMessage(chunkMessage(SHA.duplicate, 32, Buffer.alloc(32, 5)));
        handleFileTransferUtilityMessage(chunkMessage(SHA.duplicate, 0, Buffer.alloc(32, 5)));

        await settled(() => {
            const transfer = getTransfers().find((t) => t.sha256 === SHA.duplicate)!;
            expect(transfer.bytesReceived).toBe(TOTAL);
            expect(transfer.bytesReceived).toBeLessThanOrEqual(transfer.totalBytes);
        });
    });
});

describe('cancel releases its concurrency slot', () => {
    // MAX_CONCURRENT_AUDIO is 1, so exactly one of these is dispatched at a time.
    it('starts the next queued audio transfer when one is cancelled', async () => {
        utility.postMessage.mockClear();

        await requestFiles([SHA.queueA, SHA.queueB, SHA.queueC].map(audioEntry));
        expect(requestFileMessages().map((p) => p.sha256)).toEqual([SHA.queueA]);

        await cancel(SHA.queueA);
        expect(requestFileMessages().map((p) => p.sha256)).toEqual([SHA.queueA, SHA.queueB]);
    });

    it('releases the slot exactly once — a late complete or error cannot double-release', async () => {
        // Both arrive for the already-cancelled queueA. If either over-released,
        // queueC would start while queueB is still in flight (over-concurrency).
        handleFileTransferUtilityMessage(
            createIPCMessage(UtilityToMainMessageType.FILE_TRANSFER_COMPLETE, {
                peerId: PEER,
                sha256: SHA.queueA,
            })
        );
        handleFileTransferUtilityMessage(
            createIPCMessage(UtilityToMainMessageType.FILE_TRANSFER_ERROR, {
                sha256: SHA.queueA,
                error: 'late error after cancel',
            })
        );
        await flush();

        expect(requestFileMessages().map((p) => p.sha256)).toEqual([SHA.queueA, SHA.queueB]);

        // …and the queue still moves when the in-flight transfer really ends.
        await cancel(SHA.queueB);
        expect(requestFileMessages().map((p) => p.sha256)).toEqual([
            SHA.queueA,
            SHA.queueB,
            SHA.queueC,
        ]);
    });

    it('does not re-dispatch a transfer cancelled while still queued', async () => {
        // queueC is in flight; queue a fourth file behind it, cancel it while queued,
        // then free the slot. A cancelled request must not be dispatched afterwards.
        const queued = 'd'.repeat(64);
        await requestFiles([audioEntry(queued)]);
        await cancel(queued);
        await cancel(SHA.queueC);

        expect(requestFileMessages().map((p) => p.sha256)).not.toContain(queued);
    });
});

// ---------------------------------------------------------------------------
// Handler shims — the renderer-facing half, as `ipcMain.handle` registered it.
// ---------------------------------------------------------------------------

function getTransfers(): ActiveTransfer[] {
    return ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_GET_TRANSFERS)!(null, undefined as never) as ActiveTransfer[];
}

async function requestFiles(files: FileEntry[]): Promise<void> {
    await ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_REQUEST_FILES)!(null, {
        peerId: PEER,
        files,
    } as never);
}

async function cancel(sha256: string): Promise<void> {
    await ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_CANCEL)!(null, { sha256 } as never);
}

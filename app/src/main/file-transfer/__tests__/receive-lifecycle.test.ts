/**
 * File-transfer receive path — *lifecycle* tests (cycle 3).
 *
 * Cycle 1 proved the receive path's trust boundary (which bytes may touch the disk);
 * this file proves its lifecycle: who owns the partial-file descriptor, and what
 * happens to a transfer that resumes after a peer reconnects.
 *
 * It runs the shipped module the same way `file-transfer-ipc.test.ts` does — Electron
 * mocked down to `app.getPath` + `ipcMain.handle`, storage in a temp dir, messages
 * pushed through `handleFileTransferUtilityMessage` as the utility process would.
 *
 * It is a *separate file* from `file-transfer-ipc.test.ts` deliberately: these tests
 * spy on `fs.promises.open` and drive `resumeIncompleteTransfers`, which sweeps every
 * pending transfer belonging to a peer. Sharing a module instance with that file's
 * fixtures would make each suite's queue accounting depend on the other's leftovers.
 * Per-peer fixtures do the same job here at test granularity: resume is per-peer, so
 * each test's transfers are invisible to every other test's resume.
 *
 * Concurrency is exercised by *interleaving*, never by timing: `handleChunkReceived`
 * is dispatched fire-and-forget and runs synchronously up to its first `await`, so
 * two messages pushed back-to-back are genuinely overlapped by construction.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    ActiveTransfer,
    FileEntry,
} from '../../../shared/core/file-transfer-types';
import {
    IPC_CHANNELS,
    MainToUtilityMessageType,
    UtilityToMainMessageType,
    createIPCMessage,
} from '../../../shared/core/ipc-protocol';

const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-receive-lifecycle-'));
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
    resumeIncompleteTransfers,
} from '../file-transfer-ipc';

const audioDir = path.join(docsDir, 'WhatNext', 'audio');
const partialDir = path.join(audioDir, '.partial');

/** Peers are per-fixture: `resumeIncompleteTransfers` sweeps a whole peer at once. */
const PEER_CHUNK = 'peer-chunk-lifecycle';
const PEER_A = 'peer-resume-pacing';
const PEER_B = 'peer-resume-priority';
const PEER_C = 'peer-resume-inflight';
const PEER_D = 'peer-resume-queued';
const PEER_E = 'peer-resume-freshqueued';
const PEER_FRESH = 'peer-fresh-requests';

const TOTAL = 64;

/** A real body + its real hash — the completion path verifies before it renames. */
const FINISHED_BODY = Buffer.concat([
    Buffer.alloc(8, 0xa1),
    Buffer.alloc(8, 0xb2),
    Buffer.alloc(8, 0xc3),
]);
const FINISHED_SHA = crypto
    .createHash('sha256')
    .update(FINISHED_BODY)
    .digest('hex');

const SHA = {
    race: '1'.repeat(64),
    abort: '2'.repeat(64),
    finished: FINISHED_SHA,
    r1: 'a1'.repeat(32),
    r2: 'a2'.repeat(32),
    r3: 'a3'.repeat(32),
    r4: 'b4'.repeat(32),
    r5: 'c5'.repeat(32),
    r6: 'd6'.repeat(32),
    f1: 'e1'.repeat(32),
    f2: 'e2'.repeat(32),
    f3: 'e3'.repeat(32),
    f4: 'e4'.repeat(32),
    f5: 'e5'.repeat(32),
    f6: 'f6'.repeat(32),
};

const utility = { postMessage: vi.fn() };
const win = { webContents: { send: vi.fn() } };

/** Every `fs.promises.open` the module performed, with whether it was ever closed. */
interface OpenRecord {
    path: string;
    flags: string;
    closes: number;
}
const opens: OpenRecord[] = [];

function opensFor(sha256: string, flags?: string): OpenRecord[] {
    return opens.filter(
        (o) =>
            o.path === partialPath(sha256) &&
            (flags === undefined || o.flags === flags),
    );
}

function seeded(
    overrides: Partial<ActiveTransfer> & { sha256: string; peerId: string },
): ActiveTransfer {
    return {
        trackId: `track-${overrides.sha256.slice(0, 4)}`,
        type: 'audio',
        filename: `${overrides.sha256.slice(0, 4)}.mp3`,
        totalBytes: TOTAL,
        bytesReceived: 0,
        status: 'pending',
        startedAt: new Date().toISOString(),
        ...overrides,
    };
}

function chunkMessage(
    sha256: string,
    offset: number,
    body: Buffer,
    peerId = PEER_CHUNK,
) {
    return createIPCMessage(
        UtilityToMainMessageType.FILE_TRANSFER_CHUNK_RECEIVED,
        {
            peerId,
            sha256,
            offset,
            data: body.toString('base64'),
        },
    );
}

function completeMessage(sha256: string, peerId = PEER_CHUNK) {
    return createIPCMessage(UtilityToMainMessageType.FILE_TRANSFER_COMPLETE, {
        peerId,
        sha256,
    });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = (assertion: () => void) =>
    vi.waitFor(assertion, { timeout: 5000, interval: 10 });

function partialPath(sha256: string): string {
    return path.join(partialDir, `${sha256}.tmp`);
}

/** The sha256 of every FILE_TRANSFER_REQUEST_FILE we have posted, in dispatch order. */
function dispatched(): string[] {
    return utility.postMessage.mock.calls
        .map((c) => c[0])
        .filter(
            (m) =>
                m.type === MainToUtilityMessageType.FILE_TRANSFER_REQUEST_FILE,
        )
        .map((m) => (m.payload as { sha256: string }).sha256);
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
    fs.mkdirSync(partialDir, { recursive: true });
    fs.writeFileSync(
        path.join(partialDir, 'transfers.json'),
        JSON.stringify([
            seeded({
                sha256: SHA.race,
                peerId: PEER_CHUNK,
                status: 'transferring',
            }),
            seeded({
                sha256: SHA.abort,
                peerId: PEER_CHUNK,
                status: 'transferring',
            }),
            seeded({
                sha256: SHA.finished,
                peerId: PEER_CHUNK,
                status: 'transferring',
                filename: 'finished.mp3',
                totalBytes: FINISHED_BODY.length,
            }),
            seeded({ sha256: SHA.r1, peerId: PEER_A }),
            seeded({ sha256: SHA.r2, peerId: PEER_A }),
            seeded({ sha256: SHA.r3, peerId: PEER_A }),
            seeded({ sha256: SHA.r4, peerId: PEER_B }),
            seeded({ sha256: SHA.r5, peerId: PEER_C }),
            seeded({ sha256: SHA.r6, peerId: PEER_D }),
        ]),
        'utf8',
    );

    // Record every open the module makes against a partial, and how often each handle
    // is closed — that is the only way to see an *orphaned* descriptor from outside.
    const realOpen = fs.promises.open;
    vi.spyOn(fs.promises, 'open').mockImplementation(async (p, flags) => {
        const handle = await realOpen(p as never, flags as never);
        const record: OpenRecord = {
            path: String(p),
            flags: String(flags),
            closes: 0,
        };
        opens.push(record);
        const realClose = handle.close.bind(handle);
        handle.close = async () => {
            record.closes++;
            return realClose();
        };
        return handle;
    });

    await registerFileTransferHandlers(win as never, () => utility as never);
});

afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(docsDir, { recursive: true, force: true });
});

describe('partial-file handle ownership', () => {
    it('opens one descriptor for concurrent chunks of the same transfer', async () => {
        // Both handlers run their synchronous prefix — guard, then the map lookup —
        // before either's open resolves, which is exactly the interleaving that used
        // to produce two descriptors and orphan the first.
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.race, 0, Buffer.alloc(8, 1)),
        );
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.race, 8, Buffer.alloc(8, 2)),
        );
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.race, 16, Buffer.alloc(8, 3)),
        );

        await settled(() => {
            expect(fs.readFileSync(partialPath(SHA.race))).toEqual(
                Buffer.concat([
                    Buffer.alloc(8, 1),
                    Buffer.alloc(8, 2),
                    Buffer.alloc(8, 3),
                ]),
            );
        });

        // One writable descriptor for the transfer, no matter how many chunks raced.
        expect(opensFor(SHA.race, 'r+')).toHaveLength(1);
    });

    it('leaves no descriptor open once the transfer is torn down', async () => {
        await cancel(SHA.race);

        // Every descriptor this transfer ever opened is closed — including the
        // short-lived 'a' open that only exists to create the file.
        expect(opensFor(SHA.race).length).toBeGreaterThan(0);
        for (const record of opensFor(SHA.race)) {
            expect(record.closes).toBe(1);
        }
    });

    it('treats a second close as a no-op rather than a throw', async () => {
        // Cancel again, then let a late complete land on the cancelled transfer: both
        // call closePartialHandle for a sha256 that no longer has one.
        await expect(cancel(SHA.race)).resolves.toBeUndefined();
        handleFileTransferUtilityMessage(completeMessage(SHA.race));
        await flush();

        // No handle was closed twice — the map entry is dropped by the first close.
        for (const record of opensFor(SHA.race)) {
            expect(record.closes).toBe(1);
        }
    });
});

describe('chunks arriving after teardown has begun', () => {
    it('completes a legitimate multi-chunk transfer and does not let a late chunk resurrect it', async () => {
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.finished, 0, FINISHED_BODY.subarray(0, 8)),
        );
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.finished, 8, FINISHED_BODY.subarray(8, 16)),
        );
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.finished, 16, FINISHED_BODY.subarray(16)),
        );

        await settled(() =>
            expect(fs.readFileSync(partialPath(SHA.finished))).toEqual(
                FINISHED_BODY,
            ),
        );

        const opensBefore = opensFor(SHA.finished).length;

        // Completion and a straggler chunk in the same tick — the shape that used to
        // reopen a descriptor and recreate the .tmp underneath the rename, because the
        // status only flipped to 'verifying' after an await.
        handleFileTransferUtilityMessage(completeMessage(SHA.finished));
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.finished, 0, FINISHED_BODY.subarray(0, 8)),
        );

        await settled(() =>
            expect(
                getTransfers().find((t) => t.sha256 === SHA.finished)?.status,
            ).toBe('complete'),
        );

        // The file landed intact — the guard against over-tightening the late-chunk rule.
        expect(fs.readFileSync(path.join(audioDir, 'finished.mp3'))).toEqual(
            FINISHED_BODY,
        );
        // …and nothing reopened or recreated the partial behind it.
        expect(opensFor(SHA.finished).length).toBe(opensBefore);
        expect(fs.existsSync(partialPath(SHA.finished))).toBe(false);
    });

    it('does not recreate a partial that an abort just discarded', async () => {
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.abort, 0, Buffer.alloc(8, 7)),
        );
        // Wait for the bytes, not just the file: the partial exists from the moment the
        // creating open lands, which is before the writable handle is even open.
        await settled(() =>
            expect(fs.readFileSync(partialPath(SHA.abort))).toEqual(
                Buffer.alloc(8, 7),
            ),
        );

        const opensBefore = opensFor(SHA.abort).length;

        // An overrunning chunk aborts the transfer (unlinking the partial); an
        // in-bounds chunk right behind it must not bring the file back.
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.abort, TOTAL - 4, Buffer.alloc(64, 7)),
        );
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.abort, 8, Buffer.alloc(8, 7)),
        );

        await settled(() =>
            expect(fs.existsSync(partialPath(SHA.abort))).toBe(false),
        );
        await flush();

        expect(fs.existsSync(partialPath(SHA.abort))).toBe(false);
        expect(opensFor(SHA.abort).length).toBe(opensBefore);
        expect(getTransfers().find((t) => t.sha256 === SHA.abort)?.status).toBe(
            'error',
        );
    });
});

describe('resume goes through the download queue', () => {
    // MAX_CONCURRENT_AUDIO is 1: before this cycle, resume posted requests straight to
    // the utility, so all three of these started at once regardless of the limit.
    it("paces a reconnecting peer's backlog instead of starting all of it at once", async () => {
        utility.postMessage.mockClear();

        await resumeIncompleteTransfers(PEER_A);
        expect(dispatched()).toEqual([SHA.r1]);

        // What is queued says so — a queued transfer is not "transferring".
        const statuses = getTransfers()
            .filter((t) => t.peerId === PEER_A)
            .map((t) => t.status);
        expect(statuses).toEqual(['pending', 'pending', 'pending']);

        // Nothing is stranded: the backlog drains as slots free.
        await cancel(SHA.r1);
        expect(dispatched()).toEqual([SHA.r1, SHA.r2]);
        await cancel(SHA.r2);
        expect(dispatched()).toEqual([SHA.r1, SHA.r2, SHA.r3]);
        await cancel(SHA.r3);
    });

    it('puts a resumed partial ahead of a fresh request that has not been dispatched', async () => {
        utility.postMessage.mockClear();

        await requestFiles(PEER_FRESH, [
            audioEntry(SHA.f1),
            audioEntry(SHA.f2),
        ]);
        expect(dispatched()).toEqual([SHA.f1]); // f2 waits for the audio slot

        await resumeIncompleteTransfers(PEER_B);
        expect(dispatched()).toEqual([SHA.f1]); // resume respects the limit too

        // User's ruling: finish partials first.
        await cancel(SHA.f1);
        expect(dispatched()).toEqual([SHA.f1, SHA.r4]);

        await cancel(SHA.r4);
        expect(dispatched()).toEqual([SHA.f1, SHA.r4, SHA.f2]);
        await cancel(SHA.f2);
    });

    it('re-resumes an in-flight transfer within its existing slot, never a second one', async () => {
        utility.postMessage.mockClear();

        await resumeIncompleteTransfers(PEER_C);
        expect(dispatched()).toEqual([SHA.r5]); // holds the audio slot

        await requestFiles(PEER_FRESH, [audioEntry(SHA.f3)]); // queued behind it
        expect(dispatched()).toEqual([SHA.r5]);

        // Second handshake-complete for the same peer. The request is re-issued (see
        // impl-notes: a peer that drops mid-transfer is never reported to us, so this
        // is the only path that un-sticks it) but the slot is handed over, not doubled.
        await resumeIncompleteTransfers(PEER_C);
        expect(dispatched()).toEqual([SHA.r5, SHA.r5]);

        // Proof it holds exactly one slot and owns exactly one queue entry: releasing it
        // once starts f3. A doubled slot would leave f3 stuck; a duplicated queue entry
        // would dispatch r5 a third time instead.
        await cancel(SHA.r5);
        expect(dispatched()).toEqual([SHA.r5, SHA.r5, SHA.f3]);
        await cancel(SHA.f3);
    });

    it('leaves one queue entry when a peer resumes twice before it is dispatched', async () => {
        utility.postMessage.mockClear();

        await requestFiles(PEER_FRESH, [audioEntry(SHA.f4)]); // takes the slot
        await resumeIncompleteTransfers(PEER_D);
        await resumeIncompleteTransfers(PEER_D);
        expect(dispatched()).toEqual([SHA.f4]);
        expect(getTransfers().find((t) => t.sha256 === SHA.r6)?.status).toBe(
            'pending',
        );

        await cancel(SHA.f4);
        expect(dispatched()).toEqual([SHA.f4, SHA.r6]);

        // Freeing the slot again dispatches nothing — there was never a second entry.
        await cancel(SHA.r6);
        expect(dispatched()).toEqual([SHA.f4, SHA.r6]);
    });

    it('does not dispatch a still-queued fresh request twice when its peer resumes', async () => {
        utility.postMessage.mockClear();

        await requestFiles(PEER_FRESH, [audioEntry(SHA.f5)]); // takes the slot
        await requestFiles(PEER_E, [audioEntry(SHA.f6)]); // queued, and resumable
        expect(dispatched()).toEqual([SHA.f5]);

        // Resume sees f6 sitting in the queue. It used to request it here *and* let
        // processQueue dispatch it later, which overwrote the utility's receive-stream
        // entry for `peerId:sha256` and orphaned the first stream.
        await resumeIncompleteTransfers(PEER_E);
        expect(dispatched()).toEqual([SHA.f5]);

        await cancel(SHA.f5);
        expect(dispatched()).toEqual([SHA.f5, SHA.f6]);
        await cancel(SHA.f6);
        expect(dispatched()).toEqual([SHA.f5, SHA.f6]);
    });
});

// ---------------------------------------------------------------------------
// Handler shims — the renderer-facing half, as `ipcMain.handle` registered it.
// ---------------------------------------------------------------------------

function getTransfers(): ActiveTransfer[] {
    return ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_GET_TRANSFERS)!(
        null,
        undefined as never,
    ) as ActiveTransfer[];
}

async function requestFiles(peerId: string, files: FileEntry[]): Promise<void> {
    await ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_REQUEST_FILES)!(null, {
        peerId,
        files,
    } as never);
}

async function cancel(sha256: string): Promise<void> {
    await ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_CANCEL)!(null, {
        sha256,
    } as never);
}

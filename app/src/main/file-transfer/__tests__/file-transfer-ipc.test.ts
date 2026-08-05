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
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    ActiveTransfer,
    FileEntry,
    FileManifest,
} from '../../../shared/core/file-transfer-types';
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
const artworkDir = path.join(docsDir, 'WhatNext', 'artwork');
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

/**
 * Serve-path fixture: three real files, one per FileEntry type, already present in a
 * *persisted* `hashes.json` before startup.
 *
 * That is the shape of the exposure this guard closes — the hash cache survives
 * restarts and accumulates every file this install ever hashed (plus everything peers
 * sent us), while sharing intent does not survive at all. Seeding it here means the
 * "refused" assertions below prove the allowlist is doing the work, not that the file
 * merely happened to be unknown.
 */
const PLAYLIST = 'playlist-served';
const TRACK = 'track-served';
const serveFiles = {
    audio: {
        path: path.join(audioDir, 'served-song.mp3'),
        body: Buffer.from('audio bytes for the serve fixture'),
    },
    artwork: {
        path: path.join(artworkDir, 'served-art.jpg'),
        body: Buffer.from('artwork bytes'),
    },
    cover: {
        path: path.join(artworkDir, 'served-cover.jpg'),
        body: Buffer.from('cover art bytes'),
    },
};
const serveHash = {
    audio: sha256Of(serveFiles.audio.body),
    artwork: sha256Of(serveFiles.artwork.body),
    cover: sha256Of(serveFiles.cover.body),
};

function sha256Of(body: Buffer): string {
    return crypto.createHash('sha256').update(body).digest('hex');
}

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

function chunkMessage(
    sha256: string,
    offset: number,
    body: Buffer,
    peerId = PEER,
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

/**
 * Let the `void`-dispatched async handlers settle.
 *
 * Rejections are synchronous (the guard returns before the first `await`), so only
 * the accepted-chunk assertions need to wait for the disk write to land.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = (assertion: () => void) =>
    vi.waitFor(assertion, { timeout: 5000, interval: 10 });

function partialPath(sha256: string): string {
    return path.join(partialDir, `${sha256}.tmp`);
}

function tmpFiles(): string[] {
    return fs.readdirSync(partialDir).filter((f) => f.endsWith('.tmp'));
}

function requestFileMessages(): Array<{ sha256: string }> {
    return utility.postMessage.mock.calls
        .map((c) => c[0])
        .filter(
            (m) =>
                m.type === MainToUtilityMessageType.FILE_TRANSFER_REQUEST_FILE,
        )
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
        'utf8',
    );

    // Serve fixture: files on disk *and* in a persisted hash cache, as they would be
    // after any previous session — before sharing has ever been enabled in this run.
    fs.mkdirSync(artworkDir, { recursive: true });
    const hashIndex: Record<
        string,
        { sha256: string; mtimeMs: number; size: number }
    > = {};
    for (const [kind, file] of Object.entries(serveFiles)) {
        fs.writeFileSync(file.path, file.body);
        const stat = fs.statSync(file.path);
        hashIndex[file.path] = {
            sha256: serveHash[kind as keyof typeof serveHash],
            mtimeMs: stat.mtimeMs,
            size: stat.size,
        };
    }
    fs.writeFileSync(
        path.join(audioDir, 'hashes.json'),
        JSON.stringify(hashIndex),
        'utf8',
    );

    await registerFileTransferHandlers(win as never, () => utility as never);
});

afterAll(() => {
    fs.rmSync(docsDir, { recursive: true, force: true });
});

describe('inbound chunks — filesystem effects', () => {
    it('writes a chunk belonging to a transfer we requested', async () => {
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.happy, 0, Buffer.alloc(8, 1)),
        );

        await settled(() => {
            expect(fs.readFileSync(partialPath(SHA.happy))).toEqual(
                Buffer.alloc(8, 1),
            );
            expect(win.webContents.send).toHaveBeenCalledWith(
                IPC_CHANNELS.FILE_TRANSFER_PROGRESS,
                expect.objectContaining({
                    sha256: SHA.happy,
                    bytesReceived: 8,
                    totalBytes: TOTAL,
                }),
            );
        });
    });

    it('has zero filesystem effects for a chunk we never requested', async () => {
        const before = tmpFiles();

        handleFileTransferUtilityMessage(
            chunkMessage(SHA.unsolicited, 0, Buffer.alloc(16, 9)),
        );
        // …including one aimed far out into a sparse file, the disk-fill shape.
        handleFileTransferUtilityMessage(
            chunkMessage(
                SHA.unsolicited,
                8 * 1024 * 1024 * 1024,
                Buffer.alloc(16, 9),
            ),
        );
        // …and one whose "hash" is a traversal payload.
        handleFileTransferUtilityMessage(
            chunkMessage('../../../etc/whatnext-owned', 0, Buffer.alloc(16, 9)),
        );
        await flush();

        expect(tmpFiles()).toEqual(before);
        expect(fs.existsSync(partialPath(SHA.unsolicited))).toBe(false);
    });

    it('ignores a chunk sent by a peer other than the transfer owner', async () => {
        handleFileTransferUtilityMessage(
            chunkMessage(
                SHA.otherPeer,
                0,
                Buffer.alloc(8, 3),
                'a-different-peer',
            ),
        );
        await flush();

        expect(fs.existsSync(partialPath(SHA.otherPeer))).toBe(false);
        // The transfer itself survives — a hostile peer must not be able to kill it.
        const transfers = getTransfers();
        expect(transfers.find((t) => t.sha256 === SHA.otherPeer)?.status).toBe(
            'transferring',
        );
    });

    it('fails the transfer on a chunk that overruns the declared size, and discards the partial', async () => {
        // Get a legitimate partial on disk first, so the assertion below is about the
        // partial being *discarded* rather than never having existed.
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.bounds, 0, Buffer.alloc(8, 2)),
        );
        await settled(() =>
            expect(fs.existsSync(partialPath(SHA.bounds))).toBe(true),
        );

        win.webContents.send.mockClear();
        utility.postMessage.mockClear();

        handleFileTransferUtilityMessage(
            chunkMessage(SHA.bounds, TOTAL - 4, Buffer.alloc(64, 2)),
        );

        // Status, renderer error and peer cancel are synchronous; the unlink is not.
        expect(
            getTransfers().find((t) => t.sha256 === SHA.bounds)?.status,
        ).toBe('error');
        expect(win.webContents.send).toHaveBeenCalledWith(
            IPC_CHANNELS.FILE_TRANSFER_ERROR,
            expect.objectContaining({ sha256: SHA.bounds }),
        );
        // The sender is told to stop rather than being left streaming into a void.
        expect(
            utility.postMessage.mock.calls
                .map((c) => c[0])
                .some(
                    (m) =>
                        m.type ===
                        MainToUtilityMessageType.FILE_TRANSFER_CANCEL,
                ),
        ).toBe(true);
        await settled(() =>
            expect(fs.existsSync(partialPath(SHA.bounds))).toBe(false),
        );
        // Nothing was written at the out-of-bounds offset either — the file is gone,
        // not extended.
        expect(tmpFiles()).not.toContain(`${SHA.bounds}.tmp`);
    });

    it('keeps bytesReceived within totalBytes under duplicate and overlapping chunks', async () => {
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.duplicate, 0, Buffer.alloc(32, 5)),
        );
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.duplicate, 0, Buffer.alloc(32, 5)),
        );
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.duplicate, 16, Buffer.alloc(32, 5)),
        );
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.duplicate, 32, Buffer.alloc(32, 5)),
        );
        handleFileTransferUtilityMessage(
            chunkMessage(SHA.duplicate, 0, Buffer.alloc(32, 5)),
        );

        await settled(() => {
            const transfer = getTransfers().find(
                (t) => t.sha256 === SHA.duplicate,
            )!;
            expect(transfer.bytesReceived).toBe(TOTAL);
            expect(transfer.bytesReceived).toBeLessThanOrEqual(
                transfer.totalBytes,
            );
        });
    });
});

describe('cancel releases its concurrency slot', () => {
    // MAX_CONCURRENT_AUDIO is 1, so exactly one of these is dispatched at a time.
    it('starts the next queued audio transfer when one is cancelled', async () => {
        utility.postMessage.mockClear();

        await requestFiles(
            [SHA.queueA, SHA.queueB, SHA.queueC].map(audioEntry),
        );
        expect(requestFileMessages().map((p) => p.sha256)).toEqual([
            SHA.queueA,
        ]);

        await cancel(SHA.queueA);
        expect(requestFileMessages().map((p) => p.sha256)).toEqual([
            SHA.queueA,
            SHA.queueB,
        ]);
    });

    it('releases the slot exactly once — a late complete or error cannot double-release', async () => {
        // Both arrive for the already-cancelled queueA. If either over-released,
        // queueC would start while queueB is still in flight (over-concurrency).
        handleFileTransferUtilityMessage(
            createIPCMessage(UtilityToMainMessageType.FILE_TRANSFER_COMPLETE, {
                peerId: PEER,
                sha256: SHA.queueA,
            }),
        );
        handleFileTransferUtilityMessage(
            createIPCMessage(UtilityToMainMessageType.FILE_TRANSFER_ERROR, {
                sha256: SHA.queueA,
                error: 'late error after cancel',
            }),
        );
        await flush();

        expect(requestFileMessages().map((p) => p.sha256)).toEqual([
            SHA.queueA,
            SHA.queueB,
        ]);

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

        expect(requestFileMessages().map((p) => p.sha256)).not.toContain(
            queued,
        );
    });
});

describe('serving files — sharing authorization', () => {
    it('refuses a file the hash cache holds but no manifest ever published', async () => {
        // The pre-guard behaviour: knowing the hash was enough. Now it is not.
        utility.postMessage.mockClear();

        handleFileTransferUtilityMessage(fileRequest(serveHash.audio));
        await flush();

        expect(serveMessages().map((m) => m.type)).toEqual(['file-error']);
        expect(fs.existsSync(serveFiles.audio.path)).toBe(true); // we do hold it
    });

    it('answers a refusal exactly as it answers a hash we have never held', async () => {
        // Otherwise refusals are an oracle: a probe could enumerate the user's library
        // by which error it gets back.
        const neverHeld = '9'.repeat(64);
        utility.postMessage.mockClear();

        handleFileTransferUtilityMessage(fileRequest(serveHash.audio));
        handleFileTransferUtilityMessage(fileRequest(neverHeld));
        await flush();

        const [refused, unknown] = serveMessages();
        expect(refused).toEqual({
            type: 'file-error',
            sha256: serveHash.audio,
            error: `No file found for sha256: ${serveHash.audio}`,
        });
        expect(unknown).toEqual({
            type: 'file-error',
            sha256: neverHeld,
            error: `No file found for sha256: ${neverHeld}`,
        });
    });

    it('serves every entry type once a manifest went out under active sharing', async () => {
        await setSharing(true);
        await registerServeTracks();

        utility.postMessage.mockClear();
        handleFileTransferUtilityMessage(manifestRequest());
        await settled(() => expect(lastManifest()?.files.length).toBe(3));

        // The manifest itself must carry all three types — a gap here would silently
        // become a gap in the allowlist.
        expect(
            lastManifest()!
                .files.map((f) => f.type)
                .sort(),
        ).toEqual(['artwork', 'audio', 'cover-art']);

        for (const [kind, hash] of Object.entries(serveHash)) {
            utility.postMessage.mockClear();
            handleFileTransferUtilityMessage(fileRequest(hash));

            await settled(() => {
                expect(serveMessages().map((m) => m.type)).toEqual([
                    'file-header',
                    'file-chunk',
                    'file-complete',
                ]);
            });
            const chunk = serveMessages()[1];
            expect(Buffer.from(chunk.data ?? '', 'base64')).toEqual(
                serveFiles[kind as keyof typeof serveFiles].body,
            );
        }
    });

    it('refuses again once sharing is toggled off', async () => {
        await setSharing(false);

        for (const hash of Object.values(serveHash)) {
            utility.postMessage.mockClear();
            handleFileTransferUtilityMessage(fileRequest(hash));
            await flush();

            expect(serveMessages().map((m) => m.type)).toEqual(['file-error']);
        }
    });

    it('keeps manifests deny-by-default when sharing is off', async () => {
        utility.postMessage.mockClear();
        handleFileTransferUtilityMessage(manifestRequest());

        await settled(() => expect(lastManifest()?.files).toEqual([]));
    });

    it('does not re-authorize a playlist whose sharing was revoked mid-manifest-build', async () => {
        // The race: `buildManifest` stats and hashes every file, so it yields for real
        // I/O; `set-sharing` is synchronous and runs to completion inside that window.
        // Without a post-build re-check, the build's `record()` silently re-authorizes
        // the playlist the host just withdrew — and the peer gets real file data too.
        await setSharing(true);
        await registerServeTracks();
        utility.postMessage.mockClear();

        // No await between these two lines: the request runs up to its first real
        // I/O yield inside buildManifest, so the revoke lands strictly mid-build.
        handleFileTransferUtilityMessage(manifestRequest());
        await setSharing(false);

        await settled(() => expect(lastManifest()).toBeDefined());
        // The peer is answered — never left hanging — but with deny-by-default.
        expect(lastManifest()!.files).toEqual([]);

        // …and nothing that build hashed became servable.
        for (const hash of Object.values(serveHash)) {
            utility.postMessage.mockClear();
            handleFileTransferUtilityMessage(fileRequest(hash));
            await flush();

            expect(serveMessages().map((m) => m.type)).toEqual(['file-error']);
        }
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

async function requestFiles(files: FileEntry[]): Promise<void> {
    await ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_REQUEST_FILES)!(null, {
        peerId: PEER,
        files,
    } as never);
}

async function cancel(sha256: string): Promise<void> {
    await ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_CANCEL)!(null, {
        sha256,
    } as never);
}

async function setSharing(enabled: boolean): Promise<void> {
    await ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_SET_SHARING)!(null, {
        playlistId: PLAYLIST,
        enabled,
    } as never);
}

async function registerServeTracks(): Promise<void> {
    await ipcHandlers.get(IPC_CHANNELS.FILE_TRANSFER_REGISTER_TRACKS)!(null, {
        playlistId: PLAYLIST,
        coverArtPath: serveFiles.cover.path,
        tracks: [
            {
                trackId: TRACK,
                audioPath: serveFiles.audio.path,
                artworkPath: serveFiles.artwork.path,
            },
        ],
    } as never);
}

// ---------------------------------------------------------------------------
// Serve-path message shims — as the utility process would deliver them.
// ---------------------------------------------------------------------------

function fileRequest(sha256: string) {
    return createIPCMessage(
        UtilityToMainMessageType.FILE_TRANSFER_INCOMING_REQUEST,
        {
            subtype: 'file-request',
            peerId: PEER,
            sha256,
            offsetBytes: 0,
        },
    );
}

function manifestRequest() {
    return createIPCMessage(
        UtilityToMainMessageType.FILE_TRANSFER_INCOMING_REQUEST,
        {
            subtype: 'manifest-request',
            requestId: 'req-1',
            peerId: PEER,
            playlistId: PLAYLIST,
            trackIds: [],
        },
    );
}

/** Every `file-header` / `file-chunk` / `file-complete` / `file-error` we sent, in order. */
interface ServeMessage {
    type: string;
    sha256: string;
    error?: string;
    /** base64 body, on `file-chunk` only */
    data?: string;
}

function serveMessages(): ServeMessage[] {
    return utility.postMessage.mock.calls
        .map((c) => c[0])
        .filter(
            (m) =>
                m.type === MainToUtilityMessageType.FILE_TRANSFER_SERVE_CHUNK,
        )
        .map((m) => (m.payload as { message: ServeMessage }).message);
}

function lastManifest(): FileManifest | undefined {
    const responses = utility.postMessage.mock.calls
        .map((c) => c[0])
        .filter(
            (m) =>
                m.type ===
                MainToUtilityMessageType.FILE_TRANSFER_MANIFEST_RESPONSE,
        );
    return responses.at(-1)?.payload.manifest as FileManifest | undefined;
}

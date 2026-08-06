/**
 * Shared file-transfer test scaffolding.
 *
 * Used by `file-transfer-ipc.test.ts` (trust boundary + queue) and
 * `receive-lifecycle.test.ts` (descriptor ownership + resume). Both drive the
 * shipped `file-transfer-ipc` module through the utility-process message surface,
 * so they built the same message envelopes, the same settle helpers and the same
 * `postMessage` accessors twice.
 *
 * **Parameterised, never stateful.** Those two suites are separate files on
 * purpose: separate module instances, separate temp dirs, per-file (and per-peer)
 * fixtures, so neither suite's queue accounting depends on the other's leftovers.
 * Nothing here may hold state that outlives a call — no module-level temp dir, no
 * shared registry, no shared mock. Each suite keeps its own `vi.mock('electron', …)`
 * and its own `mkdtemp`, and passes what it owns into these builders. Where a
 * helper needs per-suite context (the partial dir, the default peer) it is a small
 * factory that closes over the value the caller supplies — which also keeps every
 * call site in the suites byte-identical to what it was before the extraction.
 *
 * NOT a test file itself (no `.test.ts` suffix) — imported by the suites.
 */

import * as path from 'path';
import { vi, type Mock } from 'vitest';
import type { FileEntry } from '../../../shared/core/file-transfer-types';
import {
    MainToUtilityMessageType,
    UtilityToMainMessageType,
    createIPCMessage,
} from '../../../shared/core/ipc-protocol';

/** Declared size of every fixture transfer, in bytes. */
export const TOTAL = 64;

/**
 * Let the `void`-dispatched async handlers settle.
 *
 * Rejections are synchronous (the guard returns before the first `await`), so only
 * the accepted-chunk assertions need to wait for the disk write to land.
 */
export const flush = (): Promise<unknown> =>
    new Promise((resolve) => setTimeout(resolve, 0));

/** Retry an assertion until the fire-and-forget work behind it has landed. */
export const settled = (assertion: () => void): Promise<void> =>
    vi.waitFor(assertion, { timeout: 5000, interval: 10 });

/** Path builder for a suite's own `.partial` directory. */
export function makePartialPath(
    partialDir: string,
): (sha256: string) => string {
    return (sha256: string) => path.join(partialDir, `${sha256}.tmp`);
}

/**
 * Chunk-received envelope builder bound to the suite's default peer — the suites
 * disagree on which peer that is, and each has tests that override it.
 */
export function makeChunkMessage(defaultPeerId: string) {
    return (
        sha256: string,
        offset: number,
        body: Buffer,
        peerId = defaultPeerId,
    ) =>
        createIPCMessage(
            UtilityToMainMessageType.FILE_TRANSFER_CHUNK_RECEIVED,
            {
                peerId,
                sha256,
                offset,
                data: body.toString('base64'),
            },
        );
}

/** A manifest entry for an audio file of the fixture size. */
export function audioEntry(sha256: string): FileEntry {
    return {
        trackId: `track-${sha256.slice(0, 4)}`,
        type: 'audio',
        sha256,
        sizeBytes: TOTAL,
        mimeType: 'audio/mpeg',
        filename: `${sha256.slice(0, 4)}.mp3`,
    };
}

/**
 * The payloads of every message of one type posted to the utility process, in
 * order. The suites read different things out of them (request shas, serve
 * messages, manifests), so this stops at the payload rather than guessing.
 */
export function payloadsOfType<T>(
    postMessage: Mock,
    type: MainToUtilityMessageType,
): T[] {
    return postMessage.mock.calls
        .map((call) => call[0])
        .filter((message) => message.type === type)
        .map((message) => message.payload as T);
}

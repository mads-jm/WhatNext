/**
 * WhatNext Handshake Protocol
 * /whatnext/handshake/1.0.0
 *
 * Exchanged after connection established to share peer metadata.
 * Uses length-prefixed JSON messages over a libp2p stream (libp2p v2+ API).
 *
 * Message framing: each message is prefixed with a 4-byte big-endian uint32
 * containing the byte length of the JSON payload. Matches the framing used by
 * the file-transfer protocol. Rejects messages exceeding MAX_MESSAGE_SIZE to
 * prevent a malicious peer from causing an unbounded allocation (OOM).
 */

import type { Libp2p, Connection, Stream } from '@libp2p/interface';
import { P2P_CONFIG } from '../../shared/p2p-config';

export interface HandshakeData {
    displayName: string;
    avatarUrl?: string;
    userId: string; // WhatNext user ID (UUID)
    version: string;
    capabilities: string[];
    peerId: string;
}

// Protocol messages are small JSON objects — 1MB is generous and prevents OOM
// from a crafted 0xFFFFFFFF length prefix causing a ~4GB allocation attempt.
const MAX_MESSAGE_SIZE = 1 * 1024 * 1024; // 1MB

/**
 * How long the dialer waits for the responder's handshake before giving up.
 *
 * Required, not defensive polish. The responder now replies on the SAME stream
 * (#58), so a peer that opens the stream and never writes back — a peer still
 * running the pre-#58 reply-on-a-new-stream shape, or one whose handler threw —
 * leaves `readMessage` awaiting for the life of the connection, holding the
 * stream open and the promise pending. That is the "must be inert" requirement
 * failing in the other direction: not a storm, but a leak. Deliberately a
 * module-local constant rather than a P2P_CONFIG field: P2P_CONFIG is
 * hand-duplicated in test-peer/src/p2p-config.js and adding a field there is
 * out of scope for this cycle.
 */
const HANDSHAKE_RESPONSE_TIMEOUT = 10_000; // 10s

/**
 * Encode a message with a 4-byte big-endian length prefix.
 */
function encodeFramed(data: unknown): Uint8Array {
    const json = new TextEncoder().encode(JSON.stringify(data));
    const frame = new Uint8Array(4 + json.length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, json.length, false); // big-endian
    frame.set(json, 4);
    return frame;
}

/**
 * Accumulate raw bytes from a stream until at least `needed` bytes are available.
 * Returns `null` if the stream ends before enough bytes arrive.
 */
async function accumulateBytes(
    iter: AsyncIterator<Uint8Array | { subarray(): Uint8Array }>,
    needed: number,
    carry: Uint8Array,
): Promise<{ buf: Uint8Array; rest: Uint8Array } | null> {
    let buf = carry;
    while (buf.length < needed) {
        const { value, done } = await iter.next();
        if (done || value === undefined) return null;
        const chunk = value instanceof Uint8Array ? value : value.subarray();
        const merged = new Uint8Array(buf.length + chunk.length);
        merged.set(buf, 0);
        merged.set(chunk, buf.length);
        buf = merged;
    }
    return { buf: buf.slice(0, needed), rest: buf.slice(needed) };
}

/**
 * Read a single length-prefixed JSON message from a stream.
 * Throws if the declared message length exceeds MAX_MESSAGE_SIZE.
 */
async function readMessage<T>(stream: Stream): Promise<T> {
    const iter = (
        stream as unknown as AsyncIterable<
            Uint8Array | { subarray(): Uint8Array }
        >
    )[Symbol.asyncIterator]();

    // Read 4-byte length prefix
    const headerResult = await accumulateBytes(iter, 4, new Uint8Array(0));
    if (!headerResult) {
        throw new Error(
            '[Handshake] Stream ended before length prefix was received',
        );
    }

    const view = new DataView(
        headerResult.buf.buffer,
        headerResult.buf.byteOffset,
    );
    const length = view.getUint32(0, false); // big-endian

    if (length === 0) {
        throw new Error('[Handshake] Rejected zero-length message');
    }
    if (length > MAX_MESSAGE_SIZE) {
        throw new Error(
            `[Handshake] Rejected oversized message (length=${length}, max=${MAX_MESSAGE_SIZE})`,
        );
    }

    // Read the JSON body
    const bodyResult = await accumulateBytes(iter, length, headerResult.rest);
    if (!bodyResult) {
        throw new Error(
            '[Handshake] Stream ended before message body was complete',
        );
    }

    return JSON.parse(new TextDecoder().decode(bodyResult.buf)) as T;
}

/**
 * Read one message, but give up after `timeoutMs`. Aborts the stream on expiry
 * so the pending read rejects rather than dangling for the connection's life.
 */
async function readMessageWithTimeout<T>(
    stream: Stream,
    timeoutMs: number,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            readMessage<T>(stream),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    const err = new Error(
                        `[Handshake] No response within ${timeoutMs}ms`,
                    );
                    try {
                        stream.abort(err);
                    } catch {
                        /* already gone */
                    }
                    reject(err);
                }, timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Send a length-prefixed JSON message to a stream and half-close for writing.
 *
 * `close()` only closes the WRITABLE end (libp2p streams are half-closable), so
 * the peer can still read what we queued and we can still read their reply. The
 * close is tolerant: the reader knows the exact frame length from the header and
 * may close first, and losing a handshake we already read+wrote over a benign
 * teardown race would be a silent no-sync.
 */
async function writeMessage(stream: Stream, data: unknown): Promise<void> {
    stream.send(encodeFramed(data));
    try {
        await stream.close();
    } catch {
        /* stream already closed by the peer — the bytes are queued, benign */
    }
}

/**
 * Register handshake protocol handler (responder side)
 *
 * REQUEST/RESPONSE ON ONE STREAM (#58). The responder reads the dialer's
 * HandshakeData off the inbound stream and writes its own back on that SAME
 * stream. It must never open a new stream to reply: a reply on a fresh stream is
 * indistinguishable from a fresh request at the far end, so the far end's own
 * responder answered it — and so on, forever. That ping-pong also re-fired
 * `onHandshake` on every lap, re-triggering replication bootstrap (a pull storm).
 */
export function registerHandshakeProtocol(
    node: Libp2p,
    localData: HandshakeData,
    onHandshake: (remotePeerId: string, data: HandshakeData) => void,
): void {
    node.handle(
        P2P_CONFIG.PROTOCOLS.HANDSHAKE,
        async (stream: Stream, connection: Connection) => {
            try {
                console.log(
                    `[Handshake] Incoming handshake from ${connection.remotePeer.toString()}`,
                );

                // Read remote peer's handshake
                const remoteData = await readMessage<HandshakeData>(stream);

                // Reply on the same stream — see the loop warning above.
                await writeMessage(stream, localData);

                console.log(
                    `[Handshake] Complete with ${remoteData.displayName}`,
                );
                onHandshake(connection.remotePeer.toString(), remoteData);
            } catch (error) {
                console.error('[Handshake] Error:', error);
            }
        },
    );
}

/**
 * Initiate handshake with a connected peer (initiator side).
 *
 * Resolves with the REMOTE peer's HandshakeData, read off the same stream we
 * wrote to. Previously this returned `localData` as a placeholder and the dialer
 * only ever learned about its peer because the responder's reply-on-a-new-stream
 * re-entered our own handler — i.e. the bug was load-bearing. With the loop gone,
 * this return value is the dialer's only completion path: callers MUST run their
 * handshake-complete work (peer metadata, replication bootstrap) on it, exactly
 * as the responder callback does. Follows the same open→send→read→close shape as
 * `requestManifest` in file-transfer.ts.
 */
export async function initiateHandshake(
    node: Libp2p,
    remotePeerId: string,
    localData: HandshakeData,
    // Overridable only so tests can exercise the timeout without a 10s wait.
    timeoutMs: number = HANDSHAKE_RESPONSE_TIMEOUT,
): Promise<HandshakeData> {
    const { peerIdFromString } = await import('@libp2p/peer-id');
    const peerId = peerIdFromString(remotePeerId);

    console.log(
        `[Handshake] Initiating handshake with ${remotePeerId.slice(0, 12)}...`,
    );

    const stream = await node.dialProtocol(
        peerId,
        P2P_CONFIG.PROTOCOLS.HANDSHAKE,
    );

    try {
        // Send our handshake data, then read theirs off the same stream.
        stream.send(encodeFramed(localData));
        return await readMessageWithTimeout<HandshakeData>(stream, timeoutMs);
    } finally {
        try {
            await stream.close();
        } catch {
            /* ignore */
        }
    }
}

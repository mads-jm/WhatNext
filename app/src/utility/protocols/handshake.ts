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
    carry: Uint8Array
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
    const iter = (stream as unknown as AsyncIterable<Uint8Array | { subarray(): Uint8Array }>)[Symbol.asyncIterator]();

    // Read 4-byte length prefix
    const headerResult = await accumulateBytes(iter, 4, new Uint8Array(0));
    if (!headerResult) {
        throw new Error('[Handshake] Stream ended before length prefix was received');
    }

    const view = new DataView(headerResult.buf.buffer, headerResult.buf.byteOffset);
    const length = view.getUint32(0, false); // big-endian

    if (length === 0) {
        throw new Error('[Handshake] Rejected zero-length message');
    }
    if (length > MAX_MESSAGE_SIZE) {
        throw new Error(
            `[Handshake] Rejected oversized message (length=${length}, max=${MAX_MESSAGE_SIZE})`
        );
    }

    // Read the JSON body
    const bodyResult = await accumulateBytes(iter, length, headerResult.rest);
    if (!bodyResult) {
        throw new Error('[Handshake] Stream ended before message body was complete');
    }

    return JSON.parse(new TextDecoder().decode(bodyResult.buf)) as T;
}

/**
 * Send a length-prefixed JSON message to a stream and half-close for writing.
 */
async function writeMessage(stream: Stream, data: unknown): Promise<void> {
    stream.send(encodeFramed(data));
    await stream.close();
}

/**
 * Register handshake protocol handler (responder side)
 */
export function registerHandshakeProtocol(
    node: Libp2p,
    localData: HandshakeData,
    onHandshake: (remotePeerId: string, data: HandshakeData) => void
): void {
    node.handle(P2P_CONFIG.PROTOCOLS.HANDSHAKE, async (stream: Stream, connection: Connection) => {
        try {
            console.log(`[Handshake] Incoming handshake from ${connection.remotePeer.toString()}`);

            // Read remote peer's handshake
            const remoteData = await readMessage<HandshakeData>(stream);

            // Send our handshake back on a new stream
            const responseStream = await connection.newStream(P2P_CONFIG.PROTOCOLS.HANDSHAKE);
            await writeMessage(responseStream, localData);

            console.log(`[Handshake] Complete with ${remoteData.displayName}`);
            onHandshake(connection.remotePeer.toString(), remoteData);
        } catch (error) {
            console.error('[Handshake] Error:', error);
        }
    });
}

/**
 * Initiate handshake with a connected peer (initiator side)
 */
export async function initiateHandshake(
    node: Libp2p,
    remotePeerId: string,
    localData: HandshakeData,
): Promise<HandshakeData> {
    const { peerIdFromString } = await import('@libp2p/peer-id');
    const peerId = peerIdFromString(remotePeerId);

    console.log(`[Handshake] Initiating handshake with ${remotePeerId.slice(0, 12)}...`);

    // Send our handshake data
    const stream = await node.dialProtocol(peerId, P2P_CONFIG.PROTOCOLS.HANDSHAKE);
    await writeMessage(stream, localData);

    // The response will come via our protocol handler
    // For now, return a basic ack - the handler will fire onHandshake
    return localData; // placeholder
}

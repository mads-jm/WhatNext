/**
 * WhatNext Protocol Implementations (JavaScript)
 *
 * JS ports of app/src/utility/protocols/handshake.ts
 * and app/src/utility/protocols/replication.ts.
 *
 * Intentionally kept in sync with the TypeScript originals.
 * One deliberate divergence: registerReplicationProtocol accepts an
 * onPullResponse callback so the test peer can apply results that arrive
 * asynchronously (the TS version handles this via IPC; we handle it inline).
 */

import { peerIdFromString } from '@libp2p/peer-id';
import { P2P_CONFIG } from './p2p-config.js';
import {
    getTestFile,
    getActiveTransfers,
    startTransfer,
    recordChunk,
    completeTransfer,
    failTransfer,
    cancelTransferRecord,
} from './file-transfer-store.js';

// ─── Stream helpers ──────────────────────────────────────────────────────────

/**
 * Read a single length-prefixed JSON message from a libp2p stream.
 *
 * The app (handshake.ts, replication.ts, file-transfer.ts) frames every message
 * as a 4-byte big-endian length prefix + JSON body. This peer previously read
 * handshake/replication as "concatenate-to-EOF then JSON.parse", which is NOT
 * the app's framing — the app read our un-prefixed JSON's first 4 bytes as a
 * ~2GB length and rejected it. Reuse the framed reader so all three protocols
 * speak the app's wire format. (File-transfer already used framing.)
 *
 * @template T
 * @param {import('@libp2p/interface').Stream} stream
 * @returns {Promise<T>}
 */
async function readStreamMessage(stream) {
    const iter = stream[Symbol.asyncIterator]();
    const result = await readFramedMessage(iter, new Uint8Array(0));
    if (!result) {
        throw new Error(
            'readStreamMessage: stream ended before a complete length-prefixed message',
        );
    }
    return result.message;
}

/**
 * Write a single length-prefixed JSON message to a stream and half-close.
 * Uses the same 4-byte big-endian framing as the app (encodeFramed), so the
 * app's readers accept it instead of rejecting an unframed payload.
 *
 * @param {import('@libp2p/interface').Stream} stream
 * @param {unknown} data
 * @returns {Promise<void>}
 */
async function writeStreamMessage(stream, data) {
    stream.send(encodeFramed(data));
    // The reader knows the exact byte length from the frame header, so it may
    // close the stream before our close() lands. Tolerate that race, matching
    // the file-transfer sender in this file.
    try {
        await stream.close();
    } catch {
        /* stream already closed by the peer — benign */
    }
}

// ─── Handshake Protocol ──────────────────────────────────────────────────────

/**
 * Register the responder side of /whatnext/handshake/1.0.0.
 *
 * Flow (mirrors handshake.ts):
 *   1. Read remote peer's HandshakeData from the incoming stream.
 *   2. Open a NEW stream on the same connection and write localData.
 *   3. Fire onHandshake(remotePeerId, remoteData).
 *
 * @param {import('libp2p').Libp2p} node
 * @param {object} localData - HandshakeData for this peer
 * @param {(remotePeerId: string, data: object) => void} onHandshake
 */
export function registerHandshakeProtocol(node, localData, onHandshake) {
    node.handle(P2P_CONFIG.PROTOCOLS.HANDSHAKE, async (stream, connection) => {
        try {
            const remotePeerId = connection.remotePeer.toString();
            console.log(`[Handshake] Incoming from ${remotePeerId.slice(0, 12)}...`);

            const remoteData = await readStreamMessage(stream);

            // Respond on a new stream (same pattern as TS original)
            const responseStream = await connection.newStream(P2P_CONFIG.PROTOCOLS.HANDSHAKE);
            await writeStreamMessage(responseStream, localData);

            console.log(`[Handshake] Complete with ${remoteData.displayName}`);
            onHandshake(remotePeerId, remoteData);
        } catch (error) {
            console.error('[Handshake] Error handling incoming:', error.message);
        }
    });
}

/**
 * Initiator side: dial the handshake protocol and send localData.
 * The response arrives via the registered handler above.
 *
 * @param {import('libp2p').Libp2p} node
 * @param {string} remotePeerId
 * @param {object} localData
 * @returns {Promise<void>}
 */
export async function initiateHandshake(node, remotePeerId, localData) {
    const peerId = peerIdFromString(remotePeerId);
    console.log(`[Handshake] Initiating with ${remotePeerId.slice(0, 12)}...`);

    const stream = await node.dialProtocol(peerId, P2P_CONFIG.PROTOCOLS.HANDSHAKE);
    await writeStreamMessage(stream, localData);
    // Response arrives asynchronously via the registered protocol handler.
}

// ─── Replication Protocol ────────────────────────────────────────────────────

/**
 * Register the /whatnext/rxdb-replication/1.0.0 handler.
 *
 * Handles all four message types. Key divergence from replication.ts:
 * pull-response is forwarded to onPullResponse rather than silently ignored,
 * because the test peer has no separate IPC layer to route it through.
 *
 * @param {import('libp2p').Libp2p} node
 * @param {(collection: string, checkpoint: string|null, limit: number) =>
 *          Promise<{documents: object[], checkpoint: string}>} onPullRequest
 * @param {(collection: string, documents: object[]) => Promise<void>} onPushReceived
 * @param {(collection: string, documents: object[], checkpoint: string) => void} onPullResponse
 */
export function registerReplicationProtocol(node, onPullRequest, onPushReceived, onPullResponse) {
    node.handle(P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION, async (stream, connection) => {
        try {
            const message = await readStreamMessage(stream);
            const remotePeer = connection.remotePeer.toString().slice(0, 12);

            console.log(`[Replication] Received ${message.type} for ${message.collection} from ${remotePeer}...`);

            switch (message.type) {
                case 'pull-request': {
                    const result = await onPullRequest(
                        message.collection,
                        message.checkpoint ?? null,
                        message.limit ?? 100,
                    );
                    const responseStream = await connection.newStream(P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION);
                    await writeStreamMessage(responseStream, {
                        type: 'pull-response',
                        collection: message.collection,
                        documents: result.documents,
                        checkpoint: result.checkpoint,
                    });
                    break;
                }

                case 'push': {
                    if (message.documents && message.documents.length > 0) {
                        await onPushReceived(message.collection, message.documents);
                    }
                    const ackStream = await connection.newStream(P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION);
                    await writeStreamMessage(ackStream, {
                        type: 'push-ack',
                        collection: message.collection,
                    });
                    break;
                }

                case 'pull-response': {
                    onPullResponse(
                        message.collection,
                        message.documents ?? [],
                        message.checkpoint ?? null,
                    );
                    break;
                }

                case 'push-ack': {
                    console.log(`[Replication] Push acknowledged for ${message.collection}`);
                    break;
                }

                default:
                    console.warn(`[Replication] Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error('[Replication] Error handling stream:', error.message);
        }
    });
}

/**
 * Push documents for one collection to a remote peer.
 *
 * @param {import('libp2p').Libp2p} node
 * @param {string} remotePeerId
 * @param {string} collection
 * @param {Array<{id: string, data: object, updatedAt: string, deleted?: boolean}>} documents
 * @returns {Promise<void>}
 */
export async function pushDocuments(node, remotePeerId, collection, documents) {
    const peerId = peerIdFromString(remotePeerId);
    console.log(`[Replication] Pushing ${documents.length} doc(s) to ${remotePeerId.slice(0, 12)}... (${collection})`);
    const stream = await node.dialProtocol(peerId, P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION);
    await writeStreamMessage(stream, {
        type: 'push',
        collection,
        documents,
    });
}

/**
 * Send a pull-request for one collection to a remote peer.
 * The response arrives asynchronously via the onPullResponse callback.
 *
 * @param {import('libp2p').Libp2p} node
 * @param {string} remotePeerId
 * @param {string} collection
 * @param {string|null} checkpoint
 * @param {number} [limit=100]
 * @returns {Promise<void>}
 */
export async function pullCollection(node, remotePeerId, collection, checkpoint, limit = 100) {
    const peerId = peerIdFromString(remotePeerId);
    console.log(`[Replication] Pulling ${collection} from ${remotePeerId.slice(0, 12)}... (checkpoint: ${checkpoint ?? 'null'})`);
    const stream = await node.dialProtocol(peerId, P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION);
    await writeStreamMessage(stream, {
        type: 'pull-request',
        collection,
        checkpoint,
        limit,
    });
}

// ─── File Transfer Protocol ───────────────────────────────────────────────────

const FILE_TRANSFER_CHUNK_SIZE = 65536;       // 64KB
const FILE_TRANSFER_MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Encode a message with a 4-byte big-endian length prefix.
 *
 * @param {unknown} data
 * @returns {Uint8Array}
 */
function encodeFramed(data) {
    const json = new TextEncoder().encode(JSON.stringify(data));
    const frame = new Uint8Array(4 + json.length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, json.length, false); // big-endian
    frame.set(json, 4);
    return frame;
}

/**
 * Accumulate raw bytes from an async iterator until `needed` bytes are available.
 * Returns null if the iterator ends before enough bytes arrive.
 *
 * @param {AsyncIterator<Uint8Array|{subarray():Uint8Array}>} iter
 * @param {number} needed
 * @param {Uint8Array} carry - bytes already read from a previous partial read
 * @returns {Promise<{buf: Uint8Array, rest: Uint8Array}|null>}
 */
async function accumulateBytes(iter, needed, carry) {
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
 * Read a single length-prefixed JSON message from an async iterator.
 * `carry` holds any bytes already read from a previous partial read.
 *
 * @param {AsyncIterator<Uint8Array|{subarray():Uint8Array}>} iter
 * @param {Uint8Array} carry
 * @returns {Promise<{message: object, rest: Uint8Array}|null>}
 */
async function readFramedMessage(iter, carry) {
    const headerResult = await accumulateBytes(iter, 4, carry);
    if (!headerResult) return null;

    const view = new DataView(headerResult.buf.buffer, headerResult.buf.byteOffset);
    const length = view.getUint32(0, false); // big-endian

    if (length === 0) {
        throw new Error('readFramedMessage: rejected zero-length message');
    }
    if (length > FILE_TRANSFER_MAX_MESSAGE_SIZE) {
        throw new Error(`readFramedMessage: rejected oversized message (length=${length})`);
    }

    const bodyResult = await accumulateBytes(iter, length, headerResult.rest);
    if (!bodyResult) return null;

    try {
        const message = JSON.parse(new TextDecoder().decode(bodyResult.buf));
        return { message, rest: bodyResult.rest };
    } catch {
        return null;
    }
}

/**
 * Serve all chunks of a file to a peer on an already-open stream.
 * Writes file-header → N×file-chunk → file-complete.
 *
 * @param {import('@libp2p/interface').Stream} stream
 * @param {object} fileEntry - from getTestFile()
 * @param {number} offsetBytes - resume offset
 */
async function serveFile(stream, fileEntry, offsetBytes) {
    const { sha256, data: buf, sizeBytes } = fileEntry;

    stream.send(encodeFramed({
        type: 'file-header',
        sha256,
        totalBytes: sizeBytes,
        chunkSize: FILE_TRANSFER_CHUNK_SIZE,
    }));

    let offset = offsetBytes;
    while (offset < buf.length) {
        const end = Math.min(offset + FILE_TRANSFER_CHUNK_SIZE, buf.length);
        const chunk = buf.slice(offset, end);
        stream.send(encodeFramed({
            type: 'file-chunk',
            sha256,
            offset,
            data: chunk.toString('base64'),
        }));
        offset = end;
    }

    stream.send(encodeFramed({ type: 'file-complete', sha256 }));
    try { await stream.close(); } catch { /* ignore */ }
}

/**
 * Read response messages off a stream we opened for a file-request.
 * Accumulates chunks, fires onProgress, resolves when file-complete arrives.
 *
 * @param {AsyncIterator} iter
 * @param {Uint8Array} carry
 * @param {string} remotePeerId
 * @param {string} sha256
 * @param {import('@libp2p/interface').Stream} stream
 * @param {(bytesReceived: number, totalBytes: number) => void} onProgress
 * @returns {Promise<void>}
 */
async function receiveFileStream(iter, carry, remotePeerId, sha256, stream, onProgress) {
    let remaining = carry;
    let totalBytes = 0;

    while (true) {
        const result = await readFramedMessage(iter, remaining);
        if (!result) break;

        const { message, rest } = result;
        remaining = rest;

        switch (message.type) {
            case 'file-header': {
                totalBytes = message.totalBytes;
                console.log(`[FileTransfer] Receiving ${sha256.slice(0, 8)}... totalBytes=${totalBytes}`);
                break;
            }

            case 'file-chunk': {
                const chunkBuf = Buffer.from(message.data, 'base64');
                recordChunk(sha256, message.offset, chunkBuf);
                onProgress(totalBytes);
                break;
            }

            case 'file-complete': {
                console.log(`[FileTransfer] Complete: ${sha256.slice(0, 8)}...`);
                completeTransfer(sha256);
                try { await stream.close(); } catch { /* ignore */ }
                return;
            }

            case 'file-error': {
                console.error(`[FileTransfer] Error from peer: ${message.error}`);
                failTransfer(sha256, message.error);
                try { await stream.close(); } catch { /* ignore */ }
                return;
            }

            case 'transfer-cancel': {
                console.log(`[FileTransfer] Transfer cancelled by remote`);
                cancelTransferRecord(sha256);
                try { await stream.close(); } catch { /* ignore */ }
                return;
            }

            default:
                console.warn(`[FileTransfer] Unexpected message in receive stream: ${message.type}`);
                break;
        }
    }
}

/**
 * Register the /whatnext/file-transfer/1.0.0 protocol handler.
 *
 * Single-process divergence from the Electron app: serving is done inline in
 * the handler rather than via IPC callbacks, since we have direct Buffer access.
 *
 * @param {import('libp2p').Libp2p} node
 * @param {object} callbacks
 * @param {() => object[]} callbacks.getLocalFiles - returns getAllTestFiles()
 * @param {(sha256: string, filename: string, totalBytes: number, peerId: string) => void} callbacks.onTransferStarted
 * @param {(sha256: string, bytesReceived: number, totalBytes: number) => void} callbacks.onProgress
 * @param {(sha256: string, buf: Buffer, filename: string) => Promise<void>} callbacks.onComplete
 * @param {(sha256: string, error: string) => void} callbacks.onError
 * @param {(sha256: string) => void} callbacks.onCancelled
 */
export function registerFileTransferProtocol(node, callbacks) {
    node.handle(P2P_CONFIG.PROTOCOLS.FILE_TRANSFER, async (stream, connection) => {
        const remotePeerId = connection.remotePeer.toString();
        const shortId = remotePeerId.slice(0, 12);

        console.log(`[FileTransfer] Incoming stream from ${shortId}...`);

        try {
            const iter = stream[Symbol.asyncIterator]();
            const firstRead = await readFramedMessage(iter, new Uint8Array(0));

            if (!firstRead) {
                console.warn(`[FileTransfer] Empty or malformed first message from ${shortId}`);
                try { await stream.close(); } catch { /* ignore */ }
                return;
            }

            const { message, rest } = firstRead;

            switch (message.type) {
                case 'manifest-request': {
                    const playlistId = message.playlistId ?? 'unknown';
                    console.log(`[FileTransfer] Manifest request from ${shortId} for playlist ${playlistId}`);

                    const localFiles = callbacks.getLocalFiles();
                    const manifest = {
                        peerId: node.peerId.toString(),
                        playlistId,
                        files: localFiles.map(f => ({
                            trackId: f.trackId,
                            type: f.type,
                            sha256: f.sha256,
                            sizeBytes: f.sizeBytes,
                            mimeType: f.mimeType,
                            filename: f.filename,
                        })),
                        generatedAt: new Date().toISOString(),
                    };

                    stream.send(encodeFramed({ type: 'manifest-response', manifest }));
                    try { await stream.close(); } catch { /* ignore */ }
                    break;
                }

                case 'file-request': {
                    const { sha256, offsetBytes } = message;
                    console.log(`[FileTransfer] File request from ${shortId}: ${sha256.slice(0, 8)}... offset=${offsetBytes}`);

                    const fileEntry = getTestFile(sha256);
                    if (!fileEntry) {
                        console.warn(`[FileTransfer] File not found: ${sha256.slice(0, 8)}...`);
                        stream.send(encodeFramed({
                            type: 'file-error',
                            sha256,
                            error: `file not found: ${sha256.slice(0, 8)}`,
                        }));
                        try { await stream.close(); } catch { /* ignore */ }
                        break;
                    }

                    // Serve inline — no IPC needed in test-peer
                    await serveFile(stream, fileEntry, offsetBytes ?? 0);
                    break;
                }

                case 'file-header':
                case 'file-chunk':
                case 'file-complete': {
                    // We are receiving the response to a file-request we sent.
                    // This path fires when the provider's first message arrives on our
                    // outbound stream (which is also registered as an incoming stream
                    // from libp2p's perspective). Hand off to the receive loop.
                    if (message.type === 'file-header') {
                        const { sha256, totalBytes } = message;
                        startTransfer(sha256, sha256.slice(0, 8) + '.bin', totalBytes, remotePeerId);
                        callbacks.onTransferStarted(sha256, sha256.slice(0, 8) + '.bin', totalBytes, remotePeerId);
                        await receiveFileStream(iter, rest, remotePeerId, sha256, stream,
                            (total) => callbacks.onProgress(sha256, getActiveTransfers().find(t => t.sha256 === sha256)?.bytesReceived ?? 0, total));
                    }
                    break;
                }

                case 'transfer-cancel': {
                    console.log(`[FileTransfer] Cancel received from ${shortId} for ${message.sha256.slice(0, 8)}...`);
                    cancelTransferRecord(message.sha256);
                    callbacks.onCancelled(message.sha256);
                    try { await stream.close(); } catch { /* ignore */ }
                    break;
                }

                default:
                    console.warn(`[FileTransfer] Unknown message type from ${shortId}: ${message.type}`);
                    try { await stream.close(); } catch { /* ignore */ }
                    break;
            }
        } catch (err) {
            console.error(`[FileTransfer] Stream error from ${shortId}:`, err.message);
            try { await stream.close(); } catch { /* ignore */ }
        }
    });

    console.log(`[FileTransfer] Protocol registered: ${P2P_CONFIG.PROTOCOLS.FILE_TRANSFER}`);
}

/**
 * Request a file manifest from a peer.
 *
 * @param {import('libp2p').Libp2p} node
 * @param {string} remotePeerId
 * @param {string} playlistId
 * @returns {Promise<object>} FileManifest
 */
export async function requestManifest(node, remotePeerId, playlistId) {
    const peerId = peerIdFromString(remotePeerId);
    console.log(`[FileTransfer] Requesting manifest from ${remotePeerId.slice(0, 12)}... for playlist ${playlistId}`);

    const stream = await node.dialProtocol(peerId, P2P_CONFIG.PROTOCOLS.FILE_TRANSFER);

    try {
        stream.send(encodeFramed({ type: 'manifest-request', playlistId }));

        const iter = stream[Symbol.asyncIterator]();
        const result = await readFramedMessage(iter, new Uint8Array(0));

        if (!result) {
            throw new Error('No response received for manifest-request');
        }

        const { message } = result;
        if (message.type === 'manifest-response') {
            return message.manifest;
        }
        if (message.type === 'file-error') {
            throw new Error(message.error);
        }
        throw new Error(`Unexpected response type: ${message.type}`);
    } finally {
        try { await stream.close(); } catch { /* ignore */ }
    }
}

/**
 * Request a file from a peer.
 * Opens a stream, sends file-request, then reads the response in the background.
 *
 * @param {import('libp2p').Libp2p} node
 * @param {string} remotePeerId
 * @param {string} sha256
 * @param {number} offsetBytes
 * @param {object} callbacks - same shape as registerFileTransferProtocol callbacks
 * @returns {Promise<void>}
 */
export async function requestFile(node, remotePeerId, sha256, offsetBytes, callbacks) {
    const peerId = peerIdFromString(remotePeerId);
    console.log(`[FileTransfer] Requesting file ${sha256.slice(0, 8)}... from ${remotePeerId.slice(0, 12)}... offset=${offsetBytes}`);

    const stream = await node.dialProtocol(peerId, P2P_CONFIG.PROTOCOLS.FILE_TRANSFER);
    stream.send(encodeFramed({ type: 'file-request', sha256, offsetBytes }));

    // Fire-and-forget receive loop
    (async () => {
        try {
            const iter = stream[Symbol.asyncIterator]();
            let carry = new Uint8Array(0);
            let totalBytes = 0;

            while (true) {
                const result = await readFramedMessage(iter, carry);
                if (!result) break;

                const { message, rest } = result;
                carry = rest;

                switch (message.type) {
                    case 'file-header': {
                        totalBytes = message.totalBytes;
                        startTransfer(sha256, sha256.slice(0, 8) + '.bin', totalBytes, remotePeerId);
                        callbacks.onTransferStarted(sha256, sha256.slice(0, 8) + '.bin', totalBytes, remotePeerId);
                        break;
                    }

                    case 'file-chunk': {
                        const chunkBuf = Buffer.from(message.data, 'base64');
                        recordChunk(sha256, message.offset, chunkBuf);
                        const t = getActiveTransfers().find(t => t.sha256 === sha256);
                        callbacks.onProgress(sha256, t?.bytesReceived ?? 0, totalBytes);
                        break;
                    }

                    case 'file-complete': {
                        const assembled = completeTransfer(sha256);
                        if (assembled) {
                            await callbacks.onComplete(sha256, assembled.buf, assembled.filename);
                        }
                        try { await stream.close(); } catch { /* ignore */ }
                        return;
                    }

                    case 'file-error': {
                        failTransfer(sha256, message.error);
                        callbacks.onError(sha256, message.error);
                        try { await stream.close(); } catch { /* ignore */ }
                        return;
                    }

                    case 'transfer-cancel': {
                        cancelTransferRecord(sha256);
                        callbacks.onCancelled(sha256);
                        try { await stream.close(); } catch { /* ignore */ }
                        return;
                    }

                    default:
                        console.warn(`[FileTransfer] Unexpected message in file stream: ${message.type}`);
                        break;
                }
            }
        } catch (err) {
            failTransfer(sha256, err.message);
            callbacks.onError(sha256, `stream-error: ${err.message}`);
            try { await stream.close(); } catch { /* ignore */ }
        }
    })();
}

/**
 * Send a transfer-cancel to a peer on a new short-lived stream.
 *
 * @param {import('libp2p').Libp2p} node
 * @param {string} remotePeerId
 * @param {string} sha256
 * @returns {Promise<void>}
 */
export async function cancelFileTransfer(node, remotePeerId, sha256) {
    const peerId = peerIdFromString(remotePeerId);
    console.log(`[FileTransfer] Sending cancel for ${sha256.slice(0, 8)}... to ${remotePeerId.slice(0, 12)}...`);

    cancelTransferRecord(sha256);

    try {
        const stream = await node.dialProtocol(peerId, P2P_CONFIG.PROTOCOLS.FILE_TRANSFER);
        stream.send(encodeFramed({ type: 'transfer-cancel', sha256 }));
        try { await stream.close(); } catch { /* ignore */ }
    } catch (err) {
        console.warn(`[FileTransfer] Could not send cancel: ${err.message}`);
    }
}

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { P2P_CONFIG };

export const COLLECTIONS = ['playlists', 'tracks', 'trackInteractions', 'users'];

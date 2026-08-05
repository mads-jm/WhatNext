/**
 * WhatNext RxDB Replication Protocol
 * /whatnext/rxdb-replication/1.0.0
 *
 * Syncs RxDB documents between peers using JSON-over-stream.
 * Uses checkpoint-based sync with LWW (Last-Write-Wins) conflict resolution.
 * Updated to libp2p v2+ Stream API (send/closeWrite instead of sink).
 *
 * Message framing: each message is prefixed with a 4-byte big-endian uint32
 * containing the byte length of the JSON payload. Matches the framing used by
 * the file-transfer protocol. Rejects messages exceeding MAX_MESSAGE_SIZE to
 * prevent a malicious peer from causing an unbounded allocation (OOM).
 */

import type { Libp2p, Connection, Stream } from '@libp2p/interface';
import { P2P_CONFIG } from '../../shared/p2p-config';

// Replication payloads are JSON objects (metadata only, never raw audio).
// 5MB accommodates a large full-sync response without being exploitable.
const MAX_MESSAGE_SIZE = 5 * 1024 * 1024; // 5MB

export type ReplicationMessageType =
    'pull-request' | 'pull-response' | 'push' | 'push-ack';

export interface ReplicationMessage {
    type: ReplicationMessageType;
    collection: string;
    documents?: ReplicationDocument[];
    checkpoint?: string | null;
    limit?: number;
}

export interface ReplicationDocument {
    id: string;
    data: Record<string, unknown>;
    updatedAt: string;
    deleted?: boolean;
}

/**
 * Compute the checkpoint to report after returning `documents` for a pull.
 *
 * Returns the newest parseable `updatedAt` among the documents. If no document
 * carries a usable timestamp, the incoming `checkpoint` is preserved (so the
 * checkpoint never moves backward and never jumps to wall-clock "now", which
 * would skip docs written between the newest returned doc and now). Exported for
 * unit testing (#32).
 */
export function newestCheckpoint(
    documents: ReplicationDocument[],
    incoming: string | null,
): string {
    let newestMs = -1;
    let newest = incoming;
    for (const doc of documents) {
        const ms = Date.parse(doc.updatedAt);
        if (!Number.isNaN(ms) && ms > newestMs) {
            newestMs = ms;
            newest = doc.updatedAt;
        }
    }
    return newest ?? new Date(0).toISOString();
}

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
 * Read a length-prefixed JSON message from a stream.
 * Throws if the declared message length exceeds MAX_MESSAGE_SIZE.
 */
async function readStreamMessage<T>(stream: Stream): Promise<T> {
    const iter = (
        stream as unknown as AsyncIterable<
            Uint8Array | { subarray(): Uint8Array }
        >
    )[Symbol.asyncIterator]();

    // Read 4-byte length prefix
    const headerResult = await accumulateBytes(iter, 4, new Uint8Array(0));
    if (!headerResult) {
        throw new Error(
            '[Replication] Stream ended before length prefix was received',
        );
    }

    const view = new DataView(
        headerResult.buf.buffer,
        headerResult.buf.byteOffset,
    );
    const length = view.getUint32(0, false); // big-endian

    if (length === 0) {
        throw new Error('[Replication] Rejected zero-length message');
    }
    if (length > MAX_MESSAGE_SIZE) {
        throw new Error(
            `[Replication] Rejected oversized message (length=${length}, max=${MAX_MESSAGE_SIZE})`,
        );
    }

    // Read the JSON body
    const bodyResult = await accumulateBytes(iter, length, headerResult.rest);
    if (!bodyResult) {
        throw new Error(
            '[Replication] Stream ended before message body was complete',
        );
    }

    return JSON.parse(new TextDecoder().decode(bodyResult.buf)) as T;
}

/**
 * Write a length-prefixed JSON message to a stream and half-close the write side.
 */
async function writeStreamMessage(
    stream: Stream,
    data: unknown,
): Promise<void> {
    stream.send(encodeFramed(data));
    await stream.close();
}

export type OnPullRequest = (
    collection: string,
    checkpoint: string | null,
    limit: number,
) => Promise<{ documents: ReplicationDocument[]; checkpoint: string }>;

export type OnPushReceived = (
    collection: string,
    documents: ReplicationDocument[],
) => Promise<void>;

/**
 * Called on the REQUESTER side when a `pull-response` arrives. Previously the
 * pull-response was dropped (logged only), so pulled documents never reached the
 * renderer and the checkpoint never advanced — meaning every pull silently
 * achieved nothing and the next launch full-resynced again (#40/#41). The handler
 * forwards the documents to the renderer and persists the returned checkpoint.
 */
export type OnPullResponse = (
    remotePeerId: string,
    collection: string,
    documents: ReplicationDocument[],
    checkpoint: string | null,
) => void;

/**
 * Register replication protocol handler
 */
export function registerReplicationProtocol(
    node: Libp2p,
    onPullRequest: OnPullRequest,
    onPushReceived: OnPushReceived,
    onPullResponse?: OnPullResponse,
): void {
    node.handle(
        P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION,
        async (stream: Stream, connection: Connection) => {
            try {
                const message =
                    await readStreamMessage<ReplicationMessage>(stream);
                const remotePeer = connection.remotePeer
                    .toString()
                    .slice(0, 12);

                console.log(
                    `[Replication] Received ${message.type} for ${message.collection} from ${remotePeer}`,
                );

                switch (message.type) {
                    case 'pull-request': {
                        const result = await onPullRequest(
                            message.collection,
                            message.checkpoint ?? null,
                            message.limit ?? 100,
                        );
                        // Send response on new stream
                        const responseStream = await connection.newStream(
                            P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION,
                        );
                        await writeStreamMessage(responseStream, {
                            type: 'pull-response',
                            collection: message.collection,
                            documents: result.documents,
                            checkpoint: result.checkpoint,
                        } satisfies ReplicationMessage);
                        break;
                    }

                    case 'push': {
                        if (message.documents && message.documents.length > 0) {
                            await onPushReceived(
                                message.collection,
                                message.documents,
                            );
                        }
                        // Send ack
                        const ackStream = await connection.newStream(
                            P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION,
                        );
                        await writeStreamMessage(ackStream, {
                            type: 'push-ack',
                            collection: message.collection,
                        } satisfies ReplicationMessage);
                        break;
                    }

                    case 'pull-response': {
                        // Requester side: forward pulled docs to the renderer and
                        // advance the persisted checkpoint. Without this, pulls are no-ops.
                        console.log(
                            `[Replication] Got pull-response with ${message.documents?.length ?? 0} docs`,
                        );
                        onPullResponse?.(
                            connection.remotePeer.toString(),
                            message.collection,
                            message.documents ?? [],
                            message.checkpoint ?? null,
                        );
                        break;
                    }

                    case 'push-ack': {
                        console.log(
                            `[Replication] Push acknowledged for ${message.collection}`,
                        );
                        break;
                    }
                }
            } catch (error) {
                console.error('[Replication] Error handling stream:', error);
            }
        },
    );
}

/**
 * Send a push to a remote peer (outbound replication)
 */
export async function pushToRemotePeer(
    node: Libp2p,
    remotePeerId: string,
    collection: string,
    documents: ReplicationDocument[],
): Promise<void> {
    const { peerIdFromString } = await import('@libp2p/peer-id');
    const peerId = peerIdFromString(remotePeerId);

    console.log(
        `[Replication] Pushing ${documents.length} docs to ${remotePeerId.slice(0, 12)}...`,
    );

    const stream = await node.dialProtocol(
        peerId,
        P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION,
    );
    await writeStreamMessage(stream, {
        type: 'push',
        collection,
        documents,
    } satisfies ReplicationMessage);
}

/**
 * Send a pull request to a remote peer
 */
export async function pullFromRemotePeer(
    node: Libp2p,
    remotePeerId: string,
    collection: string,
    checkpoint: string | null,
    limit: number = 100,
): Promise<void> {
    const { peerIdFromString } = await import('@libp2p/peer-id');
    const peerId = peerIdFromString(remotePeerId);

    console.log(
        `[Replication] Pulling ${collection} from ${remotePeerId.slice(0, 12)}... (checkpoint: ${checkpoint ?? 'null'})`,
    );

    const stream = await node.dialProtocol(
        peerId,
        P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION,
    );
    await writeStreamMessage(stream, {
        type: 'pull-request',
        collection,
        checkpoint,
        limit,
    } satisfies ReplicationMessage);
}

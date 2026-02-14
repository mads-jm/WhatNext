/**
 * WhatNext RxDB Replication Protocol
 * /whatnext/rxdb-replication/1.0.0
 *
 * Syncs RxDB documents between peers using JSON-over-stream.
 * Uses checkpoint-based sync with LWW (Last-Write-Wins) conflict resolution.
 */

import type { Libp2p } from 'libp2p';
import type { Stream } from '@libp2p/interface';
import { P2P_CONFIG } from '../../shared/p2p-config';

export type ReplicationMessageType = 'pull-request' | 'pull-response' | 'push' | 'push-ack';

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
 * Read a JSON message from a stream
 */
async function readStreamMessage<T>(stream: Stream): Promise<T> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream.source) {
        chunks.push(chunk.subarray());
    }
    const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(combined));
}

/**
 * Write a JSON message to a stream
 */
async function writeStreamMessage(stream: Stream, data: unknown): Promise<void> {
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    await stream.sink([encoded]);
}

export type OnPullRequest = (
    collection: string,
    checkpoint: string | null,
    limit: number
) => Promise<{ documents: ReplicationDocument[]; checkpoint: string }>;

export type OnPushReceived = (
    collection: string,
    documents: ReplicationDocument[]
) => Promise<void>;

/**
 * Register replication protocol handler
 */
export function registerReplicationProtocol(
    node: Libp2p,
    onPullRequest: OnPullRequest,
    onPushReceived: OnPushReceived,
): void {
    node.handle(P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION, async ({ stream, connection }) => {
        try {
            const message = await readStreamMessage<ReplicationMessage>(stream);
            const remotePeer = connection.remotePeer.toString().slice(0, 12);

            console.log(`[Replication] Received ${message.type} for ${message.collection} from ${remotePeer}`);

            switch (message.type) {
                case 'pull-request': {
                    const result = await onPullRequest(
                        message.collection,
                        message.checkpoint ?? null,
                        message.limit ?? 100
                    );
                    // Send response on new stream
                    const responseStream = await connection.newStream(P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION);
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
                        await onPushReceived(message.collection, message.documents);
                    }
                    // Send ack
                    const ackStream = await connection.newStream(P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION);
                    await writeStreamMessage(ackStream, {
                        type: 'push-ack',
                        collection: message.collection,
                    } satisfies ReplicationMessage);
                    break;
                }

                case 'pull-response': {
                    // This is handled by the initiator - forward to main process
                    console.log(`[Replication] Got pull-response with ${message.documents?.length ?? 0} docs`);
                    break;
                }

                case 'push-ack': {
                    console.log(`[Replication] Push acknowledged for ${message.collection}`);
                    break;
                }
            }
        } catch (error) {
            console.error('[Replication] Error handling stream:', error);
        }
    });
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

    console.log(`[Replication] Pushing ${documents.length} docs to ${remotePeerId.slice(0, 12)}...`);

    const stream = await node.dialProtocol(peerId, P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION);
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

    console.log(`[Replication] Pulling ${collection} from ${remotePeerId.slice(0, 12)}... (checkpoint: ${checkpoint ?? 'null'})`);

    const stream = await node.dialProtocol(peerId, P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION);
    await writeStreamMessage(stream, {
        type: 'pull-request',
        collection,
        checkpoint,
        limit,
    } satisfies ReplicationMessage);
}

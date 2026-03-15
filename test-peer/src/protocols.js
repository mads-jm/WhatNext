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

// ─── Stream helpers ──────────────────────────────────────────────────────────

/**
 * Read all chunks from a libp2p stream source, concatenate, and JSON.parse.
 *
 * @template T
 * @param {import('@libp2p/interface').Stream} stream
 * @returns {Promise<T>}
 */
async function readStreamMessage(stream) {
    const chunks = [];
    for await (const chunk of stream.source) {
        chunks.push(chunk.subarray());
    }
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(combined));
}

/**
 * JSON-stringify data and write to a stream.
 *
 * @param {import('@libp2p/interface').Stream} stream
 * @param {unknown} data
 * @returns {Promise<void>}
 */
async function writeStreamMessage(stream, data) {
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    await stream.sink([encoded]);
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
    node.handle(P2P_CONFIG.PROTOCOLS.HANDSHAKE, async ({ stream, connection }) => {
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
    node.handle(P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION, async ({ stream, connection }) => {
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

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { P2P_CONFIG };

export const COLLECTIONS = ['playlists', 'tracks', 'trackInteractions', 'users'];

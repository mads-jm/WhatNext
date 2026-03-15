/**
 * WhatNext Handshake Protocol
 * /whatnext/handshake/1.0.0
 *
 * Exchanged after connection established to share peer metadata.
 * Uses JSON messages over a libp2p stream (libp2p v2+ API).
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

/**
 * Read all chunks from a stream and decode as JSON
 */
async function readMessage<T>(stream: Stream): Promise<T> {
    const chunks: Uint8Array[] = [];
    // Stream is AsyncIterable<Uint8Array | Uint8ArrayList> in libp2p v2+
    for await (const chunk of stream) {
        chunks.push(chunk.subarray());
    }
    const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }
    const text = new TextDecoder().decode(combined);
    return JSON.parse(text) as T;
}

/**
 * Send a JSON message to a stream and half-close for writing
 */
async function writeMessage(stream: Stream, data: unknown): Promise<void> {
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    stream.send(encoded);
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

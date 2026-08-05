/**
 * WhatNext Ping / Presence Protocol
 * /whatnext/ping/1.0.0
 *
 * Lightweight heartbeat protocol that tracks whether session participants
 * are still online. Each connected peer receives a ping every PING_INTERVAL ms.
 * If a peer stops responding, it is marked offline.
 *
 * Design:
 * - Initiator opens a stream and sends a 1-byte ping
 * - Responder echoes the byte back (pong)
 * - Initiator records lastSeenAt = now()
 * - If no pong within PONG_TIMEOUT ms, peer is considered offline
 *
 * Simple by design: for MVP we don't need heartbeat queuing or
 * sophisticated failure detection. Connection events already handle
 * abrupt disconnections; ping catches silent failures.
 */

import type { Libp2p } from 'libp2p';
import type { Stream } from '@libp2p/interface';
import { P2P_CONFIG } from '../../shared/p2p-config';

const PROTOCOL = `${P2P_CONFIG.PROTOCOL_PREFIX}/ping/1.0.0`;
const PING_INTERVAL = 30_000; // 30 seconds
const PONG_TIMEOUT = 10_000; // 10 second response window

export type PresenceCallback = (
    peerId: string,
    online: boolean,
    lastSeenAt: string,
) => void;

async function readByte(stream: Stream): Promise<number | null> {
    try {
        // Stream extends AsyncIterable directly in libp2p v2+
        for await (const chunk of stream) {
            // chunk may be Uint8Array or Uint8ArrayList (libp2p v2+)
            const buf = chunk instanceof Uint8Array ? chunk : chunk.subarray();
            if (buf.length > 0) return buf[0];
        }
        return null;
    } catch {
        return null;
    }
}

function writeByte(stream: Stream, byte: number): void {
    stream.send(new Uint8Array([byte]));
}

/**
 * Register the ping responder protocol handler on this node.
 * The responder simply echoes back any byte it receives.
 */
export function registerPingProtocol(node: Libp2p): void {
    node.handle(PROTOCOL, async (stream: Stream) => {
        try {
            const byte = await readByte(stream);
            if (byte !== null) {
                writeByte(stream, byte);
            }
        } catch {
            // Ignore stream errors — peer may have disconnected
        } finally {
            try {
                await stream.close();
            } catch {
                /* ignore */
            }
        }
    });
}

/**
 * Send a single ping to a peer and return true if pong received.
 */
async function pingPeer(node: Libp2p, peerId: string): Promise<boolean> {
    try {
        const { peerIdFromString } = await import('@libp2p/peer-id');
        // dialProtocol returns the stream directly in libp2p v2+
        const stream = await node.dialProtocol(
            peerIdFromString(peerId),
            PROTOCOL,
        );
        const PING_BYTE = 0x57; // 'W' for WhatNext

        const pongPromise = readByte(stream);
        await writeByte(stream, PING_BYTE);

        const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), PONG_TIMEOUT),
        );

        const result = await Promise.race([pongPromise, timeoutPromise]);
        try {
            await stream.close();
        } catch {
            /* ignore */
        }

        return result === PING_BYTE;
    } catch {
        return false;
    }
}

/**
 * Start periodic pings to all connected peers.
 * Calls onPresenceChange when a peer's online status changes.
 *
 * Returns a cleanup function to stop pinging.
 */
export function startPresenceTracking(
    node: Libp2p,
    onPresenceChange: PresenceCallback,
): () => void {
    const lastSeenAt: Map<string, string> = new Map();
    const onlineState: Map<string, boolean> = new Map();

    const timer = setInterval(async () => {
        const connections = node.getConnections();
        const connectedPeerIds = new Set(
            connections.map((c) => c.remotePeer.toString()),
        );

        for (const peerId of connectedPeerIds) {
            const alive = await pingPeer(node, peerId);
            const now = new Date().toISOString();
            const wasOnline = onlineState.get(peerId) ?? true;

            if (alive) {
                lastSeenAt.set(peerId, now);
                if (!wasOnline) {
                    onlineState.set(peerId, true);
                    onPresenceChange(peerId, true, now);
                }
            } else {
                const lastSeen = lastSeenAt.get(peerId) ?? now;
                if (wasOnline) {
                    onlineState.set(peerId, false);
                    onPresenceChange(peerId, false, lastSeen);
                }
            }
        }
    }, PING_INTERVAL);

    return () => clearInterval(timer);
}

export { PROTOCOL as PING_PROTOCOL };

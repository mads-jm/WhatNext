/**
 * WhatNext Circuit Relay v2 Server
 *
 * A standalone libp2p relay server that enables peers behind NAT
 * to communicate via circuit relay v2. Peers dial into this relay,
 * and other peers can reach them through it.
 *
 * Listens on:
 * - TCP :4001 (for desktop libp2p peers)
 * - WebSocket :4002 (for browser-based peers)
 *
 * Key persistence:
 * Relay peer ID is stable across restarts by saving/loading an Ed25519
 * private key from relay-key.json. This is required because the peer ID
 * appears in invite links shared between users.
 *
 * Usage:
 *   node relay-server.mjs
 *
 * Environment variables:
 *   RELAY_KEY_PATH  - Path to key file (default: ./relay-key.json)
 *   RELAY_TCP_PORT  - TCP listen port (default: 4001)
 *   RELAY_WS_PORT   - WebSocket listen port (default: 4002)
 */

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { identify } from '@libp2p/identify';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { startCompanionTunnel } from './companion-tunnel.mjs';

const KEY_PATH = process.env.RELAY_KEY_PATH ?? './relay-key.json';
const TCP_PORT = parseInt(process.env.RELAY_TCP_PORT ?? '4001', 10);
const WS_PORT = parseInt(process.env.RELAY_WS_PORT ?? '4002', 10);

/**
 * Load a persisted Ed25519 private key, or generate + save a new one.
 * A stable key means the relay peer ID never changes across restarts,
 * so invite links baked into user configs remain valid.
 */
async function loadOrCreateKey() {
    if (existsSync(KEY_PATH)) {
        try {
            const saved = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
            if (saved.type === 'Ed25519' && saved.raw) {
                // Reconstruct Ed25519 key from raw bytes
                const raw = Buffer.from(saved.raw, 'base64');
                const key = await generateKeyPair('Ed25519');
                // We need to use the crypto module's seed-based generation.
                // Since libp2p crypto does not have a stable privateKeyFromRaw
                // across all versions, we store the marshalled protobuf bytes
                // when available (written by newer relay versions) and fall
                // back to re-generating if the format is unrecognised.
                if (saved.marshalled) {
                    const { unmarshalPrivateKey } = await import('@libp2p/crypto/keys');
                    const bytes = Buffer.from(saved.marshalled, 'base64');
                    return unmarshalPrivateKey(bytes);
                }
                // Raw-only fallback: reconstruct by seeding a new key pair.
                // NOTE: Ed25519 raw here is the 32-byte seed. We can use it
                // if the import API supports it; otherwise fall through and
                // generate a fresh key (losing identity on this upgrade path).
                try {
                    const { keys } = await import('@libp2p/crypto');
                    return keys.supportedKeys.ed25519.unmarshalEd25519PrivateKey(raw);
                } catch {
                    console.warn('[Relay] Could not reconstruct key from raw bytes, generating new key');
                }
                void key; // suppress unused warning
            }
        } catch (err) {
            console.warn('[Relay] Could not load key file, generating new key:', err.message);
        }
    }

    // Generate a fresh Ed25519 key and save it
    const key = await generateKeyPair('Ed25519');

    const keyData = { type: 'Ed25519', raw: Buffer.from(key.raw).toString('base64') };

    // Also save marshalled bytes when the API supports it (for reliable reload)
    try {
        if (typeof key.marshal === 'function') {
            keyData.marshalled = Buffer.from(key.marshal()).toString('base64');
        }
    } catch { /* marshal not available in this build */ }

    writeFileSync(KEY_PATH, JSON.stringify(keyData, null, 2), 'utf-8');
    console.log(`[Relay] Generated new key, saved to ${KEY_PATH}`);
    return key;
}

async function main() {
    const privateKey = await loadOrCreateKey();

    const node = await createLibp2p({
        privateKey,

        addresses: {
            listen: [
                `/ip4/0.0.0.0/tcp/${TCP_PORT}`,
                `/ip4/0.0.0.0/tcp/${WS_PORT}/ws`,
            ],
        },

        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],

        transports: [
            tcp(),
            webSockets(),
        ],

        services: {
            identify: identify(),
            relay: circuitRelayServer(),
        },

        connectionManager: {
            maxConnections: 300,
        },
    });

    await node.start();

    const peerId = node.peerId.toString();
    const multiaddrs = node.getMultiaddrs().map((ma) => ma.toString());

    console.log('========================================');
    console.log('WhatNext Relay Server Started');
    console.log('========================================');
    console.log(`Peer ID: ${peerId}`);
    console.log('Listening on:');
    for (const addr of multiaddrs) {
        console.log(`  ${addr}`);
    }
    console.log('========================================');
    console.log('');
    console.log('Add one of these to WhatNext P2P Settings → Relay Servers:');
    for (const addr of multiaddrs) {
        if (addr.includes('/p2p/')) {
            console.log(`  ${addr}`);
        }
    }
    console.log('');
    console.log('Key file:', KEY_PATH, '(keep this to preserve peer ID across restarts)');

    // Start companion tunnel
    try {
        const { port: companionPort } = await startCompanionTunnel();
        console.log(`\nCompanion tunnel available on port ${companionPort}`);
        console.log('Phone viewers connect to: http://<relay-ip>:' + companionPort + '/s/<SESSION_CODE>');
    } catch (err) {
        console.warn('[Relay] Companion tunnel failed to start:', err.message);
    }

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\nShutting down relay server...');
        await node.stop();
        console.log('Relay server stopped.');
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

main().catch((error) => {
    console.error('Failed to start relay server:', error);
    process.exit(1);
});

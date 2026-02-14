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
 */

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { identify } from '@libp2p/identify';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';

async function main() {
    const node = await createLibp2p({
        addresses: {
            listen: [
                '/ip4/0.0.0.0/tcp/4001',
                '/ip4/0.0.0.0/tcp/4002/ws',
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
            maxConnections: 100,
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
    console.log('Add these addresses to P2P_CONFIG.RELAY.ADDRESSES:');
    for (const addr of multiaddrs) {
        console.log(`  '${addr}',`);
    }
    console.log('');

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

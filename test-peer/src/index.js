/**
 * WhatNext Barebones Test Peer
 *
 * A minimal libp2p node for testing P2P connections with the WhatNext Electron app.
 * This peer uses the EXACT same configuration as the Electron app's utility process.
 *
 * Usage:
 *   npm install
 *   npm start
 *
 * Features:
 * - mDNS auto-discovery (finds Electron app on same network)
 * - WebRTC connections
 * - Connection logging
 * - Interactive CLI for testing
 */

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { mdns } from '@libp2p/mdns';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { peerIdFromString } from '@libp2p/peer-id';
import chalk from 'chalk';
import readline from 'readline';
import { P2P_CONFIG } from './p2p-config.js';

// ========================================
// Configuration (matches Electron app)
// ========================================

const PEER_NAME = process.env.PEER_NAME || `TestPeer-${Math.random().toString(36).substr(2, 6)}`;

// ========================================
// libp2p Node
// ========================================

let node = null;
let discoveredPeers = new Map(); // peerId -> { multiaddrs, timestamp }
let connectedPeers = new Set();

async function startNode() {
    console.log(chalk.cyan('\n🚀 Starting WhatNext Test Peer...\n'));

    try {
        // IMPORTANT: This config matches app/src/utility/p2p-service.ts exactly
        // All configuration is loaded from p2p-config.js (synced with app)
        node = await createLibp2p({
            // Listen addresses - configured via P2P_CONFIG
            addresses: {
                listen: P2P_CONFIG.LISTEN_ADDRESSES,
            },

            // Connection encryption
            connectionEncrypters: [noise()],

            // Stream multiplexing
            streamMuxers: [yamux()],

            // Transports (multiple for robustness)
            transports: [
                tcp(),                      // Desktop-to-desktop, local testing
                webSockets(),               // Web browser compatibility
                webRTC(),                   // Browser-to-browser, WebRTC peers
                circuitRelayTransport(),    // Required for WebRTC
            ],

            // Peer discovery (mDNS for local network)
            // CRITICAL: serviceName must match across all WhatNext peers
            peerDiscovery: [
                mdns({
                    serviceName: P2P_CONFIG.MDNS_SERVICE_NAME,
                    interval: P2P_CONFIG.MDNS_INTERVAL,
                }),
            ],

            // Services
            services: {
                identify: identify(),
            },

            // Connection manager
            connectionManager: {
                maxConnections: P2P_CONFIG.CONNECTION.MAX_CONNECTIONS,
            },
        });

        // Setup event listeners
        setupEventListeners();

        // Start the node
        await node.start();

        const peerId = node.peerId.toString();
        const multiaddrs = node.getMultiaddrs().map(ma => ma.toString());

        console.log(chalk.green('✅ Node started successfully!\n'));
        console.log(chalk.bold('Your Peer ID:'));
        console.log(chalk.yellow(`  ${peerId}\n`));
        console.log(chalk.bold('Listening on:'));
        multiaddrs.forEach(addr => console.log(chalk.gray(`  ${addr}`)));
        console.log(chalk.gray('\n' + '─'.repeat(80) + '\n'));

        console.log(chalk.cyan('👂 Listening for mDNS peer discovery...'));
        console.log(chalk.gray('   (Make sure WhatNext Electron app is running on same network)\n'));

    } catch (error) {
        console.error(chalk.red('\n❌ Failed to start node:'), error);
        process.exit(1);
    }
}

// ========================================
// Event Listeners
// ========================================

function setupEventListeners() {
    // Peer discovered via mDNS
    node.addEventListener('peer:discovery', (evt) => {
        const peerId = evt.detail.id.toString();
        const multiaddrs = evt.detail.multiaddrs.map(ma => ma.toString());

        // Store discovered peer
        discoveredPeers.set(peerId, {
            multiaddrs,
            timestamp: new Date().toISOString(),
        });

        console.log(chalk.green('🔍 Peer discovered!'));
        console.log(chalk.gray(`   Peer ID: ${peerId.slice(0, 20)}...`));
        console.log(chalk.gray(`   Multiaddrs: ${multiaddrs.length} address(es)`));
        console.log(chalk.gray(`   Type 'connect ${discoveredPeers.size}' to connect\n`));
    });

    // Peer connected
    node.addEventListener('peer:connect', (evt) => {
        const peerId = evt.detail.toString();
        connectedPeers.add(peerId);

        console.log(chalk.green.bold('\n✅ CONNECTED to peer!'));
        console.log(chalk.gray(`   Peer ID: ${peerId.slice(0, 20)}...`));
        console.log(chalk.gray(`   Total connections: ${connectedPeers.size}\n`));
    });

    // Peer disconnected
    node.addEventListener('peer:disconnect', (evt) => {
        const peerId = evt.detail.toString();
        connectedPeers.delete(peerId);

        console.log(chalk.yellow('\n⚠️  Disconnected from peer'));
        console.log(chalk.gray(`   Peer ID: ${peerId.slice(0, 20)}...`));
        console.log(chalk.gray(`   Total connections: ${connectedPeers.size}\n`));
    });
}

// ========================================
// CLI Commands
// ========================================

function showHelp() {
    console.log(chalk.cyan('\n📖 Available Commands:\n'));
    console.log(chalk.white('  list') + chalk.gray('           - List discovered peers'));
    console.log(chalk.white('  connect <n>') + chalk.gray('    - Connect to peer number <n> from list'));
    console.log(chalk.white('  connections') + chalk.gray('    - Show active connections'));
    console.log(chalk.white('  status') + chalk.gray('         - Show node status'));
    console.log(chalk.white('  help') + chalk.gray('           - Show this help'));
    console.log(chalk.white('  exit') + chalk.gray('           - Stop the node and exit'));
    console.log();
}

function listPeers() {
    if (discoveredPeers.size === 0) {
        console.log(chalk.yellow('\n⚠️  No peers discovered yet\n'));
        return;
    }

    console.log(chalk.cyan(`\n📋 Discovered Peers (${discoveredPeers.size}):\n`));

    let index = 1;
    for (const [peerId, info] of discoveredPeers.entries()) {
        const isConnected = connectedPeers.has(peerId);
        const status = isConnected ? chalk.green('[CONNECTED]') : chalk.gray('[DISCONNECTED]');

        console.log(chalk.white(`${index}. `) + status);
        console.log(chalk.gray(`   Peer ID: ${peerId.slice(0, 40)}...`));
        console.log(chalk.gray(`   Discovered: ${info.timestamp}`));
        console.log(chalk.gray(`   Multiaddrs: ${info.multiaddrs.length} address(es)\n`));
        index++;
    }
}

function showConnections() {
    if (connectedPeers.size === 0) {
        console.log(chalk.yellow('\n⚠️  No active connections\n'));
        return;
    }

    console.log(chalk.cyan(`\n🔗 Active Connections (${connectedPeers.size}):\n`));

    let index = 1;
    for (const peerId of connectedPeers) {
        console.log(chalk.green(`${index}. ${peerId.slice(0, 40)}...`));
        index++;
    }
    console.log();
}

function showStatus() {
    const peerId = node.peerId.toString();
    const multiaddrs = node.getMultiaddrs();

    console.log(chalk.cyan('\n📊 Node Status:\n'));
    console.log(chalk.white('  Peer ID: ') + chalk.yellow(peerId));
    console.log(chalk.white('  Multiaddrs: ') + chalk.gray(multiaddrs.length));
    multiaddrs.forEach(addr => {
        console.log(chalk.gray(`    ${addr.toString()}`));
    });
    console.log(chalk.white('  Discovered Peers: ') + chalk.yellow(discoveredPeers.size));
    console.log(chalk.white('  Active Connections: ') + chalk.green(connectedPeers.size));
    console.log();
}

async function connectToPeer(peerNumber) {
    const peerIndex = parseInt(peerNumber) - 1;

    if (isNaN(peerIndex) || peerIndex < 0) {
        console.log(chalk.red('\n❌ Invalid peer number. Use "list" to see available peers.\n'));
        return;
    }

    const peersArray = Array.from(discoveredPeers.entries());

    if (peerIndex >= peersArray.length) {
        console.log(chalk.red(`\n❌ Peer number ${peerNumber} not found. Only ${peersArray.length} peer(s) discovered.\n`));
        return;
    }

    const [peerIdString, info] = peersArray[peerIndex];

    if (connectedPeers.has(peerIdString)) {
        console.log(chalk.yellow('\n⚠️  Already connected to this peer\n'));
        return;
    }

    console.log(chalk.cyan(`\n📡 Connecting to peer ${peerNumber}...`));
    console.log(chalk.gray(`   Peer ID: ${peerIdString.slice(0, 40)}...\n`));

    try {
        // Convert string peer ID to libp2p PeerId object
        const targetPeerId = peerIdFromString(peerIdString);

        // Check if already connected
        const existingConns = node.getConnections(targetPeerId);
        if (existingConns.length > 0) {
            console.log(chalk.yellow('\n⚠️  Already connected to this peer (existing connection found)\n'));
            return;
        }

        // Get peer from peerStore
        const peer = await node.peerStore.get(targetPeerId);

        if (!peer || peer.addresses.length === 0) {
            console.log(chalk.red('❌ Peer not in peerStore or no addresses available\n'));
            return;
        }

        console.log(chalk.gray(`   Trying ${peer.addresses.length} address(es)...\n`));

        // Dial the peer
        const connection = await node.dial(targetPeerId);

        console.log(chalk.green('✅ Connection initiated successfully!'));
        console.log(chalk.gray(`   Remote address: ${connection.remoteAddr.toString()}\n`));

    } catch (error) {
        console.log(chalk.red('❌ Connection failed:'), error.message);
        console.log(chalk.gray('\nPossible reasons:'));
        console.log(chalk.gray('  - Peer is not reachable (NAT/firewall)'));
        console.log(chalk.gray('  - WebRTC negotiation failed'));
        console.log(chalk.gray('  - Peer is offline'));
        console.log(chalk.gray('  - Transport incompatibility\n'));
    }
}

// ========================================
// CLI Interface
// ========================================

function startCLI() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.cyan('whatnext> '),
    });

    console.log(chalk.cyan('\n💬 Interactive CLI ready. Type "help" for commands.\n'));
    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        const [command, ...args] = input.split(' ');

        switch (command.toLowerCase()) {
            case 'help':
            case 'h':
                showHelp();
                break;

            case 'list':
            case 'ls':
                listPeers();
                break;

            case 'connect':
            case 'c':
                if (args.length === 0) {
                    console.log(chalk.red('\n❌ Usage: connect <peer-number>\n'));
                } else {
                    await connectToPeer(args[0]);
                }
                break;

            case 'connections':
            case 'conn':
                showConnections();
                break;

            case 'status':
            case 's':
                showStatus();
                break;

            case 'exit':
            case 'quit':
            case 'q':
                console.log(chalk.cyan('\n👋 Shutting down...\n'));
                await node.stop();
                process.exit(0);
                break;

            case '':
                // Empty line, do nothing
                break;

            default:
                console.log(chalk.red(`\n❌ Unknown command: ${command}`));
                console.log(chalk.gray('   Type "help" for available commands\n'));
        }

        rl.prompt();
    });

    rl.on('close', async () => {
        console.log(chalk.cyan('\n👋 Shutting down...\n'));
        await node.stop();
        process.exit(0);
    });
}

// ========================================
// Startup
// ========================================

async function main() {
    console.clear();
    console.log(chalk.bold.cyan('╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║          WhatNext Barebones Test Peer v1.0                ║'));
    console.log(chalk.bold.cyan('╚════════════════════════════════════════════════════════════╝'));

    await startNode();
    startCLI();
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log(chalk.cyan('\n\n👋 Received SIGINT, shutting down gracefully...\n'));
    if (node) {
        await node.stop();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log(chalk.cyan('\n\n👋 Received SIGTERM, shutting down gracefully...\n'));
    if (node) {
        await node.stop();
    }
    process.exit(0);
});

// Start the peer
main().catch(error => {
    console.error(chalk.red('\n💥 Fatal error:'), error);
    process.exit(1);
});

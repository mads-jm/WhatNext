/**
 * WhatNext Test Peer Client
 *
 * A libp2p node that speaks both WhatNext protocols and maintains an in-memory
 * session state. Designed for validating P2P playlist interactions and session
 * participation during development.
 *
 * Usage:
 *   npm install
 *   npm start                     # Interactive CLI
 *   PEER_NAME=Alice npm start     # Set display name
 *
 * Features:
 * - mDNS auto-discovery (finds Electron app on same network)
 * - Handshake protocol: auto-initiates after connection, exchanges identity
 * - RxDB replication: push/pull playlists, tracks, votes
 * - In-memory session store with LWW conflict resolution
 * - Interactive CLI for playlist interaction and session validation
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
import { FaultTolerance } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import { randomUUID } from 'crypto';
import chalk from 'chalk';
import readline from 'readline';

import { P2P_CONFIG } from './p2p-config.js';
import {
    registerHandshakeProtocol,
    registerReplicationProtocol,
    initiateHandshake,
    pushDocuments,
    pullCollection,
    COLLECTIONS,
} from './protocols.js';
import {
    applyDocuments,
    getDocuments,
    getCheckpoint,
    setHandshakeInfo,
    removeHandshakeInfo,
    createTrackDocument,
    createVoteDocument,
    getTracksList,
    formatPlaylistDisplay,
    formatTracksDisplay,
    formatPeersInfoDisplay,
    formatSessionDisplay,
    logChangeSummary,
} from './session-store.js';

// ========================================
// Identity
// ========================================

const PEER_NAME = process.env.PEER_NAME || `TestPeer-${Math.random().toString(36).substr(2, 6)}`;
const LOCAL_USER_ID = randomUUID();

/** Populated with peerId after node.start(). */
const LOCAL_HANDSHAKE_DATA = {
    displayName: PEER_NAME,
    userId: LOCAL_USER_ID,
    version: '0.1.0',
    capabilities: ['replication', 'handshake'],
    peerId: '',
};

// ========================================
// Node state
// ========================================

let node = null;
let discoveredPeers = new Map(); // peerId -> { multiaddrs, timestamp }
let connectedPeers = new Set();  // Set<peerId string>
let relayAddresses = [];         // multiaddr strings for circuit relay servers

// Hoisted readline interface so protocol callbacks can call rl.prompt().
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('whatnext> '),
});

// ========================================
// Node startup
// ========================================

async function startNode() {
    console.log(chalk.cyan('\n🚀 Starting WhatNext Test Peer...\n'));

    try {
        node = await createLibp2p({
            addresses: {
                listen: P2P_CONFIG.LISTEN_ADDRESSES,
            },
            transportManager: {
                faultTolerance: FaultTolerance.NO_FATAL,
            },
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            transports: [
                tcp(),
                webSockets(),
                webRTC(),
                circuitRelayTransport(),
            ],
            peerDiscovery: [
                mdns({
                    serviceTag: P2P_CONFIG.MDNS_SERVICE_NAME,
                    interval: P2P_CONFIG.MDNS_INTERVAL,
                }),
            ],
            services: {
                identify: identify(),
            },
            connectionManager: {
                maxConnections: P2P_CONFIG.CONNECTION.MAX_CONNECTIONS,
            },
        });

        setupEventListeners();
        await node.start();

        // Now that we have a peerId, patch the handshake identity.
        LOCAL_HANDSHAKE_DATA.peerId = node.peerId.toString();

        // Register protocol handlers.
        registerHandshakeProtocol(node, LOCAL_HANDSHAKE_DATA, (remotePeerId, data) => {
            setHandshakeInfo(remotePeerId, data);
            console.log(chalk.magenta(`\n[Handshake] ✅ Complete with ${data.displayName}`));
            console.log(chalk.gray(`   Capabilities: ${(data.capabilities ?? []).join(', ')}\n`));
            rl.prompt();
        });

        registerReplicationProtocol(
            node,
            // onPullRequest: serve local documents to peer
            async (collection, checkpoint, limit) => {
                return getDocuments(collection, checkpoint, limit);
            },
            // onPushReceived: apply incoming push and log changes
            async (collection, documents) => {
                const result = applyDocuments(collection, documents);
                console.log(chalk.cyan(
                    `\n[Replication] Push received: ${result.applied} applied, ${result.skipped} skipped (${collection})`,
                ));
                logChangeSummary(result.changes, collection);
                rl.prompt();
            },
            // onPullResponse: apply pull results and log changes
            (collection, documents, checkpoint) => {
                const result = applyDocuments(collection, documents);
                console.log(chalk.cyan(
                    `\n[Replication] Pull complete: ${result.applied} applied, ${result.skipped} skipped (${collection})`,
                ));
                logChangeSummary(result.changes, collection);
                rl.prompt();
            },
        );

        const peerId = node.peerId.toString();
        const multiaddrs = node.getMultiaddrs().map(ma => ma.toString());

        console.log(chalk.green('✅ Node started successfully!\n'));
        console.log(chalk.bold('Identity:'));
        console.log(chalk.gray(`  Name:    ${PEER_NAME}`));
        console.log(chalk.gray(`  User ID: ${LOCAL_USER_ID}`));
        console.log(chalk.bold('\nPeer ID:'));
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
// Event listeners
// ========================================

function setupEventListeners() {
    // Peer discovered via mDNS
    node.addEventListener('peer:discovery', (evt) => {
        const peerId = evt.detail.id.toString();
        const multiaddrs = evt.detail.multiaddrs.map(ma => ma.toString());

        discoveredPeers.set(peerId, {
            multiaddrs,
            timestamp: new Date().toISOString(),
        });

        console.log(chalk.green('🔍 Peer discovered!'));
        console.log(chalk.gray(`   Peer ID: ${peerId.slice(0, 20)}...`));
        console.log(chalk.gray(`   Multiaddrs: ${multiaddrs.length} address(es)`));
        console.log(chalk.gray(`   Type 'connect ${discoveredPeers.size}' to connect\n`));
    });

    // Peer connected — auto-initiate handshake
    node.addEventListener('peer:connect', async (evt) => {
        const peerId = evt.detail.toString();
        connectedPeers.add(peerId);

        console.log(chalk.green.bold('\n[P2P] ✅ Connected to peer!'));
        console.log(chalk.gray(`   Peer ID: ${peerId.slice(0, 20)}...`));
        console.log(chalk.gray(`   Total connections: ${connectedPeers.size}\n`));

        // Small delay so the remote has time to register its protocol handler
        // before we dial it. Both sides fire peer:connect simultaneously.
        setTimeout(async () => {
            try {
                await initiateHandshake(node, peerId, LOCAL_HANDSHAKE_DATA);
            } catch (err) {
                console.log(chalk.yellow(`[Handshake] Failed to initiate: ${err.message}\n`));
            }
            rl.prompt();
        }, 200);
    });

    // Peer disconnected
    node.addEventListener('peer:disconnect', (evt) => {
        const peerId = evt.detail.toString();
        connectedPeers.delete(peerId);
        removeHandshakeInfo(peerId);

        console.log(chalk.yellow('\n[P2P] ⚠️  Disconnected from peer'));
        console.log(chalk.gray(`   Peer ID: ${peerId.slice(0, 20)}...`));
        console.log(chalk.gray(`   Total connections: ${connectedPeers.size}\n`));
    });
}

// ========================================
// Peer resolution helper
// ========================================

/**
 * Resolve a connected peer ID by 1-based index, or return the first connected peer.
 * Returns null with an error message if no peers are connected or index is out of range.
 *
 * @param {string|undefined} indexArg - raw CLI argument, may be undefined
 * @returns {string|null}
 */
function resolvePeer(indexArg) {
    const peers = Array.from(connectedPeers);
    if (peers.length === 0) {
        console.log(chalk.red('\n❌ No connected peers. Use "connect <n>" first.\n'));
        return null;
    }
    if (indexArg !== undefined) {
        const idx = parseInt(indexArg, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= peers.length) {
            console.log(chalk.red(`\n❌ Peer index ${indexArg} out of range (1–${peers.length})\n`));
            return null;
        }
        return peers[idx];
    }
    return peers[0];
}

// ========================================
// CLI commands
// ========================================

function showHelp() {
    console.log(chalk.cyan('\n📖 Commands:\n'));
    console.log(chalk.bold('  Connection'));
    console.log(chalk.white('  list') + chalk.gray('                           List discovered peers'));
    console.log(chalk.white('  connect <n>') + chalk.gray('                   Connect to discovered peer n'));
    console.log(chalk.white('  connections') + chalk.gray('                   Show active connections'));
    console.log(chalk.white('  status') + chalk.gray('                        Show node status'));
    console.log('');
    console.log(chalk.bold('  Session & Playlist'));
    console.log(chalk.white('  pull [n]') + chalk.gray('                      Pull all collections from peer n (default: first connected)'));
    console.log(chalk.white('  track-add [n] <title> [artist]') + chalk.gray(' Create a track locally and push to peer n'));
    console.log(chalk.white('  playlist') + chalk.gray('                      Show current playlist state (tracks, mode, turn info)'));
    console.log(chalk.white('  tracks') + chalk.gray('                        List all known tracks with 1-based indices'));
    console.log(chalk.white('  peers-info') + chalk.gray('                    Show handshake info for connected peers'));
    console.log(chalk.white('  vote [n] <trackIdx> <+1|-1>') + chalk.gray('  Send vote for a track to peer n'));
    console.log(chalk.white('  session') + chalk.gray('                       Show full session state (collections, checkpoints)'));
    console.log('');
    console.log(chalk.bold('  Relay'));
    console.log(chalk.white('  relay-add <multiaddr>') + chalk.gray('          Add and connect to a relay server'));
    console.log(chalk.white('  relay-list') + chalk.gray('                    List configured relay servers'));
    console.log(chalk.white('  relay-connect') + chalk.gray('                 Reconnect to all configured relays'));
    console.log(chalk.white('  relay-remove <n>') + chalk.gray('              Remove relay by index'));
    console.log('');
    console.log(chalk.bold('  General'));
    console.log(chalk.white('  help') + chalk.gray('                          Show this help'));
    console.log(chalk.white('  exit') + chalk.gray('                          Stop the node and exit'));
    console.log('');
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
        const info = /** @type {any} */ (null); // getHandshakeInfo available if needed
        const name = peerId; // display name via peers-info command
        console.log(chalk.green(`${index}. ${peerId.slice(0, 52)}...`));
        index++;
    }
    console.log('');
}

function showStatus() {
    const peerId = node.peerId.toString();
    const multiaddrs = node.getMultiaddrs();

    console.log(chalk.cyan('\n📊 Node Status:\n'));
    console.log(chalk.white('  Name:      ') + chalk.yellow(PEER_NAME));
    console.log(chalk.white('  Peer ID:   ') + chalk.yellow(peerId));
    console.log(chalk.white('  Multiaddrs:') + chalk.gray(` ${multiaddrs.length}`));
    multiaddrs.forEach(addr => {
        console.log(chalk.gray(`    ${addr.toString()}`));
    });
    console.log(chalk.white('  Discovered Peers:  ') + chalk.yellow(discoveredPeers.size));
    console.log(chalk.white('  Active Connections:') + chalk.green(` ${connectedPeers.size}`));
    console.log('');
}

async function connectToPeer(peerNumber) {
    const peerIndex = parseInt(peerNumber, 10) - 1;

    if (isNaN(peerIndex) || peerIndex < 0) {
        console.log(chalk.red('\n❌ Invalid peer number. Use "list" to see available peers.\n'));
        return;
    }

    const peersArray = Array.from(discoveredPeers.entries());

    if (peerIndex >= peersArray.length) {
        console.log(chalk.red(`\n❌ Peer number ${peerNumber} not found. Only ${peersArray.length} peer(s) discovered.\n`));
        return;
    }

    const [peerIdString] = peersArray[peerIndex];

    if (connectedPeers.has(peerIdString)) {
        console.log(chalk.yellow('\n⚠️  Already connected to this peer\n'));
        return;
    }

    console.log(chalk.cyan(`\n📡 Connecting to peer ${peerNumber}...`));
    console.log(chalk.gray(`   Peer ID: ${peerIdString.slice(0, 40)}...\n`));

    try {
        const targetPeerId = peerIdFromString(peerIdString);

        const existingConns = node.getConnections(targetPeerId);
        if (existingConns.length > 0) {
            console.log(chalk.yellow('\n⚠️  Already connected to this peer (existing connection found)\n'));
            return;
        }

        const peer = await node.peerStore.get(targetPeerId);

        if (!peer || peer.addresses.length === 0) {
            console.log(chalk.red('❌ Peer not in peerStore or no addresses available\n'));
            return;
        }

        console.log(chalk.gray(`   Trying ${peer.addresses.length} address(es)...\n`));

        const connection = await node.dial(targetPeerId);

        console.log(chalk.green('✅ Connection initiated!'));
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

/**
 * Pull all collections from a connected peer.
 *
 * @param {string|undefined} peerArg
 */
async function cmdPull(peerArg) {
    const peerId = resolvePeer(peerArg);
    if (!peerId) return;

    console.log(chalk.cyan(`\n📥 Pulling all collections from ${peerId.slice(0, 16)}...\n`));

    for (const collection of COLLECTIONS) {
        try {
            // Use stored checkpoint so subsequent pulls only fetch newer docs.
            const checkpoint = getCheckpoint(collection);
            await pullCollection(node, peerId, collection, checkpoint);
        } catch (err) {
            console.log(chalk.red(`  ❌ Failed to pull ${collection}: ${err.message}`));
        }
    }
    console.log(chalk.gray('Pull requests sent. Responses arrive asynchronously.\n'));
}

/**
 * Create a track document and push it to a connected peer.
 *
 * Argument forms:
 *   track-add <title>
 *   track-add <title> <artist>
 *   track-add <peerIdx> <title>
 *   track-add <peerIdx> <title> <artist>
 *
 * @param {string[]} args
 */
async function cmdTrackAdd(args) {
    if (args.length === 0) {
        console.log(chalk.red('\n❌ Usage: track-add [peerIdx] <title> [artist]\n'));
        return;
    }

    let peerArg, title, artist;

    // If the first arg is a plain integer, treat it as a peer index.
    if (/^\d+$/.test(args[0])) {
        peerArg = args[0];
        title = args[1];
        artist = args[2] ?? 'Unknown';
    } else {
        peerArg = undefined;
        title = args[0];
        artist = args[1] ?? 'Unknown';
    }

    if (!title) {
        console.log(chalk.red('\n❌ Track title is required.\n'));
        return;
    }

    const peerId = resolvePeer(peerArg);
    if (!peerId) return;

    const doc = createTrackDocument(title, artist, LOCAL_USER_ID);
    applyDocuments('tracks', [doc]);

    console.log(chalk.green(`\n🎵 Track created: "${title}" — ${artist}`));
    console.log(chalk.gray(`   ID: ${doc.id}`));

    try {
        await pushDocuments(node, peerId, 'tracks', [doc]);
        console.log(chalk.green('   ✅ Pushed to peer\n'));
    } catch (err) {
        console.log(chalk.red(`   ❌ Push failed: ${err.message}\n`));
    }
}

/**
 * Send a vote (+1 or -1) for a track to a connected peer.
 *
 * Argument forms:
 *   vote <trackIdx> <value>
 *   vote <peerIdx> <trackIdx> <value>
 *
 * @param {string[]} args
 */
async function cmdVote(args) {
    if (args.length < 2) {
        console.log(chalk.red('\n❌ Usage: vote [peerIdx] <trackIdx> <+1|-1>\n'));
        return;
    }

    let peerArg, trackIdxStr, valueStr;

    if (args.length >= 3 && /^\d+$/.test(args[0])) {
        peerArg = args[0];
        trackIdxStr = args[1];
        valueStr = args[2];
    } else {
        peerArg = undefined;
        trackIdxStr = args[0];
        valueStr = args[1];
    }

    const peerId = resolvePeer(peerArg);
    if (!peerId) return;

    const trackIdx = parseInt(trackIdxStr, 10) - 1;
    const tracks = getTracksList();

    if (isNaN(trackIdx) || trackIdx < 0 || trackIdx >= tracks.length) {
        console.log(chalk.red(`\n❌ Track index out of range. Use "tracks" to see available tracks (1–${tracks.length}).\n`));
        return;
    }

    const value = valueStr === '+1' || valueStr === '1' ? 1 : -1;
    const trackId = tracks[trackIdx].id;
    const trackTitle = tracks[trackIdx].data?.title ?? trackId;

    const doc = createVoteDocument(LOCAL_USER_ID, trackId, value);
    applyDocuments('trackInteractions', [doc]);

    console.log(chalk.yellow(`\n👍 Vote ${value > 0 ? '+1' : '-1'} for: ${trackTitle}`));

    try {
        await pushDocuments(node, peerId, 'trackInteractions', [doc]);
        console.log(chalk.green('   ✅ Pushed to peer\n'));
    } catch (err) {
        console.log(chalk.red(`   ❌ Push failed: ${err.message}\n`));
    }
}

// ========================================
// Relay commands
// ========================================

/**
 * Connect to a relay server by multiaddr.
 * @param {string} addr - full multiaddr string including /p2p/<peerId>
 */
async function cmdRelayAdd(addr) {
    if (!addr) {
        console.log(chalk.red('\n❌ Usage: relay-add <multiaddr>\n'));
        console.log(chalk.gray('   Example: relay-add /ip4/1.2.3.4/tcp/4002/ws/p2p/12D3KooW...\n'));
        return;
    }

    if (!addr.startsWith('/')) {
        console.log(chalk.red('\n❌ Invalid multiaddr: must start with /\n'));
        return;
    }
    if (!addr.includes('/p2p/')) {
        console.log(chalk.red('\n❌ Multiaddr must include /p2p/<PeerId> component\n'));
        return;
    }

    if (relayAddresses.includes(addr)) {
        console.log(chalk.yellow('\n⚠️  Relay already in list\n'));
        return;
    }

    relayAddresses.push(addr);
    console.log(chalk.cyan(`\n📡 Connecting to relay: ${addr}\n`));

    try {
        const ma = multiaddr(addr);
        await node.dial(ma);
        console.log(chalk.green('✅ Relay connected!\n'));
    } catch (err) {
        console.log(chalk.red(`❌ Relay connection failed: ${err.message}\n`));
        console.log(chalk.gray('   The address was saved — it will be retried on "relay-connect".\n'));
    }
}

/**
 * Reconnect to all saved relay addresses.
 */
async function cmdRelayConnect() {
    if (relayAddresses.length === 0) {
        console.log(chalk.yellow('\n⚠️  No relay addresses configured. Use "relay-add <multiaddr>" first.\n'));
        return;
    }

    console.log(chalk.cyan(`\n📡 Connecting to ${relayAddresses.length} relay(s)...\n`));

    for (const addr of relayAddresses) {
        try {
            const ma = multiaddr(addr);
            await node.dial(ma);
            console.log(chalk.green(`  ✅ ${addr.slice(0, 50)}...`));
        } catch (err) {
            console.log(chalk.red(`  ❌ ${addr.slice(0, 50)}... — ${err.message}`));
        }
    }
    console.log('');
}

/**
 * Remove a relay address by index.
 * @param {string|undefined} indexArg
 */
function cmdRelayRemove(indexArg) {
    if (relayAddresses.length === 0) {
        console.log(chalk.yellow('\n⚠️  No relay addresses configured.\n'));
        return;
    }

    if (indexArg === undefined) {
        console.log(chalk.red('\n❌ Usage: relay-remove <n>\n'));
        return;
    }

    const idx = parseInt(indexArg, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= relayAddresses.length) {
        console.log(chalk.red(`\n❌ Index out of range (1–${relayAddresses.length})\n`));
        return;
    }

    const removed = relayAddresses.splice(idx, 1)[0];
    console.log(chalk.yellow(`\n🗑️  Removed relay: ${removed}\n`));
}

function cmdRelayList() {
    if (relayAddresses.length === 0) {
        console.log(chalk.yellow('\n⚠️  No relay addresses configured. Use "relay-add <multiaddr>" to add one.\n'));
        return;
    }

    console.log(chalk.cyan(`\n📡 Relay Servers (${relayAddresses.length}):\n`));

    relayAddresses.forEach((addr, i) => {
        // Check if we're currently connected to this relay's peer
        const peerIdMatch = addr.match(/\/p2p\/(.+)$/);
        const relayPeerId = peerIdMatch ? peerIdMatch[1] : null;
        const isConnected = relayPeerId && connectedPeers.has(relayPeerId);
        const status = isConnected ? chalk.green('[CONNECTED]') : chalk.gray('[DISCONNECTED]');

        console.log(chalk.white(`  ${i + 1}. `) + status);
        console.log(chalk.gray(`     ${addr}\n`));
    });
}

// ========================================
// CLI Interface
// ========================================

function startCLI() {
    console.log(chalk.cyan('\n💬 Interactive CLI ready. Type "help" for commands.\n'));
    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        const [command, ...args] = input.split(/\s+/);

        switch ((command ?? '').toLowerCase()) {
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

            // ── Session & Playlist commands ──────────────────────────────────

            case 'pull':
                await cmdPull(args[0]);
                break;

            case 'track-add':
            case 'ta':
                await cmdTrackAdd(args);
                break;

            case 'playlist':
            case 'pl':
                console.log(formatPlaylistDisplay());
                break;

            case 'tracks':
            case 'tr':
                console.log(formatTracksDisplay());
                break;

            case 'peers-info':
            case 'pi':
                console.log(formatPeersInfoDisplay());
                break;

            case 'vote':
            case 'v':
                await cmdVote(args);
                break;

            case 'session':
            case 'ss':
                console.log(formatSessionDisplay());
                break;

            // ── Relay commands ──────────────────────────────────────────────

            case 'relay-add':
            case 'ra':
                await cmdRelayAdd(args.join(' '));
                break;

            case 'relay-list':
            case 'rl':
                cmdRelayList();
                break;

            case 'relay-connect':
            case 'rc':
                await cmdRelayConnect();
                break;

            case 'relay-remove':
            case 'rr':
                cmdRelayRemove(args[0]);
                break;

            // ── General ─────────────────────────────────────────────────────

            case 'exit':
            case 'quit':
            case 'q':
                console.log(chalk.cyan('\n👋 Shutting down...\n'));
                await node.stop();
                process.exit(0);
                break;

            case '':
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
    console.log(chalk.bold.cyan('║        WhatNext Test Peer Client v2.0                     ║'));
    console.log(chalk.bold.cyan('║  Handshake · Replication · Playlist Validation            ║'));
    console.log(chalk.bold.cyan('╚════════════════════════════════════════════════════════════╝'));

    await startNode();
    startCLI();
}

process.on('SIGINT', async () => {
    console.log(chalk.cyan('\n\n👋 Received SIGINT, shutting down gracefully...\n'));
    if (node) await node.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log(chalk.cyan('\n\n👋 Received SIGTERM, shutting down gracefully...\n'));
    if (node) await node.stop();
    process.exit(0);
});

main().catch(error => {
    console.error(chalk.red('\n💥 Fatal error:'), error);
    process.exit(1);
});

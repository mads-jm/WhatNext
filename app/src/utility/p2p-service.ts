/**
 * P2P Service - Utility Process Entry Point
 *
 * This is the main entry point for the P2P utility process.
 * It runs in a separate Node.js process spawned by the main process.
 *
 * Responsibilities:
 * - Create and manage libp2p node
 * - Handle P2P connections and discovery
 * - Communicate with main process via MessagePort
 * - Coordinate RxDB replication (future)
 *
 * LEARNING NOTE: This runs in a Node.js utility process, not the main process
 * or renderer. It has full Node.js capabilities but no window/UI access.
 */

import process from 'node:process';
import { createLibp2p, Libp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { mdns } from '@libp2p/mdns';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import type { PeerId as LibP2PPeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import {
    type IPCMessage,
    MainToUtilityMessageType,
    UtilityToMainMessageType,
    createIPCMessage,
    type ConnectToPeerPayload,
    type DisconnectFromPeerPayload,
} from '../shared/core';
import { P2P_CONFIG } from '../shared/p2p-config';

/**
 * P2P Service class
 * Manages libp2p node lifecycle and connections
 */
class P2PService {
    private libp2pNode: Libp2p | null = null;
    private isStarted = false;

    constructor() {
        this.setupMessageListener();
    }

    /**
     * Setup message listener for communication with main process
     * Electron utility processes use process.parentPort (MessagePort)
     */
    private setupMessageListener(): void {
        // Electron utility processes have process.parentPort (MessagePort)
        // This is set by Electron when spawning the utility process
        const parentPort = (process as any).parentPort;

        if (!parentPort) {
            this.log('error', 'parentPort not available - not running as utility process?');
            process.exit(1);
        }

        this.log('info', 'Found parentPort, setting up message listener');

        parentPort.on('message', async (event: any) => {
            const message = event.data as IPCMessage;
            try {
                await this.handleMessage(message);
            } catch (error) {
                this.log('error', `Failed to handle message: ${error}`);
                this.sendToMain(UtilityToMainMessageType.NODE_ERROR, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        });

        this.log('info', 'P2P Service initialized, sending READY signal');

        // Send READY message to main process so it knows we're ready to receive commands
        this.sendToMain(UtilityToMainMessageType.READY, {});
    }

    /**
     * Handle incoming messages from main process
     */
    private async handleMessage(message: IPCMessage): Promise<void> {
        this.log('info', `📨 Received message: ${message.type}`);

        try {
            switch (message.type) {
                case MainToUtilityMessageType.START_NODE:
                    this.log('info', '🚀 Handling START_NODE command...');
                    await this.startNode();
                    this.log('info', '✓ START_NODE completed');
                    break;

                case MainToUtilityMessageType.STOP_NODE:
                    await this.stopNode();
                    break;

                case MainToUtilityMessageType.CONNECT_TO_PEER:
                    await this.connectToPeer(message.payload as ConnectToPeerPayload);
                    break;

                case MainToUtilityMessageType.DISCONNECT_FROM_PEER:
                    await this.disconnectFromPeer(
                        message.payload as DisconnectFromPeerPayload
                    );
                    break;

                case MainToUtilityMessageType.GET_DISCOVERED_PEERS:
                    await this.getDiscoveredPeers();
                    break;

                case MainToUtilityMessageType.GET_CONNECTED_PEERS:
                    await this.getConnectedPeers();
                    break;

                default:
                    this.log('warn', `Unknown message type: ${message.type}`);
            }
        } catch (error) {
            this.log('error', `Error handling message ${message.type}: ${error}`);
            this.log('error', `Stack trace: ${error instanceof Error ? error.stack : 'N/A'}`);
        }
    }

    /**
     * Start the libp2p node
     */
    private async startNode(): Promise<void> {
        if (this.isStarted) {
            this.log('warn', 'Node already started');
            return;
        }

        try {
            this.log('info', 'Starting libp2p node...');

            // LEARNING: Minimal libp2p configuration for desktop-to-desktop connections
            // We start with WebRTC and mDNS discovery
            //
            // CRITICAL: WebRTC transport has dependencies:
            // 1. @libp2p/identify service (peer identification)
            // 2. @libp2p/circuit-relay-v2 transport (signaling mechanism)
            // See: /docs/notes/note-251110-webrtc-node-js-compatibility-resolved.md
            this.libp2pNode = await createLibp2p({
                // Listen addresses - where this node accepts connections
                // Configured via shared P2P_CONFIG
                addresses: {
                    listen: P2P_CONFIG.LISTEN_ADDRESSES,
                },

                // Connection encryption (required)
                connectionEncrypters: [noise()],

                // Stream multiplexing (required)
                streamMuxers: [yamux()],

                // Transports: Multiple transports for robustness and compatibility
                // LEARNING: TCP for desktop-to-desktop (most reliable, works on same machine)
                // LEARNING: WebSockets for browser compatibility (future web client)
                // LEARNING: WebRTC for browser-to-browser and NAT traversal
                // LEARNING: circuitRelayTransport is REQUIRED for WebRTC
                transports: [
                    tcp(),                      // Desktop-to-desktop, local testing
                    webSockets(),               // Web browser compatibility
                    webRTC(),                   // Browser-to-browser, WebRTC peers
                    circuitRelayTransport(),    // Required for WebRTC
                ],

                // Peer discovery: mDNS for local network auto-discovery
                // CRITICAL: serviceName filters to WhatNext peers only
                peerDiscovery: [
                    mdns({
                        serviceName: P2P_CONFIG.MDNS_SERVICE_NAME,
                        interval: P2P_CONFIG.MDNS_INTERVAL,
                    }),
                ],

                // Services: Protocols that run on top of connections
                services: {
                    identify: identify(), // Required by WebRTC transport
                },

                // Connection manager settings
                connectionManager: {
                    maxConnections: P2P_CONFIG.CONNECTION.MAX_CONNECTIONS,
                },
            });

            // Setup event listeners
            this.setupLibp2pEventListeners();

            // Start the node
            await this.libp2pNode.start();

            this.isStarted = true;

            // Get our peer ID and listening addresses
            const peerId = this.libp2pNode.peerId.toString();
            const multiaddrs = this.libp2pNode
                .getMultiaddrs()
                .map((ma) => ma.toString());

            this.log('info', `libp2p node started with PeerID: ${peerId}`);
            this.log('info', `Listening on: ${multiaddrs.join(', ')}`);

            // Notify main process
            this.sendToMain(UtilityToMainMessageType.NODE_STARTED, {
                peerId,
                multiaddrs,
            });
        } catch (error) {
            this.log('error', `Failed to start node: ${error}`);
            this.sendToMain(UtilityToMainMessageType.NODE_ERROR, {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Stop the libp2p node
     */
    private async stopNode(): Promise<void> {
        if (!this.isStarted || !this.libp2pNode) {
            this.log('warn', 'Node not started');
            return;
        }

        try {
            this.log('info', 'Stopping libp2p node...');
            await this.libp2pNode.stop();
            this.isStarted = false;
            this.libp2pNode = null;

            this.sendToMain(UtilityToMainMessageType.NODE_STOPPED, {});
            this.log('info', 'libp2p node stopped');
        } catch (error) {
            this.log('error', `Failed to stop node: ${error}`);
            throw error;
        }
    }

    /**
     * Setup libp2p event listeners
     */
    private setupLibp2pEventListeners(): void {
        if (!this.libp2pNode) return;

        // LEARNING: libp2p emits events for peer discovery, connections, etc.
        // See: https://docs.libp2p.io/concepts/fundamentals/protocols-and-streams/

        // Peer discovered via mDNS
        this.libp2pNode.addEventListener('peer:discovery', (evt) => {
            const peerId = evt.detail.id.toString();
            const multiaddrs = evt.detail.multiaddrs.map((ma) => ma.toString());

            this.log('info', `Discovered peer: ${peerId}`);

            // LEARNING: We only notify main process about WhatNext peers
            // In future, we'll add a protocol prefix to filter peers
            this.sendToMain(UtilityToMainMessageType.PEER_DISCOVERED, {
                peer: {
                    peerId,
                    displayName: `WhatNext Peer ${peerId.slice(0, 8)}...`,
                    multiaddrs,
                    protocols: [],
                    discovered: 'mdns' as const,
                    discoveredAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                },
                multiaddrs,
            });
        });

        // Peer connection established
        this.libp2pNode.addEventListener('peer:connect', (evt) => {
            const peerId = evt.detail.toString();
            this.log('info', `Connected to peer: ${peerId}`);

            // LEARNING: At this point, we have a connection but haven't done
            // the WhatNext handshake yet. We'll send a handshake message next.
            this.sendToMain(UtilityToMainMessageType.CONNECTION_ESTABLISHED, {
                peerId,
                connection: {
                    peerId,
                    state: 'connected' as const,
                    connectedAt: new Date().toISOString(),
                    multiaddrs: [], // TODO: Get actual multiaddrs from connection
                },
            });
        });

        // Peer disconnected
        this.libp2pNode.addEventListener('peer:disconnect', (evt) => {
            const peerId = evt.detail.toString();
            this.log('info', `Disconnected from peer: ${peerId}`);

            this.sendToMain(UtilityToMainMessageType.CONNECTION_CLOSED, {
                peerId,
            });
        });
    }

    /**
     * Connect to a peer by peer ID
     */
    private async connectToPeer(payload: ConnectToPeerPayload): Promise<void> {
        if (!this.libp2pNode) {
            throw new Error('Node not started');
        }

        try {
            this.log('info', `🔌 Connecting to peer: ${payload.peerId}`);

            // LEARNING: Convert string peer ID to libp2p PeerId object
            const targetPeerId = peerIdFromString(payload.peerId);

            // LEARNING: Check if peer is already connected
            const connections = this.libp2pNode.getConnections(targetPeerId);
            if (connections.length > 0) {
                this.log('info', `Already connected to peer: ${payload.peerId}`);
                return;
            }

            // LEARNING: For mDNS-discovered peers, their multiaddrs are in peerStore
            let peer;
            try {
                peer = await this.libp2pNode.peerStore.get(targetPeerId);
                this.log('info', `Found peer in peerStore with ${peer.addresses.length} address(es)`);
            } catch (error) {
                throw new Error(
                    `Peer not found in peerStore. Discovery hasn't happened yet, or peer is offline.`
                );
            }

            if (!peer || peer.addresses.length === 0) {
                throw new Error(
                    'Peer has no known addresses. Cannot dial without multiaddrs.'
                );
            }

            // Log multiaddrs we're trying to dial
            this.log('info', `Attempting to dial ${peer.addresses.length} address(es):`);
            peer.addresses.forEach((addr, i) => {
                this.log('info', `  [${i}] ${addr.multiaddr.toString()}`);
            });

            // LEARNING: libp2p.dial() will try all known multiaddrs for the peer
            // and return when the first one succeeds
            this.log('info', `Dialing peer ${payload.peerId}...`);
            const connection = await this.libp2pNode.dial(targetPeerId);

            this.log('info', `✓ Successfully dialed peer: ${payload.peerId}`);
            this.log('info', `  Remote address: ${connection.remoteAddr.toString()}`);

            // Connection established event will be emitted by libp2p's peer:connect listener
        } catch (error) {
            this.log('error', `✗ Failed to connect to peer: ${error}`);
            this.log('error', `  Stack: ${error instanceof Error ? error.stack : 'N/A'}`);

            this.sendToMain(UtilityToMainMessageType.CONNECTION_FAILED, {
                peerId: payload.peerId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Disconnect from a peer
     */
    private async disconnectFromPeer(
        payload: DisconnectFromPeerPayload
    ): Promise<void> {
        if (!this.libp2pNode) {
            throw new Error('Node not started');
        }

        try {
            this.log('info', `Disconnecting from peer: ${payload.peerId}`);

            // LEARNING: libp2p's hangUp method closes all connections to a peer
            // await this.libp2pNode.hangUp(payload.peerId as any);

            // Disconnection event will be emitted by libp2p
        } catch (error) {
            this.log('error', `Failed to disconnect from peer: ${error}`);
        }
    }

    /**
     * Get list of discovered peers
     */
    private async getDiscoveredPeers(): Promise<void> {
        // LEARNING: libp2p's peerStore maintains discovered peers
        // We'll implement this after understanding peerStore API better
        this.log('info', 'getDiscoveredPeers() - Not yet implemented');
    }

    /**
     * Get list of connected peers
     */
    private async getConnectedPeers(): Promise<void> {
        if (!this.libp2pNode) {
            throw new Error('Node not started');
        }

        const connections = this.libp2pNode.getConnections();
        this.log('info', `Currently connected to ${connections.length} peers`);
    }

    /**
     * Send message to main process
     * Electron utility processes use process.parentPort.postMessage()
     */
    private sendToMain(type: UtilityToMainMessageType, payload: any): void {
        const parentPort = (process as any).parentPort;

        if (!parentPort) {
            this.log('error', 'parentPort not available');
            return;
        }

        const message = createIPCMessage(type, payload);
        parentPort.postMessage(message);
    }

    /**
     * Logging utility
     * LEARNING: In production, we'd use a proper logger (pino, winston)
     */
    private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
        const timestamp = new Date().toISOString();
        const prefix = `[P2P Service ${timestamp}] [${level.toUpperCase()}]`;
        console.log(`${prefix} ${message}`);
    }
}

// ========================================
// Entry Point
// ========================================

// Create and start the service
// TODO : Should this be a singleton?
const service = new P2PService();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[P2P Service] Received SIGTERM, shutting down...');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[P2P Service] Received SIGINT, shutting down...');
    process.exit(0);
});

export default service;

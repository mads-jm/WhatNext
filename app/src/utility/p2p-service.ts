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
import { FaultTolerance } from '@libp2p/interface';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { mdns } from '@libp2p/mdns';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { dcutr } from '@libp2p/dcutr';
import { peerIdFromString } from '@libp2p/peer-id';
import {
    type IPCMessage,
    MainToUtilityMessageType,
    UtilityToMainMessageType,
    createIPCMessage,
    type ConnectToPeerPayload,
    type DisconnectFromPeerPayload,
    type ReplicationPullResponsePayload,
} from '../shared/core';
import { P2P_CONFIG } from '../shared/p2p-config';
import { FILE_TRANSFER_CAPABILITY } from '../shared/core/file-transfer-types';
import { registerHandshakeProtocol, initiateHandshake, type HandshakeData } from './protocols/handshake';
import { registerReplicationProtocol, pushToRemotePeer, pullFromRemotePeer, newestCheckpoint, type ReplicationDocument } from './protocols/replication';
import { registerPingProtocol, startPresenceTracking } from './protocols/ping';
import {
    registerFileTransferProtocol,
    requestManifest,
    requestFile,
    sendFileChunk,
    cancelTransfer,
    cleanupPeerStreams,
    type FileTransferCallbacks,
} from './protocols/file-transfer';
import type { FileTransferMessage } from '../shared/core/file-transfer-types';
import { RelayManager } from './relay-manager';
import { CheckpointStore, resolveCheckpointPath } from './checkpoint-store';
import { BootstrapTracker } from './bootstrap-tracker';
import type {
    PeerDiscoveryEvent,
    PeerConnectionEvent,
    MultiaddrLike,
    PeerStoreEntry,
    UtilityProcessMessageEvent,
} from './types';

/**
 * P2P Service class
 * Manages libp2p node lifecycle and connections
 */
class P2PService {
    private libp2pNode: Libp2p | null = null;
    private isStarted = false;
    private connectedPeerNames: Map<string, string> = new Map();
    // Durable per-peer/per-collection checkpoints ("peerId:collection" -> checkpoint).
    // Persisted to disk so a relaunch resumes incrementally instead of full-resyncing (#40).
    private checkpointStore: CheckpointStore = new CheckpointStore(resolveCheckpointPath());
    // One replication bootstrap per (peer, connection); released on peer:disconnect (#58).
    private bootstrapTracker: BootstrapTracker = new BootstrapTracker();

    // User identity (set via IPC from main process, used in handshake)
    private userDisplayName: string | null = null;
    private userAvatarUrl: string | undefined = undefined;
    private userIdentityId: string | null = null;

    // Relay
    private relayManager: RelayManager | null = null;
    private activeRelayMultiaddr: string | null = null;

    // Presence
    private stopPresenceTracking: (() => void) | null = null;

    // Pending pull request promises: requestId -> { resolve, reject }
    private pendingPullRequests: Map<string, { resolve: (val: ReplicationDocument[]) => void; reject: (err: Error) => void }> = new Map();

    // Pending file-transfer request promises (manifest requests): requestId -> { resolve, reject }
    private pendingFileTransferRequests: Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }> = new Map();

    // Relay addresses loaded from settings (passed via START_NODE or UPDATE_RELAY_ADDRESSES)
    private relayAddresses: string[] = [];

    // File transfer callbacks — stored here so requestFile can use the same dispatch logic
    private fileTransferCallbacks: FileTransferCallbacks | null = null;

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
        const parentPort = process.parentPort;

        if (!parentPort) {
            this.log('error', 'parentPort not available - not running as utility process?');
            process.exit(1);
        }

        this.log('info', 'Found parentPort, setting up message listener');

        parentPort.on('message', async (event: UtilityProcessMessageEvent) => {
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
                case MainToUtilityMessageType.START_NODE: {
                    this.log('info', '🚀 Handling START_NODE command...');
                    const startPayload = message.payload as { relayAddresses?: string[] };
                    if (startPayload.relayAddresses) {
                        this.relayAddresses = startPayload.relayAddresses;
                    }
                    await this.startNode();
                    this.log('info', '✓ START_NODE completed');
                    break;
                }

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

                case MainToUtilityMessageType.REPLICATION_PUSH: {
                    const pushPayload = message.payload as { collection: string; documents: ReplicationDocument[] };
                    if (this.libp2pNode) {
                        const connections = this.libp2pNode.getConnections();
                        for (const conn of connections) {
                            try {
                                await pushToRemotePeer(
                                    this.libp2pNode,
                                    conn.remotePeer.toString(),
                                    pushPayload.collection,
                                    pushPayload.documents
                                );
                            } catch (error) {
                                this.log('error', `Failed to push to ${conn.remotePeer.toString()}: ${error}`);
                            }
                        }
                    }
                    break;
                }

                case MainToUtilityMessageType.REPLICATION_PULL: {
                    const pullPayload = message.payload as { collection: string; checkpoint: string | null };
                    if (this.libp2pNode) {
                        const connections = this.libp2pNode.getConnections();
                        for (const conn of connections) {
                            try {
                                await pullFromRemotePeer(
                                    this.libp2pNode,
                                    conn.remotePeer.toString(),
                                    pullPayload.collection,
                                    pullPayload.checkpoint
                                );
                            } catch (error) {
                                this.log('error', `Failed to pull from ${conn.remotePeer.toString()}: ${error}`);
                            }
                        }
                    }
                    break;
                }

                case MainToUtilityMessageType.GET_DISCOVERED_PEERS:
                    await this.getDiscoveredPeers();
                    break;

                case MainToUtilityMessageType.GET_CONNECTED_PEERS:
                    await this.getConnectedPeers();
                    break;

                case MainToUtilityMessageType.SET_USER_IDENTITY: {
                    const identity = message.payload as { displayName: string; avatarUrl?: string; userId: string };
                    this.userDisplayName = identity.displayName;
                    this.userAvatarUrl = identity.avatarUrl;
                    this.userIdentityId = identity.userId;
                    this.log('info', `User identity set: ${identity.displayName} (${identity.userId.slice(0, 8)}...)`);
                    break;
                }

                case MainToUtilityMessageType.UPDATE_RELAY_ADDRESSES: {
                    const { addresses } = message.payload as { addresses: string[] };
                    this.relayAddresses = addresses;
                    if (this.relayManager) {
                        await this.relayManager.updateAddresses(addresses);
                    }
                    this.log('info', `Relay addresses updated: ${addresses.length} address(es)`);
                    break;
                }

                case MainToUtilityMessageType.REPLICATION_PULL_RESPONSE: {
                    const resp = message.payload as ReplicationPullResponsePayload;
                    const pending = this.pendingPullRequests.get(resp.requestId);
                    if (pending) {
                        this.pendingPullRequests.delete(resp.requestId);
                        pending.resolve(resp.documents as ReplicationDocument[]);
                    }
                    break;
                }

                case MainToUtilityMessageType.FILE_TRANSFER_REQUEST_MANIFEST: {
                    if (!this.libp2pNode) break
                    const { peerId: targetPeerId, playlistId, requestId: manifestReqId } = message.payload as {
                        peerId: string
                        playlistId: string
                        requestId: string
                    }
                    try {
                        const manifest = await requestManifest(
                            this.libp2pNode,
                            peerIdFromString(targetPeerId),
                            playlistId
                        )
                        this.sendToMain(UtilityToMainMessageType.FILE_TRANSFER_MANIFEST_RECEIVED, {
                            requestId: manifestReqId,
                            peerId: targetPeerId,
                            manifest,
                        })
                    } catch (err) {
                        this.sendToMain(UtilityToMainMessageType.FILE_TRANSFER_ERROR, {
                            requestId: manifestReqId,
                            peerId: targetPeerId,
                            sha256: '',
                            error: err instanceof Error ? err.message : String(err),
                        })
                    }
                    break
                }

                case MainToUtilityMessageType.FILE_TRANSFER_REQUEST_FILE: {
                    if (!this.libp2pNode || !this.fileTransferCallbacks) break
                    const { peerId: filePeerId, sha256: fileHash, offsetBytes } = message.payload as {
                        peerId: string
                        sha256: string
                        offsetBytes: number
                    }
                    try {
                        await requestFile(
                            this.libp2pNode,
                            peerIdFromString(filePeerId),
                            fileHash,
                            offsetBytes,
                            this.fileTransferCallbacks
                        )
                    } catch (err) {
                        this.sendToMain(UtilityToMainMessageType.FILE_TRANSFER_ERROR, {
                            peerId: filePeerId,
                            sha256: fileHash,
                            error: err instanceof Error ? err.message : String(err),
                        })
                    }
                    break
                }

                case MainToUtilityMessageType.FILE_TRANSFER_CANCEL: {
                    if (!this.libp2pNode) break
                    const { peerId: cancelPeerId, sha256: cancelHash } = message.payload as {
                        peerId: string
                        sha256: string
                    }
                    try {
                        await cancelTransfer(
                            this.libp2pNode,
                            peerIdFromString(cancelPeerId),
                            cancelHash
                        )
                    } catch (err) {
                        this.log('warn', `cancelTransfer failed: ${err}`)
                    }
                    break
                }

                case MainToUtilityMessageType.FILE_TRANSFER_SERVE_CHUNK: {
                    if (!this.libp2pNode) break
                    const { peerId: chunkPeerId, message: chunkMsg } = message.payload as {
                        peerId: string
                        message: FileTransferMessage
                    }
                    try {
                        await sendFileChunk(
                            this.libp2pNode,
                            peerIdFromString(chunkPeerId),
                            chunkMsg
                        )
                    } catch (err) {
                        this.log('error', `sendFileChunk failed: ${err}`)
                    }
                    break
                }

                // File-transfer manifest response from main process (resolves pending promise)
                case MainToUtilityMessageType.FILE_TRANSFER_MANIFEST_RESPONSE: {
                    const { requestId: ftReqId, manifest: ftManifest } = message.payload as {
                        requestId: string
                        manifest: unknown
                    }
                    const pending = this.pendingFileTransferRequests.get(ftReqId)
                    if (pending) {
                        this.pendingFileTransferRequests.delete(ftReqId)
                        pending.resolve(ftManifest)
                    }
                    break
                }

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

            // Load durable replication checkpoints before any peer connects so the
            // first pull resumes from the saved checkpoint (incremental, not full resync).
            if (!this.checkpointStore.isLoaded) {
                await this.checkpointStore.load();
                this.log('info', `Loaded ${this.checkpointStore.entries().length} persisted checkpoint(s)`);
            }

            // LEARNING: Minimal libp2p configuration for desktop-to-desktop connections
            // We start with WebRTC and mDNS discovery
            //
            // CRITICAL: WebRTC transport has dependencies:
            // 1. @libp2p/identify service (peer identification)
            // 2. @libp2p/circuit-relay-v2 transport (signaling mechanism)
            // See: /docs/notes/note-251110-webrtc-node-js-compatibility-resolved.md
            // LEARNING: createLibp2p auto-starts the node unless start: false.
            // We pass start: false so we can set up event listeners BEFORE
            // the node starts, avoiding missed peer:discovery events.
            this.libp2pNode = await createLibp2p({
                start: false,

                // Listen addresses - where this node accepts connections
                // Configured via shared P2P_CONFIG
                addresses: {
                    listen: [...P2P_CONFIG.LISTEN_ADDRESSES],
                },

                // LEARNING: Allow node to start even if some listen addresses fail.
                // On Windows, Electron utility processes may reject TCP bind on 0.0.0.0.
                // With NO_FATAL, WebRTC and other transports still work.
                transportManager: {
                    faultTolerance: FaultTolerance.NO_FATAL,
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
                        serviceTag: P2P_CONFIG.MDNS_SERVICE_NAME,
                        interval: P2P_CONFIG.MDNS_INTERVAL,
                    }),
                ],

                // Services: Protocols that run on top of connections
                services: {
                    identify: identify(), // Required by WebRTC transport
                    // DCUtR: after a relay connection is established, automatically
                    // attempt hole-punching to upgrade to a direct WebRTC connection.
                    // The relay becomes a bootstrap step, not a permanent intermediary.
                    dcutr: dcutr(),
                },

                // Connection manager settings
                connectionManager: {
                    maxConnections: P2P_CONFIG.CONNECTION.MAX_CONNECTIONS,
                },
            });

            // Setup event listeners BEFORE starting so we don't miss early events
            this.setupLibp2pEventListeners();

            // Now start the node
            await this.libp2pNode.start();

            // Register protocols
            this.registerProtocols();

            // Connect to relay servers
            await this.connectToRelays();

            this.isStarted = true;

            // Get our peer ID and listening addresses
            const peerId = this.libp2pNode.peerId.toString();
            const multiaddrs = this.libp2pNode
                .getMultiaddrs()
                .map((ma: MultiaddrLike) => ma.toString());

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

            // Flush any pending checkpoint writes before the process can exit.
            await this.checkpointStore.dispose();

            // Clean up presence tracking
            this.stopPresenceTracking?.();
            this.stopPresenceTracking = null;

            // Clean up relay manager
            this.relayManager?.dispose();
            this.relayManager = null;
            this.activeRelayMultiaddr = null;

            await this.libp2pNode.stop();
            this.isStarted = false;
            this.libp2pNode = null;

            // Every connection is gone; a restart must bootstrap replication afresh.
            this.bootstrapTracker.clear();

            this.sendToMain(UtilityToMainMessageType.NODE_STOPPED, {});
            this.log('info', 'libp2p node stopped');
        } catch (error) {
            this.log('error', `Failed to stop node: ${error}`);
            throw error;
        }
    }

    /**
     * Register WhatNext-specific protocol handlers
     */
    private registerProtocols(): void {
        if (!this.libp2pNode) return;

        const localHandshakeData: HandshakeData = {
            displayName: this.userDisplayName || `WhatNext User ${Math.random().toString(36).slice(2, 6)}`,
            avatarUrl: this.userAvatarUrl,
            userId: this.userIdentityId || this.libp2pNode.peerId.toString(),
            version: P2P_CONFIG.APP_INFO.protocolVersion,
            capabilities: ['playlist-sync', 'rxdb-replication', FILE_TRANSFER_CAPABILITY],
            peerId: this.libp2pNode.peerId.toString(),
        };

        // Register handshake handler (responder side). The dialer side runs the
        // same completion path off initiateHandshake's return value.
        registerHandshakeProtocol(
            this.libp2pNode,
            localHandshakeData,
            (remotePeerId, data) => this.onHandshakeComplete(remotePeerId, data)
        );

        // Register replication handler
        registerReplicationProtocol(
            this.libp2pNode,
            // onPullRequest (responder): request our data from the renderer via main.
            async (collection, checkpoint, limit) => {
                this.log('info', `Pull request for ${collection} (checkpoint: ${checkpoint})`);

                // Generate a correlation ID and wait for main to relay back renderer's data.
                const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                try {
                    const documents = await new Promise<ReplicationDocument[]>((resolve, reject) => {
                        // On timeout REJECT (don't resolve empty). Resolving empty +
                        // a fresh checkpoint made a slow peer look like it had no
                        // changes, silently advancing the requester past unsent data (#41).
                        const timer = setTimeout(() => {
                            this.pendingPullRequests.delete(requestId);
                            reject(new Error(`Pull request for ${collection} timed out after ${P2P_CONFIG.REPLICATION.PULL_TIMEOUT}ms`));
                        }, P2P_CONFIG.REPLICATION.PULL_TIMEOUT);

                        this.pendingPullRequests.set(requestId, {
                            resolve: (docs) => { clearTimeout(timer); resolve(docs); },
                            reject: (err) => { clearTimeout(timer); reject(err); },
                        });

                        this.sendToMain(UtilityToMainMessageType.REPLICATION_PULL_REQUEST, {
                            requestId,
                            collection,
                            checkpoint,
                            limit,
                        });
                    });

                    // Advance the checkpoint to the newest doc we're actually sending,
                    // not to "now" — "now" would skip docs written between the newest
                    // returned doc and wall-clock time.
                    return { documents, checkpoint: newestCheckpoint(documents, checkpoint) };
                } catch (err) {
                    // Surface the timeout/failure and DO NOT advance the requester's
                    // checkpoint: echo back the checkpoint they sent so the missed
                    // changes are re-pulled next time rather than silently dropped.
                    this.log('warn', `Pull for ${collection} failed, not advancing checkpoint: ${err}`);
                    return { documents: [], checkpoint: checkpoint ?? new Date(0).toISOString() };
                }
            },
            // onPushReceived: forward changes to main -> renderer.
            async (collection, documents) => {
                this.log('info', `Received ${documents.length} docs for ${collection}`);
                this.sendToMain(UtilityToMainMessageType.REPLICATION_CHANGES, {
                    collection,
                    documents,
                    checkpoint: new Date().toISOString(),
                });
            },
            // onPullResponse (requester): apply pulled docs and persist the checkpoint (#40).
            (remotePeerId, collection, documents, checkpoint) => {
                this.log('info', `Pull-response from ${remotePeerId.slice(0, 12)}: ${documents.length} docs for ${collection}`);
                if (documents.length > 0) {
                    this.sendToMain(UtilityToMainMessageType.REPLICATION_CHANGES, {
                        collection,
                        documents,
                        checkpoint: checkpoint ?? new Date().toISOString(),
                    });
                }
                if (checkpoint) {
                    this.checkpointStore.set(`${remotePeerId}:${collection}`, checkpoint);
                }
            }
        );

        // Register ping/presence protocol
        registerPingProtocol(this.libp2pNode);

        // Start presence tracking (pings connected peers every 30s)
        this.stopPresenceTracking = startPresenceTracking(
            this.libp2pNode,
            (peerId, online, lastSeenAt) => {
                this.sendToMain(UtilityToMainMessageType.PEER_PRESENCE_UPDATE, {
                    peerId,
                    online,
                    lastSeenAt,
                });
            }
        );

        // Register file-transfer protocol
        this.fileTransferCallbacks = {
            onManifestRequest: async (peerId, playlistId) => {
                // This is a synchronous bridge: we need the manifest from the main process.
                // Use the same pending-promise pattern as replication pull requests.
                const requestId = `ft-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}`
                return new Promise((resolve, reject) => {
                    const timer = setTimeout(() => {
                        this.pendingFileTransferRequests.delete(requestId)
                        reject(new Error('Manifest request timed out'))
                    }, 10_000)

                    this.pendingFileTransferRequests.set(requestId, {
                        resolve: (val: unknown) => { clearTimeout(timer); resolve(val as import('../shared/core/file-transfer-types').FileManifest) },
                        reject: (err: Error) => { clearTimeout(timer); reject(err) },
                    })

                    this.sendToMain(UtilityToMainMessageType.FILE_TRANSFER_INCOMING_REQUEST, {
                        requestId,
                        subtype: 'manifest-request',
                        peerId,
                        playlistId,
                    })
                })
            },
            onFileRequest: (peerId, sha256, offsetBytes) => {
                this.sendToMain(UtilityToMainMessageType.FILE_TRANSFER_INCOMING_REQUEST, {
                    subtype: 'file-request',
                    peerId,
                    sha256,
                    offsetBytes,
                })
            },
            onFileChunkReceived: (peerId, sha256, offset, data) => {
                this.sendToMain(UtilityToMainMessageType.FILE_TRANSFER_CHUNK_RECEIVED, {
                    peerId,
                    sha256,
                    offset,
                    data,
                })
            },
            onFileComplete: (peerId, sha256) => {
                this.sendToMain(UtilityToMainMessageType.FILE_TRANSFER_COMPLETE, {
                    peerId,
                    sha256,
                })
            },
            onFileError: (peerId, sha256, error) => {
                this.sendToMain(UtilityToMainMessageType.FILE_TRANSFER_ERROR, {
                    peerId,
                    sha256,
                    error,
                })
            },
            onTransferCancel: (peerId, sha256) => {
                this.sendToMain(UtilityToMainMessageType.FILE_TRANSFER_ERROR, {
                    peerId,
                    sha256,
                    error: 'transfer-cancel',
                })
            },
        }
        registerFileTransferProtocol(this.libp2pNode, this.fileTransferCallbacks)

        this.log('info', 'Protocols registered: handshake, replication, ping, file-transfer');
    }

    /**
     * Connect to configured relay servers for NAT traversal.
     * Uses RelayManager for retry logic and status tracking.
     */
    private async connectToRelays(): Promise<void> {
        if (!this.libp2pNode) return;

        this.relayManager = new RelayManager(
            this.libp2pNode,
            this.relayAddresses,
            (connected, relayMultiaddr, relayPeerId) => {
                this.activeRelayMultiaddr = relayMultiaddr;
                this.sendToMain(UtilityToMainMessageType.RELAY_CONNECTED, {
                    connected,
                    relayMultiaddr,
                    relayPeerId,
                });
                this.log('info', connected
                    ? `Relay connected: ${relayMultiaddr}`
                    : 'Relay disconnected'
                );
            }
        );

        if (P2P_CONFIG.RELAY.AUTO_CONNECT) {
            await this.relayManager.connectAll();
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
        this.libp2pNode.addEventListener('peer:discovery', (evt: PeerDiscoveryEvent) => {
            const peerId = evt.detail.id.toString();
            const multiaddrs = evt.detail.multiaddrs.map((ma: MultiaddrLike) => ma.toString());

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
        this.libp2pNode.addEventListener('peer:connect', (evt: PeerConnectionEvent) => {
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
        this.libp2pNode.addEventListener('peer:disconnect', (evt: PeerConnectionEvent) => {
            const peerId = evt.detail.toString();
            this.log('info', `Disconnected from peer: ${peerId}`);

            cleanupPeerStreams(peerId).catch((err) => {
                this.log('warn', `Error cleaning up streams for ${peerId}: ${err}`);
            });

            // Re-arm the replication bootstrap so a reconnect pulls again. Keeping
            // the claim past the connection would make the peer look
            // already-handshaked forever — silent no-sync (#58).
            this.bootstrapTracker.release(peerId);

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
            } catch {
                this.log('info', 'Peer not found in peerStore');
                // Will try relay hint below if available
            }

            // If we have a relay hint, add relay address to peerStore
            if (payload.relay) {
                this.log('info', `Using relay hint: ${payload.relay}`);
                const { multiaddr } = await import('@multiformats/multiaddr');
                const relayAddr = multiaddr(
                    `${payload.relay}/p2p-circuit/p2p/${payload.peerId}`
                );
                await this.libp2pNode.peerStore.merge(targetPeerId, {
                    multiaddrs: [relayAddr],
                });
                // Re-fetch peer after merge
                peer = await this.libp2pNode.peerStore.get(targetPeerId);
            }

            if (!peer || peer.addresses.length === 0) {
                throw new Error(
                    'Peer has no known addresses. Cannot dial without multiaddrs.'
                );
            }

            // Log multiaddrs we're trying to dial
            this.log('info', `Attempting to dial ${peer.addresses.length} address(es):`);
            peer.addresses.forEach((addr: PeerStoreEntry['addresses'][number], i: number) => {
                this.log('info', `  [${i}] ${addr.multiaddr.toString()}`);
            });

            // LEARNING: libp2p.dial() will try all known multiaddrs for the peer
            // and return when the first one succeeds
            this.log('info', `Dialing peer ${payload.peerId}...`);
            const connection = await this.libp2pNode.dial(targetPeerId);

            this.log('info', `✓ Successfully dialed peer: ${payload.peerId}`);
            this.log('info', `  Remote address: ${connection.remoteAddr.toString()}`);

            // Initiate handshake after connection
            try {
                const localData: HandshakeData = {
                    displayName: this.userDisplayName || `WhatNext User ${this.libp2pNode.peerId.toString().slice(-4)}`,
                    avatarUrl: this.userAvatarUrl,
                    userId: this.userIdentityId || this.libp2pNode.peerId.toString(),
                    version: P2P_CONFIG.APP_INFO.protocolVersion,
                    capabilities: ['playlist-sync', 'rxdb-replication', FILE_TRANSFER_CAPABILITY],
                    peerId: this.libp2pNode.peerId.toString(),
                };
                // Dialer completion path: initiateHandshake now resolves with the
                // REMOTE's data (it used to return a placeholder and rely on the
                // handshake loop re-entering our responder — see handshake.ts).
                const remoteData = await initiateHandshake(this.libp2pNode, payload.peerId, localData);
                this.onHandshakeComplete(payload.peerId, remoteData);
            } catch (err) {
                this.log('warn', `Handshake failed (non-fatal): ${err}`);
            }

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
     * Shared handshake-completion path for BOTH sides of a connection.
     *
     * The responder reaches it from the protocol handler's callback; the dialer
     * reaches it from `initiateHandshake`'s resolved value. Before #58 only the
     * responder path existed and the dialer learned its peer only because the
     * responder's reply-on-a-new-stream re-entered our own handler — so this
     * method is what keeps breaking the loop from becoming a silent no-sync.
     *
     * Replication bootstrap is claimed once per (peer, connection): a connection
     * can complete the handshake twice locally when both ends dial each other.
     */
    private onHandshakeComplete(remotePeerId: string, data: HandshakeData): void {
        this.connectedPeerNames.set(remotePeerId, data.displayName);
        this.sendToMain(UtilityToMainMessageType.HANDSHAKE_COMPLETE, {
            peerId: remotePeerId,
            displayName: data.displayName,
            avatarUrl: data.avatarUrl,
            userId: data.userId,
            version: data.version,
            capabilities: data.capabilities,
        });

        if (!this.bootstrapTracker.claim(remotePeerId)) {
            this.log('info', `Replication already bootstrapped for ${remotePeerId}, skipping`);
            return;
        }

        // Trigger initial replication pull from the newly joined peer
        this.triggerInitialReplication(remotePeerId);
    }

    /**
     * Pull session-relevant collections from a newly connected peer.
     * Called after handshake completes to bootstrap replication.
     */
    private triggerInitialReplication(peerId: string): void {
        if (!this.libp2pNode) return;

        const SESSION_COLLECTIONS = ['playlists', 'tracks', 'trackInteractions', 'comments', 'users'];

        for (const collection of SESSION_COLLECTIONS) {
            const checkpointKey = `${peerId}:${collection}`;
            const checkpoint = this.checkpointStore.get(checkpointKey);

            // pullFromRemotePeer sends a pull-request; the response arrives via
            // the replication protocol handler (pull-response case in replication.ts).
            pullFromRemotePeer(this.libp2pNode, peerId, collection, checkpoint)
                .catch((err) => {
                    this.log('warn', `Initial pull failed for ${collection} from ${peerId}: ${err}`);
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
            const { peerIdFromString: fromStr } = await import('@libp2p/peer-id');
            await this.libp2pNode.hangUp(fromStr(payload.peerId));
        } catch (error) {
            this.log('error', `Failed to disconnect from peer: ${error}`);
        }
    }

    /**
     * Get list of discovered peers (from peerStore)
     */
    private async getDiscoveredPeers(): Promise<void> {
        if (!this.libp2pNode) return;

        const peers: Array<{ peerId: string; multiaddrs: string[] }> = [];
        // peerStore.all() returns Promise<Peer[]> in libp2p v2+
        const allPeers = await this.libp2pNode.peerStore.all();
        for (const peer of allPeers) {
            peers.push({
                peerId: peer.id.toString(),
                multiaddrs: peer.addresses.map((a: { multiaddr: { toString(): string } }) => a.multiaddr.toString()),
            });
        }
        this.sendToMain(UtilityToMainMessageType.PEER_DISCOVERED, { peers });
        this.log('info', `Discovered peers: ${peers.length}`);
    }

    /**
     * Get list of connected peers with presence info
     */
    private async getConnectedPeers(): Promise<void> {
        if (!this.libp2pNode) {
            throw new Error('Node not started');
        }

        const connections = this.libp2pNode.getConnections();
        const peers = connections.map((conn) => ({
            peerId: conn.remotePeer.toString(),
            displayName: this.connectedPeerNames.get(conn.remotePeer.toString()),
            remoteAddr: conn.remoteAddr.toString(),
        }));

        this.log('info', `Connected peers: ${peers.length}`);
        // Return data by including in a message (using REPLICATION_STATE as a status channel is a workaround;
        // a proper GET_CONNECTED_PEERS_RESPONSE could be added in a future IPC pass)
        this.sendToMain(UtilityToMainMessageType.REPLICATION_STATE, {
            connectedPeers: peers,
            activeRelayMultiaddr: this.activeRelayMultiaddr,
        });
    }

    /** Build a shareable invite URL for the current session. */
    getInviteData(): { peerId: string | null; relayMultiaddr: string | null } {
        return {
            peerId: this.libp2pNode?.peerId.toString() ?? null,
            relayMultiaddr: this.activeRelayMultiaddr,
        };
    }

    /**
     * Send message to main process
     * Electron utility processes use process.parentPort.postMessage()
     */
    private sendToMain(type: UtilityToMainMessageType, payload: Record<string, unknown>): void {
        const parentPort = process.parentPort;

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

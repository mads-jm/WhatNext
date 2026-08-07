/**
 * Coordination tests for the P2P utility-process service (#32).
 *
 * `p2p-service.ts` is the hub where handshake completion, replication
 * checkpointing and main↔utility message routing meet, and until the test seam
 * landed none of it could be exercised: importing the module constructed the
 * singleton, which called `process.exit(1)` without a `process.parentPort`.
 *
 * What is faked, and why:
 *  - `libp2p` itself — `createLibp2p` returns {@link MockP2PNode}, an extension of
 *    the protocol suites' `MockLibp2p` with the node-lifecycle surface the service
 *    touches (peerId, event listeners, start/stop, multiaddrs). No real node, no
 *    sockets, no transports.
 *  - The four protocol modules — mocked so the *callbacks the service hands them*
 *    can be captured and invoked directly. The protocols' own wire behaviour is
 *    already covered by `protocols/__tests__/`; what is untested is the service's
 *    decisions inside those callbacks.
 *  - `CheckpointStore` / `RelayManager` — both have their own suites; here they are
 *    recording stand-ins so nothing touches disk or dials a relay.
 *  - `newestCheckpoint` is deliberately NOT mocked: the "advance to the newest doc"
 *    rule (#41) is the thing under test, so the real implementation runs.
 *
 * These are behaviour pins, not a spec: several assertions encode current
 * behaviour so a regression is visible, not because the behaviour is ideal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import process from 'node:process';
import type { Libp2p } from 'libp2p';
import { MockLibp2p, asLibp2p } from '../protocols/__tests__/harness';
import {
    MainToUtilityMessageType,
    UtilityToMainMessageType,
    createIPCMessage,
    type IPCMessage,
} from '../../shared/core';
import { P2P_CONFIG } from '../../shared/p2p-config';
import type { HandshakeData } from '../protocols/handshake';
import type {
    OnPullRequest,
    OnPullResponse,
    OnPushReceived,
    ReplicationDocument,
} from '../protocols/replication';
import type { FileTransferCallbacks } from '../protocols/file-transfer';

// ========================================
// Module mocks
// ========================================

/** Spies shared between the `vi.mock` factories (hoisted) and the test bodies. */
const h = vi.hoisted(() => ({
    createLibp2p: vi.fn(),
    registerHandshakeProtocol: vi.fn(),
    initiateHandshake: vi.fn(),
    registerReplicationProtocol: vi.fn(),
    pullFromRemotePeer: vi.fn(),
    pushToRemotePeer: vi.fn(),
    registerPingProtocol: vi.fn(),
    startPresenceTracking: vi.fn(),
    registerFileTransferProtocol: vi.fn(),
    cleanupPeerStreams: vi.fn(),
    requestManifest: vi.fn(),
    requestFile: vi.fn(),
    sendFileChunk: vi.fn(),
    cancelTransfer: vi.fn(),
    /** Every CheckpointStore the service constructed, newest last. */
    checkpointStores: [] as Array<{
        seed: Map<string, string>;
        sets: Array<[string, string]>;
        disposeCalls: number;
    }>,
    /** Every RelayManager the service constructed, newest last. */
    relayManagers: [] as Array<{
        addresses: string[];
        updates: string[][];
        connectAllCalls: number;
    }>,
}));

vi.mock('libp2p', () => ({ createLibp2p: h.createLibp2p }));

vi.mock('../protocols/handshake', () => ({
    registerHandshakeProtocol: h.registerHandshakeProtocol,
    initiateHandshake: h.initiateHandshake,
}));

// Partial mock: `newestCheckpoint` stays real (see file header).
vi.mock('../protocols/replication', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../protocols/replication')>();
    return {
        ...actual,
        registerReplicationProtocol: h.registerReplicationProtocol,
        pullFromRemotePeer: h.pullFromRemotePeer,
        pushToRemotePeer: h.pushToRemotePeer,
    };
});

vi.mock('../protocols/ping', () => ({
    registerPingProtocol: h.registerPingProtocol,
    startPresenceTracking: h.startPresenceTracking,
}));

vi.mock('../protocols/file-transfer', () => ({
    registerFileTransferProtocol: h.registerFileTransferProtocol,
    cleanupPeerStreams: h.cleanupPeerStreams,
    requestManifest: h.requestManifest,
    requestFile: h.requestFile,
    sendFileChunk: h.sendFileChunk,
    cancelTransfer: h.cancelTransfer,
}));

vi.mock('../checkpoint-store', () => {
    class FakeCheckpointStore {
        seed = new Map<string, string>();
        sets: Array<[string, string]> = [];
        disposeCalls = 0;
        private loaded = false;

        constructor() {
            h.checkpointStores.push(this);
        }
        async load(): Promise<void> {
            this.loaded = true;
        }
        get isLoaded(): boolean {
            return this.loaded;
        }
        entries(): Array<[string, string]> {
            return [...this.seed.entries()];
        }
        get(key: string): string | null {
            return this.seed.get(key) ?? null;
        }
        set(key: string, checkpoint: string): void {
            this.sets.push([key, checkpoint]);
            this.seed.set(key, checkpoint);
        }
        async dispose(): Promise<void> {
            this.disposeCalls += 1;
        }
    }
    return {
        CheckpointStore: FakeCheckpointStore,
        resolveCheckpointPath: () => '/nonexistent/checkpoints.json',
    };
});

vi.mock('../relay-manager', () => {
    class FakeRelayManager {
        updates: string[][] = [];
        connectAllCalls = 0;

        constructor(
            _node: unknown,
            public addresses: string[],
            _onStatusChange: unknown,
        ) {
            h.relayManagers.push(this);
        }
        async connectAll(): Promise<void> {
            this.connectAllCalls += 1;
        }
        async updateAddresses(addresses: string[]): Promise<void> {
            this.updates.push(addresses);
            this.addresses = addresses;
        }
        dispose(): void {}
    }
    return { RelayManager: FakeRelayManager };
});

// Imported after the mocks are registered. `service` is the module-level
// singleton: null here precisely because no parentPort exists at import time.
import service, { P2PService } from '../p2p-service';

// ========================================
// Fixtures & helpers
// ========================================

const LOCAL_PEER = '12D3KooWLocalAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const REMOTE_PEER = '12D3KooWRemoteBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const SESSION_COLLECTIONS = [
    'playlists',
    'tracks',
    'trackInteractions',
    'comments',
    'users',
];

/**
 * The libp2p node the service believes it started. Extends the protocol suites'
 * `MockLibp2p` (reusing `getConnections`/`setConnectedPeers` and the single
 * explained `asLibp2p` cast) with the node-lifecycle surface `p2p-service` uses.
 */
class MockP2PNode extends MockLibp2p {
    readonly peerId: { toString(): string };
    started = false;
    stopped = false;

    private eventListeners = new Map<string, (evt: unknown) => void>();

    constructor(peerIdStr: string = LOCAL_PEER) {
        super();
        this.peerId = { toString: () => peerIdStr };
    }

    addEventListener(type: string, cb: (evt: never) => void): void {
        this.eventListeners.set(type, cb as (evt: unknown) => void);
    }

    async start(): Promise<void> {
        this.started = true;
    }

    async stop(): Promise<void> {
        this.stopped = true;
    }

    getMultiaddrs(): Array<{ toString(): string }> {
        return [{ toString: () => '/ip4/127.0.0.1/tcp/4001' }];
    }

    /** Fire a libp2p event at whatever listener the service registered. */
    emit(
        type: 'peer:discovery' | 'peer:connect' | 'peer:disconnect',
        detail: unknown,
    ): void {
        const listener = this.eventListeners.get(type);
        if (!listener) throw new Error(`No listener registered for ${type}`);
        listener({ detail });
    }
}

/**
 * Stand-in for Electron's `process.parentPort`. Records what the service posts
 * to main and lets a test hand it a main→utility message.
 */
class StubParentPort {
    readonly sent: Array<IPCMessage<Record<string, unknown>>> = [];
    private listener:
        ((evt: { data: unknown }) => Promise<void> | void) | null = null;

    on(
        _event: 'message',
        cb: (evt: { data: unknown }) => Promise<void> | void,
    ): void {
        this.listener = cb;
    }

    postMessage(message: unknown): void {
        this.sent.push(message as IPCMessage<Record<string, unknown>>);
    }

    /** Deliver a main→utility message and await the service's handling of it. */
    async deliver(
        type: MainToUtilityMessageType,
        payload: Record<string, unknown> = {},
    ): Promise<void> {
        if (!this.listener) throw new Error('No message listener registered');
        await this.listener({ data: createIPCMessage(type, payload) });
    }

    ofType(type: UtilityToMainMessageType): Array<Record<string, unknown>> {
        return this.sent.filter((m) => m.type === type).map((m) => m.payload);
    }

    last(type: UtilityToMainMessageType): Record<string, unknown> {
        const all = this.ofType(type);
        if (all.length === 0) throw new Error(`No ${type} message was sent`);
        return all[all.length - 1];
    }
}

/**
 * Install the stub parentPort. The property does not exist outside an Electron
 * utility process, so it is defined (and removed again in afterEach) rather than
 * assigned; the cast is the same kind of structural stand-in as `asLibp2p`.
 */
function installParentPort(): StubParentPort {
    const port = new StubParentPort();
    Object.defineProperty(process, 'parentPort', {
        value: port as unknown as typeof process.parentPort,
        configurable: true,
        writable: true,
    });
    return port;
}

/** Construct a service wired to a fresh stub port (no libp2p node yet). */
function createService(): { service: P2PService; port: StubParentPort } {
    const port = installParentPort();
    return { service: new P2PService(), port };
}

/** Construct a service and drive it through START_NODE with a mock libp2p node. */
async function startService(
    options: { node?: MockP2PNode; relayAddresses?: string[] } = {},
): Promise<{ service: P2PService; port: StubParentPort; node: MockP2PNode }> {
    const node = options.node ?? new MockP2PNode();
    h.createLibp2p.mockResolvedValue(asLibp2p(node));
    const { service, port } = createService();
    await port.deliver(MainToUtilityMessageType.START_NODE, {
        relayAddresses: options.relayAddresses ?? [],
    });
    return { service, port, node };
}

/** The handshake-completion callback the service most recently registered. */
function handshakeCallback(): (peerId: string, data: HandshakeData) => void {
    const call = h.registerHandshakeProtocol.mock.calls.at(-1) as unknown as
        | [Libp2p, HandshakeData, (peerId: string, data: HandshakeData) => void]
        | undefined;
    if (!call) throw new Error('registerHandshakeProtocol was not called');
    return call[2];
}

/** The local handshake data the service most recently advertised. */
function localHandshakeData(): HandshakeData {
    const call = h.registerHandshakeProtocol.mock.calls.at(-1) as unknown as
        [Libp2p, HandshakeData, unknown] | undefined;
    if (!call) throw new Error('registerHandshakeProtocol was not called');
    return call[1];
}

/** The replication callbacks the service most recently registered. */
function replicationCallbacks(): {
    onPullRequest: OnPullRequest;
    onPushReceived: OnPushReceived;
    onPullResponse: OnPullResponse;
} {
    const call = h.registerReplicationProtocol.mock.calls.at(-1) as unknown as
        [Libp2p, OnPullRequest, OnPushReceived, OnPullResponse] | undefined;
    if (!call) throw new Error('registerReplicationProtocol was not called');
    return {
        onPullRequest: call[1],
        onPushReceived: call[2],
        onPullResponse: call[3],
    };
}

/** The file-transfer callbacks the service most recently registered. */
function fileTransferCallbacks(): FileTransferCallbacks {
    const call = h.registerFileTransferProtocol.mock.calls.at(-1) as unknown as
        [Libp2p, FileTransferCallbacks] | undefined;
    if (!call) throw new Error('registerFileTransferProtocol was not called');
    return call[1];
}

function remoteHandshake(
    overrides: Partial<HandshakeData> = {},
): HandshakeData {
    return {
        displayName: 'Remote User',
        avatarUrl: 'https://example.invalid/a.png',
        userId: 'user-remote',
        version: P2P_CONFIG.APP_INFO.protocolVersion,
        capabilities: ['playlist-sync', 'rxdb-replication'],
        peerId: REMOTE_PEER,
        ...overrides,
    };
}

function doc(id: string, updatedAt: string): ReplicationDocument {
    return { id, data: { id }, updatedAt };
}

/** The collections passed to pullFromRemotePeer, in call order. */
function pulledCollections(): string[] {
    return h.pullFromRemotePeer.mock.calls.map(
        (call) => (call as unknown as [Libp2p, string, string])[2],
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    h.checkpointStores.length = 0;
    h.relayManagers.length = 0;
    h.startPresenceTracking.mockReturnValue(() => {});
    h.pullFromRemotePeer.mockResolvedValue(undefined);
    h.cleanupPeerStreams.mockResolvedValue(undefined);
    // The service logs through console.log at every level; keep the run quiet.
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    Reflect.deleteProperty(process, 'parentPort');
    vi.restoreAllMocks();
    vi.useRealTimers();
});

// ========================================
// Tests
// ========================================

describe('module test seam', () => {
    it('skips the singleton when there is no parentPort', () => {
        // Importing this suite is the assertion: at module-eval time no
        // parentPort exists, so the tail must not have constructed (and
        // exited). Pre-seam this file could not have been imported at all.
        expect(service).toBeNull();
    });

    it('announces READY to main as soon as a parentPort exists', () => {
        const { port } = createService();
        expect(port.sent.map((m) => m.type)).toEqual([
            UtilityToMainMessageType.READY,
        ]);
    });
});

describe('handshake completion → replication bootstrap (#58)', () => {
    it('reports the remote identity to main', async () => {
        const { port } = await startService();

        handshakeCallback()(REMOTE_PEER, remoteHandshake());

        expect(port.last(UtilityToMainMessageType.HANDSHAKE_COMPLETE)).toEqual({
            peerId: REMOTE_PEER,
            displayName: 'Remote User',
            avatarUrl: 'https://example.invalid/a.png',
            userId: 'user-remote',
            version: P2P_CONFIG.APP_INFO.protocolVersion,
            capabilities: ['playlist-sync', 'rxdb-replication'],
        });
    });

    it('bootstraps exactly the five session collections, resuming from stored checkpoints', async () => {
        const { node } = await startService();
        const store = h.checkpointStores.at(-1)!;
        store.seed.set(`${REMOTE_PEER}:tracks`, '2026-01-01T00:00:00.000Z');

        handshakeCallback()(REMOTE_PEER, remoteHandshake());

        expect(pulledCollections()).toEqual(SESSION_COLLECTIONS);
        expect(h.pullFromRemotePeer).toHaveBeenCalledWith(
            asLibp2p(node),
            REMOTE_PEER,
            'tracks',
            '2026-01-01T00:00:00.000Z',
        );
        // A collection with no stored checkpoint pulls from scratch (null), not
        // from "now" — a wall-clock checkpoint would skip everything older.
        expect(h.pullFromRemotePeer).toHaveBeenCalledWith(
            asLibp2p(node),
            REMOTE_PEER,
            'playlists',
            null,
        );
    });

    it('skips re-bootstrap when the same peer completes a second handshake', async () => {
        const { port } = await startService();
        const onHandshake = handshakeCallback();

        onHandshake(REMOTE_PEER, remoteHandshake());
        onHandshake(REMOTE_PEER, remoteHandshake());

        // Both ends dialing means one connection can complete the handshake
        // twice: both completions are reported to main, only the first pulls.
        expect(
            port.ofType(UtilityToMainMessageType.HANDSHAKE_COMPLETE),
        ).toHaveLength(2);
        expect(pulledCollections()).toEqual(SESSION_COLLECTIONS);
    });
});

describe('replication callbacks', () => {
    it('relays a pull request to main and advances to the newest returned document', async () => {
        const { port } = await startService();
        const { onPullRequest } = replicationCallbacks();

        const pending = onPullRequest('tracks', '2026-01-01T00:00:00.000Z', 50);
        const request = port.last(
            UtilityToMainMessageType.REPLICATION_PULL_REQUEST,
        );
        expect(request).toMatchObject({
            collection: 'tracks',
            checkpoint: '2026-01-01T00:00:00.000Z',
            limit: 50,
        });

        const documents = [
            doc('a', '2026-02-01T00:00:00.000Z'),
            doc('b', '2026-03-01T00:00:00.000Z'),
        ];
        await port.deliver(MainToUtilityMessageType.REPLICATION_PULL_RESPONSE, {
            requestId: request.requestId as string,
            documents,
        });

        await expect(pending).resolves.toEqual({
            documents,
            // Newest doc's updatedAt, NOT wall-clock now (#41).
            checkpoint: '2026-03-01T00:00:00.000Z',
        });
    });

    it('echoes the requester checkpoint back on timeout instead of advancing (#41)', async () => {
        vi.useFakeTimers();
        await startService();
        const { onPullRequest } = replicationCallbacks();

        const pending = onPullRequest('tracks', '2026-01-01T00:00:00.000Z', 50);
        await vi.advanceTimersByTimeAsync(
            P2P_CONFIG.REPLICATION.PULL_TIMEOUT + 1,
        );

        await expect(pending).resolves.toEqual({
            documents: [],
            checkpoint: '2026-01-01T00:00:00.000Z',
        });
    });

    it('falls back to the epoch when a timed-out pull had no checkpoint', async () => {
        vi.useFakeTimers();
        await startService();
        const { onPullRequest } = replicationCallbacks();

        const pending = onPullRequest('users', null, 50);
        await vi.advanceTimersByTimeAsync(
            P2P_CONFIG.REPLICATION.PULL_TIMEOUT + 1,
        );

        await expect(pending).resolves.toEqual({
            documents: [],
            checkpoint: new Date(0).toISOString(),
        });
    });

    it('forwards pushed documents to main as REPLICATION_CHANGES', async () => {
        const { port } = await startService();
        const { onPushReceived } = replicationCallbacks();
        const documents = [doc('a', '2026-02-01T00:00:00.000Z')];

        await onPushReceived('comments', documents);

        expect(
            port.last(UtilityToMainMessageType.REPLICATION_CHANGES),
        ).toMatchObject({ collection: 'comments', documents });
    });

    it('persists a pull-response checkpoint under the peerId:collection key and forwards the docs', async () => {
        const { port } = await startService();
        const { onPullResponse } = replicationCallbacks();
        const documents = [doc('a', '2026-02-01T00:00:00.000Z')];

        onPullResponse(
            REMOTE_PEER,
            'playlists',
            documents,
            '2026-02-01T00:00:00.000Z',
        );

        expect(port.last(UtilityToMainMessageType.REPLICATION_CHANGES)).toEqual(
            {
                collection: 'playlists',
                documents,
                checkpoint: '2026-02-01T00:00:00.000Z',
            },
        );
        expect(h.checkpointStores.at(-1)!.sets).toEqual([
            [`${REMOTE_PEER}:playlists`, '2026-02-01T00:00:00.000Z'],
        ]);
    });

    it('persists the checkpoint but sends no changes for an empty pull-response', async () => {
        const { port } = await startService();
        const { onPullResponse } = replicationCallbacks();

        onPullResponse(REMOTE_PEER, 'users', [], '2026-02-02T00:00:00.000Z');

        expect(
            port.ofType(UtilityToMainMessageType.REPLICATION_CHANGES),
        ).toEqual([]);
        expect(h.checkpointStores.at(-1)!.sets).toEqual([
            [`${REMOTE_PEER}:users`, '2026-02-02T00:00:00.000Z'],
        ]);
    });
});

describe('main → utility message routing', () => {
    it('advertises the identity set via SET_USER_IDENTITY in the handshake data', async () => {
        const node = new MockP2PNode();
        h.createLibp2p.mockResolvedValue(asLibp2p(node));
        const { port } = createService();

        await port.deliver(MainToUtilityMessageType.SET_USER_IDENTITY, {
            displayName: 'Ada',
            avatarUrl: 'https://example.invalid/ada.png',
            userId: 'user-ada',
        });
        await port.deliver(MainToUtilityMessageType.START_NODE, {});

        expect(localHandshakeData()).toMatchObject({
            displayName: 'Ada',
            avatarUrl: 'https://example.invalid/ada.png',
            userId: 'user-ada',
            peerId: LOCAL_PEER,
        });
    });

    it('hands START_NODE relay addresses to the relay manager', async () => {
        await startService({ relayAddresses: ['/ip4/10.0.0.1/tcp/4001'] });

        expect(h.relayManagers.at(-1)).toMatchObject({
            addresses: ['/ip4/10.0.0.1/tcp/4001'],
            connectAllCalls: 1,
        });
    });

    it('stores relay addresses updated before the node starts', async () => {
        const node = new MockP2PNode();
        h.createLibp2p.mockResolvedValue(asLibp2p(node));
        const { port } = createService();

        await port.deliver(MainToUtilityMessageType.UPDATE_RELAY_ADDRESSES, {
            addresses: ['/ip4/10.0.0.2/tcp/4001'],
        });
        await port.deliver(MainToUtilityMessageType.START_NODE, {});

        expect(h.relayManagers.at(-1)?.addresses).toEqual([
            '/ip4/10.0.0.2/tcp/4001',
        ]);
    });

    it('pushes relay address updates into a live relay manager', async () => {
        const { port } = await startService({
            relayAddresses: ['/ip4/10.0.0.1/tcp/4001'],
        });

        await port.deliver(MainToUtilityMessageType.UPDATE_RELAY_ADDRESSES, {
            addresses: ['/ip4/10.0.0.3/tcp/4001'],
        });

        expect(h.relayManagers.at(-1)?.updates).toEqual([
            ['/ip4/10.0.0.3/tcp/4001'],
        ]);
    });

    it('ignores a pull response for an unknown requestId', async () => {
        vi.useFakeTimers();
        const { port } = await startService();
        const { onPullRequest } = replicationCallbacks();

        const pending = onPullRequest('tracks', null, 50);
        let settled = false;
        void pending.then(() => {
            settled = true;
        });

        await port.deliver(MainToUtilityMessageType.REPLICATION_PULL_RESPONSE, {
            requestId: 'not-a-real-request',
            documents: [doc('a', '2026-02-01T00:00:00.000Z')],
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        // The genuine requestId still resolves it.
        const request = port.last(
            UtilityToMainMessageType.REPLICATION_PULL_REQUEST,
        );
        await port.deliver(MainToUtilityMessageType.REPLICATION_PULL_RESPONSE, {
            requestId: request.requestId as string,
            documents: [],
        });
        await expect(pending).resolves.toMatchObject({ documents: [] });
    });

    it('resolves a pending manifest request from FILE_TRANSFER_MANIFEST_RESPONSE', async () => {
        const { port } = await startService();
        const manifest = { playlistId: 'p1', files: [] };

        const pending = fileTransferCallbacks().onManifestRequest(
            REMOTE_PEER,
            'p1',
        );
        const outgoing = port.last(
            UtilityToMainMessageType.FILE_TRANSFER_INCOMING_REQUEST,
        );
        expect(outgoing).toMatchObject({
            subtype: 'manifest-request',
            peerId: REMOTE_PEER,
            playlistId: 'p1',
        });

        // An unrelated requestId must not resolve it...
        await port.deliver(
            MainToUtilityMessageType.FILE_TRANSFER_MANIFEST_RESPONSE,
            {
                requestId: 'other',
                manifest: { playlistId: 'wrong', files: [] },
            },
        );
        // ...the matching one does.
        await port.deliver(
            MainToUtilityMessageType.FILE_TRANSFER_MANIFEST_RESPONSE,
            { requestId: outgoing.requestId as string, manifest },
        );

        await expect(pending).resolves.toEqual(manifest);
    });

    it('warns rather than throws on an unknown message type', async () => {
        const { port } = createService();
        const logged = vi.mocked(console.log);

        await expect(
            port.deliver('totally_unknown' as MainToUtilityMessageType, {}),
        ).resolves.toBeUndefined();

        expect(
            logged.mock.calls.some((args) =>
                String(args[0]).includes(
                    'Unknown message type: totally_unknown',
                ),
            ),
        ).toBe(true);
        expect(port.ofType(UtilityToMainMessageType.NODE_ERROR)).toEqual([]);
    });

    it('treats file-transfer commands as no-ops before the node exists', async () => {
        const { port } = createService();

        await port.deliver(
            MainToUtilityMessageType.FILE_TRANSFER_REQUEST_MANIFEST,
            { peerId: REMOTE_PEER, playlistId: 'p1', requestId: 'r1' },
        );
        await port.deliver(
            MainToUtilityMessageType.FILE_TRANSFER_REQUEST_FILE,
            {
                peerId: REMOTE_PEER,
                sha256: 'abc',
                offsetBytes: 0,
            },
        );
        await port.deliver(MainToUtilityMessageType.FILE_TRANSFER_CANCEL, {
            peerId: REMOTE_PEER,
            sha256: 'abc',
        });
        await port.deliver(MainToUtilityMessageType.FILE_TRANSFER_SERVE_CHUNK, {
            peerId: REMOTE_PEER,
            message: { type: 'file-chunk' },
        });

        expect(h.requestManifest).not.toHaveBeenCalled();
        expect(h.requestFile).not.toHaveBeenCalled();
        expect(h.cancelTransfer).not.toHaveBeenCalled();
        expect(h.sendFileChunk).not.toHaveBeenCalled();
        // Silent no-op: not even an error is reported back to main.
        expect(
            port.ofType(UtilityToMainMessageType.FILE_TRANSFER_ERROR),
        ).toEqual([]);
    });
});

describe('lifecycle coordination', () => {
    it('releases the bootstrap claim and cleans up streams on peer:disconnect', async () => {
        const { port, node } = await startService();
        handshakeCallback()(REMOTE_PEER, remoteHandshake());
        expect(pulledCollections()).toHaveLength(5);

        node.emit('peer:disconnect', { toString: () => REMOTE_PEER });

        expect(h.cleanupPeerStreams).toHaveBeenCalledWith(REMOTE_PEER);
        expect(port.last(UtilityToMainMessageType.CONNECTION_CLOSED)).toEqual({
            peerId: REMOTE_PEER,
        });

        // Reconnect: the claim was released, so the peer bootstraps again
        // (keeping it would be a silent no-sync — #58).
        handshakeCallback()(REMOTE_PEER, remoteHandshake());
        expect(pulledCollections()).toHaveLength(10);
    });

    it('disposes the checkpoint store and clears bootstrap claims on STOP_NODE', async () => {
        const { port, node } = await startService();
        handshakeCallback()(REMOTE_PEER, remoteHandshake());
        const store = h.checkpointStores.at(-1)!;

        await port.deliver(MainToUtilityMessageType.STOP_NODE);

        expect(store.disposeCalls).toBe(1);
        expect(node.stopped).toBe(true);
        expect(port.ofType(UtilityToMainMessageType.NODE_STOPPED)).toHaveLength(
            1,
        );

        // A restart re-bootstraps every peer: the tracker was cleared.
        await port.deliver(MainToUtilityMessageType.START_NODE, {});
        handshakeCallback()(REMOTE_PEER, remoteHandshake());
        expect(pulledCollections()).toHaveLength(10);
    });
});

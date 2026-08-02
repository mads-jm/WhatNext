/**
 * Shared P2P test harness (#32).
 *
 * Minimal in-memory mocks for libp2p `Stream` / `Connection` / `Libp2p` so the
 * protocol handlers can be exercised without a real two-node libp2p network.
 * Frames are encoded with the same 4-byte big-endian length prefix the protocols
 * use, so what we feed in is exactly what they parse.
 *
 * NOT a test file itself (no `.test.ts` suffix) — imported by the suites.
 */

import type { Libp2p } from 'libp2p';

/** Encode a JSON value with the protocols' 4-byte big-endian length prefix. */
export function encodeFrame(data: unknown): Uint8Array {
    const json = new TextEncoder().encode(JSON.stringify(data));
    const frame = new Uint8Array(4 + json.length);
    new DataView(frame.buffer).setUint32(0, json.length, false);
    frame.set(json, 4);
    return frame;
}

/** Decode a single length-prefixed frame back into a JSON value. */
export function decodeFrame<T = unknown>(bytes: Uint8Array): T {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const length = view.getUint32(0, false);
    const body = bytes.slice(4, 4 + length);
    return JSON.parse(new TextDecoder().decode(body)) as T;
}

/**
 * A mock libp2p message stream. Yields the supplied inbound frames when iterated
 * and records everything written via `send`. Models backpressure via
 * `writableNeedsDrain` + a resolvable `onDrain`.
 */
export class MockStream {
    sent: Uint8Array[] = [];
    closed = false;
    aborted = false;
    writableNeedsDrain = false;
    /** Number of `send` calls to return `false` for (simulating a full buffer). */
    failSends = 0;
    /**
     * When true the iterator stalls after the inbound frames instead of ending:
     * models a peer that accepted the stream and never replies (a pre-#58 peer,
     * or one whose handler threw). `abort()` releases it.
     */
    hang = false;
    /** The error passed to `abort`, if any. */
    abortReason: Error | null = null;

    private inbound: Uint8Array[];
    private drainResolvers: Array<() => void> = [];
    private hangResolvers: Array<() => void> = [];

    constructor(inbound: Uint8Array[] = []) {
        this.inbound = inbound;
    }

    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        for (const chunk of this.inbound) {
            yield chunk;
        }
        if (this.hang) {
            await new Promise<void>((resolve) => {
                this.hangResolvers.push(resolve);
            });
        }
    }

    send(data: Uint8Array): boolean {
        this.sent.push(data);
        if (this.failSends > 0) {
            this.failSends -= 1;
            this.writableNeedsDrain = true;
            return false;
        }
        return true;
    }

    onDrain(): Promise<void> {
        if (!this.writableNeedsDrain) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this.drainResolvers.push(resolve);
        });
    }

    /** Test hook: signal the buffer drained, releasing any pending onDrain awaiters. */
    drain(): void {
        this.writableNeedsDrain = false;
        const resolvers = this.drainResolvers;
        this.drainResolvers = [];
        for (const r of resolvers) r();
    }

    async close(): Promise<void> {
        this.closed = true;
    }

    abort(err?: Error): void {
        this.aborted = true;
        this.abortReason = err ?? null;
        const resolvers = this.hangResolvers;
        this.hangResolvers = [];
        for (const r of resolvers) r();
    }

    /** Decode all frames written to this stream. */
    sentFrames<T = unknown>(): T[] {
        return this.sent.map((b) => decodeFrame<T>(b));
    }
}

/** A mock connection whose `newStream` hands back capturable streams. */
export class MockConnection {
    newStreams: MockStream[] = [];

    constructor(public readonly remotePeerId: string) {}

    get remotePeer() {
        return { toString: () => this.remotePeerId };
    }

    async newStream(): Promise<MockStream> {
        const stream = new MockStream();
        this.newStreams.push(stream);
        return stream;
    }
}

/**
 * A mock libp2p node that records the handler registered via `handle` and lets
 * the test drive `getConnections()`.
 */
export class MockLibp2p {
    handlers: Map<string, (stream: MockStream, connection: MockConnection) => unknown> = new Map();
    connections: Array<{ remotePeer: { toString(): string } }> = [];
    /** Every `dialProtocol` call, in order — lets a test assert "dialed exactly once". */
    dials: Array<{ peerId: string; protocol: string }> = [];
    /** Streams handed back by `dialProtocol`, in call order. */
    dialedStreams: MockStream[] = [];

    private dialQueue: MockStream[] = [];

    handle(protocol: string, handler: (stream: MockStream, connection: MockConnection) => unknown): void {
        this.handlers.set(protocol, handler);
    }

    getConnections() {
        return this.connections;
    }

    setConnectedPeers(peerIds: string[]): void {
        this.connections = peerIds.map((id) => ({ remotePeer: { toString: () => id } }));
    }

    /**
     * Queue the stream the next `dialProtocol` call returns. Preload it with the
     * frames the remote is expected to reply with; the mock ignores send/read
     * ordering, so a request/response exchange on one stream can be set up ahead
     * of time.
     */
    queueDialStream(stream: MockStream): void {
        this.dialQueue.push(stream);
    }

    async dialProtocol(peerId: { toString(): string }, protocol: string): Promise<MockStream> {
        this.dials.push({ peerId: peerId.toString(), protocol });
        const stream = this.dialQueue.shift() ?? new MockStream();
        this.dialedStreams.push(stream);
        return stream;
    }
}

/**
 * Cast a {@link MockLibp2p} to the `Libp2p` type the protocol registrars expect.
 * The mock implements only the handful of methods the protocol handlers touch
 * (`handle`, `getConnections`); the registrars' parameter type demands the full
 * surface. Centralizing the single unavoidable structural cast here keeps the
 * test bodies clean and the unsafe assertion explained in exactly one place.
 */
export function asLibp2p(mock: MockLibp2p): Libp2p {
    return mock as unknown as Libp2p;
}

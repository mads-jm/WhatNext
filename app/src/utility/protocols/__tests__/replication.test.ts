import { describe, it, expect, vi } from 'vitest';
import {
    registerReplicationProtocol,
    newestCheckpoint,
    type ReplicationMessage,
    type ReplicationDocument,
} from '../replication';
import { P2P_CONFIG } from '../../../shared/p2p-config';
import { MockStream, MockConnection, MockLibp2p, encodeFrame, asLibp2p } from './harness';

const PROTOCOL = P2P_CONFIG.PROTOCOLS.RXDB_REPLICATION;

function getHandler(node: MockLibp2p) {
    const handler = node.handlers.get(PROTOCOL);
    if (!handler) throw new Error('replication handler not registered');
    return handler;
}

const doc = (id: string, updatedAt: string): ReplicationDocument => ({
    id,
    data: { id, updatedAt, name: id },
    updatedAt,
});

describe('newestCheckpoint', () => {
    it('returns the newest updatedAt among the documents', () => {
        const docs = [doc('a', '2026-06-27T00:00:00.000Z'), doc('b', '2026-06-27T00:00:05.000Z')];
        expect(newestCheckpoint(docs, null)).toBe('2026-06-27T00:00:05.000Z');
    });

    it('preserves the incoming checkpoint when no doc has a usable timestamp', () => {
        expect(newestCheckpoint([], '2026-06-27T00:00:00.000Z')).toBe('2026-06-27T00:00:00.000Z');
        expect(newestCheckpoint([doc('a', 'bad')], '2026-06-27T00:00:00.000Z')).toBe(
            '2026-06-27T00:00:00.000Z'
        );
    });

    it('never returns wall-clock now for an empty pull (epoch fallback only)', () => {
        expect(newestCheckpoint([], null)).toBe(new Date(0).toISOString());
    });
});

describe('replication protocol handler', () => {
    it('answers a pull-request with a pull-response carrying the resolved docs', async () => {
        const node = new MockLibp2p();
        const docs = [doc('a', '2026-06-27T00:00:01.000Z')];
        const onPullRequest = vi.fn(async () => ({ documents: docs, checkpoint: 'cp-1' }));
        registerReplicationProtocol(asLibp2p(node), onPullRequest, vi.fn(), vi.fn());

        const request: ReplicationMessage = { type: 'pull-request', collection: 'playlists', checkpoint: null };
        const stream = new MockStream([encodeFrame(request)]);
        const conn = new MockConnection('peer-1');

        await getHandler(node)(stream, conn);

        expect(onPullRequest).toHaveBeenCalledWith('playlists', null, 100);
        expect(conn.newStreams).toHaveLength(1);
        const [response] = conn.newStreams[0].sentFrames<ReplicationMessage>();
        expect(response.type).toBe('pull-response');
        expect(response.collection).toBe('playlists');
        expect(response.documents).toEqual(docs);
        expect(response.checkpoint).toBe('cp-1');
    });

    it('applies a push and acks it', async () => {
        const node = new MockLibp2p();
        const onPushReceived = vi.fn(async () => {});
        registerReplicationProtocol(asLibp2p(node), vi.fn(), onPushReceived, vi.fn());

        const docs = [doc('a', '2026-06-27T00:00:01.000Z')];
        const push: ReplicationMessage = { type: 'push', collection: 'tracks', documents: docs };
        const stream = new MockStream([encodeFrame(push)]);
        const conn = new MockConnection('peer-2');

        await getHandler(node)(stream, conn);

        expect(onPushReceived).toHaveBeenCalledWith('tracks', docs);
        const [ack] = conn.newStreams[0].sentFrames<ReplicationMessage>();
        expect(ack.type).toBe('push-ack');
        expect(ack.collection).toBe('tracks');
    });

    it('forwards a pull-response to onPullResponse with the remote peer id (#40)', async () => {
        const node = new MockLibp2p();
        const onPullResponse = vi.fn();
        registerReplicationProtocol(asLibp2p(node), vi.fn(), vi.fn(), onPullResponse);

        const docs = [doc('a', '2026-06-27T00:00:09.000Z')];
        const response: ReplicationMessage = {
            type: 'pull-response',
            collection: 'comments',
            documents: docs,
            checkpoint: 'cp-9',
        };
        const stream = new MockStream([encodeFrame(response)]);
        const conn = new MockConnection('peer-xyz');

        await getHandler(node)(stream, conn);

        expect(onPullResponse).toHaveBeenCalledWith('peer-xyz', 'comments', docs, 'cp-9');
    });

    it('does not throw when no onPullResponse is provided (backward compat)', async () => {
        const node = new MockLibp2p();
        registerReplicationProtocol(asLibp2p(node), vi.fn(), vi.fn());
        const response: ReplicationMessage = {
            type: 'pull-response',
            collection: 'users',
            documents: [],
            checkpoint: 'cp',
        };
        const stream = new MockStream([encodeFrame(response)]);
        await expect(getHandler(node)(stream, new MockConnection('p'))).resolves.toBeUndefined();
    });
});

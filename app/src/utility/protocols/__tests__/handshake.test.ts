import { describe, it, expect, vi } from 'vitest';
import { registerHandshakeProtocol, type HandshakeData } from '../handshake';
import { P2P_CONFIG } from '../../../shared/p2p-config';
import { MockStream, MockConnection, MockLibp2p, encodeFrame, asLibp2p } from './harness';

const PROTOCOL = P2P_CONFIG.PROTOCOLS.HANDSHAKE;

const localData: HandshakeData = {
    displayName: 'Local User',
    userId: 'local-uuid',
    version: '1.0.0',
    capabilities: ['playlist-sync', 'rxdb-replication', 'file-transfer/1.0.0'],
    peerId: 'local-peer',
};

function remote(overrides: Partial<HandshakeData> = {}): HandshakeData {
    return {
        displayName: 'Remote User',
        userId: 'remote-uuid',
        version: '1.0.0',
        capabilities: ['playlist-sync', 'rxdb-replication'],
        peerId: 'remote-peer',
        ...overrides,
    };
}

describe('handshake protocol', () => {
    it('exchanges metadata: reads remote handshake and replies with local data', async () => {
        const node = new MockLibp2p();
        const onHandshake = vi.fn();
        registerHandshakeProtocol(asLibp2p(node), localData, onHandshake);
        const handler = node.handlers.get(PROTOCOL)!;

        const remoteData = remote();
        const stream = new MockStream([encodeFrame(remoteData)]);
        const conn = new MockConnection('remote-peer');

        await handler(stream, conn);

        // onHandshake fires with the remote's parsed data.
        expect(onHandshake).toHaveBeenCalledWith('remote-peer', remoteData);
        // We replied with OUR handshake on a fresh stream.
        const [reply] = conn.newStreams[0].sentFrames<HandshakeData>();
        expect(reply).toEqual(localData);
    });

    it('surfaces a capability mismatch to the app layer rather than rejecting it', async () => {
        // The protocol does not enforce capabilities (MVP) — it exchanges them and
        // lets the higher layer decide. This test pins that contract: a peer missing
        // 'rxdb-replication' still completes the handshake, with its (reduced)
        // capability set delivered so the app can choose how to treat it.
        const node = new MockLibp2p();
        const onHandshake = vi.fn();
        registerHandshakeProtocol(asLibp2p(node), localData, onHandshake);
        const handler = node.handlers.get(PROTOCOL)!;

        const mismatched = remote({ capabilities: ['playlist-sync'], version: '0.9.0' });
        await handler(new MockStream([encodeFrame(mismatched)]), new MockConnection('remote-peer'));

        expect(onHandshake).toHaveBeenCalledTimes(1);
        const delivered = onHandshake.mock.calls[0][1] as HandshakeData;
        expect(delivered.capabilities).toEqual(['playlist-sync']);
        expect(delivered.capabilities).not.toContain('rxdb-replication');
    });

    it('does not call onHandshake when the stream yields no data', async () => {
        const node = new MockLibp2p();
        const onHandshake = vi.fn();
        registerHandshakeProtocol(asLibp2p(node), localData, onHandshake);
        const handler = node.handlers.get(PROTOCOL)!;

        // Empty stream → readMessage throws → handler swallows, no handshake.
        await handler(new MockStream([]), new MockConnection('remote-peer'));
        expect(onHandshake).not.toHaveBeenCalled();
    });
});

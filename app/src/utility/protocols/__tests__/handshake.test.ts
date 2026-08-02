import { describe, it, expect, vi } from 'vitest';
import { registerHandshakeProtocol, initiateHandshake, type HandshakeData } from '../handshake';
import { P2P_CONFIG } from '../../../shared/p2p-config';
import { MockStream, MockConnection, MockLibp2p, encodeFrame, asLibp2p } from './harness';

const PROTOCOL = P2P_CONFIG.PROTOCOLS.HANDSHAKE;

// `initiateHandshake` runs the string through `peerIdFromString`, which validates
// the multihash — a placeholder like 'remote-peer' throws. Real peer ID, no network.
const REMOTE_PEER_ID = '12D3KooWSeGgUKtPNVcVy6423yWX4XMqoRoz8fw1jwMRNcpLqSHF';

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
    it('exchanges metadata: reads remote handshake and replies on the SAME stream', async () => {
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
        // We replied with OUR handshake on the inbound stream, not a fresh one.
        // (Pre-#58 this asserted the reply landed on conn.newStreams[0] — that
        // reply-on-a-new-stream shape IS the handshake loop; see the next test.)
        expect(stream.sentFrames<HandshakeData>()).toEqual([localData]);
        expect(conn.newStreams).toHaveLength(0);
    });

    it('never sends another handshake in response to a handshake (#58 loop break)', async () => {
        // The loop: A dials B, B replies on a NEW stream, A's own responder sees
        // that as a fresh request and replies on another new stream, forever —
        // and each lap re-fired onHandshake, re-triggering replication bootstrap.
        // Feed the responder a frame that IS a reply and assert it emits nothing
        // that could reach the peer's responder.
        const node = new MockLibp2p();
        const onHandshake = vi.fn();
        registerHandshakeProtocol(asLibp2p(node), localData, onHandshake);
        const handler = node.handlers.get(PROTOCOL)!;

        const conn = new MockConnection('remote-peer');
        await handler(new MockStream([encodeFrame(remote())]), conn);

        // No new stream, no dial: the peer's responder is never re-entered, so
        // the exchange terminates after exactly one round trip.
        expect(conn.newStreams).toHaveLength(0);
        expect(node.dials).toHaveLength(0);
        expect(onHandshake).toHaveBeenCalledTimes(1);
    });

    it('initiateHandshake resolves with the REMOTE data read off the dialed stream', async () => {
        // The dialing side's completion path. Pre-#58 this returned localData as
        // a placeholder and the dialer learned its peer only via the loop, so
        // breaking the loop without this would be a silent no-sync.
        const node = new MockLibp2p();
        const remoteData = remote();
        node.queueDialStream(new MockStream([encodeFrame(remoteData)]));

        const result = await initiateHandshake(asLibp2p(node), REMOTE_PEER_ID, localData);

        expect(result).toEqual(remoteData);
        expect(node.dials).toEqual([{ peerId: REMOTE_PEER_ID, protocol: PROTOCOL }]);
        // Exactly one frame out — our handshake — on the dialed stream.
        expect(node.dialedStreams[0].sentFrames<HandshakeData>()).toEqual([localData]);
        expect(node.dialedStreams[0].closed).toBe(true);
    });

    it('completes exactly once on BOTH sides of a connection', async () => {
        // Two-node exchange driven through the mocks: dialer D and responder R.
        const responderNode = new MockLibp2p();
        const responderLocal = remote({ displayName: 'Responder' });
        const onResponderHandshake = vi.fn();
        registerHandshakeProtocol(asLibp2p(responderNode), responderLocal, onResponderHandshake);
        const responderHandler = responderNode.handlers.get(PROTOCOL)!;

        // R's reply is what D will read back off the stream it dialed.
        const dialerNode = new MockLibp2p();
        dialerNode.queueDialStream(new MockStream([encodeFrame(responderLocal)]));

        const learnedByDialer = await initiateHandshake(
            asLibp2p(dialerNode),
            REMOTE_PEER_ID,
            localData
        );

        // Deliver what D actually put on the wire to R's handler.
        const [dialedFrame] = dialerNode.dialedStreams[0].sent;
        const responderConn = new MockConnection('dialer-peer');
        const responderStream = new MockStream([dialedFrame]);
        await responderHandler(responderStream, responderConn);

        // Both sides learned the other's data...
        expect(learnedByDialer).toEqual(responderLocal);
        expect(onResponderHandshake).toHaveBeenCalledTimes(1);
        expect(onResponderHandshake).toHaveBeenCalledWith('dialer-peer', localData);

        // ...and the exchange cost exactly one stream, one dial, no new streams.
        expect(dialerNode.dials).toHaveLength(1);
        expect(responderNode.dials).toHaveLength(0);
        expect(responderConn.newStreams).toHaveLength(0);
        expect(responderStream.sentFrames<HandshakeData>()).toEqual([responderLocal]);
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

    it('gives up (and aborts the stream) if the peer never replies', async () => {
        // A peer still running the pre-#58 shape replies on a NEW stream and
        // never writes to the one we dialed. Without a bound, our read would
        // await for the life of the connection — inert in the "no storm" sense
        // but a leaked stream + pending promise. Verified against two real
        // libp2p nodes before this bound was added; it hung indefinitely.
        const node = new MockLibp2p();
        const silent = new MockStream([]);
        silent.hang = true;
        node.queueDialStream(silent);

        await expect(
            initiateHandshake(asLibp2p(node), REMOTE_PEER_ID, localData, 20)
        ).rejects.toThrow(/No response within/);

        // Aborted, so the stalled read is released rather than pinned open.
        expect(silent.aborted).toBe(true);
        expect(silent.abortReason?.message).toMatch(/No response within/);
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

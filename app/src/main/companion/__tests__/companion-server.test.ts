/**
 * Companion server — relay tunnel authentication and per-phone addressing.
 *
 * These are integration tests: they stand up a fake relay (HTTP + WS) on
 * localhost and drive the real `companion-server` module against it, because
 * the behaviour under test lives entirely in the wire handshake.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
    startCompanionServer,
    stopCompanionServer,
    startRelayTunnel,
    isRelayTunnelActive,
    getCompanionServerInfo,
    sendTimeRequestAck,
    pushTurnUpdate,
    type CompanionServerCallbacks,
} from '../companion-server';

const HOST_TOKEN = 'a'.repeat(64);
const SESSION_CODE = 'ABC234';

interface HostAttach {
    ws: WebSocket;
    authorization: string | undefined;
    url: string | undefined;
}

interface FakeRelay {
    baseUrl: string;
    /** Every host WebSocket the relay has accepted, in order. */
    attaches: HostAttach[];
    /** Envelopes received from the host, in order. */
    received: Array<{ v: number; type: string; to: string | null; payload: { type: string; data?: unknown } }>;
    sendPhoneMessage(from: string, payload: unknown): void;
    sendPhoneDisconnect(from: string): void;
    waitForAttach(count: number, timeoutMs?: number): Promise<HostAttach>;
    waitForEnvelope(predicate: (e: { type: string; to: string | null; payload: { type: string } }) => boolean, timeoutMs?: number): Promise<{ to: string | null; payload: { type: string; data?: unknown } }>;
    close(): Promise<void>;
}

async function createFakeRelay(opts: { issueToken?: boolean } = {}): Promise<FakeRelay> {
    const issueToken = opts.issueToken !== false;

    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/session') {
            const body = issueToken
                ? { code: SESSION_CODE, hostToken: HOST_TOKEN, tunnelProtocolVersion: 1 }
                : { code: SESSION_CODE }; // an older relay: no credential
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
            return;
        }
        res.writeHead(404);
        res.end('not found');
    });

    const wss = new WebSocketServer({ server });
    const relay: FakeRelay = {
        baseUrl: '',
        attaches: [],
        received: [],
        sendPhoneMessage(from, payload) {
            const ws = relay.attaches[relay.attaches.length - 1]?.ws;
            ws?.send(JSON.stringify({ v: 1, type: 'phone:message', from, payload }));
        },
        sendPhoneDisconnect(from) {
            const ws = relay.attaches[relay.attaches.length - 1]?.ws;
            ws?.send(JSON.stringify({ v: 1, type: 'phone:disconnect', from }));
        },
        async waitForAttach(count, timeoutMs = 3000) {
            const deadline = Date.now() + timeoutMs;
            while (relay.attaches.length < count) {
                if (Date.now() > deadline) throw new Error(`timed out waiting for host attach #${count}`);
                await new Promise((r) => setTimeout(r, 20));
            }
            return relay.attaches[count - 1];
        },
        async waitForEnvelope(predicate, timeoutMs = 3000) {
            const deadline = Date.now() + timeoutMs;
            for (;;) {
                const found = relay.received.find(predicate);
                if (found) return found;
                if (Date.now() > deadline) throw new Error('timed out waiting for envelope');
                await new Promise((r) => setTimeout(r, 20));
            }
        },
        close() {
            for (const attach of relay.attaches) attach.ws.close();
            return new Promise<void>((resolve) => {
                wss.close(() => server.close(() => resolve()));
            });
        },
    };

    wss.on('connection', (ws, req) => {
        relay.attaches.push({
            ws,
            authorization: req.headers.authorization,
            url: req.url,
        });
        ws.on('message', (raw: Buffer) => {
            try {
                relay.received.push(JSON.parse(raw.toString('utf-8')));
            } catch {
                relay.received.push(JSON.parse('{"v":0,"type":"unparseable","to":null,"payload":{"type":"?"}}'));
            }
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    relay.baseUrl = `http://127.0.0.1:${port}`;
    return relay;
}

function makeCallbacks() {
    return {
        onClientJoined: vi.fn(),
        onClientLeft: vi.fn(),
        onReaction: vi.fn(),
        onTimeRequest: vi.fn(),
    } satisfies CompanionServerCallbacks;
}

let relays: FakeRelay[] = [];
let callbacks = makeCallbacks();

beforeEach(async () => {
    callbacks = makeCallbacks();
    await startCompanionServer(callbacks);
});

afterEach(async () => {
    stopCompanionServer();
    for (const relay of relays) await relay.close();
    relays = [];
    vi.restoreAllMocks();
});

async function withRelay(opts?: { issueToken?: boolean }): Promise<FakeRelay> {
    const relay = await createFakeRelay(opts);
    relays.push(relay);
    return relay;
}

/** Join two phones over the tunnel and return their host-side client ids. */
async function joinTwoPhones(relay: FakeRelay) {
    relay.sendPhoneMessage('phone-1', { type: 'join', displayName: 'Ada' });
    relay.sendPhoneMessage('phone-2', { type: 'join', displayName: 'Bela' });
    await vi.waitFor(() => expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2));
    return {
        ada: callbacks.onClientJoined.mock.calls[0][0] as { id: string; displayName: string },
        bela: callbacks.onClientJoined.mock.calls[1][0] as { id: string; displayName: string },
    };
}

describe('relay tunnel — host credential', () => {
    it('presents the minted credential as a bearer header, never in the URL', async () => {
        const relay = await withRelay();

        const info = await startRelayTunnel(relay.baseUrl);
        const attach = await relay.waitForAttach(1);

        expect(attach.authorization).toBe(`Bearer ${HOST_TOKEN}`);
        expect(attach.url).toBe(`/host/${SESSION_CODE}`);
        expect(attach.url).not.toContain(HOST_TOKEN);
        expect(info.relayUrl).not.toContain(HOST_TOKEN);
        expect(info.relayUrl).toBe(`${relay.baseUrl}/s/${SESSION_CODE}`);
    });

    it('fails closed when the relay mints no credential', async () => {
        const relay = await withRelay({ issueToken: false });

        await expect(startRelayTunnel(relay.baseUrl)).rejects.toThrow(/older/i);
        expect(relay.attaches).toHaveLength(0);
        expect(isRelayTunnelActive()).toBe(false);
    });

    it('names the relay/app mismatch in the version-skew error', async () => {
        const relay = await withRelay({ issueToken: false });

        await expect(startRelayTunnel(relay.baseUrl)).rejects.toThrow(
            /did not issue a host credential/i,
        );
    });

    it('re-attaches with the credential after a transport drop', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        const first = await relay.waitForAttach(1);

        // Simulate a transport drop (no application close code).
        first.ws.close();

        const second = await relay.waitForAttach(2, 5000);
        expect(second.authorization).toBe(`Bearer ${HOST_TOKEN}`);
        expect(isRelayTunnelActive()).toBe(true);
    }, 10_000);

    it('stops retrying when the relay rejects the credential', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        const first = await relay.waitForAttach(1);

        first.ws.close(4003, 'Unauthorized');

        await new Promise((r) => setTimeout(r, 2000));
        expect(relay.attaches).toHaveLength(1);
        expect(isRelayTunnelActive()).toBe(false);
    }, 10_000);
});

describe('relay tunnel — per-phone addressing', () => {
    it('attributes reactions and time requests to the phone that sent them', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        const { ada, bela } = await joinTwoPhones(relay);
        expect(ada.id).not.toBe(bela.id);
        expect(ada.displayName).toBe('Ada');
        expect(bela.displayName).toBe('Bela');

        relay.sendPhoneMessage('phone-2', { type: 'time-request', trackId: 't1' });
        await vi.waitFor(() => expect(callbacks.onTimeRequest).toHaveBeenCalledTimes(1));
        expect(callbacks.onTimeRequest).toHaveBeenCalledWith(bela.id, 'Bela', 't1');

        relay.sendPhoneMessage('phone-1', { type: 'reaction', emoji: '🔥', trackId: 't1' });
        await vi.waitFor(() => expect(callbacks.onReaction).toHaveBeenCalledTimes(1));
        expect(callbacks.onReaction).toHaveBeenCalledWith(ada.id, 'Ada', '🔥', 't1');
    });

    it('addresses a time-request ack to the requesting phone only', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        const { bela } = await joinTwoPhones(relay);

        sendTimeRequestAck(bela.id, 'granted');

        const ack = await relay.waitForEnvelope((e) => e.payload.type === 'time-request:ack');
        expect(ack.to).toBe('phone-2');
        expect(ack.payload).toEqual({ type: 'time-request:ack', data: { status: 'granted' } });

        // Exactly one ack on the wire, addressed — never a fan-out.
        const acks = relay.received.filter((e) => e.payload?.type === 'time-request:ack');
        expect(acks).toHaveLength(1);
    });

    it('fans state pushes out to every phone (to: null)', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        pushTurnUpdate({ currentTurn: 3, effectiveTurnIndex: 3, mode: 'round-robin' });

        const turn = await relay.waitForEnvelope((e) => e.payload.type === 'turn:update');
        expect(turn.to).toBeNull();
    });

    it('ignores relay phone traffic that arrives before a join', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        relay.sendPhoneMessage('phone-9', { type: 'time-request', trackId: 't1' });
        await new Promise((r) => setTimeout(r, 100));

        expect(callbacks.onTimeRequest).not.toHaveBeenCalled();
    });

    it('drops relay frames that are not v1 envelopes', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        const attach = await relay.waitForAttach(1);

        // Pre-v1 wire format: a bare phone message with no envelope.
        attach.ws.send(JSON.stringify({ type: 'join', displayName: 'Impostor' }));
        await new Promise((r) => setTimeout(r, 100));

        expect(callbacks.onClientJoined).not.toHaveBeenCalled();
    });
});

describe('relay tunnel — client bookkeeping', () => {
    it('counts tunnelled phones as connected clients', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        expect(getCompanionServerInfo()?.connectedClients).toBe(0);
        await joinTwoPhones(relay);
        expect(getCompanionServerInfo()?.connectedClients).toBe(2);
    });

    it('fires onClientLeft when a tunnelled phone disconnects', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        const { ada } = await joinTwoPhones(relay);
        relay.sendPhoneDisconnect('phone-1');

        await vi.waitFor(() => expect(callbacks.onClientLeft).toHaveBeenCalledTimes(1));
        expect(callbacks.onClientLeft.mock.calls[0][0]).toMatchObject({ id: ada.id, displayName: 'Ada' });
        expect(getCompanionServerInfo()?.connectedClients).toBe(1);
    });
});

describe('LAN clients', () => {
    /** Connect a real phone WebSocket to the in-process companion server. */
    async function connectLanPhone(displayName: string) {
        const info = getCompanionServerInfo();
        const ws = new WebSocket(`ws://127.0.0.1:${info!.port}/ws`);
        const messages: Array<{ type: string; data?: unknown }> = [];
        ws.on('message', (raw: Buffer) => messages.push(JSON.parse(raw.toString('utf-8'))));
        await new Promise<void>((resolve, reject) => {
            ws.once('open', () => resolve());
            ws.once('error', reject);
        });
        ws.send(JSON.stringify({ type: 'join', displayName }));
        return { ws, messages };
    }

    it('still delivers a time-request ack to the requesting LAN client only', async () => {
        const one = await connectLanPhone('Ada');
        const two = await connectLanPhone('Bela');

        await vi.waitFor(() => expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2));
        const ada = callbacks.onClientJoined.mock.calls[0][0] as { id: string };

        one.ws.send(JSON.stringify({ type: 'time-request', trackId: 't1' }));
        await vi.waitFor(() => expect(callbacks.onTimeRequest).toHaveBeenCalledTimes(1));

        sendTimeRequestAck(ada.id, 'seen');

        await vi.waitFor(() =>
            expect(one.messages.some((m) => m.type === 'time-request:ack')).toBe(true),
        );
        expect(two.messages.some((m) => m.type === 'time-request:ack')).toBe(false);

        one.ws.close();
        two.ws.close();
    });
});

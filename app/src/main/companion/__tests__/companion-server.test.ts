/**
 * Companion server — relay tunnel authentication and per-phone addressing.
 *
 * These are integration tests: they stand up a fake relay (HTTP + WS) on
 * localhost and drive the real `companion-server` module against it, because
 * the behaviour under test lives entirely in the wire handshake.
 *
 * This owns the *host* end of the companion contract: the real app-side server,
 * with the relay faked. The relay end — the real tunnel, with the host and the
 * phone faked — is `relay/__tests__/companion-tunnel.test.mjs`. The overlap is
 * deliberate: each file asserts the side it actually runs, so a wire-format
 * change has to be made true twice, once from each direction.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import {
    startCompanionServer,
    stopCompanionServer,
    startRelayTunnel,
    isRelayTunnelActive,
    getCompanionServerInfo,
    sendTimeRequestAck,
    pushTurnUpdate,
    pushSessionSnapshot,
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
    received: Array<{
        v: number;
        type: string;
        to: string | null;
        payload: { type: string; data?: unknown };
    }>;
    sendPhoneMessage(from: string, payload: unknown): void;
    sendPhoneDisconnect(from: string): void;
    waitForAttach(count: number, timeoutMs?: number): Promise<HostAttach>;
    waitForEnvelope(
        predicate: (e: {
            type: string;
            to: string | null;
            payload: { type: string };
        }) => boolean,
        timeoutMs?: number,
    ): Promise<{
        to: string | null;
        payload: { type: string; data?: unknown };
    }>;
    close(): Promise<void>;
}

async function createFakeRelay(
    opts: { issueToken?: boolean } = {},
): Promise<FakeRelay> {
    const issueToken = opts.issueToken !== false;

    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/session') {
            const body = issueToken
                ? {
                      code: SESSION_CODE,
                      hostToken: HOST_TOKEN,
                      tunnelProtocolVersion: 1,
                  }
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
            ws?.send(
                JSON.stringify({ v: 1, type: 'phone:message', from, payload }),
            );
        },
        sendPhoneDisconnect(from) {
            const ws = relay.attaches[relay.attaches.length - 1]?.ws;
            ws?.send(JSON.stringify({ v: 1, type: 'phone:disconnect', from }));
        },
        async waitForAttach(count, timeoutMs = 3000) {
            const deadline = Date.now() + timeoutMs;
            while (relay.attaches.length < count) {
                if (Date.now() > deadline)
                    throw new Error(
                        `timed out waiting for host attach #${count}`,
                    );
                await new Promise((r) => setTimeout(r, 20));
            }
            return relay.attaches[count - 1];
        },
        async waitForEnvelope(predicate, timeoutMs = 3000) {
            const deadline = Date.now() + timeoutMs;
            for (;;) {
                const found = relay.received.find(predicate);
                if (found) return found;
                if (Date.now() > deadline)
                    throw new Error('timed out waiting for envelope');
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
                relay.received.push(
                    JSON.parse(
                        '{"v":0,"type":"unparseable","to":null,"payload":{"type":"?"}}',
                    ),
                );
            }
        });
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve()),
    );
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
/** The session-scoped join PIN minted by the server under test. */
let joinPin = '';

beforeEach(async () => {
    callbacks = makeCallbacks();
    ({ joinPin } = await startCompanionServer(callbacks));
});

afterEach(async () => {
    stopCompanionServer();
    for (const relay of relays) await relay.close();
    relays = [];
    vi.useRealTimers();
    vi.restoreAllMocks();
});

async function withRelay(opts?: { issueToken?: boolean }): Promise<FakeRelay> {
    const relay = await createFakeRelay(opts);
    relays.push(relay);
    return relay;
}

interface LanPhone {
    ws: WebSocket;
    messages: Array<{ type: string; data?: Record<string, unknown> }>;
    /**
     * Resolves with the first buffered message of the given type. Clear
     * `messages` before a second round trip to wait for a *fresh* one.
     */
    next(
        type: string,
        timeoutMs?: number,
    ): Promise<{ type: string; data?: Record<string, unknown> }>;
    join(
        displayName: string,
        opts?: { pin?: string; reconnectToken?: string | null },
    ): void;
}

/** Connect a real phone WebSocket to the in-process companion server. */
async function connectLanPhone(): Promise<LanPhone> {
    const info = getCompanionServerInfo();
    const ws = new WebSocket(`ws://127.0.0.1:${info!.port}/ws`);
    const messages: LanPhone['messages'] = [];
    ws.on('message', (raw: Buffer) =>
        messages.push(JSON.parse(raw.toString('utf-8'))),
    );
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });

    const phone: LanPhone = {
        ws,
        messages,
        async next(type, timeoutMs = 3000) {
            const deadline = Date.now() + timeoutMs;
            for (;;) {
                const found = messages.find((m) => m.type === type);
                if (found) return found;
                if (Date.now() > deadline)
                    throw new Error(`timed out waiting for ${type}`);
                await new Promise((r) => setTimeout(r, 10));
            }
        },
        join(displayName, opts = {}) {
            ws.send(
                JSON.stringify({
                    type: 'join',
                    displayName,
                    pin: opts.pin ?? joinPin,
                    reconnectToken: opts.reconnectToken ?? null,
                }),
            );
        },
    };
    return phone;
}

/** Join two phones over the tunnel and return their host-side client ids. */
async function joinTwoPhones(relay: FakeRelay) {
    relay.sendPhoneMessage('phone-1', {
        type: 'join',
        displayName: 'Ada',
        pin: joinPin,
    });
    relay.sendPhoneMessage('phone-2', {
        type: 'join',
        displayName: 'Bela',
        pin: joinPin,
    });
    await vi.waitFor(() =>
        expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
    );
    return {
        ada: callbacks.onClientJoined.mock.calls[0][0] as {
            id: string;
            displayName: string;
        },
        bela: callbacks.onClientJoined.mock.calls[1][0] as {
            id: string;
            displayName: string;
        },
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
        expect(info.relayUrl).toBe(
            `${relay.baseUrl}/s/${SESSION_CODE}#pin=${joinPin}`,
        );
    });

    it('carries the join PIN as a fragment, so the relay never receives it', async () => {
        const relay = await withRelay();

        const info = await startRelayTunnel(relay.baseUrl);

        // Everything before '#' is what a server would see in its access log.
        const [serverVisible, fragment] = info.relayUrl.split('#');
        expect(serverVisible).toBe(`${relay.baseUrl}/s/${SESSION_CODE}`);
        expect(fragment).toBe(`pin=${joinPin}`);
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

        relay.sendPhoneMessage('phone-2', {
            type: 'time-request',
            trackId: 't1',
        });
        await vi.waitFor(() =>
            expect(callbacks.onTimeRequest).toHaveBeenCalledTimes(1),
        );
        expect(callbacks.onTimeRequest).toHaveBeenCalledWith(
            bela.id,
            'Bela',
            't1',
        );

        relay.sendPhoneMessage('phone-1', {
            type: 'reaction',
            emoji: '🔥',
            trackId: 't1',
        });
        await vi.waitFor(() =>
            expect(callbacks.onReaction).toHaveBeenCalledTimes(1),
        );
        expect(callbacks.onReaction).toHaveBeenCalledWith(
            ada.id,
            'Ada',
            '🔥',
            't1',
        );
    });

    it('addresses a time-request ack to the requesting phone only', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        const { bela } = await joinTwoPhones(relay);

        sendTimeRequestAck(bela.id, 'granted');

        const ack = await relay.waitForEnvelope(
            (e) => e.payload.type === 'time-request:ack',
        );
        expect(ack.to).toBe('phone-2');
        expect(ack.payload).toEqual({
            type: 'time-request:ack',
            data: { status: 'granted' },
        });

        // Exactly one ack on the wire, addressed — never a fan-out.
        const acks = relay.received.filter(
            (e) => e.payload?.type === 'time-request:ack',
        );
        expect(acks).toHaveLength(1);
    });

    it('fans state pushes out to every phone (to: null)', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        pushTurnUpdate({
            currentTurn: 3,
            effectiveTurnIndex: 3,
            mode: 'round-robin',
        });

        const turn = await relay.waitForEnvelope(
            (e) => e.payload.type === 'turn:update',
        );
        expect(turn.to).toBeNull();
    });

    it('ignores relay phone traffic that arrives before a join', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        relay.sendPhoneMessage('phone-9', {
            type: 'time-request',
            trackId: 't1',
        });
        await new Promise((r) => setTimeout(r, 100));

        expect(callbacks.onTimeRequest).not.toHaveBeenCalled();
    });

    it('drops relay frames that are not v1 envelopes', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        const attach = await relay.waitForAttach(1);

        // Pre-v1 wire format: a bare phone message with no envelope.
        attach.ws.send(
            JSON.stringify({ type: 'join', displayName: 'Impostor' }),
        );
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

        await vi.waitFor(() =>
            expect(callbacks.onClientLeft).toHaveBeenCalledTimes(1),
        );
        expect(callbacks.onClientLeft.mock.calls[0][0]).toMatchObject({
            id: ada.id,
            displayName: 'Ada',
        });
        expect(getCompanionServerInfo()?.connectedClients).toBe(1);
    });
});

describe('LAN clients', () => {
    it('still delivers a time-request ack to the requesting LAN client only', async () => {
        const one = await connectLanPhone();
        const two = await connectLanPhone();
        one.join('Ada');
        two.join('Bela');

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const ada = callbacks.onClientJoined.mock.calls[0][0] as { id: string };

        one.ws.send(JSON.stringify({ type: 'time-request', trackId: 't1' }));
        await vi.waitFor(() =>
            expect(callbacks.onTimeRequest).toHaveBeenCalledTimes(1),
        );

        sendTimeRequestAck(ada.id, 'seen');

        await vi.waitFor(() =>
            expect(
                one.messages.some((m) => m.type === 'time-request:ack'),
            ).toBe(true),
        );
        expect(two.messages.some((m) => m.type === 'time-request:ack')).toBe(
            false,
        );

        one.ws.close();
        two.ws.close();
    });

    it('serves the phone client uncacheable, so a stale build cannot lock a phone out', async () => {
        // Under vitest neither the dev nor the packaged path resolves, so point
        // the "packaged resources" branch at the real companion-web directory.
        const proc = process as NodeJS.Process & { resourcesPath?: string };
        const previous = proc.resourcesPath;
        proc.resourcesPath = path.resolve(__dirname, '..', '..', '..');

        try {
            const info = getCompanionServerInfo();
            const res = await fetch(
                `http://127.0.0.1:${info!.port}/companion.js`,
            );

            expect(res.status).toBe(200);
            expect(res.headers.get('cache-control')).toBe('no-store');
        } finally {
            proc.resourcesPath = previous;
        }
    });
});

describe('participant credential — join PIN', () => {
    it('mints a 4-character PIN over the ambiguity-free alphabet', () => {
        expect(joinPin).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
        expect(getCompanionServerInfo()?.joinPin).toBe(joinPin);
    });

    it('refuses a LAN join with no PIN and says why', async () => {
        const phone = await connectLanPhone();
        phone.ws.send(JSON.stringify({ type: 'join', displayName: 'Mallory' }));

        const denied = await phone.next('join:denied');
        expect(denied.data).toMatchObject({ reason: 'invalid-pin' });
        expect(phone.messages.some((m) => m.type === 'join:ack')).toBe(false);
        expect(callbacks.onClientJoined).not.toHaveBeenCalled();
        expect(getCompanionServerInfo()?.connectedClients).toBe(0);

        phone.ws.close();
    });

    it('refuses a LAN join with the wrong PIN', async () => {
        const phone = await connectLanPhone();
        phone.join('Mallory', { pin: joinPin === 'AAAA' ? 'BBBB' : 'AAAA' });

        const denied = await phone.next('join:denied');
        expect(denied.data).toMatchObject({ reason: 'invalid-pin' });
        expect(callbacks.onClientJoined).not.toHaveBeenCalled();

        phone.ws.close();
    });

    it('accepts the PIN case-insensitively and with stray whitespace', async () => {
        const phone = await connectLanPhone();
        phone.join('Ada', { pin: ` ${joinPin.toLowerCase()} ` });

        await phone.next('join:ack');
        expect(callbacks.onClientJoined).toHaveBeenCalledTimes(1);

        phone.ws.close();
    });

    it('refuses a relay join with no PIN, addressed to that phone alone', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        relay.sendPhoneMessage('phone-7', {
            type: 'join',
            displayName: 'Mallory',
        });

        const denial = await relay.waitForEnvelope(
            (e) => e.payload.type === 'join:denied',
        );
        expect(denial.to).toBe('phone-7');
        expect(denial.payload.data).toMatchObject({ reason: 'invalid-pin' });
        expect(callbacks.onClientJoined).not.toHaveBeenCalled();
        expect(getCompanionServerInfo()?.connectedClients).toBe(0);
    });

    it('never tells a phone it is the host, even when it types the host name', async () => {
        pushSessionSnapshot({
            sessionName: 'Party',
            playback: {
                isPlaying: false,
                trackId: null,
                progressMs: 0,
                durationMs: 0,
                title: null,
                artists: [],
                albumArtUrl: null,
            },
            tracks: [],
            participants: [
                {
                    id: 'u1',
                    displayName: 'Ada',
                    avatarUrl: null,
                    isHost: true,
                    isCoHost: false,
                },
            ],
            turn: { currentTurn: null, effectiveTurnIndex: null, mode: null },
        });

        const phone = await connectLanPhone();
        phone.join('ada'); // the host's display name, lower-cased

        const ack = await phone.next('join:ack');
        expect(ack.data).not.toHaveProperty('isHost');
        expect(typeof ack.data?.reconnectToken).toBe('string');

        phone.ws.close();
    });
});

describe('participant credential — join lockout', () => {
    /** Burn attempts with a PIN that is guaranteed wrong. */
    const wrongPin = () => (joinPin === 'AAAA' ? 'BBBB' : 'AAAA');

    async function burnAttempts(count: number) {
        const phone = await connectLanPhone();
        for (let i = 0; i < count; i++) {
            phone.messages.length = 0;
            phone.join('Mallory', { pin: wrongPin() });
            await phone.next('join:denied');
        }
        return phone;
    }

    it('locks joins out after ten wrong PINs — even for the correct one', async () => {
        const attacker = await burnAttempts(10);
        expect(attacker.messages.at(-1)?.data).toMatchObject({
            reason: 'locked-out',
        });

        const honest = await connectLanPhone();
        honest.join('Ada');

        const denied = await honest.next('join:denied');
        expect(denied.data).toMatchObject({ reason: 'locked-out' });
        expect(typeof denied.data?.retryAfterMs).toBe('number');
        expect(callbacks.onClientJoined).not.toHaveBeenCalled();

        attacker.ws.close();
        honest.ws.close();
    });

    it('lets joins through again once the lockout window passes', async () => {
        const attacker = await burnAttempts(10);
        attacker.ws.close();

        // Only Date is faked: the real socket timers keep running.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 61_000);

        const honest = await connectLanPhone();
        honest.join('Ada');
        const ack = await honest.next('join:ack');

        expect(typeof ack.data?.reconnectToken).toBe('string');
        honest.ws.close();
    });

    it('lets an already-joined phone reconnect through a lockout it did not cause', async () => {
        const first = await connectLanPhone();
        first.join('Ada');
        const ack = await first.next('join:ack');
        const token = ack.data?.reconnectToken as string;
        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(1),
        );
        const original = callbacks.onClientJoined.mock.calls[0][0] as {
            id: string;
        };

        // Ada's socket drops the way mobile sockets do, and *another* guest
        // fat-fingers the PIN until joins freeze while she is away.
        first.ws.close();
        await vi.waitFor(() =>
            expect(callbacks.onClientLeft).toHaveBeenCalledTimes(1),
        );
        const attacker = await burnAttempts(10);

        const again = await connectLanPhone();
        again.join('Ada', { reconnectToken: token });
        await again.next('join:ack');

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const returning = callbacks.onClientJoined.mock.calls[1][0] as {
            id: string;
        };
        expect(returning.id).toBe(original.id);
        expect(again.messages.some((m) => m.type === 'join:denied')).toBe(
            false,
        );

        attacker.ws.close();
        again.ws.close();
    });

    it('exempts a live token holder from the lockout on a fresh socket', async () => {
        const first = await connectLanPhone();
        first.join('Ada');
        const ack = await first.next('join:ack');
        const token = ack.data?.reconnectToken as string;

        const attacker = await burnAttempts(10);

        // The old socket is still open (the server has not reaped it yet) —
        // the identity is looked up in `clients`, not the grace list.
        const again = await connectLanPhone();
        again.join('Ada', { reconnectToken: token });
        const reAck = await again.next('join:ack');
        expect(reAck.data?.reconnectToken).toBe(token);

        attacker.ws.close();
        again.ws.close();
    });

    it('still locks out a stranger who presents a bogus reconnect token', async () => {
        const attacker = await burnAttempts(10);

        const stranger = await connectLanPhone();
        stranger.join('Mallory', { reconnectToken: 'f'.repeat(32) });
        const denied = await stranger.next('join:denied');
        expect(denied.data).toMatchObject({ reason: 'locked-out' });
        expect(callbacks.onClientJoined).not.toHaveBeenCalled();

        attacker.ws.close();
        stranger.ws.close();
    });

    it('lets a relay phone reconnect on a new slot through a lockout', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        relay.sendPhoneMessage('phone-1', {
            type: 'join',
            displayName: 'Ada',
            pin: joinPin,
        });
        const ack = await relay.waitForEnvelope(
            (e) => e.payload.type === 'join:ack',
        );
        const token = (ack.payload.data as { reconnectToken: string })
            .reconnectToken;
        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(1),
        );
        const original = callbacks.onClientJoined.mock.calls[0][0] as {
            id: string;
        };

        const attacker = await burnAttempts(10);

        relay.received.length = 0;
        relay.sendPhoneMessage('phone-2', {
            type: 'join',
            displayName: 'Ada',
            pin: joinPin,
            reconnectToken: token,
        });
        await relay.waitForEnvelope((e) => e.payload.type === 'join:ack');

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const returning = callbacks.onClientJoined.mock.calls[1][0] as {
            id: string;
        };
        expect(returning.id).toBe(original.id);
        expect(
            relay.received.some((e) => e.payload.type === 'join:denied'),
        ).toBe(false);

        attacker.ws.close();
    });

    it('resets the failure count on a successful join', async () => {
        const attacker = await burnAttempts(9);

        const honest = await connectLanPhone();
        honest.join('Ada');
        await honest.next('join:ack');

        // Without the reset, one more wrong PIN would trip the lockout.
        attacker.messages.length = 0;
        attacker.join('Mallory', { pin: wrongPin() });
        const denied = await attacker.next('join:denied');
        expect(denied.data).toMatchObject({ reason: 'invalid-pin' });

        attacker.ws.close();
        honest.ws.close();
    });
});

describe('participant identity — reconnect token', () => {
    it('gives a returning LAN phone its own identity back', async () => {
        const first = await connectLanPhone();
        first.join('Ada');
        const ack = await first.next('join:ack');
        const token = ack.data?.reconnectToken as string;

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(1),
        );
        const original = callbacks.onClientJoined.mock.calls[0][0] as {
            id: string;
        };

        first.ws.close();

        const again = await connectLanPhone();
        again.join('Ada', { reconnectToken: token });
        await again.next('join:ack');

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const returning = callbacks.onClientJoined.mock.calls[1][0] as {
            id: string;
        };
        expect(returning.id).toBe(original.id);
        expect(getCompanionServerInfo()?.connectedClients).toBe(1);

        again.ws.close();
    });

    it('gives a second guest with the same name a distinct identity', async () => {
        const one = await connectLanPhone();
        one.join('Sam');
        await one.next('join:ack');

        const two = await connectLanPhone();
        two.join('Sam'); // same name, no token
        await two.next('join:ack');

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const [first, second] = callbacks.onClientJoined.mock.calls.map(
            (c) => c[0] as { id: string; displayName: string },
        );
        expect(first.id).not.toBe(second.id);
        expect(second.displayName).toBe('Sam');
        expect(getCompanionServerInfo()?.connectedClients).toBe(2);

        one.ws.close();
        two.ws.close();
    });

    it('will not let a LAN client adopt a relay-tunnelled phone identity', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        relay.sendPhoneMessage('phone-1', {
            type: 'join',
            displayName: 'Ada',
            pin: joinPin,
        });
        const ack = await relay.waitForEnvelope(
            (e) => e.payload.type === 'join:ack',
        );
        const relayToken = (ack.payload.data as { reconnectToken: string })
            .reconnectToken;

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(1),
        );
        const relayClient = callbacks.onClientJoined.mock.calls[0][0] as {
            id: string;
        };

        // Same name, and the relay phone's own token — still a different device.
        const impostor = await connectLanPhone();
        impostor.join('Ada', { reconnectToken: relayToken });
        await impostor.next('join:ack');

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const lanClient = callbacks.onClientJoined.mock.calls[1][0] as {
            id: string;
        };
        expect(lanClient.id).not.toBe(relayClient.id);
        expect(getCompanionServerInfo()?.connectedClients).toBe(2);

        // The relay phone still owns its slot: its ack is still routed to it.
        sendTimeRequestAck(relayClient.id, 'granted');
        const relayAck = await relay.waitForEnvelope(
            (e) => e.payload.type === 'time-request:ack',
        );
        expect(relayAck.to).toBe('phone-1');

        impostor.ws.close();
    });

    it('will not let a relay-tunnelled phone adopt a LAN client identity', async () => {
        const lan = await connectLanPhone();
        lan.join('Ada');
        const ack = await lan.next('join:ack');
        const lanToken = ack.data?.reconnectToken as string;
        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(1),
        );
        const lanClient = callbacks.onClientJoined.mock.calls[0][0] as {
            id: string;
        };

        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        // The mirror of the LAN→relay case: transport binding cuts both ways.
        relay.sendPhoneMessage('phone-1', {
            type: 'join',
            displayName: 'Ada',
            pin: joinPin,
            reconnectToken: lanToken,
        });
        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const relayClient = callbacks.onClientJoined.mock.calls[1][0] as {
            id: string;
        };

        expect(relayClient.id).not.toBe(lanClient.id);
        expect(getCompanionServerInfo()?.connectedClients).toBe(2);

        lan.ws.close();
    });

    it('keeps a relay phone identity across a reconnect on a new phone id', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        relay.sendPhoneMessage('phone-1', {
            type: 'join',
            displayName: 'Ada',
            pin: joinPin,
        });
        const ack = await relay.waitForEnvelope(
            (e) => e.payload.type === 'join:ack',
        );
        const token = (ack.payload.data as { reconnectToken: string })
            .reconnectToken;

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(1),
        );
        const original = callbacks.onClientJoined.mock.calls[0][0] as {
            id: string;
        };

        // The relay hands a reconnecting phone a brand-new slot.
        relay.sendPhoneMessage('phone-2', {
            type: 'join',
            displayName: 'Ada',
            pin: joinPin,
            reconnectToken: token,
        });
        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const returning = callbacks.onClientJoined.mock.calls[1][0] as {
            id: string;
        };

        expect(returning.id).toBe(original.id);
        expect(getCompanionServerInfo()?.connectedClients).toBe(1);

        // Traffic and acks follow the phone to its new slot…
        relay.sendPhoneMessage('phone-2', {
            type: 'time-request',
            trackId: 't1',
        });
        await vi.waitFor(() =>
            expect(callbacks.onTimeRequest).toHaveBeenCalledTimes(1),
        );
        expect(callbacks.onTimeRequest).toHaveBeenCalledWith(
            original.id,
            'Ada',
            't1',
        );

        sendTimeRequestAck(original.id, 'granted');
        const routed = await relay.waitForEnvelope(
            (e) => e.payload.type === 'time-request:ack',
        );
        expect(routed.to).toBe('phone-2');

        // …and the late disconnect for the abandoned slot drops nobody.
        relay.sendPhoneDisconnect('phone-1');
        await new Promise((r) => setTimeout(r, 100));
        expect(callbacks.onClientLeft).not.toHaveBeenCalled();
        expect(getCompanionServerInfo()?.connectedClients).toBe(1);
    });

    it('restores a relay phone identity after a full disconnect', async () => {
        const relay = await withRelay();
        await startRelayTunnel(relay.baseUrl);
        await relay.waitForAttach(1);

        relay.sendPhoneMessage('phone-1', {
            type: 'join',
            displayName: 'Ada',
            pin: joinPin,
        });
        const ack = await relay.waitForEnvelope(
            (e) => e.payload.type === 'join:ack',
        );
        const token = (ack.payload.data as { reconnectToken: string })
            .reconnectToken;
        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(1),
        );
        const original = callbacks.onClientJoined.mock.calls[0][0] as {
            id: string;
        };

        // The tunnel notices the drop first — the roster must not keep a ghost.
        relay.sendPhoneDisconnect('phone-1');
        await vi.waitFor(() =>
            expect(callbacks.onClientLeft).toHaveBeenCalledTimes(1),
        );
        expect(getCompanionServerInfo()?.connectedClients).toBe(0);

        relay.sendPhoneMessage('phone-2', {
            type: 'join',
            displayName: 'Ada',
            pin: joinPin,
            reconnectToken: token,
        });
        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const returning = callbacks.onClientJoined.mock.calls[1][0] as {
            id: string;
        };

        expect(returning.id).toBe(original.id);
        expect(getCompanionServerInfo()?.connectedClients).toBe(1);
    });

    it('gives a returning phone with no token a fresh identity', async () => {
        const first = await connectLanPhone();
        first.join('Ada');
        await first.next('join:ack');
        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(1),
        );
        const original = callbacks.onClientJoined.mock.calls[0][0] as {
            id: string;
        };

        first.ws.close();
        await vi.waitFor(() =>
            expect(callbacks.onClientLeft).toHaveBeenCalledTimes(1),
        );

        // Same display name, no credential — a different participant.
        const second = await connectLanPhone();
        second.join('Ada');
        await second.next('join:ack');

        await vi.waitFor(() =>
            expect(callbacks.onClientJoined).toHaveBeenCalledTimes(2),
        );
        const fresh = callbacks.onClientJoined.mock.calls[1][0] as {
            id: string;
        };
        expect(fresh.id).not.toBe(original.id);

        second.ws.close();
    });
});

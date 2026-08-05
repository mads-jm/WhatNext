/**
 * Companion tunnel — host authentication and per-phone addressing.
 *
 * Run by the app's vitest project (see app/vitest.config.ts `include`), which
 * is why this file lives beside the relay source but has no runner of its own.
 * The tunnel module is a singleton, so the suite starts it once on an
 * OS-assigned port and drives it with real WebSocket clients.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import {
    startCompanionTunnel,
    stopCompanionTunnel,
} from '../companion-tunnel.mjs';

const TUNNEL_PROTOCOL_VERSION = 1;

let port;
let baseUrl;
let wsBase;

/** Sockets opened by a test, closed after it. */
let openSockets = [];

beforeAll(async () => {
    ({ port } = await startCompanionTunnel(0));
    baseUrl = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
});

afterAll(() => {
    stopCompanionTunnel();
});

// ---- helpers ----

async function createSession() {
    const res = await fetch(`${baseUrl}/session`, { method: 'POST' });
    expect(res.ok).toBe(true);
    return res.json();
}

function track(ws) {
    openSockets.push(ws);
    return ws;
}

function waitOpen(ws) {
    return new Promise((resolve, reject) => {
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
}

function waitClose(ws, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('timed out waiting for close')),
            timeoutMs,
        );
        ws.once('close', (code, reason) => {
            clearTimeout(timer);
            resolve({ code, reason: reason.toString('utf-8') });
        });
    });
}

function nextMessage(ws, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.off('message', onMessage);
            reject(new Error('timed out waiting for message'));
        }, timeoutMs);
        const onMessage = (raw) => {
            clearTimeout(timer);
            ws.off('message', onMessage);
            resolve(JSON.parse(raw.toString('utf-8')));
        };
        ws.on('message', onMessage);
    });
}

/** Resolves true when nothing arrives within the window. */
function expectSilence(ws, windowMs = 250) {
    return new Promise((resolve) => {
        let quiet = true;
        const onMessage = () => {
            quiet = false;
        };
        ws.on('message', onMessage);
        setTimeout(() => {
            ws.off('message', onMessage);
            resolve(quiet);
        }, windowMs);
    });
}

async function connectHost(code, token) {
    const ws = track(
        new WebSocket(`${wsBase}/host/${code}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
    );
    await waitOpen(ws);
    return ws;
}

async function connectPhone(code) {
    const ws = track(new WebSocket(`${wsBase}/ws/${code}`));
    await waitOpen(ws);
    return ws;
}

function hostFrame(to, payload) {
    return JSON.stringify({
        v: TUNNEL_PROTOCOL_VERSION,
        type: 'host:message',
        to,
        payload,
    });
}

/** Have a phone speak so the host learns its relay-assigned id. */
async function introducePhone(host, phone, displayName) {
    phone.send(JSON.stringify({ type: 'join', displayName }));
    const envelope = await nextMessage(host);
    expect(envelope.type).toBe('phone:message');
    return envelope.from;
}

afterEach(() => {
    for (const ws of openSockets) {
        if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
        ) {
            ws.close();
        }
    }
    openSockets = [];
});

describe('companion tunnel — session creation', () => {
    it('mints a host token alongside the public session code', async () => {
        const body = await createSession();

        expect(body.code).toMatch(/^[A-Z0-9]{6}$/);
        expect(typeof body.hostToken).toBe('string');
        expect(body.hostToken.length).toBe(64); // 32 bytes hex
        expect(body.tunnelProtocolVersion).toBe(TUNNEL_PROTOCOL_VERSION);
    });

    it('never exposes the host token through the public status endpoint', async () => {
        const { code, hostToken } = await createSession();

        const res = await fetch(`${baseUrl}/session/${code}/status`);
        const text = await res.text();

        expect(text).not.toContain(hostToken);
        expect(JSON.parse(text)).toMatchObject({
            exists: true,
            hostConnected: false,
        });
    });

    it('issues a different token per session', async () => {
        const a = await createSession();
        const b = await createSession();
        expect(a.hostToken).not.toBe(b.hostToken);
    });
});

describe('companion tunnel — static serving', () => {
    it('serves the phone client uncacheable', async () => {
        // A phone holding a stale companion.js sends no join PIN and is refused
        // by the host with no way to self-heal, so these files must not cache.
        const res = await fetch(`${baseUrl}/companion.js`);

        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });
});

describe('companion tunnel — host authentication', () => {
    it('accepts a host presenting the minted credential', async () => {
        const { code, hostToken } = await createSession();
        const host = await connectHost(code, hostToken);
        const phone = await connectPhone(code);

        phone.send(JSON.stringify({ type: 'heartbeat' }));
        const envelope = await nextMessage(host);

        expect(envelope).toMatchObject({
            v: TUNNEL_PROTOCOL_VERSION,
            type: 'phone:message',
            payload: { type: 'heartbeat' },
        });
    });

    it('rejects a host presenting no credential', async () => {
        const { code } = await createSession();
        const impostor = track(new WebSocket(`${wsBase}/host/${code}`));

        const closed = await waitClose(impostor);
        expect(closed.code).toBe(4003);
    });

    it('rejects a host presenting the session code as the credential', async () => {
        const { code } = await createSession();
        const impostor = track(
            new WebSocket(`${wsBase}/host/${code}`, {
                headers: { Authorization: `Bearer ${code}` },
            }),
        );

        const closed = await waitClose(impostor);
        expect(closed.code).toBe(4003);
    });

    it('leaves the attached host untouched when an impostor is rejected', async () => {
        const { code, hostToken } = await createSession();
        const host = await connectHost(code, hostToken);
        const phone = await connectPhone(code);

        const impostor = track(new WebSocket(`${wsBase}/host/${code}`));
        const closed = await waitClose(impostor);
        expect(closed.code).toBe(4003);

        // The legitimate host is still the one wired to the phone…
        phone.send(JSON.stringify({ type: 'heartbeat' }));
        const envelope = await nextMessage(host);
        expect(envelope.payload).toMatchObject({ type: 'heartbeat' });

        // …and the impostor's traffic reaches nobody.
        expect(impostor.readyState).not.toBe(WebSocket.OPEN);
    });

    it('rejects a host for an unknown session before checking credentials', async () => {
        const impostor = track(new WebSocket(`${wsBase}/host/ZZZZZZ`));
        const closed = await waitClose(impostor);
        expect(closed.code).toBe(4001);
    });
});

describe('companion tunnel — per-phone addressing', () => {
    it('tags phone traffic with distinct ids for two phones on one tunnel', async () => {
        const { code, hostToken } = await createSession();
        const host = await connectHost(code, hostToken);
        const phoneA = await connectPhone(code);
        const phoneB = await connectPhone(code);

        const idA = await introducePhone(host, phoneA, 'Ada');
        const idB = await introducePhone(host, phoneB, 'Bela');

        expect(idA).toBeTruthy();
        expect(idB).toBeTruthy();
        expect(idA).not.toBe(idB);
    });

    it('delivers an addressed payload only to the addressed phone', async () => {
        const { code, hostToken } = await createSession();
        const host = await connectHost(code, hostToken);
        const phoneA = await connectPhone(code);
        const phoneB = await connectPhone(code);

        const idA = await introducePhone(host, phoneA, 'Ada');
        await introducePhone(host, phoneB, 'Bela');

        const ack = { type: 'time-request:ack', data: { status: 'granted' } };
        const receivedByA = nextMessage(phoneA);
        const silentB = expectSilence(phoneB);

        host.send(hostFrame(idA, ack));

        expect(await receivedByA).toEqual(ack);
        expect(await silentB).toBe(true);
    });

    it('fans out to every phone when addressed to null', async () => {
        const { code, hostToken } = await createSession();
        const host = await connectHost(code, hostToken);
        const phoneA = await connectPhone(code);
        const phoneB = await connectPhone(code);

        const update = { type: 'turn:update', data: { currentTurn: 2 } };
        const gotA = nextMessage(phoneA);
        const gotB = nextMessage(phoneB);

        host.send(hostFrame(null, update));

        expect(await gotA).toEqual(update);
        expect(await gotB).toEqual(update);
    });

    it('unwraps the envelope so the phone sees plain companion JSON', async () => {
        const { code, hostToken } = await createSession();
        const host = await connectHost(code, hostToken);
        const phone = await connectPhone(code);

        const got = nextMessage(phone);
        host.send(
            hostFrame(null, {
                type: 'playback:update',
                data: { isPlaying: true },
            }),
        );

        const received = await got;
        expect(received.v).toBeUndefined();
        expect(received.type).toBe('playback:update');
    });

    it('tells the host when a tunnelled phone disconnects', async () => {
        const { code, hostToken } = await createSession();
        const host = await connectHost(code, hostToken);
        const phone = await connectPhone(code);

        const phoneId = await introducePhone(host, phone, 'Ada');

        const notified = nextMessage(host);
        phone.close();

        expect(await notified).toEqual({
            v: TUNNEL_PROTOCOL_VERSION,
            type: 'phone:disconnect',
            from: phoneId,
        });
    });

    it('drops unversioned host frames instead of broadcasting them', async () => {
        const { code, hostToken } = await createSession();
        const host = await connectHost(code, hostToken);
        const phone = await connectPhone(code);

        const silent = expectSilence(phone, 300);
        // Pre-v1 wire format: a bare ServerToPhoneMessage with no envelope.
        host.send(
            JSON.stringify({ type: 'turn:update', data: { currentTurn: 1 } }),
        );

        expect(await silent).toBe(true);
    });
});

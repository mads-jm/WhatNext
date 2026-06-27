import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Libp2p } from 'libp2p';
import { RelayManager, nextFallbackAddress } from '../relay-manager';
import { P2P_CONFIG } from '../../shared/p2p-config';

// RelayManager dials via `await import('@multiformats/multiaddr')` (the codebase's
// established dynamic-import pattern for this ESM-only package, mirrored in
// p2p-service.ts). Under fake timers + the concurrent suite, the real module
// loader resolves on a macrotask that `advanceTimersByTimeAsync` doesn't pump, so
// scheduled retries fire before the import settles and dials are missed. Stubbing
// it makes resolution a pure microtask (deterministic) without touching source;
// the stub preserves `toString()` so the dial-target assertions still hold.
vi.mock('@multiformats/multiaddr', () => ({
    multiaddr: (addr: string) => ({ toString: () => addr }),
}));

const ADDR_A = '/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADDR_B = '/ip4/127.0.0.1/tcp/4002/p2p/12D3KooWBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

interface FakeConnection {
    remotePeer: { toString(): string };
    addEventListener(type: 'close', cb: () => void): void;
    _close(): void;
}

function makeConnection(peerId: string): FakeConnection {
    let closeCb: (() => void) | null = null;
    return {
        remotePeer: { toString: () => peerId },
        addEventListener: (_type, cb) => {
            closeCb = cb;
        },
        _close: () => closeCb?.(),
    };
}

interface FakeNode {
    dial: ReturnType<typeof vi.fn>;
    getConnections: ReturnType<typeof vi.fn>;
}

function makeNode(dialImpl: (addr: string) => Promise<FakeConnection>): FakeNode {
    return {
        dial: vi.fn(async (ma: { toString(): string }) => dialImpl(ma.toString())),
        getConnections: vi.fn(() => [] as Array<{ remotePeer: { toString(): string } }>),
    };
}

/**
 * Repeatedly advance fake time past a backoff window and flush microtasks until
 * `predicate` holds or `maxRounds` is reached. Robust against retries that pause
 * on a dynamic `import()` the timer advance can't pump in a single step.
 */
async function advanceUntil(predicate: () => boolean, maxRounds = 12): Promise<void> {
    for (let i = 0; i < maxRounds && !predicate(); i++) {
        await vi.advanceTimersByTimeAsync(P2P_CONFIG.RELAY.RETRY_MAX_DELAY);
        // Each retry awaits `import('@multiformats/multiaddr')`; under fake timers
        // that import job is not pumped by advancing time, so wait for it explicitly
        // (the vitest-documented escape hatch) before checking the predicate again.
        await vi.dynamicImportSettled();
    }
}

describe('nextFallbackAddress', () => {
    it('returns null when there is no alternative', () => {
        expect(nextFallbackAddress([ADDR_A], ADDR_A)).toBeNull();
        expect(nextFallbackAddress([], ADDR_A)).toBeNull();
    });

    it('returns the next address after the failed one', () => {
        expect(nextFallbackAddress([ADDR_A, ADDR_B], ADDR_A)).toBe(ADDR_B);
    });

    it('wraps around the ring', () => {
        expect(nextFallbackAddress([ADDR_A, ADDR_B], ADDR_B)).toBe(ADDR_A);
    });

    it('falls back to the first address when the failed one is unknown', () => {
        expect(nextFallbackAddress([ADDR_A, ADDR_B], 'unknown')).toBe(ADDR_A);
    });
});

describe('RelayManager backoff + reconnect', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('retries a failing relay with backoff (multiple dial attempts)', async () => {
        const node = makeNode(async () => {
            throw new Error('connection refused');
        });
        const mgr = new RelayManager(node as unknown as Libp2p, [ADDR_A], () => {});

        await mgr.connectAll();
        expect(node.dial).toHaveBeenCalledTimes(1);

        // Drive scheduled retries. Each retry awaits a dynamic `import()` whose
        // job the fake-timer advance doesn't deterministically pump, so we POLL:
        // advance past the capped backoff window, flush microtasks, and repeat
        // until a second dial lands (bounded) rather than guessing an iteration
        // count. This is deterministic — the retry WILL eventually fire.
        await advanceUntil(() => node.dial.mock.calls.length > 1);
        expect(node.dial.mock.calls.length).toBeGreaterThan(1);

        mgr.dispose();
    });

    it('falls back to the next relay after exhausting the first', async () => {
        const node = makeNode(async (addr) => {
            if (addr === ADDR_A) throw new Error('A down');
            return makeConnection('relayB-peer');
        });
        const statuses: Array<[boolean, string | null]> = [];
        const mgr = new RelayManager(
            node as unknown as Libp2p,
            [ADDR_A, ADDR_B],
            (connected, ma) => statuses.push([connected, ma])
        );

        await mgr.connectAll();
        // Drive all of A's retries to exhaustion; fallback should then dial B.
        // Poll (see note above) so the dynamic-import-gated retries all settle.
        await advanceUntil(
            () =>
                node.dial.mock.calls.some(
                    (c) => (c[0] as { toString(): string }).toString() === ADDR_B
                ),
            P2P_CONFIG.RELAY.MAX_RETRIES + 4
        );

        const dialedB = node.dial.mock.calls.some(
            (c) => (c[0] as { toString(): string }).toString() === ADDR_B
        );
        expect(dialedB).toBe(true);
        expect(statuses.some(([connected, ma]) => connected && ma === ADDR_B)).toBe(true);

        mgr.dispose();
    });
});

describe('RelayManager heartbeat liveness', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('detects a half-open relay and triggers reconnect', async () => {
        const conn = makeConnection('relayA-peer');
        const node = makeNode(async () => conn);
        const statuses: Array<[boolean, string | null]> = [];
        const mgr = new RelayManager(
            node as unknown as Libp2p,
            [ADDR_A],
            (connected, ma) => statuses.push([connected, ma])
        );

        await mgr.connectAll();
        expect(mgr.currentRelayMultiaddr).toBe(ADDR_A);

        // Node reports the relay peer is NOT among live connections → half-open.
        node.getConnections.mockReturnValue([]);
        const live = mgr.checkRelayLiveness();

        expect(live).toBe(false);
        expect(mgr.currentRelayMultiaddr).toBeNull();
        expect(statuses).toContainEqual([false, null]);

        mgr.dispose();
    });

    it('reports live when the relay peer is still connected', async () => {
        const conn = makeConnection('relayA-peer');
        const node = makeNode(async () => conn);
        const mgr = new RelayManager(node as unknown as Libp2p, [ADDR_A], () => {});

        await mgr.connectAll();
        node.getConnections.mockReturnValue([{ remotePeer: { toString: () => 'relayA-peer' } }]);

        expect(mgr.checkRelayLiveness()).toBe(true);
        expect(mgr.currentRelayMultiaddr).toBe(ADDR_A);

        mgr.dispose();
    });
});

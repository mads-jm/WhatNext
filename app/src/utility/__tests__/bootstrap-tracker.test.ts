import { describe, it, expect } from 'vitest';
import { BootstrapTracker } from '../bootstrap-tracker';

const PEER_A = '12D3KooWSeGgUKtPNVcVy6423yWX4XMqoRoz8fw1jwMRNcpLqSHF';
const PEER_B = '12D3KooWBhvxjLBSVsHVfnkTMKHRJPCPzhbAY9EjqhpczTMvbtMy';

describe('BootstrapTracker', () => {
    it('grants the bootstrap to the first claimer only', () => {
        const tracker = new BootstrapTracker();
        expect(tracker.claim(PEER_A)).toBe(true);
        expect(tracker.claim(PEER_A)).toBe(false);
        expect(tracker.claim(PEER_A)).toBe(false);
    });

    it('deduplicates the both-sides-dial case: two completions, one bootstrap', () => {
        // Both ends dial on peer:connect, so one connection can complete the
        // handshake twice locally (once as dialer, once as responder).
        const tracker = new BootstrapTracker();
        const completions = [PEER_A, PEER_A];
        const bootstraps = completions.filter((p) => tracker.claim(p));
        expect(bootstraps).toEqual([PEER_A]);
    });

    it('tracks peers independently', () => {
        const tracker = new BootstrapTracker();
        expect(tracker.claim(PEER_A)).toBe(true);
        expect(tracker.claim(PEER_B)).toBe(true);
        expect(tracker.claim(PEER_A)).toBe(false);
        expect(tracker.claim(PEER_B)).toBe(false);
    });

    it('re-arms after disconnect so a reconnect bootstraps exactly once again', () => {
        // The guard must not make a reconnected peer look already-handshaked.
        // Silent no-sync is a worse failure than the pull storm it replaces.
        const tracker = new BootstrapTracker();

        expect(tracker.claim(PEER_A)).toBe(true); // first connection
        expect(tracker.claim(PEER_A)).toBe(false);

        tracker.release(PEER_A); // peer:disconnect

        expect(tracker.has(PEER_A)).toBe(false);
        expect(tracker.claim(PEER_A)).toBe(true); // reconnect -> exactly one more
        expect(tracker.claim(PEER_A)).toBe(false);
    });

    it('releasing an unknown peer is a no-op', () => {
        const tracker = new BootstrapTracker();
        expect(() => tracker.release(PEER_B)).not.toThrow();
        expect(tracker.claim(PEER_B)).toBe(true);
    });

    it('clear() re-arms every peer, as on node stop/restart', () => {
        const tracker = new BootstrapTracker();
        tracker.claim(PEER_A);
        tracker.claim(PEER_B);

        tracker.clear();

        expect(tracker.claim(PEER_A)).toBe(true);
        expect(tracker.claim(PEER_B)).toBe(true);
    });
});

/**
 * Replication-bootstrap deduplication, per (peer, connection).
 *
 * A completed handshake triggers `triggerInitialReplication` — one pull-request
 * per session collection. That must happen exactly ONCE per connection:
 *  - Before #58, the reply-on-a-new-stream handshake loop re-fired the completion
 *    callback on every lap, so the bootstrap re-fired too — a pull storm.
 *  - With the loop broken, a peer can still legitimately complete the handshake
 *    twice on one connection: both ends dial on `peer:connect`, so each end is
 *    both dialer and responder. Without this guard that is two bootstraps.
 *
 * The mirror-image failure is worse than the storm: if the guard outlives the
 * connection, a peer that disconnects and reconnects looks "already bootstrapped"
 * and never re-pulls — silent no-sync. So the claim is released on
 * `peer:disconnect`, which is the lifecycle the p2p-service already listens on,
 * and cleared wholesale when the node stops.
 *
 * Keyed by peer ID rather than by connection ID because `peer:disconnect` (the
 * only reset signal available) is peer-scoped.
 */
export class BootstrapTracker {
    private bootstrapped = new Set<string>();

    /**
     * Claim the one-shot bootstrap slot for `peerId`.
     *
     * Returns `true` only for the first call since the peer was last released —
     * i.e. only the caller that should actually run the bootstrap. Subsequent
     * calls return `false` until {@link release} or {@link clear}.
     */
    claim(peerId: string): boolean {
        if (this.bootstrapped.has(peerId)) {
            return false;
        }
        this.bootstrapped.add(peerId);
        return true;
    }

    /** Whether `peerId` currently holds a bootstrap claim. Diagnostics/tests. */
    has(peerId: string): boolean {
        return this.bootstrapped.has(peerId);
    }

    /**
     * Drop the claim for `peerId` so a reconnect bootstraps again. Call from the
     * `peer:disconnect` handler — forgetting to is a silent no-sync bug.
     */
    release(peerId: string): void {
        this.bootstrapped.delete(peerId);
    }

    /** Drop every claim. Call when the libp2p node stops. */
    clear(): void {
        this.bootstrapped.clear();
    }
}

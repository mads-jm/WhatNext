/**
 * Relay Manager
 *
 * Manages circuit relay v2 connections for NAT traversal.
 * Handles:
 * - Connecting to configured relay addresses with exponential backoff (#41)
 * - Falling back to the next configured relay when one is exhausted (#41)
 * - A periodic heartbeat that detects half-open relay links (#41)
 * - Tracking which relay is currently active
 * - Notifying the service when relay status changes
 *
 * Relay addresses are user-configured (from relay-config-store) and passed
 * in at startup — they are NOT baked into the compiled code. This preserves
 * user sovereignty: users pick the relay infrastructure for their sessions.
 */

import type { Libp2p } from 'libp2p';
import { P2P_CONFIG } from '../shared/p2p-config';
import { computeBackoffDelay } from './backoff';

export type RelayStatusCallback = (
    connected: boolean,
    relayMultiaddr: string | null,
    relayPeerId: string | null,
) => void;

/**
 * Pick the next relay address to try when `failedAddr` has exhausted its
 * retries. Returns the first OTHER configured address after `failedAddr`
 * (wrapping around), or null when no alternative exists. Pure so the fallback
 * policy is unit-testable without any libp2p wiring.
 */
export function nextFallbackAddress(
    addresses: readonly string[],
    failedAddr: string,
): string | null {
    if (addresses.length <= 1) {
        return null;
    }
    const idx = addresses.indexOf(failedAddr);
    if (idx === -1) {
        // Unknown address — fall back to the first configured one.
        return addresses[0] ?? null;
    }
    // Walk the ring starting after the failed address; return the first distinct entry.
    for (let i = 1; i < addresses.length; i++) {
        const candidate = addresses[(idx + i) % addresses.length];
        if (candidate !== failedAddr) {
            return candidate;
        }
    }
    return null;
}

export class RelayManager {
    private node: Libp2p;
    private addresses: string[];
    private onStatusChange: RelayStatusCallback;
    private activeRelayMultiaddr: string | null = null;
    private activeRelayPeerId: string | null = null;
    private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private disposed = false;

    constructor(
        node: Libp2p,
        addresses: string[],
        onStatusChange: RelayStatusCallback,
    ) {
        this.node = node;
        this.addresses = addresses;
        this.onStatusChange = onStatusChange;
    }

    /** Attempt to connect to all configured relay addresses. */
    async connectAll(): Promise<void> {
        if (this.addresses.length === 0) {
            console.log('[RelayManager] No relay addresses configured');
            return;
        }

        this.startHeartbeat();

        for (const addr of this.addresses) {
            await this.connectWithRetry(addr, 0);
        }
    }

    /** Update the list of relay addresses and reconnect. */
    async updateAddresses(newAddresses: string[]): Promise<void> {
        // Compute diff BEFORE overwriting this.addresses —
        // otherwise added would always be empty (comparing newAddresses to itself).
        const removed = this.addresses.filter((a) => !newAddresses.includes(a));
        const added = newAddresses.filter((a) => !this.addresses.includes(a));

        // Cancel pending retries for addresses that have been removed
        for (const addr of removed) {
            this.clearRetry(addr);
        }

        this.addresses = newAddresses;

        // Connect to newly added addresses
        for (const addr of added) {
            await this.connectWithRetry(addr, 0);
        }
    }

    get currentRelayMultiaddr(): string | null {
        return this.activeRelayMultiaddr;
    }

    get currentRelayPeerId(): string | null {
        return this.activeRelayPeerId;
    }

    private async connectWithRetry(
        addr: string,
        attempt: number,
    ): Promise<void> {
        if (this.disposed) return;

        if (attempt >= P2P_CONFIG.RELAY.MAX_RETRIES) {
            console.warn(
                `[RelayManager] Gave up connecting to relay ${addr} after ${attempt} attempts`,
            );
            this.tryFallback(addr);
            return;
        }

        try {
            console.log(
                `[RelayManager] Connecting to relay: ${addr} (attempt ${attempt + 1}/${P2P_CONFIG.RELAY.MAX_RETRIES})`,
            );
            const { multiaddr } = await import('@multiformats/multiaddr');
            const ma = multiaddr(addr);
            const connection = await this.node.dial(ma);

            const peerId = connection.remotePeer.toString();
            console.log(
                `[RelayManager] Connected to relay: ${addr} (peer: ${peerId})`,
            );

            this.activeRelayMultiaddr = addr;
            this.activeRelayPeerId = peerId;
            this.clearRetry(addr);
            this.onStatusChange(true, addr, peerId);

            // Listen for relay disconnection
            connection.addEventListener('close', () => {
                console.log(`[RelayManager] Relay disconnected: ${addr}`);
                if (this.activeRelayMultiaddr === addr) {
                    this.activeRelayMultiaddr = null;
                    this.activeRelayPeerId = null;
                    this.onStatusChange(false, null, null);
                }
                // Schedule reconnect (attempt 0 — start the backoff schedule fresh)
                this.scheduleRetry(addr, 0);
            });
        } catch (err) {
            console.warn(
                `[RelayManager] Failed to connect to relay ${addr}: ${err}`,
            );
            this.scheduleRetry(addr, attempt + 1);
        }
    }

    /**
     * On exhausting retries for `failedAddr`, try the next configured relay —
     * but only if we don't already have a live relay. This is the single-fallback
     * hook the spec asks for (multi-relay orchestration remains out of scope).
     */
    private tryFallback(failedAddr: string): void {
        if (this.disposed || this.activeRelayMultiaddr) return;
        const fallback = nextFallbackAddress(this.addresses, failedAddr);
        if (fallback && !this.retryTimers.has(fallback)) {
            console.log(
                `[RelayManager] Falling back from ${failedAddr} to ${fallback}`,
            );
            void this.connectWithRetry(fallback, 0);
        }
    }

    private scheduleRetry(addr: string, attempt: number): void {
        this.clearRetry(addr);
        if (this.disposed) return;
        if (attempt >= P2P_CONFIG.RELAY.MAX_RETRIES) {
            this.tryFallback(addr);
            return;
        }

        const delay = computeBackoffDelay(attempt, {
            baseMs: P2P_CONFIG.RELAY.RETRY_BASE_DELAY,
            maxMs: P2P_CONFIG.RELAY.RETRY_MAX_DELAY,
            factor: P2P_CONFIG.RELAY.BACKOFF_FACTOR,
            jitter: P2P_CONFIG.RELAY.BACKOFF_JITTER,
        });
        console.log(
            `[RelayManager] Retry ${addr} (attempt ${attempt + 1}) in ${delay}ms`,
        );
        const timer = setTimeout(
            () => this.connectWithRetry(addr, attempt),
            delay,
        );
        // Don't keep the event loop alive solely for a pending relay retry.
        if (typeof timer === 'object' && 'unref' in timer) {
            (timer as { unref: () => void }).unref();
        }
        this.retryTimers.set(addr, timer);
    }

    private clearRetry(addr: string): void {
        const existing = this.retryTimers.get(addr);
        if (existing) {
            clearTimeout(existing);
            this.retryTimers.delete(addr);
        }
    }

    /**
     * Start the relay liveness heartbeat. Some half-open links never emit a
     * 'close' event (NAT timeout, silent peer death), so the disconnect handler
     * never fires and we believe we're still relayed. The heartbeat proactively
     * verifies the active relay is still among the node's live connections and,
     * if not, treats it as a disconnect and reconnects.
     */
    private startHeartbeat(): void {
        if (this.heartbeatTimer) return;
        this.heartbeatTimer = setInterval(() => {
            this.checkRelayLiveness();
        }, P2P_CONFIG.RELAY.HEARTBEAT_INTERVAL);
        if (
            typeof this.heartbeatTimer === 'object' &&
            'unref' in this.heartbeatTimer
        ) {
            (this.heartbeatTimer as { unref: () => void }).unref();
        }
    }

    /**
     * One heartbeat tick. Returns true if the active relay is still live; false
     * if a half-open link was detected (and a reconnect was scheduled). Exposed
     * for unit testing — callers should not need to invoke it directly.
     */
    checkRelayLiveness(): boolean {
        if (
            this.disposed ||
            !this.activeRelayPeerId ||
            !this.activeRelayMultiaddr
        ) {
            return true; // nothing to check
        }
        const stillConnected = this.node
            .getConnections()
            .some((c) => c.remotePeer.toString() === this.activeRelayPeerId);

        if (stillConnected) {
            return true;
        }

        console.warn(
            `[RelayManager] Heartbeat: active relay ${this.activeRelayMultiaddr} is half-open — reconnecting`,
        );
        const addr = this.activeRelayMultiaddr;
        this.activeRelayMultiaddr = null;
        this.activeRelayPeerId = null;
        this.onStatusChange(false, null, null);
        this.scheduleRetry(addr, 0);
        return false;
    }

    dispose(): void {
        this.disposed = true;
        for (const [addr] of this.retryTimers) {
            this.clearRetry(addr);
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}

/**
 * Relay Manager
 *
 * Manages circuit relay v2 connections for NAT traversal.
 * Handles:
 * - Connecting to configured relay addresses with retry logic
 * - Tracking which relay is currently active
 * - Notifying the service when relay status changes
 *
 * Relay addresses are user-configured (from relay-config-store) and passed
 * in at startup — they are NOT baked into the compiled code. This preserves
 * user sovereignty: users pick the relay infrastructure for their sessions.
 */

import type { Libp2p } from 'libp2p';
import { P2P_CONFIG } from '../shared/p2p-config';

export type RelayStatusCallback = (connected: boolean, relayMultiaddr: string | null, relayPeerId: string | null) => void;

export class RelayManager {
    private node: Libp2p;
    private addresses: string[];
    private onStatusChange: RelayStatusCallback;
    private activeRelayMultiaddr: string | null = null;
    private activeRelayPeerId: string | null = null;
    private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    constructor(node: Libp2p, addresses: string[], onStatusChange: RelayStatusCallback) {
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

    private async connectWithRetry(addr: string, attempt: number): Promise<void> {
        if (attempt >= P2P_CONFIG.RELAY.MAX_RETRIES) {
            console.warn(`[RelayManager] Gave up connecting to relay ${addr} after ${attempt} attempts`);
            return;
        }

        try {
            console.log(`[RelayManager] Connecting to relay: ${addr} (attempt ${attempt + 1}/${P2P_CONFIG.RELAY.MAX_RETRIES})`);
            const { multiaddr } = await import('@multiformats/multiaddr');
            const ma = multiaddr(addr);
            const connection = await this.node.dial(ma);

            const peerId = connection.remotePeer.toString();
            console.log(`[RelayManager] Connected to relay: ${addr} (peer: ${peerId})`);

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
                // Schedule reconnect
                this.scheduleRetry(addr, 0);
            });
        } catch (err) {
            console.warn(`[RelayManager] Failed to connect to relay ${addr}: ${err}`);
            this.scheduleRetry(addr, attempt + 1);
        }
    }

    private scheduleRetry(addr: string, attempt: number): void {
        this.clearRetry(addr);
        if (attempt >= P2P_CONFIG.RELAY.MAX_RETRIES) return;

        const timer = setTimeout(
            () => this.connectWithRetry(addr, attempt),
            P2P_CONFIG.RELAY.RETRY_INTERVAL
        );
        this.retryTimers.set(addr, timer);
    }

    private clearRetry(addr: string): void {
        const existing = this.retryTimers.get(addr);
        if (existing) {
            clearTimeout(existing);
            this.retryTimers.delete(addr);
        }
    }

    dispose(): void {
        for (const [addr] of this.retryTimers) {
            this.clearRetry(addr);
        }
    }
}

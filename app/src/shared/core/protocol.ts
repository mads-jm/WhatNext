/**
 * WhatNext Protocol Handler
 *
 * Utilities for parsing and generating `whtnxt://` custom protocol URLs.
 *
 * URL Format: whtnxt://connect/<peerId>?<optional-query-params>
 *
 * Examples:
 * - whtnxt://connect/12D3KooWFoo...
 * - whtnxt://connect/12D3KooWFoo...?relay=/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWRelay
 */

import type { PeerId } from './types';

/**
 * Protocol scheme
 */
export const PROTOCOL_SCHEME = 'whtnxt';

/**
 * Protocol actions
 */
export enum ProtocolAction {
    CONNECT = 'connect',
}

/**
 * Parsed protocol URL
 */
export interface ParsedProtocolUrl {
    action: ProtocolAction;
    peerId: PeerId;
    relay?: string; // Optional relay multiaddr
    metadata?: Record<string, string>; // Additional query params
}

/**
 * Parse a whtnxt:// protocol URL
 *
 * @param url - Full protocol URL (e.g., "whtnxt://connect/12D3KooWFoo...")
 * @returns Parsed URL components
 * @throws Error if URL is invalid
 */
export function parseProtocolUrl(url: string): ParsedProtocolUrl {
    try {
        const parsed = new URL(url);

        // Validate scheme
        if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) {
            throw new Error(`Invalid protocol scheme: ${parsed.protocol}`);
        }

        // Parse action from hostname
        const action = parsed.hostname as ProtocolAction;
        if (!Object.values(ProtocolAction).includes(action)) {
            throw new Error(`Unknown protocol action: ${action}`);
        }

        // Extract peer ID from pathname
        // URL format: whtnxt://connect/<peerId>
        // pathname will be "/<peerId>"
        const peerId = parsed.pathname.slice(1); // Remove leading "/"
        if (!peerId) {
            throw new Error('Missing peer ID in protocol URL');
        }

        // Validate peer ID format (libp2p peer IDs start with specific prefixes)
        // See: https://github.com/libp2p/specs/blob/master/peer-ids/peer-ids.md
        if (!isValidPeerId(peerId)) {
            throw new Error(`Invalid peer ID format: ${peerId}`);
        }

        // Extract optional relay multiaddr
        const relay = parsed.searchParams.get('relay') || undefined;

        // Extract all other query params as metadata
        const metadata: Record<string, string> = {};
        parsed.searchParams.forEach((value, key) => {
            if (key !== 'relay') {
                metadata[key] = value;
            }
        });

        return {
            action,
            peerId,
            relay,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        };
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to parse protocol URL: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Generate a whtnxt:// protocol URL for connecting to a peer
 *
 * @param peerId - Target peer ID
 * @param options - Optional connection hints (relay address, metadata)
 * @returns Full protocol URL
 */
export function createConnectUrl(
    peerId: PeerId,
    options?: {
        relay?: string;
        metadata?: Record<string, string>;
    }
): string {
    const url = new URL(`${PROTOCOL_SCHEME}://${ProtocolAction.CONNECT}/${peerId}`);

    if (options?.relay) {
        url.searchParams.set('relay', options.relay);
    }

    if (options?.metadata) {
        Object.entries(options.metadata).forEach(([key, value]) => {
            url.searchParams.set(key, value);
        });
    }

    return url.toString();
}

/**
 * Validate libp2p peer ID format
 *
 * libp2p peer IDs are multihashes encoded in base58btc or base32.
 * Common prefixes:
 * - "Qm" (CIDv0, SHA-256) - legacy format
 * - "12D3Koo" (CIDv1, libp2p-key) - modern format
 * - "bafz" (CIDv1, base32) - alternative encoding
 *
 * LEARNING NOTE: This is a basic validation. libp2p has proper validation
 * via the PeerId class, but we need a quick check before passing to libp2p.
 *
 * @param peerId - Peer ID string to validate
 * @returns True if format looks valid
 */
export function isValidPeerId(peerId: string): boolean {
    // Basic length check (peer IDs are typically 40-60 characters)
    if (peerId.length < 10 || peerId.length > 100) {
        return false;
    }

    // Check for known prefixes
    const validPrefixes = ['Qm', '12D3Koo', 'bafz'];
    const hasValidPrefix = validPrefixes.some((prefix) =>
        peerId.startsWith(prefix)
    );

    if (!hasValidPrefix) {
        return false;
    }

    // Basic charset validation (base58btc: alphanumeric, no 0, O, I, l)
    // base32: a-z, 2-7
    const isValidCharset =
        /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(
            peerId
        ) || /^[a-z2-7]+$/.test(peerId);

    return isValidCharset;
}

/**
 * Extract peer ID from a multiaddr string
 *
 * Example: /ip4/127.0.0.1/tcp/4001/p2p/12D3KooWFoo... → 12D3KooWFoo...
 *
 * LEARNING NOTE: Multiaddrs can contain peer IDs in the /p2p/ component.
 * This is useful when we have a full multiaddr and need just the peer ID.
 *
 * @param multiaddr - libp2p multiaddr string
 * @returns Peer ID or undefined if not found
 */
export function extractPeerIdFromMultiaddr(multiaddr: string): PeerId | undefined {
    const match = multiaddr.match(/\/p2p\/([^/]+)/);
    return match?.[1];
}

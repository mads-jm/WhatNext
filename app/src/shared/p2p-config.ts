/**
 * Shared P2P Configuration
 *
 * This file contains all P2P networking configuration shared between:
 * - Electron app utility process (app/src/utility/p2p-service.ts)
 * - Test peer (test-peer/src/index.js)
 *
 * IMPORTANT: Keep this in sync across all P2P implementations!
 */

/**
 * WhatNext P2P Protocol Configuration
 */
export const P2P_CONFIG = {
    /**
     * mDNS Service Name
     *
     * CRITICAL: This MUST match across all WhatNext peers for discovery to work.
     * Format: _service._protocol.local (standard mDNS naming)
     *
     * Why custom service name:
     * - Filters out non-WhatNext libp2p peers on the network
     * - Prevents discovery of unrelated libp2p applications
     * - Makes debugging easier (can see WhatNext-specific traffic)
     */
    MDNS_SERVICE_NAME: '_whatnext._udp.local',

    /**
     * mDNS Broadcast Interval (milliseconds)
     *
     * How often to broadcast presence on local network.
     * - Lower = faster discovery, more network traffic
     * - Higher = slower discovery, less network traffic
     *
     * Default: 1000ms (1 second) - good balance for local network
     */
    MDNS_INTERVAL: 1000,

    /**
     * Custom Protocol Prefix
     *
     * All WhatNext-specific protocols use this prefix.
     * Examples:
     * - /whatnext/handshake/1.0.0
     * - /whatnext/playlist-sync/1.0.0
     * - /whatnext/rxdb-replication/1.0.0
     */
    PROTOCOL_PREFIX: '/whatnext',

    /**
     * Protocol Versions
     */
    PROTOCOLS: {
        HANDSHAKE: '/whatnext/handshake/1.0.0',
        PLAYLIST_SYNC: '/whatnext/playlist-sync/1.0.0',
        RXDB_REPLICATION: '/whatnext/rxdb-replication/1.0.0',
    },

    /**
     * Connection Manager Settings
     */
    CONNECTION: {
        /**
         * Maximum simultaneous connections
         *
         * LEARNING: Start conservative, tune based on:
         * - Memory usage per connection
         * - Bandwidth per connection
         * - RxDB replication overhead
         */
        MAX_CONNECTIONS: 10,

        /**
         * Connection timeout (milliseconds)
         *
         * How long to wait for a connection to establish before giving up.
         */
        DIAL_TIMEOUT: 30000, // 30 seconds
    },

    /**
     * Listen Addresses
     *
     * Where the libp2p node will accept incoming connections.
     *
     * Format: multiaddr string
     * - /ip4/0.0.0.0/tcp/0 = Listen on all IPv4 interfaces, random TCP port
     * - /ip4/0.0.0.0/tcp/0/ws = Listen on all IPv4 interfaces, random TCP port with WebSocket
     *
     * Port 0 = OS assigns random available port (avoids conflicts)
     */
    LISTEN_ADDRESSES: [
        '/ip4/0.0.0.0/tcp/0',           // TCP transport
        '/ip4/0.0.0.0/tcp/0/ws',        // WebSocket transport
    ],

    /**
     * Application Metadata
     *
     * Sent during handshake to identify peer.
     */
    APP_INFO: {
        name: 'WhatNext',
        version: '0.1.0', // TODO: Read from package.json
        protocolVersion: '1.0.0',
    },
} as const;

/**
 * Type exports for TypeScript consumers
 */
export type P2PConfig = typeof P2P_CONFIG;
export type ProtocolName = keyof typeof P2P_CONFIG.PROTOCOLS;

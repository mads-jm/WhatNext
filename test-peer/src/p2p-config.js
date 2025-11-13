/**
 * Shared P2P Configuration (JavaScript version)
 *
 * This file mirrors app/src/shared/p2p-config.ts
 * Keep this in sync with the TypeScript version!
 *
 * IMPORTANT: This is the test peer copy. The source of truth is:
 * app/src/shared/p2p-config.ts
 */

export const P2P_CONFIG = {
    /**
     * mDNS Service Name - MUST match across all WhatNext peers
     */
    MDNS_SERVICE_NAME: '_whatnext._udp.local',

    /**
     * mDNS Broadcast Interval (milliseconds)
     */
    MDNS_INTERVAL: 1000,

    /**
     * Custom Protocol Prefix
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
        MAX_CONNECTIONS: 10,
        DIAL_TIMEOUT: 30000,
    },

    /**
     * Listen Addresses
     */
    LISTEN_ADDRESSES: [
        '/ip4/0.0.0.0/tcp/0',       // TCP transport
        '/ip4/0.0.0.0/tcp/0/ws',    // WebSocket transport
    ],

    /**
     * Application Metadata
     */
    APP_INFO: {
        name: 'WhatNext',
        version: '0.1.0',
        protocolVersion: '1.0.0',
    },
};

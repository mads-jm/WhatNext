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
     * - /ip4/127.0.0.1/tcp/0 = Listen on localhost, random TCP port
     * - /ip4/127.0.0.1/tcp/0/ws = Listen on localhost, random TCP port with WebSocket
     *
     * Port 0 = OS assigns random available port (avoids conflicts)
     *
     * NOTE: We bind to 127.0.0.1 instead of 0.0.0.0 because Electron's
     * utility process on Windows restricts binding to all interfaces.
     * Remote peers connect via WebRTC/relay, not direct TCP.
     */
    LISTEN_ADDRESSES: [
        '/ip4/127.0.0.1/tcp/0',         // TCP transport (localhost only; remote peers use WebRTC/relay)
        '/ip4/127.0.0.1/tcp/0/ws',      // WebSocket transport (localhost only)
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

    /**
     * Relay Server Configuration
     *
     * Relay addresses are NOT stored here — they live in the user's settings
     * (relay-config-store.ts) and are loaded at runtime. This preserves user
     * sovereignty: users configure which relay infrastructure their sessions
     * use. The relay code (relay/relay-server.mjs) can be self-hosted.
     *
     * At startup, main.ts reads addresses from relay-config-store and passes
     * them to the utility process via the START_NODE or UPDATE_RELAY_ADDRESSES
     * message payload.
     */
    RELAY: {
        /** Auto-connect to configured relays on startup */
        AUTO_CONNECT: true,
        /**
         * @deprecated Superseded by exponential backoff (RETRY_BASE_DELAY /
         * RETRY_MAX_DELAY / BACKOFF_FACTOR). Retained only for backward compat
         * with any external consumer of P2P_CONFIG; RelayManager no longer reads it.
         */
        RETRY_INTERVAL: 10000,
        /** Maximum number of connection attempts per relay address before falling back */
        MAX_RETRIES: 5,
        /** Base delay (ms) for exponential reconnect backoff: delay = BASE * FACTOR^attempt */
        RETRY_BASE_DELAY: 1000,
        /** Ceiling (ms) for a single backoff delay, regardless of attempt count */
        RETRY_MAX_DELAY: 30000,
        /** Multiplier applied per attempt for exponential backoff */
        BACKOFF_FACTOR: 2,
        /**
         * Jitter fraction in [0, 1]. "Equal jitter": the delay is randomized in
         * [d/2, d] where d is the computed backoff. Spreads reconnect storms so
         * many peers don't hammer a recovering relay in lockstep.
         */
        BACKOFF_JITTER: 0.5,
        /**
         * Heartbeat interval (ms) for proactive relay-liveness checks. Detects
         * half-open links that never emit a 'close' event by verifying the active
         * relay is still among the node's live connections; if not, reconnect.
         */
        HEARTBEAT_INTERVAL: 15000,
    },

    /**
     * RxDB Replication Settings
     */
    REPLICATION: {
        /**
         * How long (ms) a pull responder waits for the renderer to supply its
         * documents before giving up. On timeout the responder does NOT advance
         * the requester's checkpoint (it echoes the incoming checkpoint back) so
         * the missed changes are re-pulled on the next attempt — this replaces
         * the old hardcoded 5s "resolve empty + fresh checkpoint" that silently
         * dropped changes (#41). Longer than 5s to tolerate slow/large collections.
         */
        PULL_TIMEOUT: 15000,
    },
} as const;

/**
 * Type exports for TypeScript consumers
 */
export type P2PConfig = typeof P2P_CONFIG;
export type ProtocolName = keyof typeof P2P_CONFIG.PROTOCOLS;

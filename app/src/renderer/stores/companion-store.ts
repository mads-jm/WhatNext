/**
 * Companion Store
 *
 * Holds the running state of the phone companion HTTP server and its relay tunnel.
 * Lives in Zustand (not component state) because the server runs in Electron's main
 * process and outlives any React component — toggling the share panel must not lose
 * the fact that the server is already running.
 */

import { create } from 'zustand';

interface CompanionStore {
    /**
     * Non-null when the local companion HTTP server is running. `joinPin` is
     * the session-scoped participant credential minted at start.
     */
    serverInfo: { port: number; localIp: string; joinPin: string } | null;
    /** Non-null when an active relay tunnel URL has been established. */
    relayUrl: string | null;

    setServerInfo: (info: { port: number; localIp: string; joinPin: string } | null) => void;
    setRelayUrl: (url: string | null) => void;
    clearAll: () => void;
}

export const useCompanionStore = create<CompanionStore>((set) => ({
    serverInfo: null,
    relayUrl: null,

    setServerInfo: (info) => set({ serverInfo: info }),
    setRelayUrl: (url) => set({ relayUrl: url }),
    clearAll: () => set({ serverInfo: null, relayUrl: null }),
}));

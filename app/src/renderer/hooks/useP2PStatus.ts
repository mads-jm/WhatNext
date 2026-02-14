/**
 * P2P Status Hook
 * Extracts P2P polling logic into a reusable hook.
 */

import { useState, useEffect } from 'react';
import type { P2PStatusPayload } from '../../shared/core';

export function useP2PStatus(pollInterval = 2000): P2PStatusPayload {
    const [status, setStatus] = useState<P2PStatusPayload>({
        nodeStarted: false,
        peerId: '',
        multiaddrs: [],
        discoveredPeers: [],
        connectedPeers: [],
        protocols: [],
    });

    useEffect(() => {
        if (!window.electron?.p2p) return;

        let active = true;

        const poll = async () => {
            try {
                const newStatus = await window.electron!.p2p.getStatus();
                if (active) setStatus(newStatus);
            } catch (e) {
                console.error('[useP2PStatus] Poll failed:', e);
            }
            if (active) setTimeout(poll, pollInterval);
        };

        poll();
        return () => { active = false; };
    }, [pollInterval]);

    return status;
}

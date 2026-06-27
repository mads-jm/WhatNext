/**
 * usePlaybackState
 * Polls window.electron.spotify.getPlaybackState() every 5 seconds when enabled.
 * Returns the normalised PlaybackState or null if unavailable.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PlaybackState } from '../../shared/session-interfaces';
import { normalizePlaybackState } from '../utils/playback-helpers';

const POLL_INTERVAL_MS = 3000;

interface UsePlaybackStateResult {
    state: PlaybackState | null;
    error: string | null;
    refresh: () => void;
}

export function usePlaybackState(enabled: boolean): UsePlaybackStateResult {
    const [state, setState] = useState<PlaybackState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<(() => Promise<void>) | null>(null);

    useEffect(() => {
        if (!enabled) {
            setState(null);
            setError(null);
            pollRef.current = null;
            return;
        }

        let cancelled = false;

        const poll = async () => {
            if (cancelled) return;

            const spotify = window.electron?.spotify;
            if (!spotify) {
                setError('Spotify IPC not available');
                return;
            }

            try {
                const result = await spotify.getPlaybackState();
                if (cancelled) return;

                if (!result.success) {
                    setError(result.error ?? 'Unknown error');
                    return;
                }

                setError(null);
                setState(normalizePlaybackState(result.state));
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            }
        };

        pollRef.current = poll;
        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            pollRef.current = null;
            clearInterval(id);
        };
    }, [enabled]);

    const refresh = useCallback(() => {
        pollRef.current?.();
    }, []);

    return { state, error, refresh };
}

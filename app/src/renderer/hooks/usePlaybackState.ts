/**
 * usePlaybackState
 * Polls window.electron.spotify.getPlaybackState() every 5 seconds when enabled.
 * Returns the normalised PlaybackState or null if unavailable.
 */

import { useState, useEffect } from 'react';
import type { PlaybackState } from '../../shared/session-interfaces';

const POLL_INTERVAL_MS = 5000;

interface UsePlaybackStateResult {
    state: PlaybackState | null;
    error: string | null;
}

export function usePlaybackState(enabled: boolean): UsePlaybackStateResult {
    const [state, setState] = useState<PlaybackState | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled) {
            setState(null);
            setError(null);
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
                setState(
                    result.state
                        ? {
                              isPlaying: result.state.isPlaying,
                              currentTrackExternalId: result.state.track?.spotifyId ?? null,
                              progressMs: result.state.progressMs,
                              durationMs: result.state.track?.durationMs ?? 0,
                              deviceName: result.state.deviceName,
                              trackTitle: result.state.track?.title,
                              trackArtists: result.state.track?.artists,
                          }
                        : null
                );
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            }
        };

        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [enabled]);

    return { state, error };
}

/**
 * TrackEndingWarning
 * Amber banner shown when the current track has ≤20s remaining
 * and there is no next track queued in the playlist.
 */

import type { PlaybackState } from '../../../shared/session-interfaces';

const WARNING_THRESHOLD_MS = 20_000;

interface TrackEndingWarningProps {
    playbackState: PlaybackState | null;
    hasNextTrack: boolean;
}

export function TrackEndingWarning({ playbackState, hasNextTrack }: TrackEndingWarningProps) {
    if (!playbackState || !playbackState.isPlaying || hasNextTrack) return null;

    const remainingMs = playbackState.durationMs - playbackState.progressMs;
    if (remainingMs > WARNING_THRESHOLD_MS || remainingMs <= 0) return null;

    const remainingSec = Math.ceil(remainingMs / 1000);

    return (
        <div className="card card-body flex items-center gap-3 border-amber-600/60 bg-amber-900/20 animate-pulse">
            <i className="fa-solid fa-triangle-exclamation text-amber-400 shrink-0" />
            <span className="text-sm font-medium text-amber-300">
                Track ending in {remainingSec}s — no next track queued!
            </span>
        </div>
    );
}

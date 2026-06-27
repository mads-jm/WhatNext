/**
 * PlaybackBar
 * Self-contained Spotify playback controls component.
 * Polls playback state and exposes transport controls (play/pause/skip).
 */

import { usePlaybackState } from '../../hooks/usePlaybackState';

interface PlaybackBarProps {
    enabled: boolean;
    contextUri?: string;
}

export function PlaybackBar({ enabled, contextUri }: PlaybackBarProps) {
    const { state, error, refresh } = usePlaybackState(enabled);

    const spotify = window.electron?.spotify;

    const handleRewind30 = async () => {
        if (!spotify || !state) return;
        const newPosition = Math.max(0, state.progressMs - 30_000);
        await spotify.seekPlayback({ positionMs: newPosition });
        refresh();
    };

    const handlePlayPause = async () => {
        if (!spotify) return;
        if (state?.isPlaying) {
            await spotify.pausePlayback();
        } else {
            await spotify.resumePlayback();
        }
    };

    const handleSkipNext = async () => spotify?.skipNext();
    const handleSkipPrevious = async () => spotify?.skipPrevious();

    const handleOpenSpotify = async () => {
        // Try desktop app first, fall back to web
        const desktopUri = contextUri || 'spotify:';
        const webUrl = contextUri
            ? `https://open.spotify.com/${contextUri.replace('spotify:', '').replace(/:/g, '/')}`
            : 'https://open.spotify.com';

        const result = await window.electron?.shell.openExternal(desktopUri);
        if (!result?.success) {
            window.electron?.shell.openExternal(webUrl);
        }
    };

    if (!enabled) return null;

    if (error) {
        return (
            <div className="card card-body flex items-center gap-3 text-sm text-on-surface-variant">
                <i className="fa-brands fa-spotify text-primary" />
                <span>Spotify unavailable: {error}</span>
            </div>
        );
    }

    if (!state) {
        return (
            <div className="card card-body flex items-center gap-3 text-sm text-on-surface-variant">
                <i className="fa-brands fa-spotify text-primary" />
                <span>No active Spotify device.</span>
                <button
                    className="btn-ghost text-xs text-primary hover:text-primary-dim p-0"
                    onClick={handleOpenSpotify}
                >
                    Open Spotify
                </button>
            </div>
        );
    }

    const progressPercent =
        state.durationMs > 0
            ? Math.min(100, (state.progressMs / state.durationMs) * 100)
            : 0;

    const formatTime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${m}:${String(s % 60).padStart(2, '0')}`;
    };

    return (
        <div className="card card-body flex items-center gap-4">
            {/* Track info */}
            <div className="flex-1 min-w-0">
                {state.trackTitle ? (
                    <div className="space-y-0.5">
                        <p className="text-sm font-medium text-on-surface truncate">
                            {state.trackTitle}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                            {state.trackArtists && (
                                <span className="truncate">{state.trackArtists.join(', ')}</span>
                            )}
                            {state.deviceName && (
                                <span className="shrink-0">
                                    <i className="fa-solid fa-volume-high mr-1" />
                                    {state.deviceName}
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-on-surface-variant">Nothing playing</p>
                )}
            </div>

            {/* Transport controls */}
            <div className="flex items-center gap-2">
                <button className="btn-ghost p-2" onClick={handleSkipPrevious} title="Previous">
                    <i className="fa-solid fa-backward-step" />
                </button>
                <button
                    className="btn-ghost p-2 relative"
                    onClick={handleRewind30}
                    title="Rewind 30 seconds"
                >
                    <i className="fa-solid fa-rotate-left text-sm" />
                    <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold leading-none">30</span>
                </button>
                <button
                    className="btn-primary p-2 rounded-full w-9 h-9 flex items-center justify-center"
                    onClick={handlePlayPause}
                    title={state.isPlaying ? 'Pause' : 'Play'}
                >
                    <i className={`fa-solid ${state.isPlaying ? 'fa-pause' : 'fa-play'} text-sm`} />
                </button>
                <button className="btn-ghost p-2" onClick={handleSkipNext} title="Next">
                    <i className="fa-solid fa-forward-step" />
                </button>
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-2 w-48 shrink-0">
                <span className="text-xs text-on-surface-variant w-8 text-right">
                    {formatTime(state.progressMs)}
                </span>
                <div className="flex-1 h-1 bg-surface-high rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                <span className="text-xs text-on-surface-variant w-8">
                    {formatTime(state.durationMs)}
                </span>
            </div>
        </div>
    );
}

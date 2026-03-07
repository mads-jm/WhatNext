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
    const { state, error } = usePlaybackState(enabled);

    const spotify = window.electron?.spotify;

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

    const handleOpenSpotify = () => {
        if (contextUri) {
            window.electron?.shell.openExternal(
                `https://open.spotify.com/${contextUri.replace('spotify:', '').replace(':', '/')}`
            );
        } else {
            window.electron?.shell.openExternal('https://open.spotify.com');
        }
    };

    if (!enabled) return null;

    if (error) {
        return (
            <div className="card card-body flex items-center gap-3 text-sm text-gray-500">
                <i className="fa-brands fa-spotify text-green-500" />
                <span>Spotify unavailable: {error}</span>
            </div>
        );
    }

    if (!state) {
        return (
            <div className="card card-body flex items-center gap-3 text-sm text-gray-500">
                <i className="fa-brands fa-spotify text-green-500" />
                <span>No active Spotify device.</span>
                <button
                    className="btn-ghost text-xs text-blue-400 hover:text-blue-300 p-0"
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
                        <p className="text-sm font-medium text-gray-100 truncate">
                            {state.trackTitle}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
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
                    <p className="text-sm text-gray-500">Nothing playing</p>
                )}
            </div>

            {/* Transport controls */}
            <div className="flex items-center gap-2">
                <button className="btn-ghost p-2" onClick={handleSkipPrevious} title="Previous">
                    <i className="fa-solid fa-backward-step" />
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
                <span className="text-xs text-gray-500 w-8 text-right">
                    {formatTime(state.progressMs)}
                </span>
                <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                <span className="text-xs text-gray-500 w-8">
                    {formatTime(state.durationMs)}
                </span>
            </div>
        </div>
    );
}

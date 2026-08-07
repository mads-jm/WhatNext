/**
 * LibraryDownload — download audio for existing Spotify tracks in the library.
 *
 * Shows tracks that have a spotifyId but no local audio file.
 * Uses spotDL to fetch audio; updates existing track documents with localFilePath.
 */

import { useLibraryDownload } from '../../hooks/useLibraryDownload';
import type { TrackDocument } from '../../db/schemas';
import type { TrackProgress } from '../../hooks/usePlaylistDownload';

const FORMAT_OPTIONS = [
    { value: 'mp3', label: 'MP3' },
    { value: 'opus', label: 'Opus' },
    { value: 'flac', label: 'FLAC' },
    { value: 'm4a', label: 'M4A' },
] as const;

export function LibraryDownload() {
    const lib = useLibraryDownload();

    if (lib.state === 'loading') {
        return (
            <div className="flex items-center justify-center py-20 gap-3 text-on-surface-variant">
                <i className="fa-solid fa-spinner fa-spin" />
                <span className="text-sm">Loading library tracks…</span>
            </div>
        );
    }

    if (lib.state === 'idle') {
        if (lib.candidates.length === 0) {
            return <EmptyState />;
        }

        return (
            <div className="flex flex-col gap-5">
                {/* Info banner */}
                <div className="flex items-start gap-3 p-4 bg-surface-high rounded-xl border border-outline-variant/20">
                    <i className="fa-brands fa-spotify text-[#1DB954] mt-0.5" />
                    <div className="text-sm text-on-surface-variant">
                        These tracks are in your library with Spotify metadata
                        but no local audio file. spotDL will find matching audio
                        on YouTube and tag it with full Spotify metadata.
                    </div>
                </div>

                {/* Format + actions row */}
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <label
                            htmlFor="library-format"
                            className="text-xs uppercase tracking-widest text-on-surface-variant shrink-0"
                        >
                            Format
                        </label>
                        <select
                            id="library-format"
                            value={lib.preferredFormat}
                            onChange={(e) =>
                                lib.setPreferredFormat(e.target.value)
                            }
                            className="bg-surface-high border border-outline-variant/20 rounded-lg px-3 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary/50"
                        >
                            {FORMAT_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                        <button
                            onClick={lib.selectAll}
                            className="text-xs text-primary hover:underline"
                        >
                            All
                        </button>
                        <span className="text-on-surface-variant text-xs">
                            ·
                        </span>
                        <button
                            onClick={lib.selectNone}
                            className="text-xs text-on-surface-variant hover:text-on-surface hover:underline"
                        >
                            None
                        </button>
                        <span className="text-xs text-on-surface-variant ml-2">
                            {lib.selectedIds.size} selected
                        </span>
                    </div>
                </div>

                {/* Track list */}
                <div className="flex flex-col gap-1 max-h-96 overflow-y-auto pr-1">
                    {lib.candidates.map((track) => (
                        <TrackRow
                            key={track.id}
                            track={track}
                            selected={lib.selectedIds.has(track.id)}
                            onToggle={() => lib.toggleTrack(track.id)}
                        />
                    ))}
                </div>

                {/* Download button */}
                <div className="pt-2">
                    <button
                        onClick={lib.startDownload}
                        disabled={lib.selectedIds.size === 0}
                        className="px-6 py-2.5 text-sm font-bold bg-gradient-to-r from-primary to-primary-dim text-surface rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                    >
                        Download {lib.selectedIds.size} track
                        {lib.selectedIds.size !== 1 ? 's' : ''}
                    </button>
                </div>
            </div>
        );
    }

    if (lib.state === 'downloading') {
        return (
            <LibraryProgress
                tracks={lib.candidates.filter(
                    (d) => lib.selectedIds.has(d.id) && !!d.spotifyId,
                )}
                progress={lib.progress}
                completedCount={lib.completedCount}
                onCancel={lib.cancel}
            />
        );
    }

    if (lib.state === 'done') {
        const total = lib.candidates.filter((d) =>
            lib.selectedIds.has(d.id),
        ).length;
        const successCount = Array.from(lib.progress.values()).filter(
            (p) => p.status === 'complete',
        ).length;
        // Downloaded but with no reported file path — nothing was patched onto
        // the track document, so these are neither saved nor outright failures (#57).
        const unimportedCount = Array.from(lib.progress.values()).filter(
            (p) => p.status === 'unimported',
        ).length;
        const failedCount = total - successCount - unimportedCount;

        return (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
                <i className="fa-solid fa-circle-check text-4xl text-primary" />
                <div className="text-center">
                    <p className="font-semibold text-on-surface">
                        Downloads complete
                    </p>
                    <p className="text-sm text-on-surface-variant mt-1">
                        {successCount} track{successCount !== 1 ? 's' : ''}{' '}
                        saved locally
                        {unimportedCount > 0 && (
                            <span className="text-tertiary">
                                {' '}
                                · {unimportedCount} downloaded but not linked
                            </span>
                        )}
                        {failedCount > 0 && (
                            <span className="text-error">
                                {' '}
                                · {failedCount} failed
                            </span>
                        )}
                    </p>
                </div>
                <button
                    onClick={lib.reset}
                    className="px-5 py-2 text-sm font-medium bg-surface-high border border-outline-variant/20 rounded-xl text-on-surface hover:bg-surface-highest transition-colors"
                >
                    Back to Library
                </button>
            </div>
        );
    }

    if (lib.state === 'error') {
        return (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
                <i className="fa-solid fa-triangle-exclamation text-3xl text-error" />
                <p className="text-sm text-on-surface-variant">
                    {lib.error ?? 'Something went wrong.'}
                </p>
                <button
                    onClick={lib.reset}
                    className="px-5 py-2 text-sm font-medium bg-surface-high border border-outline-variant/20 rounded-xl text-on-surface hover:bg-surface-highest transition-colors"
                >
                    Try Again
                </button>
            </div>
        );
    }

    return null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState() {
    return (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
            <i className="fa-solid fa-circle-check text-3xl text-primary" />
            <div className="text-center">
                <p className="font-medium text-on-surface">All caught up</p>
                <p className="text-sm text-on-surface-variant mt-1">
                    Every Spotify track in your library already has a local
                    audio file.
                </p>
            </div>
        </div>
    );
}

function TrackRow({
    track,
    selected,
    onToggle,
}: {
    track: TrackDocument;
    selected: boolean;
    onToggle: () => void;
}) {
    return (
        <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-high cursor-pointer transition-colors group">
            <input
                type="checkbox"
                checked={selected}
                onChange={onToggle}
                className="w-4 h-4 rounded accent-primary shrink-0"
            />
            {track.albumArtUrl ? (
                <img
                    src={
                        track.albumArtLocalPath
                            ? `file://${track.albumArtLocalPath}`
                            : track.albumArtUrl
                    }
                    alt=""
                    className="w-9 h-9 rounded object-cover shrink-0 bg-surface-high"
                />
            ) : (
                <div className="w-9 h-9 rounded bg-surface-high flex items-center justify-center shrink-0">
                    <i className="fa-solid fa-music text-xs text-on-surface-variant" />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <p className="text-sm text-on-surface truncate">
                    {track.title}
                </p>
                <p className="text-xs text-on-surface-variant truncate">
                    {track.artists?.join(', ')}
                    {track.album ? ` · ${track.album}` : ''}
                </p>
            </div>
            <i className="fa-brands fa-spotify text-xs text-[#1DB954] opacity-60 shrink-0" />
        </label>
    );
}

function LibraryProgress({
    tracks,
    progress,
    completedCount,
    onCancel,
}: {
    tracks: TrackDocument[];
    progress: Map<string, TrackProgress>;
    completedCount: number;
    onCancel: () => void;
}) {
    const total = tracks.length;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <span className="text-sm text-on-surface-variant">
                    <span className="font-semibold text-on-surface">
                        {completedCount}
                    </span>{' '}
                    / {total} downloaded
                </span>
                <button
                    onClick={onCancel}
                    className="text-xs text-error hover:underline"
                >
                    Cancel
                </button>
            </div>

            <div className="space-y-3">
                {tracks.map((track) => {
                    // spotifyId is guaranteed non-null by the filter applied at the call site
                    const url = `https://open.spotify.com/track/${track.spotifyId!}`;
                    const p = progress.get(url) ?? {
                        sourceUrl: url,
                        percent: 0,
                        status: 'pending' as const,
                    };
                    return (
                        <LibraryTrackProgressRow
                            key={track.id}
                            track={track}
                            progress={p}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function LibraryTrackProgressRow({
    track,
    progress,
}: {
    track: TrackDocument;
    progress: TrackProgress;
}) {
    const { percent, status, speed, eta, error } = progress;

    const statusIcon =
        status === 'complete'
            ? 'fa-check text-primary'
            : status === 'error'
              ? 'fa-xmark text-error'
              : status === 'unimported'
                ? 'fa-triangle-exclamation text-tertiary'
                : status === 'downloading'
                  ? 'fa-spinner fa-spin text-secondary'
                  : 'fa-clock text-on-surface-variant';

    const isTerminal =
        status === 'complete' || status === 'error' || status === 'unimported';

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
                <i
                    className={`fa-solid ${statusIcon} w-3.5 text-center text-xs`}
                />
                <span className="text-sm text-on-surface truncate flex-1">
                    {track.title}
                </span>
                {status === 'downloading' && (
                    <span className="text-xs text-on-surface-variant font-mono shrink-0">
                        {speed ?? ''}
                        {eta ? ` · ${eta}` : ''}
                    </span>
                )}
                {status === 'complete' && (
                    <span className="text-xs text-primary shrink-0">Done</span>
                )}
                {status === 'unimported' && (
                    <span className="text-xs text-tertiary shrink-0">
                        Not linked
                    </span>
                )}
                {status === 'error' && (
                    <span className="text-xs text-error shrink-0">Failed</span>
                )}
            </div>

            {!isTerminal && (
                <div className="h-1 bg-surface-high rounded-full overflow-hidden ml-5">
                    <div
                        className="h-full bg-gradient-to-r from-primary to-primary-dim rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}

            {status === 'error' && error && (
                <p className="text-xs text-error ml-5">{error}</p>
            )}
        </div>
    );
}

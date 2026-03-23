/**
 * DownloadProgress — per-track progress bars during an active download.
 */

import type { TrackProgress } from '../../hooks/usePlaylistDownload';
import type { ResolvedTrack } from '../../../../../service/downloader/types';

interface DownloadProgressProps {
    tracks: ResolvedTrack[];
    progress: Map<string, TrackProgress>;
    completedCount: number;
    onCancel: () => void;
}

export function DownloadProgress({
    tracks,
    progress,
    completedCount,
    onCancel,
}: DownloadProgressProps) {
    const total = tracks.length;

    return (
        <div className="flex flex-col gap-4">
            {/* Overall progress */}
            <div className="flex items-center justify-between">
                <span className="text-sm text-on-surface-variant">
                    <span className="font-semibold text-on-surface">{completedCount}</span> /{' '}
                    {total} downloaded
                </span>
                <button
                    onClick={onCancel}
                    className="text-xs text-error hover:underline"
                >
                    Cancel
                </button>
            </div>

            {/* Per-track rows */}
            <div className="space-y-3">
                {tracks.map((track) => {
                    const p = progress.get(track.sourceUrl) ?? {
                        sourceUrl: track.sourceUrl,
                        percent: 0,
                        status: 'pending' as const,
                    };
                    return (
                        <TrackProgressRow key={track.sourceId} track={track} progress={p} />
                    );
                })}
            </div>
        </div>
    );
}

interface TrackProgressRowProps {
    track: ResolvedTrack;
    progress: TrackProgress;
}

function TrackProgressRow({ track, progress }: TrackProgressRowProps) {
    const { percent, status, speed, eta, error } = progress;

    const statusIcon =
        status === 'complete'
            ? 'fa-check text-primary'
            : status === 'error'
              ? 'fa-xmark text-error'
              : status === 'downloading'
                ? 'fa-spinner fa-spin text-secondary'
                : 'fa-clock text-on-surface-variant';

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
                <i className={`fa-solid ${statusIcon} w-3.5 text-center text-xs`} />
                <span className="text-sm text-on-surface truncate flex-1">
                    {track.title || track.sourceId}
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
                {status === 'error' && (
                    <span className="text-xs text-error shrink-0">Failed</span>
                )}
            </div>

            {status !== 'complete' && status !== 'error' && (
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

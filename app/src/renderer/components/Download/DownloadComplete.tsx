/**
 * DownloadComplete — summary shown after a download session finishes.
 */

import type { TrackProgress } from '../../hooks/usePlaylistDownload';
import type { ResolvedTrack } from '../../../../../service/downloader/types';

interface DownloadCompleteProps {
    tracks: ResolvedTrack[];
    progress: Map<string, TrackProgress>;
    onReset: () => void;
}

export function DownloadComplete({ tracks, progress, onReset }: DownloadCompleteProps) {
    const completed = tracks.filter(
        (t) => progress.get(t.sourceUrl)?.status === 'complete',
    );
    const failed = tracks.filter(
        (t) => progress.get(t.sourceUrl)?.status === 'error',
    );

    return (
        <div className="flex flex-col items-center justify-center py-16 gap-5">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <i className="fa-solid fa-check text-2xl text-primary" />
            </div>

            <div className="text-center">
                <p className="text-lg font-bold font-headline text-on-surface">
                    {completed.length} track{completed.length !== 1 ? 's' : ''} downloaded
                </p>
                {failed.length > 0 && (
                    <p className="text-sm text-error mt-1">
                        {failed.length} track{failed.length !== 1 ? 's' : ''} failed
                    </p>
                )}
                <p className="text-sm text-on-surface-variant mt-1">
                    Added to your library with source badges.
                </p>
                <p className="text-xs text-on-surface-variant/70 mt-2 flex items-center justify-center gap-1.5">
                    <i className="fa-solid fa-circle-notch fa-spin text-[10px]" />
                    Purchase links resolving in background — will appear on track rows shortly.
                </p>
            </div>

            {failed.length > 0 && (
                <div className="w-full max-w-sm space-y-1">
                    <p className="text-xs text-on-surface-variant uppercase tracking-widest mb-2">
                        Failed tracks
                    </p>
                    {failed.map((t) => (
                        <div key={t.sourceId} className="flex items-center gap-2 text-sm">
                            <i className="fa-solid fa-xmark text-error text-xs w-3" />
                            <span className="text-on-surface-variant truncate">{t.title}</span>
                            <span className="text-xs text-error truncate">
                                {progress.get(t.sourceUrl)?.error}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <button
                onClick={onReset}
                className="mt-2 px-5 py-2 text-sm font-medium bg-surface-high border border-outline-variant/20 rounded-xl text-on-surface hover:bg-surface-highest transition-colors"
            >
                Download More
            </button>
        </div>
    );
}

/**
 * SourceBadge — shows the origin source of a track (Spotify, Local, etc.)
 * Extracted from LibraryView for reuse in TrackPickerModal and other contexts.
 *
 * Uses the `source` field (v2) with a graceful fallback for pre-migration tracks:
 *   source ?? (spotifyId ? 'spotify' : 'manual')
 */

import type { TrackDocType } from '../../db/schemas';

function resolveSource(track: TrackDocType): string {
    return track.source ?? (track.spotifyId ? 'spotify' : 'manual');
}

export function SourceBadge({ track }: { track: TrackDocType }) {
    const source = resolveSource(track);

    switch (source) {
        case 'spotify':
            return (
                <span
                    title={`Spotify · ${track.spotifyId ?? ''}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary"
                >
                    <i className="fa-brands fa-spotify" />
                    Spotify
                </span>
            );

        case 'local':
            return (
                <span
                    title={`Local file · ${track.localFilePath ?? ''}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-high text-on-surface-variant"
                >
                    <i className="fa-solid fa-hard-drive" />
                    Local
                </span>
            );

        case 'youtube':
            return (
                <span
                    title={track.sourceUrl ? `YouTube · ${track.sourceUrl}` : 'YouTube'}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400"
                >
                    <i className="fa-brands fa-youtube" />
                    YouTube
                </span>
            );

        case 'soundcloud':
            return (
                <span
                    title={track.sourceUrl ? `SoundCloud · ${track.sourceUrl}` : 'SoundCloud'}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/15 text-orange-400"
                >
                    <i className="fa-brands fa-soundcloud" />
                    SoundCloud
                </span>
            );

        case 'bandcamp':
            return (
                <span
                    title={track.sourceUrl ? `Bandcamp · ${track.sourceUrl}` : 'Bandcamp'}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/15 text-teal-400"
                >
                    <i className="fa-brands fa-bandcamp" />
                    Bandcamp
                </span>
            );

        default:
            // 'manual' or any unknown source
            return (
                <span
                    title="Manually added"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-high text-on-surface-variant"
                >
                    <i className="fa-solid fa-pen" />
                    Manual
                </span>
            );
    }
}

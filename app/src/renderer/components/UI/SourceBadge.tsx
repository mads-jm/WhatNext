/**
 * SourceBadge — shows the origin source of a track (Spotify, Local, etc.)
 * Extracted from LibraryView for reuse in TrackPickerModal and other contexts.
 */

import type { TrackDocType } from '../../db/schemas';

export function SourceBadge({ track }: { track: TrackDocType }) {
    if (track.spotifyId) {
        return (
            <span
                title={`Spotify · ${track.spotifyId}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/40 text-green-400"
            >
                <i className="fa-brands fa-spotify" />
                Spotify
            </span>
        );
    }
    return (
        <span
            title="Local file"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700 text-gray-400"
        >
            <i className="fa-solid fa-hard-drive" />
            Local
        </span>
    );
}

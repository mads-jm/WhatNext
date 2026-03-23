/**
 * DownloadTrackSelector — track list with checkboxes and format picker.
 * Reusable for both URL import and library download flows.
 */

import type { ResolvedTrack } from '../../../../../service/downloader/types';

const FORMAT_OPTIONS = [
    { value: 'best_audio', label: 'Best quality' },
    { value: 'opus', label: 'Opus' },
    { value: 'mp3', label: 'MP3' },
    { value: 'flac', label: 'FLAC' },
];

interface DownloadTrackSelectorProps {
    tracks: ResolvedTrack[];
    selectedIds: Set<string>;
    preferredFormat: string;
    onToggle: (sourceId: string) => void;
    onSelectAll: () => void;
    onSelectNone: () => void;
    onFormatChange: (format: string) => void;
    onConfirm: () => void;
    onBack: () => void;
    confirmLabel?: string;
}

export function DownloadTrackSelector({
    tracks,
    selectedIds,
    preferredFormat,
    onToggle,
    onSelectAll,
    onSelectNone,
    onFormatChange,
    onConfirm,
    onBack,
    confirmLabel = 'Download Selected',
}: DownloadTrackSelectorProps) {
    return (
        <div className="flex flex-col gap-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-sm text-on-surface-variant">
                    <span className="font-semibold text-on-surface">{tracks.length}</span> track
                    {tracks.length !== 1 ? 's' : ''} found
                    <span className="text-outline-variant">·</span>
                    <button onClick={onSelectAll} className="text-primary hover:underline">
                        All
                    </button>
                    <button onClick={onSelectNone} className="hover:underline">
                        None
                    </button>
                    <span className="text-outline-variant ml-1">
                        ({selectedIds.size} selected)
                    </span>
                </div>

                {/* Format picker */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-on-surface-variant uppercase tracking-widest">
                        Format
                    </span>
                    <select
                        value={preferredFormat}
                        onChange={(e) => onFormatChange(e.target.value)}
                        className="text-sm bg-surface-high text-on-surface border border-outline-variant/20 rounded-lg px-2 py-1"
                    >
                        {FORMAT_OPTIONS.map((f) => (
                            <option key={f.value} value={f.value}>
                                {f.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Track list */}
            <div className="border border-outline-variant/10 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-outline-variant/10">
                            <th className="w-10 px-3 py-2.5" />
                            {/* Thumbnail */}
                            <th className="w-10 px-1 py-2.5 hidden sm:table-cell" />
                            <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-widest text-on-surface-variant font-medium">
                                Title
                            </th>
                            <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-widest text-on-surface-variant font-medium hidden md:table-cell">
                                Artist
                            </th>
                            <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-widest text-on-surface-variant font-medium hidden lg:table-cell">
                                Source
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/5">
                        {tracks.map((track) => (
                            <TrackRow
                                key={track.sourceId}
                                track={track}
                                selected={selectedIds.has(track.sourceId)}
                                onToggle={() => onToggle(track.sourceId)}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
                <button
                    onClick={onBack}
                    className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                >
                    ← Back
                </button>
                <button
                    onClick={onConfirm}
                    disabled={selectedIds.size === 0}
                    className="px-5 py-2 text-sm font-bold bg-gradient-to-r from-primary to-primary-dim text-surface rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                    {confirmLabel}
                </button>
            </div>
        </div>
    );
}

interface TrackRowProps {
    track: ResolvedTrack;
    selected: boolean;
    onToggle: () => void;
}

function TrackRow({ track, selected, onToggle }: TrackRowProps) {
    return (
        <tr
            onClick={onToggle}
            className={`cursor-pointer transition-colors ${
                selected ? 'bg-primary/5' : 'hover:bg-surface-high'
            }`}
        >
            <td className="px-3 py-2.5">
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={onToggle}
                    onClick={(e) => e.stopPropagation()}
                    className="accent-primary"
                />
            </td>
            <td className="px-1 py-2 hidden sm:table-cell">
                {track.thumbnailUrl ? (
                    <img
                        src={track.thumbnailUrl}
                        alt=""
                        className="w-8 h-8 rounded object-cover"
                    />
                ) : (
                    <div className="w-8 h-8 rounded bg-surface-high flex items-center justify-center">
                        <i className="fa-solid fa-music text-[10px] text-on-surface-variant" />
                    </div>
                )}
            </td>
            <td className="px-3 py-2.5">
                <span className="font-medium text-on-surface truncate block max-w-xs">
                    {track.title || track.sourceId}
                </span>
            </td>
            <td className="px-3 py-2.5 hidden md:table-cell">
                <span className="text-on-surface-variant truncate block max-w-[160px]">
                    {track.artists.join(', ') || '—'}
                </span>
            </td>
            <td className="px-3 py-2.5 hidden lg:table-cell">
                <ProviderBadge provider={track.sourceProvider} />
            </td>
        </tr>
    );
}

function ProviderBadge({ provider }: { provider: ResolvedTrack['sourceProvider'] }) {
    const config: Record<string, { label: string; icon: string; color: string }> = {
        youtube: { label: 'YouTube', icon: 'fa-brands fa-youtube', color: 'text-red-400' },
        soundcloud: { label: 'SoundCloud', icon: 'fa-brands fa-soundcloud', color: 'text-orange-400' },
        bandcamp: { label: 'Bandcamp', icon: 'fa-solid fa-b', color: 'text-teal-400' },
        spotify: { label: 'Spotify', icon: 'fa-brands fa-spotify', color: 'text-green-400' },
    };
    const c = config[provider] ?? { label: provider, icon: 'fa-solid fa-globe', color: 'text-on-surface-variant' };
    return (
        <span className={`text-xs flex items-center gap-1 ${c.color}`}>
            <i className={c.icon} />
            {c.label}
        </span>
    );
}

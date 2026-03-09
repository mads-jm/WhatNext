/**
 * TrackPickerModal
 * Lets users browse the local Library and add tracks to a playlist.
 * The Library is the local-first canonical track pool — Spotify is just one source.
 */

import { useState, useEffect, useMemo, useReducer } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import type { TrackDocType } from '../../db/schemas';
import type { RxDocument } from 'rxdb';
import { formatDuration } from '../../utils/format';

interface TrackPickerModalProps {
    playlistId: string;
    existingTrackIds: string[];
    onAdd: (trackIds: string[]) => void;
    onClose: () => void;
}

type TracksState =
    | { status: 'loading'; allTracks: TrackDocType[] }
    | { status: 'done'; allTracks: TrackDocType[] }
    | { status: 'error'; allTracks: TrackDocType[] };

type TracksAction =
    | { type: 'SUCCESS'; allTracks: TrackDocType[] }
    | { type: 'ERROR' };

function tracksReducer(state: TracksState, action: TracksAction): TracksState {
    switch (action.type) {
        case 'SUCCESS':
            return { status: 'done', allTracks: action.allTracks };
        case 'ERROR':
            return { status: 'error', allTracks: state.allTracks };
    }
}

export function TrackPickerModal({ existingTrackIds, onAdd, onClose }: TrackPickerModalProps) {
    const { db } = useDatabase();
    const [tracksState, dispatchTracks] = useReducer(tracksReducer, { status: 'loading', allTracks: [] });
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [adding, setAdding] = useState(false);

    const allTracks = tracksState.allTracks;
    const loading = tracksState.status === 'loading';

    // Reactive subscription to all tracks
    useEffect(() => {
        if (!db) return;

        const subscription = db.tracks.find({
            sort: [{ addedAt: 'desc' }],
        }).$.subscribe({
            next: (docs: RxDocument<TrackDocType>[]) => {
                dispatchTracks({ type: 'SUCCESS', allTracks: docs.map((d) => d.toJSON() as TrackDocType) });
            },
            error: () => dispatchTracks({ type: 'ERROR' }),
        });

        return () => subscription.unsubscribe();
    }, [db]);

    // Filter: exclude already-in-playlist, apply search
    const existingSet = useMemo(() => new Set(existingTrackIds), [existingTrackIds]);

    const filteredTracks = useMemo(() => {
        const q = search.toLowerCase().trim();
        return allTracks.filter((t) => {
            if (existingSet.has(t.id)) return false;
            if (!q) return true;
            return (
                t.title.toLowerCase().includes(q) ||
                t.artists.some((a) => a.toLowerCase().includes(q)) ||
                t.album.toLowerCase().includes(q)
            );
        });
    }, [allTracks, existingSet, search]);

    const toggleTrack = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const toggleAll = () => {
        if (selected.size === filteredTracks.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(filteredTracks.map((t) => t.id)));
        }
    };

    const handleAdd = async () => {
        if (selected.size === 0) return;
        setAdding(true);
        onAdd([...selected]);
    };

    const availableCount = allTracks.length - existingSet.size;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            role="button"
            tabIndex={0}
            onClick={(e) => e.target === e.currentTarget && onClose()}
            onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) onClose();
            }}
        >
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Add tracks from Library</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {availableCount === 0
                                ? 'No tracks available — import from Spotify first'
                                : `${availableCount} track${availableCount !== 1 ? 's' : ''} available`}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-gray-400 hover:text-gray-200 rounded-md hover:bg-gray-800 transition-colors"
                    >
                        <i className="fa-solid fa-xmark text-lg" />
                    </button>
                </div>

                {/* Search */}
                <div className="px-5 py-3 border-b border-gray-800">
                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                        <input
                            type="text"
                            placeholder="Search title, artist, album…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                </div>

                {/* Track list */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-gray-500">
                            <i className="fa-solid fa-spinner fa-spin mr-2" />
                            Loading Library…
                        </div>
                    ) : filteredTracks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                            <i className="fa-solid fa-music text-3xl mb-3 text-gray-700" />
                            {availableCount === 0
                                ? <p className="text-sm">All Library tracks are already in this playlist.</p>
                                : <p className="text-sm">No tracks match your search.</p>}
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                                <tr className="text-xs text-gray-500 uppercase tracking-wide">
                                    <th className="px-4 py-2 w-10">
                                        <input
                                            type="checkbox"
                                            checked={selected.size === filteredTracks.length && filteredTracks.length > 0}
                                            onChange={toggleAll}
                                            className="accent-blue-500"
                                        />
                                    </th>
                                    <th className="px-3 py-2 text-left">Title</th>
                                    <th className="px-3 py-2 text-left hidden sm:table-cell">Album</th>
                                    <th className="px-3 py-2 text-right">Dur.</th>
                                    <th className="px-3 py-2 w-16 text-center">Source</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTracks.map((track) => (
                                    <tr
                                        key={track.id}
                                        onClick={() => toggleTrack(track.id)}
                                        className={`cursor-pointer border-b border-gray-800/50 transition-colors ${
                                            selected.has(track.id)
                                                ? 'bg-blue-900/20'
                                                : 'hover:bg-gray-800/40'
                                        }`}
                                    >
                                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={selected.has(track.id)}
                                                onChange={() => toggleTrack(track.id)}
                                                className="accent-blue-500"
                                            />
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="font-medium text-gray-200 truncate max-w-[200px]">{track.title}</div>
                                            <div className="text-xs text-gray-500 truncate">{track.artists.join(', ')}</div>
                                        </td>
                                        <td className="px-3 py-2.5 text-gray-400 hidden sm:table-cell truncate max-w-[150px]">
                                            {track.album}
                                        </td>
                                        <td className="px-3 py-2.5 text-gray-500 text-right tabular-nums">
                                            {formatDuration(track.durationMs)}
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            {track.spotifyId ? (
                                                <span title="Spotify" className="text-green-500">
                                                    <i className="fa-brands fa-spotify" />
                                                </span>
                                            ) : (
                                                <span title="Local" className="text-gray-600">
                                                    <i className="fa-solid fa-hard-drive" />
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800">
                    <span className="text-sm text-gray-400">
                        {selected.size > 0
                            ? `${selected.size} track${selected.size !== 1 ? 's' : ''} selected`
                            : 'Select tracks to add'}
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 rounded-lg hover:bg-gray-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAdd}
                            disabled={selected.size === 0 || adding}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                        >
                            <i className={`fa-solid ${adding ? 'fa-spinner fa-spin' : 'fa-plus'}`} />
                            Add {selected.size > 0 ? selected.size : ''} track{selected.size !== 1 ? 's' : ''}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

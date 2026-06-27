/**
 * LibraryView — v0.1
 * The local-first canonical track pool.
 * All tracks ever imported into WhatNext, regardless of source.
 * Spotify tracks are denoted with a Spotify icon; future sources will have their own badges.
 */

import { useState, useEffect, useMemo, useReducer } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useAddToPlaylist } from '../../hooks/useAddToPlaylist';
import type { TrackDocType, PlaylistDocType } from '../../db/schemas';
import type { RxDocument } from 'rxdb';
import { formatDuration } from '../../utils/format';
import { artSrc } from '../../utils/artSrc';
import { SourceBadge } from '../UI/SourceBadge';

type TracksState =
    | { status: 'loading'; tracks: TrackDocType[] }
    | { status: 'done'; tracks: TrackDocType[] }
    | { status: 'error'; tracks: TrackDocType[] };

type TracksAction =
    | { type: 'SUCCESS'; tracks: TrackDocType[] }
    | { type: 'ERROR' };

function tracksReducer(state: TracksState, action: TracksAction): TracksState {
    switch (action.type) {
        case 'SUCCESS':
            return { status: 'done', tracks: action.tracks };
        case 'ERROR':
            return { status: 'error', tracks: state.tracks };
    }
}

export function LibraryView() {
    const { db } = useDatabase();
    const { addingTo, feedback: addedFeedback, add: addToPlaylist } = useAddToPlaylist();
    const [tracksState, dispatchTracks] = useReducer(tracksReducer, { status: 'loading', tracks: [] });
    const [playlists, setPlaylists] = useState<PlaylistDocType[]>([]);
    const [search, setSearch] = useState('');
    const [sourceFilter, setSourceFilter] = useState<'all' | 'spotify' | 'local' | 'youtube' | 'soundcloud' | 'bandcamp' | 'manual'>('all');

    const tracks = tracksState.tracks;
    const loading = tracksState.status === 'loading';

    // Reactive track subscription
    useEffect(() => {
        if (!db) return;
        const sub = db.tracks.find({ sort: [{ addedAt: 'desc' }] }).$.subscribe({
            next: (docs: RxDocument<TrackDocType>[]) => {
                dispatchTracks({ type: 'SUCCESS', tracks: docs.map((d) => d.toJSON() as TrackDocType) });
            },
            error: () => dispatchTracks({ type: 'ERROR' }),
        });
        return () => sub.unsubscribe();
    }, [db]);

    // Reactive playlist subscription (for "add to playlist" dropdown)
    useEffect(() => {
        if (!db) return;
        const sub = db.playlists.find({ sort: [{ updatedAt: 'desc' }] }).$.subscribe({
            next: (docs: RxDocument<PlaylistDocType>[]) => {
                setPlaylists(docs.map((d) => d.toJSON() as PlaylistDocType));
            },
        });
        return () => sub.unsubscribe();
    }, [db]);

    // Resolve the effective source for a track (with pre-migration fallback)
    const resolveSource = (t: TrackDocType): string =>
        t.source ?? (t.spotifyId ? 'spotify' : 'manual');

    // Filter tracks
    const filteredTracks = useMemo(() => {
        const q = search.toLowerCase().trim();
        return tracks.filter((t) => {
            // Source filter — uses source field with fallback for pre-migration tracks
            if (sourceFilter !== 'all' && resolveSource(t) !== sourceFilter) return false;
            // Text search
            if (!q) return true;
            return (
                t.title.toLowerCase().includes(q) ||
                t.artists.some((a) => a.toLowerCase().includes(q)) ||
                t.album.toLowerCase().includes(q)
            );
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tracks, search, sourceFilter]);

    const spotifyCount = tracks.filter((t) => resolveSource(t) === 'spotify').length;
    const localCount = tracks.filter((t) => resolveSource(t) === 'local').length;
    const youtubeCount = tracks.filter((t) => resolveSource(t) === 'youtube').length;
    const soundcloudCount = tracks.filter((t) => resolveSource(t) === 'soundcloud').length;
    const bandcampCount = tracks.filter((t) => resolveSource(t) === 'bandcamp').length;

    const handleAddToPlaylist = (trackId: string, playlistId: string) => {
        const pl = playlists.find((p) => p.id === playlistId);
        addToPlaylist(trackId, playlistId, pl?.playlistName ?? 'playlist');
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="card mb-4">
                <div className="card-body">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-bold mb-1">Library</h2>
                            <p className="text-sm text-on-surface-variant">
                                Your local-first track collection — every track imported into WhatNext lives here.
                            </p>
                        </div>
                        <div className="text-right shrink-0">
                            <p className="text-3xl font-bold text-on-surface">{tracks.length}</p>
                            <p className="text-xs text-on-surface-variant">tracks</p>
                        </div>
                    </div>

                    {/* Source breakdown */}
                    <div className="flex flex-wrap gap-3 mt-4">
                        <button
                            onClick={() => setSourceFilter('all')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                sourceFilter === 'all'
                                    ? 'bg-primary text-surface'
                                    : 'bg-surface-high text-on-surface-variant hover:bg-outline-variant'
                            }`}
                        >
                            <i className="fa-solid fa-layer-group" />
                            All <span className="font-semibold">{tracks.length}</span>
                        </button>
                        <button
                            onClick={() => setSourceFilter('spotify')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                sourceFilter === 'spotify'
                                    ? 'bg-primary text-surface'
                                    : 'bg-surface-high text-on-surface-variant hover:bg-outline-variant'
                            }`}
                        >
                            <i className="fa-brands fa-spotify" />
                            Spotify <span className="font-semibold">{spotifyCount}</span>
                        </button>
                        <button
                            onClick={() => setSourceFilter('local')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                sourceFilter === 'local'
                                    ? 'bg-primary text-surface'
                                    : 'bg-surface-high text-on-surface-variant hover:bg-outline-variant'
                            }`}
                        >
                            <i className="fa-solid fa-hard-drive" />
                            Local Files <span className="font-semibold">{localCount}</span>
                        </button>
                        {youtubeCount > 0 && (
                            <button
                                onClick={() => setSourceFilter('youtube')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                    sourceFilter === 'youtube'
                                        ? 'bg-primary text-surface'
                                        : 'bg-surface-high text-on-surface-variant hover:bg-outline-variant'
                                }`}
                            >
                                <i className="fa-brands fa-youtube" />
                                YouTube <span className="font-semibold">{youtubeCount}</span>
                            </button>
                        )}
                        {soundcloudCount > 0 && (
                            <button
                                onClick={() => setSourceFilter('soundcloud')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                    sourceFilter === 'soundcloud'
                                        ? 'bg-primary text-surface'
                                        : 'bg-surface-high text-on-surface-variant hover:bg-outline-variant'
                                }`}
                            >
                                <i className="fa-brands fa-soundcloud" />
                                SoundCloud <span className="font-semibold">{soundcloudCount}</span>
                            </button>
                        )}
                        {bandcampCount > 0 && (
                            <button
                                onClick={() => setSourceFilter('bandcamp')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                    sourceFilter === 'bandcamp'
                                        ? 'bg-primary text-surface'
                                        : 'bg-surface-high text-on-surface-variant hover:bg-outline-variant'
                                }`}
                            >
                                <i className="fa-brands fa-bandcamp" />
                                Bandcamp <span className="font-semibold">{bandcampCount}</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Search + feedback */}
            <div className="flex items-center gap-3 mb-3">
                <div className="relative flex-1">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm" />
                    <input
                        type="text"
                        placeholder="Search title, artist, album…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-surface-high border border-outline-variant rounded-lg text-sm text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-primary"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                        >
                            <i className="fa-solid fa-xmark" />
                        </button>
                    )}
                </div>
                {addedFeedback && (
                    <span className="text-xs text-primary flex items-center gap-1 whitespace-nowrap">
                        <i className="fa-solid fa-check" />
                        {addedFeedback}
                    </span>
                )}
            </div>

            {/* Track table */}
            <div className="card flex-1 overflow-hidden flex flex-col">
                <div className="card-header flex items-center justify-between">
                    <span className="font-medium">
                        {search || sourceFilter !== 'all'
                            ? `${filteredTracks.length} of ${tracks.length} tracks`
                            : `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`}
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-on-surface-variant">
                            <i className="fa-solid fa-spinner fa-spin mr-2" />
                            Loading Library…
                        </div>
                    ) : tracks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
                            <i className="fa-solid fa-music text-5xl mb-4 text-on-surface-variant" />
                            <h3 className="text-lg font-medium mb-2">Library is empty</h3>
                            <p className="text-sm text-center max-w-xs">
                                Import tracks from Spotify to populate your Library. All imported tracks appear here regardless of which playlist they're in.
                            </p>
                        </div>
                    ) : filteredTracks.length === 0 ? (
                        <div className="flex items-center justify-center py-16 text-on-surface-variant">
                            <p className="text-sm">No tracks match your search.</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead className="sticky top-0 bg-surface text-xs text-on-surface-variant uppercase border-b border-outline-variant">
                                <tr>
                                    <th className="text-left px-4 py-2 w-8">#</th>
                                    <th className="text-left px-4 py-2">Title</th>
                                    <th className="text-left px-4 py-2 hidden md:table-cell">Album</th>
                                    <th className="text-left px-4 py-2 w-24">Source</th>
                                    <th className="text-right px-4 py-2 w-16">Dur.</th>
                                    <th className="px-4 py-2 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTracks.map((track, idx) => (
                                    <tr
                                        key={track.id}
                                        className="border-b border-outline-variant/50 hover:bg-surface-high/30 transition-colors group"
                                    >
                                        <td className="px-4 py-2.5 text-on-surface-variant text-sm tabular-nums">
                                            {idx + 1}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-3">
                                                {artSrc(track.albumArtLocalPath, track.albumArtUrl) ? (
                                                    <img
                                                        src={artSrc(track.albumArtLocalPath, track.albumArtUrl)}
                                                        alt=""
                                                        className="w-9 h-9 rounded object-cover shrink-0"
                                                        onError={(e) => {
                                                            if (track.albumArtUrl) e.currentTarget.src = track.albumArtUrl;
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-9 h-9 rounded bg-surface-high flex items-center justify-center shrink-0">
                                                        <i className="fa-solid fa-music text-on-surface-variant text-xs" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="font-medium text-on-surface truncate max-w-[200px]">
                                                        {track.title}
                                                    </div>
                                                    <div className="text-xs text-on-surface-variant truncate">
                                                        {track.artists.join(', ')}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2.5 text-sm text-on-surface-variant hidden md:table-cell truncate max-w-[160px]">
                                            {track.album}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <SourceBadge track={track} />
                                        </td>
                                        <td className="px-4 py-2.5 text-right text-sm text-on-surface-variant tabular-nums">
                                            {formatDuration(track.durationMs)}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {/* Add to playlist dropdown */}
                                            {playlists.length > 0 && (
                                                <div className="relative group/add">
                                                    <button
                                                        disabled={addingTo?.trackId === track.id}
                                                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-high transition-all disabled:opacity-50"
                                                        title="Add to playlist"
                                                    >
                                                        {addingTo?.trackId === track.id ? (
                                                            <i className="fa-solid fa-spinner fa-spin text-xs" />
                                                        ) : (
                                                            <i className="fa-solid fa-plus text-xs" />
                                                        )}
                                                    </button>
                                                    {/* Dropdown on hover */}
                                                    <div className="hidden group-hover/add:block absolute right-0 top-full mt-1 w-52 bg-surface-high border border-outline-variant rounded-lg shadow-xl z-10 py-1">
                                                        <p className="px-3 py-1.5 text-[10px] text-on-surface-variant uppercase tracking-wide font-semibold border-b border-outline-variant mb-1">
                                                            Add to playlist
                                                        </p>
                                                        {playlists.map((pl) => (
                                                            <button
                                                                key={pl.id}
                                                                onClick={() => handleAddToPlaylist(track.id, pl.id)}
                                                                className="w-full text-left px-3 py-2 text-sm text-on-surface hover:bg-surface-high hover:text-on-surface transition-colors truncate"
                                                            >
                                                                {pl.playlistName}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

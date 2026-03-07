/**
 * LibraryView — v0.1
 * The local-first canonical track pool.
 * All tracks ever imported into WhatNext, regardless of source.
 * Spotify tracks are denoted with a Spotify icon; future sources will have their own badges.
 */

import { useState, useEffect, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useAddToPlaylist } from '../../hooks/useAddToPlaylist';
import type { TrackDocType, PlaylistDocType } from '../../db/schemas';
import type { RxDocument } from 'rxdb';
import { formatDuration } from '../../utils/format';
import { SourceBadge } from '../UI/SourceBadge';

export function LibraryView() {
    const { db } = useDatabase();
    const { addingTo, feedback: addedFeedback, add: addToPlaylist } = useAddToPlaylist();
    const [tracks, setTracks] = useState<TrackDocType[]>([]);
    const [playlists, setPlaylists] = useState<PlaylistDocType[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [sourceFilter, setSourceFilter] = useState<'all' | 'spotify' | 'local'>('all');

    // Reactive track subscription
    useEffect(() => {
        if (!db) return;
        const sub = db.tracks.find({ sort: [{ addedAt: 'desc' }] }).$.subscribe({
            next: (docs: RxDocument<TrackDocType>[]) => {
                setTracks(docs.map((d) => d.toJSON() as TrackDocType));
                setLoading(false);
            },
            error: () => setLoading(false),
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

    // Filter tracks
    const filteredTracks = useMemo(() => {
        const q = search.toLowerCase().trim();
        return tracks.filter((t) => {
            // Source filter
            if (sourceFilter === 'spotify' && !t.spotifyId) return false;
            if (sourceFilter === 'local' && t.spotifyId) return false;
            // Text search
            if (!q) return true;
            return (
                t.title.toLowerCase().includes(q) ||
                t.artists.some((a) => a.toLowerCase().includes(q)) ||
                t.album.toLowerCase().includes(q)
            );
        });
    }, [tracks, search, sourceFilter]);

    const spotifyCount = useMemo(() => tracks.filter((t) => t.spotifyId).length, [tracks]);
    const localCount = useMemo(() => tracks.filter((t) => !t.spotifyId).length, [tracks]);

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
                            <p className="text-sm text-gray-400">
                                Your local-first track collection — every track imported into WhatNext lives here.
                            </p>
                        </div>
                        <div className="text-right shrink-0">
                            <p className="text-3xl font-bold text-white">{tracks.length}</p>
                            <p className="text-xs text-gray-500">tracks</p>
                        </div>
                    </div>

                    {/* Source breakdown */}
                    <div className="flex gap-3 mt-4">
                        <button
                            onClick={() => setSourceFilter('all')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                sourceFilter === 'all'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                        >
                            <i className="fa-solid fa-layer-group" />
                            All <span className="font-semibold">{tracks.length}</span>
                        </button>
                        <button
                            onClick={() => setSourceFilter('spotify')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                sourceFilter === 'spotify'
                                    ? 'bg-green-700 text-white'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                        >
                            <i className="fa-brands fa-spotify" />
                            Spotify <span className="font-semibold">{spotifyCount}</span>
                        </button>
                        <button
                            onClick={() => setSourceFilter('local')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                sourceFilter === 'local'
                                    ? 'bg-gray-600 text-white'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                        >
                            <i className="fa-solid fa-hard-drive" />
                            Local <span className="font-semibold">{localCount}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Search + feedback */}
            <div className="flex items-center gap-3 mb-3">
                <div className="relative flex-1">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                    <input
                        type="text"
                        placeholder="Search title, artist, album…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                            <i className="fa-solid fa-xmark" />
                        </button>
                    )}
                </div>
                {addedFeedback && (
                    <span className="text-xs text-green-400 flex items-center gap-1 whitespace-nowrap">
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
                        <div className="flex items-center justify-center py-16 text-gray-500">
                            <i className="fa-solid fa-spinner fa-spin mr-2" />
                            Loading Library…
                        </div>
                    ) : tracks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                            <i className="fa-solid fa-music text-5xl mb-4 text-gray-700" />
                            <h3 className="text-lg font-medium mb-2">Library is empty</h3>
                            <p className="text-sm text-center max-w-xs">
                                Import tracks from Spotify to populate your Library. All imported tracks appear here regardless of which playlist they're in.
                            </p>
                        </div>
                    ) : filteredTracks.length === 0 ? (
                        <div className="flex items-center justify-center py-16 text-gray-600">
                            <p className="text-sm">No tracks match your search.</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead className="sticky top-0 bg-gray-900 text-xs text-gray-500 uppercase border-b border-gray-800">
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
                                        className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors group"
                                    >
                                        <td className="px-4 py-2.5 text-gray-600 text-sm tabular-nums">
                                            {idx + 1}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <div className="font-medium text-gray-200 truncate max-w-[220px]">
                                                {track.title}
                                            </div>
                                            <div className="text-xs text-gray-500 truncate">
                                                {track.artists.join(', ')}
                                            </div>
                                        </td>
                                        <td className="px-4 py-2.5 text-sm text-gray-400 hidden md:table-cell truncate max-w-[160px]">
                                            {track.album}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <SourceBadge track={track} />
                                        </td>
                                        <td className="px-4 py-2.5 text-right text-sm text-gray-500 tabular-nums">
                                            {formatDuration(track.durationMs)}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {/* Add to playlist dropdown */}
                                            {playlists.length > 0 && (
                                                <div className="relative group/add">
                                                    <button
                                                        disabled={addingTo?.trackId === track.id}
                                                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-all disabled:opacity-50"
                                                        title="Add to playlist"
                                                    >
                                                        {addingTo?.trackId === track.id ? (
                                                            <i className="fa-solid fa-spinner fa-spin text-xs" />
                                                        ) : (
                                                            <i className="fa-solid fa-plus text-xs" />
                                                        )}
                                                    </button>
                                                    {/* Dropdown on hover */}
                                                    <div className="hidden group-hover/add:block absolute right-0 top-full mt-1 w-52 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 py-1">
                                                        <p className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wide font-semibold border-b border-gray-700 mb-1">
                                                            Add to playlist
                                                        </p>
                                                        {playlists.map((pl) => (
                                                            <button
                                                                key={pl.id}
                                                                onClick={() => handleAddToPlaylist(track.id, pl.id)}
                                                                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors truncate"
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

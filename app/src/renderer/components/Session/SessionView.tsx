/**
 * SessionView
 * Primary session UI. Renders setup flow or active session depending on state.
 */

import { useState, useEffect } from 'react';
import { useNavigationStore } from '../../stores/navigation-store';
import { useUserStore } from '../../stores/user-store';
import { useSessionState } from '../../hooks/useSessionState';
import { usePlaybackState } from '../../hooks/usePlaybackState';
import { useTrackSource } from '../../hooks/useTrackSource';
import { getDatabase } from '../../db/database';
import type { PlaylistDocType, TrackDocType, UserDocType } from '../../db/schemas';
import { SessionSetup } from './SessionSetup';
import { PlaybackBar } from './PlaybackBar';
import { ReactionBar } from '../Social/ReactionBar';
import { PlaylistComments } from '../Social/PlaylistComments';

interface SessionViewProps {
    playlistId?: string;
}

export function SessionView({ playlistId }: SessionViewProps) {
    const sessionPlaylistId = useNavigationStore((s) => s.sessionPlaylistId);
    const navigate = useNavigationStore((s) => s.navigate);
    const endSession = useNavigationStore((s) => s.endSession);
    const user = useUserStore((s) => s.user);
    const userId = useUserStore((s) => s.userId);

    const activeId = playlistId ?? sessionPlaylistId ?? null;

    const { sessionState, isActiveSession } = useSessionState(activeId ?? '');

    const [playlist, setPlaylist] = useState<PlaylistDocType | null>(null);
    const [tracks, setTracks] = useState<TrackDocType[]>([]);
    const [participants, setParticipants] = useState<UserDocType[]>([]);
    const [currentTurnUser, setCurrentTurnUser] = useState<UserDocType | null>(null);

    // Subscribe to playlist changes reactively
    useEffect(() => {
        if (!activeId) return;
        let sub: { unsubscribe: () => void } | null = null;
        let alive = true;

        getDatabase().then((db) => {
            if (!alive) return;
            sub = db.playlists
                .findOne(activeId)
                .$.subscribe((doc) => {
                    if (alive) setPlaylist(doc ? doc.toJSON() as PlaylistDocType : null);
                });
        });

        return () => {
            alive = false;
            sub?.unsubscribe();
        };
    }, [activeId]);

    // Subscribe to track list reactively, maintain playlist order
    useEffect(() => {
        if (!playlist || playlist.trackIds.length === 0) {
            setTracks([]);
            return;
        }
        const ids = playlist.trackIds;
        let sub: { unsubscribe: () => void } | null = null;
        let alive = true;

        getDatabase().then((db) => {
            if (!alive) return;
            sub = db.tracks
                .find({ selector: { id: { $in: ids } } })
                .$.subscribe((docs) => {
                    if (alive) {
                        const ordered = ids
                            .map((id) => docs.find((d) => d.id === id))
                            .filter((d): d is NonNullable<typeof d> => d !== undefined)
                            .map((d) => d.toJSON() as TrackDocType);
                        setTracks(ordered);
                    }
                });
        });

        return () => {
            alive = false;
            sub?.unsubscribe();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playlist?.trackIds.join(',')]);

    // Load participants by ID
    useEffect(() => {
        if (!sessionState) return;
        const ids = sessionState.participantIds;
        let alive = true;

        getDatabase().then((db) => {
            db.users
                .findByIds(ids)
                .exec()
                .then((map) => {
                    if (!alive) return;
                    setParticipants(
                        ids
                            .map((id) => map.get(id))
                            .filter((u): u is NonNullable<typeof u> => u !== undefined)
                            .map((u) => u.toJSON() as UserDocType)
                    );
                });
        });

        return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionState?.participantIds.join(',')]);

    // Resolve current turn user display name
    useEffect(() => {
        const turnId = playlist?.currentTurnUserId;
        if (!turnId) { setCurrentTurnUser(null); return; }
        let alive = true;

        getDatabase().then((db) => {
            db.users.findOne(turnId).exec().then((doc) => {
                if (alive) setCurrentTurnUser(doc ? doc.toJSON() as UserDocType : null);
            });
        });

        return () => { alive = false; };
    }, [playlist?.currentTurnUserId]);

    const isSpotifyPlayback = sessionState?.playbackProvider.type === 'spotify';
    const spotifyContextUri = playlist?.linkedSpotifyId
        ? `spotify:playlist:${playlist.linkedSpotifyId}`
        : undefined;

    const { error: trackSourceError } = useTrackSource({
        config: sessionState?.trackSource ?? { type: 'manual' },
        playlistId: activeId ?? '',
        enabled: isActiveSession,
    });

    const { state: playbackState } = usePlaybackState(isActiveSession && isSpotifyPlayback);

    // ----------------------------------------
    // Empty state
    // ----------------------------------------
    if (!activeId) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center text-gray-600">
                    <i className="fa-solid fa-satellite-dish text-4xl mb-4" />
                    <h3 className="text-lg font-medium text-gray-400 mb-2">No Active Session</h3>
                    <p className="text-sm">Open a collaborative playlist to start a session</p>
                </div>
            </div>
        );
    }

    // ----------------------------------------
    // Setup — no active session yet
    // ----------------------------------------
    if (!isActiveSession) {
        return <SessionSetup playlistId={activeId} onStart={() => {}} />;
    }

    // ----------------------------------------
    // Active session
    // ----------------------------------------
    const isMyTurn =
        playlist?.queueMode === 'turn_taking' &&
        playlist.currentTurnUserId === userId;

    const handleEndSession = () => {
        endSession();
        navigate('playlists');
    };

    return (
        <div className="space-y-4">
            {/* Header row */}
            <div className="flex items-center gap-3">
                <button className="btn-ghost text-sm" onClick={handleEndSession}>
                    <i className="fa-solid fa-arrow-left mr-2" />
                    End Session
                </button>
                {trackSourceError && (
                    <span className="text-xs text-red-400">
                        <i className="fa-solid fa-triangle-exclamation mr-1" />
                        Sync error: {trackSourceError}
                    </span>
                )}
            </div>

            {/* Playback bar */}
            {isSpotifyPlayback && (
                <PlaybackBar enabled contextUri={spotifyContextUri} />
            )}

            {/* Turn indicator */}
            {playlist?.queueMode === 'turn_taking' && (
                <div className={`card card-body flex items-center gap-3 ${
                    isMyTurn ? 'border-green-600/60 bg-green-900/20' : 'border-gray-700'
                }`}>
                    {isMyTurn ? (
                        <>
                            <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                            </span>
                            <span className="text-sm font-semibold text-green-400">
                                Your turn! Add a track on Spotify.
                            </span>
                        </>
                    ) : (
                        <>
                            <i className="fa-solid fa-hourglass-half text-gray-500 text-sm" />
                            <span className="text-sm text-gray-400">
                                Waiting for{' '}
                                <span className="font-medium text-gray-300">
                                    {currentTurnUser?.displayName ?? 'someone'}
                                </span>
                                ...
                            </span>
                        </>
                    )}
                </div>
            )}

            {/* Session info row */}
            <div className="card card-body flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
                        <i className="fa-solid fa-music text-white text-sm" />
                    </div>
                    <div>
                        <p className="font-semibold text-gray-100">{playlist?.playlistName ?? 'Loading...'}</p>
                        <p className="text-xs text-gray-500">
                            {tracks.length} tracks &middot; {participants.length} participant{participants.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>
                <button
                    className="btn-ghost text-sm"
                    onClick={() => user && navigator.clipboard.writeText(activeId)}
                    title="Copy session ID"
                >
                    <i className="fa-solid fa-share-nodes mr-1" />
                    Share
                </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
                {/* Participant roster */}
                <div className="card col-span-1">
                    <div className="card-header">
                        <span className="font-medium text-sm">Participants</span>
                    </div>
                    <div className="card-body space-y-3">
                        {participants.map((p) => {
                            const trackCount = tracks.filter((t) => t.addedBy === p.id).length;
                            const isTurn = playlist?.currentTurnUserId === p.id;

                            return (
                                <div key={p.id} className="flex items-center gap-2">
                                    <div className="relative">
                                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-300">
                                            {p.displayName.charAt(0).toUpperCase()}
                                        </div>
                                        {isTurn && (
                                            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border border-gray-900" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-200 truncate">
                                            {p.displayName}
                                            {p.id === userId && (
                                                <span className="ml-1 text-xs text-gray-500">(you)</span>
                                            )}
                                        </p>
                                    </div>
                                    {trackCount > 0 && (
                                        <span className="text-xs text-gray-500 shrink-0">{trackCount}</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Track list */}
                <div className="card col-span-2">
                    <div className="card-header flex items-center justify-between">
                        <span className="font-medium text-sm">Tracks ({tracks.length})</span>
                        {sessionState?.trackSource.type === 'spotify-collab' && (
                            <span className="text-xs text-gray-500">
                                <i className="fa-brands fa-spotify text-green-500 mr-1" />
                                Live sync
                            </span>
                        )}
                    </div>
                    <div className="card-body space-y-1 max-h-96 overflow-y-auto">
                        {tracks.length === 0 ? (
                            <div className="text-center py-10 text-gray-600">
                                <i className="fa-solid fa-music text-3xl mb-3" />
                                <p className="text-sm">No tracks yet</p>
                            </div>
                        ) : (
                            tracks.map((track, index) => {
                                const adder = participants.find((p) => p.id === track.addedBy);
                                const isNowPlaying =
                                    track.spotifyId != null &&
                                    track.spotifyId === playbackState?.currentTrackExternalId;

                                return (
                                    <div
                                        key={track.id}
                                        className={`flex flex-col gap-1 px-3 py-2 rounded-md ${
                                            isNowPlaying
                                                ? 'bg-green-900/30 border border-green-700/40'
                                                : 'hover:bg-gray-800/60'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="w-6 text-xs text-gray-600 text-right shrink-0">
                                                {isNowPlaying
                                                    ? <i className="fa-solid fa-volume-high text-green-500" />
                                                    : index + 1}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-medium truncate ${isNowPlaying ? 'text-green-400' : 'text-gray-200'}`}>
                                                    {track.title}
                                                </p>
                                                <p className="text-xs text-gray-500 truncate">
                                                    {track.artists.join(', ')}
                                                </p>
                                            </div>
                                            {adder && (
                                                <span className="text-xs text-gray-500 shrink-0">
                                                    {adder.displayName}
                                                </span>
                                            )}
                                        </div>
                                        <div className="pl-9">
                                            <ReactionBar trackId={track.id} playlistId={activeId} />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Comments */}
            <PlaylistComments playlistId={activeId} />
        </div>
    );
}

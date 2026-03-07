import { useState, useEffect } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useUserStore } from '../../stores/user-store';
import { useNavigationStore } from '../../stores/navigation-store';
import { useRxDBDocument } from '../../hooks/useRxDBCollection';
import { useP2PStatus } from '../../hooks/useP2PStatus';
import { useSessionState } from '../../hooks/useSessionState';
import { findTrackViewModels } from '../../db/query-helpers';
import type { PlaylistDocType } from '../../db/schemas';
import type { TrackViewModel } from '../../db/types';
import { ReactionBar } from '../Social/ReactionBar';
import { PlaylistComments } from '../Social/PlaylistComments';

interface SessionViewProps {
    playlistId?: string;
}

export function SessionView({ playlistId }: SessionViewProps) {
    const navigate = useNavigationStore((s) => s.navigate);
    const { db } = useDatabase();
    const userId = useUserStore((s) => s.userId);
    const p2p = useP2PStatus();

    const { doc: playlist } = useRxDBDocument<PlaylistDocType>(
        () => db && playlistId ? db.playlists.findOne(playlistId).exec() : null,
        [db, playlistId]
    );

    const [tracks, setTracks] = useState<TrackViewModel[]>([]);
    useEffect(() => {
        if (!db || !playlist) { setTracks([]); return; }
        const trackIds = playlist.trackIds;
        if (trackIds.length === 0) { setTracks([]); return; }

        findTrackViewModels(db, trackIds).then(setTracks);
    }, [db, playlist?.trackIds]);

    const { isTurnTaking, isMyTurn, currentTurnUser } = useSessionState(playlist, userId);

    const copyConnectUrl = () => {
        if (p2p.peerId) {
            navigator.clipboard.writeText(`whtnxt://connect/${p2p.peerId}`);
        }
    };

    if (!playlistId) {
        return (
            <div className="flex items-center justify-center h-full text-gray-600">
                <div className="text-center">
                    <i className="fa-solid fa-satellite-dish text-4xl mb-4" />
                    <h3 className="text-lg font-medium mb-2">No Active Session</h3>
                    <p className="text-sm">Open a collaborative playlist and start a session</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <button onClick={() => navigate('playlists')} className="btn-ghost text-sm">
                <i className="fa-solid fa-arrow-left mr-2" />
                Back to Playlists
            </button>

            {/* Turn Indicator Banner */}
            {isTurnTaking && (
                <div className={`rounded-xl p-4 text-center ${
                    isMyTurn
                        ? 'bg-green-900/40 border border-green-700 animate-pulse'
                        : 'bg-gray-800 border border-gray-700'
                }`}>
                    {isMyTurn ? (
                        <div>
                            <div className="text-2xl font-bold text-green-400 mb-1">
                                Your turn!
                            </div>
                            <div className="text-sm text-green-300/70">
                                Add a track to the playlist
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div className="text-lg font-medium text-gray-400 mb-1">
                                Waiting for {currentTurnUser}...
                            </div>
                            <div className="text-sm text-gray-500">
                                They're choosing the next track
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Session Info Cards */}
            <div className="grid grid-cols-3 gap-4">
                <div className="card">
                    <div className="card-body">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Playlist</div>
                        <div className="font-bold text-gray-100">{playlist?.playlistName || 'Loading...'}</div>
                        <div className="text-sm text-gray-400 mt-1">{tracks.length} tracks</div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-body">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Connected Peers</div>
                        <div className="font-bold text-gray-100">{p2p.connectedPeers.length}</div>
                        <div className="text-sm text-gray-400 mt-1">
                            {p2p.nodeStarted ? 'Online' : 'Connecting...'}
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-body">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Share</div>
                        <button onClick={copyConnectUrl} className="btn-primary text-xs w-full">
                            <i className="fa-solid fa-copy mr-1" />
                            Copy Connect URL
                        </button>
                    </div>
                </div>
            </div>

            {/* Peers List */}
            {p2p.connectedPeers.length > 0 && (
                <div className="card">
                    <div className="card-header">
                        <span className="font-medium">Peers in Session</span>
                    </div>
                    <div className="card-body space-y-2">
                        <div className="flex items-center gap-3 p-2 rounded-lg bg-gray-800/50">
                            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">U</div>
                            <div className="flex-1">
                                <div className="text-sm font-medium text-gray-200">You ({userId})</div>
                                <div className="text-xs text-gray-500">{(p2p.peerId ?? '').slice(0, 16)}...</div>
                            </div>
                            {isTurnTaking && isMyTurn && (
                                <span className="px-2 py-0.5 bg-green-900/50 text-green-400 rounded text-xs">Your turn</span>
                            )}
                        </div>
                        {p2p.connectedPeers.map((peerId) => (
                            <div key={peerId} className="flex items-center gap-3 p-2 rounded-lg bg-gray-800/50">
                                <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold">P</div>
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-gray-200">Peer</div>
                                    <div className="text-xs text-gray-500">{peerId.slice(0, 16)}...</div>
                                </div>
                                {isTurnTaking && currentTurnUser === peerId && (
                                    <span className="px-2 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-xs">Their turn</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Track List */}
            <div className="card">
                <div className="card-header">
                    <span className="font-medium">Playlist Tracks</span>
                </div>
                <div className="card-body">
                    {tracks.length === 0 ? (
                        <div className="text-center py-8 text-gray-600">
                            <p>No tracks yet. Import some from Spotify!</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {tracks.map((track, i) => (
                                <div key={track.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-800/50">
                                    <span className="text-gray-600 text-sm w-6 text-right">{i + 1}</span>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-gray-200">{track.title}</div>
                                        <div className="text-xs text-gray-500">{track.artists.join(', ')}</div>
                                        {playlistId && (
                                            <ReactionBar trackId={track.id} playlistId={playlistId} />
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500">{track.addedByName ?? track.addedBy}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Session Discussion */}
            {playlistId && (
                <PlaylistComments playlistId={playlistId} />
            )}
        </div>
    );
}

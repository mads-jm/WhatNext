/**
 * SessionTrackList
 * Right-column card listing the session's tracks with now-playing highlight and reactions.
 */

import type { TrackDocType, UserDocType } from '../../db/schemas';
import { ReactionBar } from '../Social/ReactionBar';
import { artSrc } from '../../utils/artSrc';

interface SessionTrackListProps {
    tracks: TrackDocType[];
    participants: UserDocType[];
    playlistId: string;
    isLiveSync: boolean;
    currentTrackExternalId?: string | null;
}

export function SessionTrackList({
    tracks,
    participants,
    playlistId,
    isLiveSync,
    currentTrackExternalId,
}: SessionTrackListProps) {
    return (
        <div className="card col-span-2" data-testid="session-queue">
            <div className="card-header flex items-center justify-between">
                <span className="font-medium text-sm">Tracks ({tracks.length})</span>
                {isLiveSync && (
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
                            track.spotifyId === currentTrackExternalId;

                        return (
                            <div
                                key={track.id}
                                className={`flex flex-col gap-1 px-3 py-2 rounded-md ${
                                    isNowPlaying
                                        ? 'bg-green-900/30 border border-green-700/40'
                                        : 'hover:bg-gray-800/60'
                                }`}
                                data-testid={isNowPlaying ? 'current-track' : undefined}
                            >
                                <div className="flex items-center gap-3">
                                    <span className="w-5 text-xs text-gray-600 text-right shrink-0">
                                        {isNowPlaying
                                            ? <i className="fa-solid fa-volume-high text-green-500" />
                                            : index + 1}
                                    </span>
                                    {artSrc(track.albumArtLocalPath, track.albumArtUrl) ? (
                                        <img
                                            src={artSrc(track.albumArtLocalPath, track.albumArtUrl)}
                                            alt=""
                                            className="w-8 h-8 rounded object-cover shrink-0"
                                            onError={(e) => {
                                                if (track.albumArtUrl) e.currentTarget.src = track.albumArtUrl;
                                            }}
                                        />
                                    ) : (
                                        <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center shrink-0">
                                            <i className="fa-solid fa-music text-gray-600 text-xs" />
                                        </div>
                                    )}
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
                                <div className="pl-16">
                                    <ReactionBar trackId={track.id} playlistId={playlistId} />
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

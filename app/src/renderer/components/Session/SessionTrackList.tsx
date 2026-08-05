/**
 * SessionTrackList
 * Card listing the session's tracks with now-playing highlight and reactions.
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
    onSyncNow?: () => void;
    syncing?: boolean;
}

export function SessionTrackList({
    tracks,
    participants,
    playlistId,
    isLiveSync,
    currentTrackExternalId,
    onSyncNow,
    syncing,
}: SessionTrackListProps) {
    return (
        <div className="card" data-testid="session-queue">
            <div className="card-header flex items-center justify-between">
                <span className="font-medium text-sm text-on-surface">
                    Tracks ({tracks.length})
                </span>
                {isLiveSync && (
                    <span className="text-xs text-on-surface-variant flex items-center gap-2">
                        <span>
                            <i className="fa-brands fa-spotify text-primary mr-1" />
                            Live sync
                        </span>
                        {onSyncNow && (
                            <button
                                onClick={onSyncNow}
                                disabled={syncing}
                                title="Sync now"
                                className="text-on-surface-variant hover:text-on-surface disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <i
                                    className={`fa-solid fa-rotate text-xs ${syncing ? 'fa-spin' : ''}`}
                                />
                            </button>
                        )}
                    </span>
                )}
            </div>
            <div className="card-body space-y-1 max-h-96 overflow-y-auto">
                {tracks.length === 0 ? (
                    <div className="text-center py-10 text-on-surface-variant">
                        <i className="fa-solid fa-music text-3xl mb-3" />
                        <p className="text-sm">No tracks yet</p>
                    </div>
                ) : (
                    tracks.map((track, index) => {
                        const adder = participants.find(
                            (p) => p.id === track.addedBy,
                        );
                        const adderAvatar = adder
                            ? artSrc(adder.avatarLocalPath, adder.avatarUrl)
                            : null;
                        const isNowPlaying =
                            track.spotifyId != null &&
                            track.spotifyId === currentTrackExternalId;

                        return (
                            <div
                                key={track.id}
                                className={`flex flex-col gap-1 px-3 py-2 rounded-md transition-colors ${
                                    isNowPlaying
                                        ? 'bg-primary/10 border-l-4 border-primary'
                                        : 'hover:bg-surface-high'
                                }`}
                                data-testid={
                                    isNowPlaying ? 'current-track' : undefined
                                }
                            >
                                <div className="flex items-center gap-3">
                                    <span className="w-5 text-xs text-on-surface-variant text-right shrink-0">
                                        {isNowPlaying ? (
                                            <i className="fa-solid fa-volume-high text-primary" />
                                        ) : (
                                            index + 1
                                        )}
                                    </span>
                                    {artSrc(
                                        track.albumArtLocalPath,
                                        track.albumArtUrl,
                                    ) ? (
                                        <img
                                            src={artSrc(
                                                track.albumArtLocalPath,
                                                track.albumArtUrl,
                                            )}
                                            alt=""
                                            className="w-8 h-8 rounded-md object-cover shrink-0 transition-transform hover:scale-110"
                                            onError={(e) => {
                                                if (track.albumArtUrl)
                                                    e.currentTarget.src =
                                                        track.albumArtUrl;
                                            }}
                                        />
                                    ) : (
                                        <div className="w-8 h-8 rounded-md bg-surface-high flex items-center justify-center shrink-0">
                                            <i className="fa-solid fa-music text-on-surface-variant text-xs" />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p
                                            className={`text-sm font-medium truncate ${isNowPlaying ? 'text-primary' : 'text-on-surface'}`}
                                        >
                                            {track.title}
                                        </p>
                                        <p className="text-xs text-on-surface-variant truncate">
                                            {track.artists.join(', ')}
                                        </p>
                                    </div>
                                    {track.durationMs != null && (
                                        <span className="font-mono text-xs text-on-surface-variant shrink-0">
                                            {Math.floor(
                                                track.durationMs / 60000,
                                            )}
                                            :
                                            {String(
                                                Math.floor(
                                                    (track.durationMs % 60000) /
                                                        1000,
                                                ),
                                            ).padStart(2, '0')}
                                        </span>
                                    )}
                                    {adder && (
                                        <span
                                            className="shrink-0"
                                            title={adder.displayName}
                                        >
                                            {adderAvatar ? (
                                                <img
                                                    src={adderAvatar}
                                                    alt={adder.displayName}
                                                    className="w-5 h-5 rounded-full object-cover"
                                                />
                                            ) : (
                                                <span className="w-5 h-5 rounded-full bg-surface-high flex items-center justify-center text-[10px] font-bold text-on-surface-variant">
                                                    {adder.displayName
                                                        .charAt(0)
                                                        .toUpperCase()}
                                                </span>
                                            )}
                                        </span>
                                    )}
                                </div>
                                <div className="pl-16">
                                    <ReactionBar
                                        trackId={track.id}
                                        playlistId={playlistId}
                                    />
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

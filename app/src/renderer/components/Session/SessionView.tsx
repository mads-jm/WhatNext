/**
 * SessionView
 * Primary session UI. Renders setup flow or active session depending on state.
 * Acts as a thin orchestrator — all visual sections live in focused sub-components.
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
import { PlaylistComments } from '../Social/PlaylistComments';
import { SessionEmptyState } from './SessionEmptyState';
import { SessionHeader } from './SessionHeader';
import { TurnIndicator } from './TurnIndicator';
import { SessionInfoBar } from './SessionInfoBar';
import { ParticipantRoster } from './ParticipantRoster';
import { SessionTrackList } from './SessionTrackList';

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
        return <SessionEmptyState />;
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
            <SessionHeader
                onEndSession={handleEndSession}
                trackSourceError={trackSourceError}
            />

            {isSpotifyPlayback && (
                <PlaybackBar enabled contextUri={spotifyContextUri} />
            )}

            {playlist?.queueMode === 'turn_taking' && !playlist.isComplete && (
                <TurnIndicator
                    isMyTurn={isMyTurn}
                    currentTurnDisplayName={currentTurnUser?.displayName}
                    tracksPerTurn={playlist.tracksPerTurn}
                    turnTracksAdded={playlist.turnTracksAdded}
                    turnsCompleted={playlist.turnsCompleted}
                    maxTurns={playlist.maxTurns}
                />
            )}

            <SessionInfoBar
                playlistName={playlist?.playlistName}
                coverArtLocalPath={playlist?.coverArtLocalPath}
                coverArtUrl={playlist?.coverArtUrl}
                trackCount={tracks.length}
                participantCount={participants.length}
                onShare={() => user && navigator.clipboard.writeText(activeId)}
            />

            <div className="grid grid-cols-3 gap-4">
                <ParticipantRoster
                    participants={participants}
                    tracks={tracks}
                    currentUserId={userId}
                    currentTurnUserId={playlist?.currentTurnUserId}
                    turnOrder={playlist?.turnOrder}
                />

                <SessionTrackList
                    tracks={tracks}
                    participants={participants}
                    playlistId={activeId}
                    isLiveSync={sessionState?.trackSource.type === 'spotify-collab'}
                    currentTrackExternalId={playbackState?.currentTrackExternalId}
                />
            </div>

            <PlaylistComments playlistId={activeId} />
        </div>
    );
}

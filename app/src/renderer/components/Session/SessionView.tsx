/**
 * SessionView
 * Primary session UI. Renders setup flow or active session depending on state.
 * Acts as a thin orchestrator — all visual sections live in focused sub-components.
 */

import { useState, useEffect } from 'react';
import { useNavigationStore } from '../../stores/navigation-store';
import { useCompanionStore } from '../../stores/companion-store';
import { useUserStore } from '../../stores/user-store';
import { useSessionState } from '../../hooks/useSessionState';
import { usePlaybackState } from '../../hooks/usePlaybackState';
import { useTrackSource } from '../../hooks/useTrackSource';
import { useSessionReplication } from '../../hooks/useSessionReplication';
import { getDatabase } from '../../db/database';
import type { PlaylistDocType, TrackDocType, UserDocType } from '../../db/schemas';
import { computeEffectiveTurn } from '../../utils/turn-helpers';
import { hasLocalPlaybackSurface } from '../../utils/playback-helpers';
import { advanceTurn } from '../../db/services/playlist-service';
import { SessionSetup } from './SessionSetup';
import { SessionEmptyState } from './SessionEmptyState';
import { SessionHeader } from './SessionHeader';
import { TurnIndicator } from './TurnIndicator';
import { SessionInfoBar } from './SessionInfoBar';
import { ShareSessionPanel } from './ShareSessionPanel';
import { CompanionSharePanel } from './CompanionSharePanel';
import { ParticipantRoster } from './ParticipantRoster';
import { SessionTrackList } from './SessionTrackList';
import { TrackEndingWarning } from './TrackEndingWarning';
import { SessionFeed } from './SessionFeed';
import { AddTrackPanel } from './AddTrackPanel';
import { SharingToggle } from '../FileTransfer/SharingToggle';
import { TransferProgressAggregate } from '../FileTransfer/TransferProgressBar';
import { FileManifestPanel } from '../FileTransfer/FileManifestPanel';
import { useFileTransfer } from '../../hooks/useFileTransfer';
import { useFileTransferStore } from '../../stores/file-transfer-store';
import { FILE_TRANSFER_CAPABILITY } from '../../../shared/core/file-transfer-types';

interface SessionViewProps {
    playlistId?: string;
}

export function SessionView({ playlistId }: SessionViewProps) {
    const sessionPlaylistId = useNavigationStore((s) => s.sessionPlaylistId);
    const navigate = useNavigationStore((s) => s.navigate);
    const endSession = useNavigationStore((s) => s.endSession);
    // Not read in this component, but the selector is what subscribes it to
    // user-store changes that do not alter `userId` (a display-name or avatar
    // edit, say). Deleting the binding would also delete that re-render
    // trigger, which is a behaviour change this lint pass is not entitled to
    // make; whether the subscription is actually wanted is a separate question.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const user = useUserStore((s) => s.user);
    const userId = useUserStore((s) => s.userId);

    const activeId = playlistId ?? sessionPlaylistId ?? null;

    const { sessionState, isActiveSession } = useSessionState(activeId ?? '');

    const [playlist, setPlaylist] = useState<PlaylistDocType | null>(null);
    const [tracks, setTracks] = useState<TrackDocType[]>([]);
    const [participants, setParticipants] = useState<UserDocType[]>([]);
    const [currentTurnUser, setCurrentTurnUser] = useState<UserDocType | null>(null);
    const [showSharePanel, setShowSharePanel] = useState(false);

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

    // Resolve current turn user display name using effective (track-derived) turn user
    const effectiveTurnUserId = (() => {
        if (!playlist || playlist.queueMode !== 'turn_taking' || playlist.isComplete) return undefined;
        const state = computeEffectiveTurn(playlist, tracks);
        return state.effectiveTurnUserId;
    })();

    useEffect(() => {
        const turnId = effectiveTurnUserId;
        if (!turnId) { setCurrentTurnUser(null); return; }
        let alive = true;

        getDatabase().then((db) => {
            db.users.findOne(turnId).exec().then((doc) => {
                if (alive) setCurrentTurnUser(doc ? doc.toJSON() as UserDocType : null);
            });
        });

        return () => { alive = false; };
    }, [effectiveTurnUserId]);

    // Auto-advance when track history shows the quota is full but DB hasn't caught up
    const turnQuotaFull = effectiveTurnUserId !== undefined &&
        playlist !== null &&
        playlist.queueMode === 'turn_taking' &&
        !playlist.isComplete &&
        computeEffectiveTurn(playlist, tracks).turnQuotaFull;

    useEffect(() => {
        if (turnQuotaFull && activeId) {
            advanceTurn(activeId);
        }
    }, [turnQuotaFull, activeId]);

    // Device-local: does *this* device drive Spotify for this session? There is
    // no cross-peer playback ownership in Phase 1, so nothing here is derived
    // from user identity (see `hasLocalPlaybackSurface`).
    const isSpotifyPlayback = hasLocalPlaybackSurface(sessionState);

    const clearCompanion = useCompanionStore((s) => s.clearAll);

    // Replicate session collections to/from connected peers when session is active
    useSessionReplication(isActiveSession);

    // File transfer — mount IPC listeners and expose actions
    const { requestManifest, requestFiles, cancelTransfer, registerTracks, setSharing } = useFileTransfer();
    const manifests = useFileTransferStore((s) => s.manifests);
    const peerCapabilities = useFileTransferStore((s) => s.peerCapabilities);

    // Peers with file-transfer capability that have not yet sent a manifest for this playlist.
    // The manifests map is keyed by playlistId — one manifest per playlist (last received).
    // "No manifest yet" means either the map has no entry for this playlist, or the stored
    // manifest came from a different peer.
    const existingManifestPeerId = activeId ? manifests.get(activeId)?.peerId : undefined;
    const capablePeersWithoutManifest = activeId
        ? [...peerCapabilities.entries()]
              .filter(
                  ([peerId, caps]) =>
                      caps.includes(FILE_TRANSFER_CAPABILITY) && peerId !== existingManifestPeerId,
              )
              .map(([peerId]) => peerId)
        : [];

    // Manifests scoped to the active playlist — store is keyed by playlistId
    const activeManifest = activeId ? manifests.get(activeId) ?? null : null;

    const isHost = sessionState?.hostId === userId;

    const {
        error: trackSourceError,
        syncNow,
        syncing: trackSourceSyncing,
        addTrack,
    } = useTrackSource({
        config: sessionState?.trackSource ?? { type: 'manual' },
        playlistId: activeId ?? '',
        enabled: isActiveSession,
    });

    const { state: playbackState } = usePlaybackState(isActiveSession && isSpotifyPlayback);

    // Determine if there's a next track after the currently playing one
    const hasNextTrack = (() => {
        if (!playbackState?.currentTrackExternalId || tracks.length === 0) return true; // no warning when unknown
        const currentIdx = tracks.findIndex((t) => t.spotifyId === playbackState.currentTrackExternalId);
        if (currentIdx === -1) return true; // playing something not in our list
        return currentIdx < tracks.length - 1;
    })();

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
    // Derive turn state from actual track list — resilient to stored counter drift
    const turnState = playlist?.queueMode === 'turn_taking' && !playlist.isComplete
        ? computeEffectiveTurn(playlist, tracks)
        : null;
    const isMyTurn = turnState !== null && turnState.effectiveTurnUserId === userId;

    const handleEndSession = () => {
        clearCompanion();
        endSession();
        navigate('playlists');
    };

    return (
        <div className="flex gap-4 h-full">
            {/* Main content */}
            <div className="flex-1 space-y-4 overflow-y-auto">
                <SessionHeader
                    onEndSession={handleEndSession}
                    trackSourceError={trackSourceError}
                />

                <TrackEndingWarning playbackState={playbackState} hasNextTrack={hasNextTrack} />

                {/* No playback-ownership control here by design: nothing in Phase 1
                    propagates ownership between peers, so any take/hand-off
                    affordance would promise mutual exclusion the app cannot
                    deliver. The transport controls live in the shell-level
                    PlaybackBar and are scoped to this device's Spotify. */}

                {turnState && playlist && (
                    <TurnIndicator
                        isMyTurn={isMyTurn}
                        currentTurnDisplayName={currentTurnUser?.displayName}
                        currentTurnAvatarUrl={currentTurnUser?.avatarUrl}
                        currentTurnAvatarLocalPath={currentTurnUser?.avatarLocalPath}
                        tracksPerTurn={playlist.tracksPerTurn}
                        turnTracksAdded={turnState.turnTracksAdded}
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
                    onShare={() => setShowSharePanel((v) => !v)}
                />

                {showSharePanel && (
                    <>
                        <ShareSessionPanel sessionId={activeId} />
                        <CompanionSharePanel sessionActive={isActiveSession} />
                        {isHost && (
                            <div className="card card-body">
                                <SharingToggle
                                    playlistId={activeId}
                                    onSharingChanged={async (enabled) => {
                                        await setSharing(activeId, enabled)
                                        if (enabled && playlist && tracks.length > 0) {
                                            await registerTracks(
                                                activeId,
                                                playlist.coverArtLocalPath ?? undefined,
                                                tracks.map((t) => ({
                                                    trackId: t.id,
                                                    audioPath: t.localFilePath ?? undefined,
                                                    artworkPath: t.albumArtLocalPath ?? undefined,
                                                })),
                                            )
                                        }
                                    }}
                                />
                            </div>
                        )}
                    </>
                )}

                {/* Aggregate transfer progress — visible while downloads are active */}
                <TransferProgressAggregate
                    playlistId={activeId}
                    onCancel={cancelTransfer}
                />

                {/* Request manifest from capable peers that haven't sent one yet */}
                {capablePeersWithoutManifest.length > 0 && (
                    <div className="card card-body flex items-center justify-between gap-3">
                        <span className="text-xs text-on-surface-variant">
                            {capablePeersWithoutManifest.length} peer
                            {capablePeersWithoutManifest.length > 1 ? 's have' : ' has'} files available
                        </span>
                        <button
                            onClick={() => {
                                capablePeersWithoutManifest.forEach((peerId) =>
                                    requestManifest(peerId, activeId),
                                );
                            }}
                            className="px-3 py-1.5 bg-surface-high hover:bg-primary hover:text-on-surface text-on-surface-variant text-xs rounded-lg transition-colors whitespace-nowrap"
                        >
                            Get peer files
                        </button>
                    </div>
                )}

                {/* Manifest panel — shown when a peer has shared their file list */}
                {activeManifest && (
                    <FileManifestPanel
                        manifest={activeManifest}
                        onRequestFiles={(files) => requestFiles(activeManifest.peerId, files)}
                    />
                )}

                <ParticipantRoster
                    participants={participants}
                    tracks={tracks}
                    currentUserId={userId}
                    currentTurnUserId={turnState?.effectiveTurnUserId ?? playlist?.currentTurnUserId}
                    turnOrder={playlist?.turnOrder}
                />

                {/* Manual TrackSource (#37): local add affordance. Rendered
                    only when the source hook exposes a functional add path
                    (manual sessions) and we know who is adding. */}
                {addTrack && userId && (
                    <AddTrackPanel
                        onAdd={async (incoming) => {
                            await addTrack(incoming, userId);
                        }}
                        error={trackSourceError}
                    />
                )}

                <SessionTrackList
                    tracks={tracks}
                    participants={participants}
                    playlistId={activeId}
                    isLiveSync={sessionState?.trackSource.type === 'spotify-collab'}
                    currentTrackExternalId={playbackState?.currentTrackExternalId}
                    onSyncNow={syncNow ?? undefined}
                    syncing={trackSourceSyncing}
                />
            </div>

            {/* Session Feed sidebar */}
            <SessionFeed playlistId={activeId} />
        </div>
    );
}

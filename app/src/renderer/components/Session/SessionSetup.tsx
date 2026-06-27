/**
 * SessionSetup
 * Two-step session configuration form.
 * Step 1: configure track source and playback provider.
 * Step 2: add/select participants.
 */

import { useReducer, useEffect } from 'react';
import { useNavigationStore } from '../../stores/navigation-store';
import { useUserStore } from '../../stores/user-store';
import {
    createSessionParticipant,
    getAllUsers,
} from '../../db/services/user-service';
import { getPlaylist, updatePlaylist } from '../../db/services/playlist-service';
import type {
    TrackSourceConfig,
    PlaybackProviderConfig,
} from '../../../shared/session-interfaces';
import type { UserDocType } from '../../db/schemas';

// ---------------------------------------------------------------------------
// State & reducer
// ---------------------------------------------------------------------------

type SessionSetupState = {
    step: 1 | 2;
    linkedSpotifyId: string | null;
    trackSource: TrackSourceConfig;
    playbackProvider: PlaybackProviderConfig;
    participantIds: string[];
    suggestedUsers: UserDocType[];
    newParticipant: { name: string; spotifyUsername: string; error: string | null };
};

type SessionSetupAction =
    /** Atomically links a Spotify playlist and sets the derived track source + playback provider. */
    | { type: 'LINK_SPOTIFY'; spotifyPlaylistId: string }
    | { type: 'SET_TRACK_SOURCE'; source: TrackSourceConfig }
    | { type: 'SET_PLAYBACK_PROVIDER'; provider: PlaybackProviderConfig }
    | { type: 'SET_STEP'; step: 1 | 2 }
    | { type: 'SET_SUGGESTED_USERS'; users: UserDocType[] }
    | { type: 'TOGGLE_PARTICIPANT'; userId: string }
    | { type: 'ADD_PARTICIPANT'; user: UserDocType; userId: string }
    | { type: 'UPDATE_NEW_PARTICIPANT'; field: 'name' | 'spotifyUsername'; value: string }
    | { type: 'SET_NEW_PARTICIPANT_ERROR'; error: string | null }
    | { type: 'RESET_NEW_PARTICIPANT' };

const initialState: SessionSetupState = {
    step: 1,
    linkedSpotifyId: null,
    trackSource: { type: 'manual' },
    playbackProvider: { type: 'none' },
    participantIds: [],
    suggestedUsers: [],
    newParticipant: { name: '', spotifyUsername: '', error: null },
};

function reducer(state: SessionSetupState, action: SessionSetupAction): SessionSetupState {
    switch (action.type) {
        case 'LINK_SPOTIFY':
            return {
                ...state,
                linkedSpotifyId: action.spotifyPlaylistId,
                trackSource: { type: 'spotify-collab', spotifyPlaylistId: action.spotifyPlaylistId },
                playbackProvider: { type: 'spotify' },
            };
        case 'SET_TRACK_SOURCE':
            return { ...state, trackSource: action.source };
        case 'SET_PLAYBACK_PROVIDER':
            return { ...state, playbackProvider: action.provider };
        case 'SET_STEP':
            return { ...state, step: action.step };
        case 'SET_SUGGESTED_USERS':
            return { ...state, suggestedUsers: action.users };
        case 'TOGGLE_PARTICIPANT':
            return {
                ...state,
                participantIds: state.participantIds.includes(action.userId)
                    ? state.participantIds.filter((id) => id !== action.userId)
                    : [...state.participantIds, action.userId],
            };
        case 'ADD_PARTICIPANT':
            return {
                ...state,
                participantIds: [...state.participantIds, action.userId],
                suggestedUsers: [...state.suggestedUsers, action.user],
                newParticipant: { name: '', spotifyUsername: '', error: null },
            };
        case 'UPDATE_NEW_PARTICIPANT':
            return {
                ...state,
                newParticipant: { ...state.newParticipant, [action.field]: action.value },
            };
        case 'SET_NEW_PARTICIPANT_ERROR':
            return {
                ...state,
                newParticipant: { ...state.newParticipant, error: action.error },
            };
        case 'RESET_NEW_PARTICIPANT':
            return {
                ...state,
                newParticipant: { name: '', spotifyUsername: '', error: null },
            };
    }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SessionSetupProps {
    playlistId: string;
    onStart: () => void;
}

export function SessionSetup({ playlistId, onStart }: SessionSetupProps) {
    const user = useUserStore((s) => s.user);
    const startSession = useNavigationStore((s) => s.startSession);

    const [state, dispatch] = useReducer(reducer, initialState);
    const { step, linkedSpotifyId, trackSource, playbackProvider, participantIds, suggestedUsers, newParticipant } = state;

    useEffect(() => {
        getPlaylist(playlistId).then((pl) => {
            if (pl?.linkedSpotifyId) {
                dispatch({ type: 'LINK_SPOTIFY', spotifyPlaylistId: pl.linkedSpotifyId });
            }
        });
    }, [playlistId]);

    useEffect(() => {
        getAllUsers().then((users) => {
            dispatch({ type: 'SET_SUGGESTED_USERS', users: users.filter((u) => !u.isLocal) });
        });
    }, []);

    const handleAddParticipant = async () => {
        dispatch({ type: 'SET_NEW_PARTICIPANT_ERROR', error: null });
        const name = newParticipant.name.trim();
        if (!name) { dispatch({ type: 'SET_NEW_PARTICIPANT_ERROR', error: 'Display name is required' }); return; }
        const spotifyId = newParticipant.spotifyUsername.trim() || undefined;

        try {
            const doc = await createSessionParticipant(name, spotifyId);
            dispatch({ type: 'ADD_PARTICIPANT', user: doc.toJSON() as UserDocType, userId: doc.id });
        } catch (err) {
            dispatch({ type: 'SET_NEW_PARTICIPANT_ERROR', error: err instanceof Error ? err.message : String(err) });
        }
    };

    const handleStart = async () => {
        if (!user) return;

        // Persist participants as playlist collaborators so turn-taking and
        // playlist views can see them independent of ephemeral session state.
        if (participantIds.length > 0) {
            await updatePlaylist(playlistId, {
                collaboratorIds: participantIds,
                isCollaborative: true,
            });
        }

        startSession({
            playlistId,
            trackSource,
            playbackProvider,
            participantIds: [user.id, ...participantIds],
            hostId: user.id,
        });
        onStart();
    };

    return (
        <div className="space-y-4 max-w-xl">
            <div className="card">
                <div className="card-header flex items-center gap-2">
                    <i className="fa-solid fa-users text-primary" />
                    <span className="font-medium">Start a Session</span>
                </div>

                {step === 1 && (
                    <div className="card-body space-y-4">
                        {/* Track source */}
                        <div>
                            <p className="text-sm font-medium text-on-surface mb-2">Track Source</p>
                            {linkedSpotifyId ? (
                                <div className="space-y-2">
                                    <label className="flex items-start gap-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="trackSource"
                                            className="mt-0.5"
                                            aria-label="Spotify Collaborative Playlist"
                                            checked={trackSource.type === 'spotify-collab'}
                                            onChange={() =>
                                                dispatch({ type: 'SET_TRACK_SOURCE', source: { type: 'spotify-collab', spotifyPlaylistId: linkedSpotifyId } })
                                            }
                                        />
                                        <div>
                                            <p className="text-sm font-medium text-on-surface">Spotify Collaborative Playlist</p>
                                            <p className="text-xs text-on-surface-variant">
                                                Polls{' '}
                                                <code className="bg-surface px-1 rounded">{linkedSpotifyId}</code>
                                                {' '}for new tracks
                                            </p>
                                        </div>
                                    </label>
                                    <label className="flex items-start gap-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="trackSource"
                                            className="mt-0.5"
                                            aria-label="Manual (metadata only)"
                                            checked={trackSource.type === 'manual'}
                                            onChange={() => dispatch({ type: 'SET_TRACK_SOURCE', source: { type: 'manual' } })}
                                        />
                                        <div>
                                            <p className="text-sm font-medium text-on-surface">Manual</p>
                                            <p className="text-xs text-on-surface-variant">
                                                No Spotify polling — metadata only
                                            </p>
                                        </div>
                                    </label>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <p className="text-xs text-on-surface-variant">
                                        No Spotify playlist linked. Using manual mode.
                                        Link a Spotify playlist to enable Spotify sync.
                                    </p>
                                    <label className="flex items-center gap-3">
                                        <input type="radio" name="trackSource" checked readOnly />
                                        <span className="text-sm text-on-surface">Manual</span>
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* Playback provider */}
                        <div>
                            <p className="text-sm font-medium text-on-surface mb-2">Playback</p>
                            <div className="space-y-2">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="playback"
                                        checked={playbackProvider.type === 'spotify'}
                                        onChange={() => dispatch({ type: 'SET_PLAYBACK_PROVIDER', provider: { type: 'spotify' } })}
                                    />
                                    <span className="text-sm text-on-surface">
                                        <i className="fa-brands fa-spotify text-primary mr-2" />
                                        Spotify
                                    </span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="playback"
                                        checked={playbackProvider.type === 'none'}
                                        onChange={() => dispatch({ type: 'SET_PLAYBACK_PROVIDER', provider: { type: 'none' } })}
                                    />
                                    <span className="text-sm text-on-surface">None (metadata only)</span>
                                </label>
                            </div>
                        </div>

                        <button className="btn-primary w-full" onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}>
                            Next: Add Participants
                            <i className="fa-solid fa-arrow-right ml-2" />
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="card-body space-y-4">
                        <button className="btn-ghost text-sm p-0 text-on-surface-variant" onClick={() => dispatch({ type: 'SET_STEP', step: 1 })}>
                            <i className="fa-solid fa-arrow-left mr-1" />
                            Back
                        </button>

                        {suggestedUsers.length > 0 && (
                            <div>
                                <p className="text-sm font-medium text-on-surface mb-2">Known participants</p>
                                <div className="space-y-2">
                                    {suggestedUsers.map((u) => {
                                        const spotifyLink = u.linkedAccounts.find((a) => a.provider === 'spotify');
                                        return (
                                            <label key={u.id} className="flex items-center gap-3 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    aria-label={u.displayName}
                                                    checked={participantIds.includes(u.id)}
                                                    onChange={() => dispatch({ type: 'TOGGLE_PARTICIPANT', userId: u.id })}
                                                />
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-surface-high flex items-center justify-center text-xs font-bold text-on-surface">
                                                        {u.displayName.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <span className="text-sm text-on-surface">{u.displayName}</span>
                                                        {spotifyLink && (
                                                            <span className="ml-2 text-xs text-on-surface-variant">
                                                                <i className="fa-brands fa-spotify text-primary mr-0.5" />
                                                                {spotifyLink.providerUserId}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div>
                            <p className="text-sm font-medium text-on-surface mb-2">Add new participant</p>
                            <div className="space-y-2">
                                <input
                                    className="input text-sm w-full"
                                    placeholder="Display name"
                                    value={newParticipant.name}
                                    onChange={(e) => dispatch({ type: 'UPDATE_NEW_PARTICIPANT', field: 'name', value: e.target.value })}
                                />
                                <input
                                    className="input text-sm w-full"
                                    placeholder="Spotify username (optional)"
                                    value={newParticipant.spotifyUsername}
                                    onChange={(e) => dispatch({ type: 'UPDATE_NEW_PARTICIPANT', field: 'spotifyUsername', value: e.target.value })}
                                />
                                {newParticipant.error && <p className="text-xs text-error">{newParticipant.error}</p>}
                                <button className="btn-ghost text-sm border border-outline-variant" onClick={handleAddParticipant}>
                                    <i className="fa-solid fa-plus mr-1" />
                                    Add
                                </button>
                            </div>
                        </div>

                        <button
                            className="btn-primary w-full"
                            onClick={handleStart}
                            disabled={!user}
                        >
                            <i className="fa-solid fa-play mr-2" />
                            Start Session
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

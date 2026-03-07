/**
 * SessionSetup
 * Two-step session configuration form.
 * Step 1: configure track source and playback provider.
 * Step 2: add/select participants.
 */

import { useState, useEffect } from 'react';
import { useNavigationStore } from '../../stores/navigation-store';
import { useUserStore } from '../../stores/user-store';
import {
    createSessionParticipant,
    getAllUsers,
} from '../../db/services/user-service';
import { getPlaylist } from '../../db/services/playlist-service';
import type {
    TrackSourceConfig,
    PlaybackProviderConfig,
} from '../../../shared/session-interfaces';
import type { UserDocType } from '../../db/schemas';

interface SessionSetupProps {
    playlistId: string;
    onStart: () => void;
}

export function SessionSetup({ playlistId, onStart }: SessionSetupProps) {
    const user = useUserStore((s) => s.user);
    const startSession = useNavigationStore((s) => s.startSession);

    const [step, setStep] = useState<1 | 2>(1);
    const [linkedSpotifyId, setLinkedSpotifyId] = useState<string | null>(null);

    const [trackSource, setTrackSource] = useState<TrackSourceConfig>({ type: 'manual' });
    const [playbackProvider, setPlaybackProvider] = useState<PlaybackProviderConfig>({ type: 'none' });

    const [participantIds, setParticipantIds] = useState<string[]>([]);
    const [suggestedUsers, setSuggestedUsers] = useState<UserDocType[]>([]);

    const [newDisplayName, setNewDisplayName] = useState('');
    const [newSpotifyUsername, setNewSpotifyUsername] = useState('');
    const [addError, setAddError] = useState<string | null>(null);

    useEffect(() => {
        getPlaylist(playlistId).then((pl) => {
            if (!pl) return;
            if (pl.linkedSpotifyId) {
                setLinkedSpotifyId(pl.linkedSpotifyId);
                setTrackSource({ type: 'spotify-collab', spotifyPlaylistId: pl.linkedSpotifyId });
                setPlaybackProvider({ type: 'spotify' });
            }
        });
    }, [playlistId]);

    useEffect(() => {
        getAllUsers().then((users) => {
            setSuggestedUsers(users.filter((u) => !u.isLocal));
        });
    }, []);

    const toggleSuggestedParticipant = (userId: string) => {
        setParticipantIds((prev) =>
            prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
        );
    };

    const handleAddParticipant = async () => {
        setAddError(null);
        const name = newDisplayName.trim();
        if (!name) { setAddError('Display name is required'); return; }
        const spotifyId = newSpotifyUsername.trim();
        if (!spotifyId) { setAddError('Spotify username is required'); return; }

        try {
            const doc = await createSessionParticipant(name, spotifyId);
            setParticipantIds((prev) => [...prev, doc.id]);
            setSuggestedUsers((prev) => [...prev, doc.toJSON() as UserDocType]);
            setNewDisplayName('');
            setNewSpotifyUsername('');
        } catch (err) {
            setAddError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleStart = () => {
        if (!user) return;
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
                    <i className="fa-solid fa-users text-blue-400" />
                    <span className="font-medium">Start a Session</span>
                </div>

                {step === 1 && (
                    <div className="card-body space-y-4">
                        {/* Track source */}
                        <div>
                            <p className="text-sm font-medium text-gray-300 mb-2">Track Source</p>
                            {linkedSpotifyId ? (
                                <div className="space-y-2">
                                    <label className="flex items-start gap-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="trackSource"
                                            className="mt-0.5"
                                            checked={trackSource.type === 'spotify-collab'}
                                            onChange={() =>
                                                setTrackSource({ type: 'spotify-collab', spotifyPlaylistId: linkedSpotifyId })
                                            }
                                        />
                                        <div>
                                            <p className="text-sm font-medium text-gray-200">Spotify Collaborative Playlist</p>
                                            <p className="text-xs text-gray-500">
                                                Polls{' '}
                                                <code className="bg-gray-900 px-1 rounded">{linkedSpotifyId}</code>
                                                {' '}every 5 seconds for new tracks
                                            </p>
                                        </div>
                                    </label>
                                    <label className="flex items-start gap-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="trackSource"
                                            className="mt-0.5"
                                            checked={trackSource.type === 'manual'}
                                            onChange={() => setTrackSource({ type: 'manual' })}
                                        />
                                        <div>
                                            <p className="text-sm font-medium text-gray-200">Manual</p>
                                            <p className="text-xs text-gray-500">
                                                No Spotify polling — metadata only
                                            </p>
                                        </div>
                                    </label>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <p className="text-xs text-gray-500">
                                        No Spotify playlist linked. Using manual mode.
                                        Link a Spotify playlist to enable Spotify sync.
                                    </p>
                                    <label className="flex items-center gap-3">
                                        <input type="radio" name="trackSource" checked readOnly />
                                        <span className="text-sm text-gray-300">Manual</span>
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* Playback provider */}
                        <div>
                            <p className="text-sm font-medium text-gray-300 mb-2">Playback</p>
                            <div className="space-y-2">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="playback"
                                        checked={playbackProvider.type === 'spotify'}
                                        onChange={() => setPlaybackProvider({ type: 'spotify' })}
                                    />
                                    <span className="text-sm text-gray-200">
                                        <i className="fa-brands fa-spotify text-green-500 mr-2" />
                                        Spotify
                                    </span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="playback"
                                        checked={playbackProvider.type === 'none'}
                                        onChange={() => setPlaybackProvider({ type: 'none' })}
                                    />
                                    <span className="text-sm text-gray-200">None (metadata only)</span>
                                </label>
                            </div>
                        </div>

                        <button className="btn-primary w-full" onClick={() => setStep(2)}>
                            Next: Add Participants
                            <i className="fa-solid fa-arrow-right ml-2" />
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="card-body space-y-4">
                        <button className="btn-ghost text-sm p-0 text-gray-400" onClick={() => setStep(1)}>
                            <i className="fa-solid fa-arrow-left mr-1" />
                            Back
                        </button>

                        {suggestedUsers.length > 0 && (
                            <div>
                                <p className="text-sm font-medium text-gray-300 mb-2">Known participants</p>
                                <div className="space-y-2">
                                    {suggestedUsers.map((u) => (
                                        <label key={u.id} className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={participantIds.includes(u.id)}
                                                onChange={() => toggleSuggestedParticipant(u.id)}
                                            />
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
                                                    {u.displayName.charAt(0).toUpperCase()}
                                                </div>
                                                <span className="text-sm text-gray-200">{u.displayName}</span>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <p className="text-sm font-medium text-gray-300 mb-2">Add new participant</p>
                            <div className="space-y-2">
                                <input
                                    className="input text-sm w-full"
                                    placeholder="Display name"
                                    value={newDisplayName}
                                    onChange={(e) => setNewDisplayName(e.target.value)}
                                />
                                <input
                                    className="input text-sm w-full"
                                    placeholder="Spotify username"
                                    value={newSpotifyUsername}
                                    onChange={(e) => setNewSpotifyUsername(e.target.value)}
                                />
                                {addError && <p className="text-xs text-red-400">{addError}</p>}
                                <button className="btn-ghost text-sm border border-gray-700" onClick={handleAddParticipant}>
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

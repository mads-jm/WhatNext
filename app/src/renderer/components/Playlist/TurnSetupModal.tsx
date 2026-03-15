/**
 * TurnSetupModal
 * First-open prompt for collaborative playlists that haven't configured turn-taking yet.
 * Per product intent, turn-taking is the default approach to a collaborative playlist.
 * Dismisses automatically when the DB updates (reactive).
 */

import { useState } from 'react';
import type { PlaylistDocType, UserDocType } from '../../db/schemas';
import { updatePlaylist } from '../../db/services/playlist-service';

interface TurnSetupModalProps {
    playlist: PlaylistDocType;
    participants: UserDocType[];
}

function displayName(userId: string, participants: UserDocType[]): string {
    return participants.find((p) => p.id === userId)?.displayName ?? userId;
}

export function TurnSetupModal({ playlist, participants }: TurnSetupModalProps) {
    const defaultOrder = [playlist.ownerId, ...playlist.collaboratorIds];
    const [tracksPerTurn, setTracksPerTurn] = useState(1);
    const [maxTurns, setMaxTurns] = useState<number | null>(null);
    const [maxTurnsInput, setMaxTurnsInput] = useState('');
    const [saving, setSaving] = useState(false);

    const handleEnable = async () => {
        setSaving(true);
        await updatePlaylist(playlist.id, {
            queueMode: 'turn_taking',
            currentTurnUserId: playlist.ownerId,
            turnOrder: defaultOrder,
            tracksPerTurn,
            turnTracksAdded: 0,
            turnsCompleted: 0,
            ...(maxTurns !== null && { maxTurns }),
        });
        // Modal dismisses reactively — no need to call close
    };

    const handleMaxTurnsChange = (val: string) => {
        setMaxTurnsInput(val);
        const n = parseInt(val, 10);
        setMaxTurns(!isNaN(n) && n > 0 ? n : null);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-1">
                        <i className="fa-solid fa-arrow-right-arrow-left text-yellow-400" />
                        <h2 className="text-lg font-semibold text-gray-100">Set Up Turn-Taking</h2>
                    </div>
                    <p className="text-sm text-gray-400 mb-6">
                        Collaborative playlists use turn-taking by default — each person adds tracks in sequence, keeping things balanced.
                    </p>

                    {/* Turn order preview */}
                    <div className="mb-5">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Turn order</p>
                        <div className="space-y-1">
                            {defaultOrder.map((userId, idx) => (
                                <div key={userId} className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-800/60">
                                    <span className="text-xs text-gray-600 w-4 text-right shrink-0">{idx + 1}</span>
                                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">
                                        {displayName(userId, participants).charAt(0).toUpperCase()}
                                    </div>
                                    <span className="text-sm text-gray-300">
                                        {displayName(userId, participants)}
                                    </span>
                                    {idx === 0 && (
                                        <span className="ml-auto text-xs text-gray-600">goes first</span>
                                    )}
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-gray-600 mt-1.5">Reorder anytime from the playlist view.</p>
                    </div>

                    {/* Config */}
                    <div className="flex items-center gap-6 mb-6">
                        <div>
                            <p className="text-xs text-gray-500 mb-1.5">Tracks per turn</p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setTracksPerTurn((n) => Math.max(1, n - 1))}
                                    disabled={tracksPerTurn <= 1}
                                    className="w-7 h-7 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-30 flex items-center justify-center"
                                >
                                    <i className="fa-solid fa-minus text-xs" />
                                </button>
                                <span className="text-base font-semibold text-gray-100 w-5 text-center">{tracksPerTurn}</span>
                                <button
                                    onClick={() => setTracksPerTurn((n) => n + 1)}
                                    className="w-7 h-7 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 flex items-center justify-center"
                                >
                                    <i className="fa-solid fa-plus text-xs" />
                                </button>
                            </div>
                        </div>

                        <div>
                            <p className="text-xs text-gray-500 mb-1.5">Max turns <span className="text-gray-700">(optional)</span></p>
                            <input
                                type="number"
                                min={1}
                                placeholder="∞"
                                value={maxTurnsInput}
                                onChange={(e) => handleMaxTurnsChange(e.target.value)}
                                className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-700 focus:outline-none focus:border-gray-500"
                            />
                        </div>
                    </div>

                    <button
                        onClick={handleEnable}
                        disabled={saving}
                        className="btn-accent w-full justify-center"
                    >
                        {saving ? 'Setting up…' : 'Start Turn-Taking'}
                    </button>
                </div>
            </div>
        </div>
    );
}

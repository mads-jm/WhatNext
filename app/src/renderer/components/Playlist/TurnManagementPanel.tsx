/**
 * TurnManagementPanel
 * Shown in PlaylistView for all collaborative turn-taking playlists that are not complete.
 * Displays current turn progress, turn order (reorderable), tracks-per-turn, and max-turns config.
 */

import React, { useState, useEffect } from 'react';
import type { PlaylistDocType, UserDocType } from '../../db/schemas';
import type { TrackViewModel } from '../../db/types';
import { setTurnOrder, setTurnConfig, markPlaylistComplete, reopenPlaylist, advanceTurn } from '../../db/services/playlist-service';

interface TurnManagementPanelProps {
    playlist: PlaylistDocType;
    participants: UserDocType[]; // All known participants (owner + collaborators)
    tracks: TrackViewModel[];    // Current track list — used to derive turn progress from history
    totalDurationMs: number;     // Total current playlist playtime in ms
    currentUserId: string | null;
}

function formatDurationHuman(ms: number): string {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Parse a human hours string like "8", "1.5", "90m" → ms. Returns null if invalid. */
function parseHoursInput(raw: string): number | null {
    const trimmed = raw.trim();
    // Allow "Xm" for minutes
    const minuteMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*m$/i);
    if (minuteMatch) return Math.round(parseFloat(minuteMatch[1]) * 60_000);
    const num = parseFloat(trimmed);
    if (isNaN(num) || num <= 0) return null;
    return Math.round(num * 3_600_000);
}

/**
 * Derive how many tracks the current turn user has added this turn by walking
 * backwards through the track list and counting their consecutive trailing additions,
 * up to tracksPerTurn. This is resilient to stored counter drift.
 */
function inferTurnTracksAdded(
    tracks: TrackViewModel[],
    currentTurnUserId: string | undefined,
    tracksPerTurn: number
): number {
    if (!currentTurnUserId || tracks.length === 0) return 0;
    let count = 0;
    for (let i = tracks.length - 1; i >= 0 && count < tracksPerTurn; i--) {
        if (tracks[i].addedBy === currentTurnUserId) count++;
        else break;
    }
    return count;
}

// ─── Small reusable controls ──────────────────────────────────────────────────

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
            {children}
        </div>
    );
}

function NumberInput({ value, min = 1, onChange }: { value: number; min?: number; onChange: (n: number) => void }) {
    const [raw, setRaw] = useState(String(value));

    // Keep raw in sync when value changes externally
    useEffect(() => { setRaw(String(value)); }, [value]);

    const commit = () => {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n >= min) onChange(n);
        else setRaw(String(value)); // revert invalid input
    };

    return (
        <input
            type="number"
            min={min}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500 [appearance:textfield]"
        />
    );
}

function DurationInput({ valueMs, onChange }: { valueMs: number; onChange: (ms: number) => void }) {
    const toDisplay = (ms: number) => {
        const h = ms / 3_600_000;
        return Number.isInteger(h) ? String(h) : h.toFixed(1);
    };
    const [raw, setRaw] = useState(toDisplay(valueMs));

    useEffect(() => { setRaw(toDisplay(valueMs)); }, [valueMs]);

    const commit = () => {
        const ms = parseHoursInput(raw);
        if (ms !== null) onChange(ms);
        else setRaw(toDisplay(valueMs));
    };

    return (
        <div className="flex items-center gap-1">
            <input
                type="text"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => e.key === 'Enter' && commit()}
                placeholder="8"
                className="w-14 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
            />
            <span className="text-xs text-gray-600">hr</span>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────

function resolvedOrder(playlist: PlaylistDocType, participants: UserDocType[]): string[] {
    if (playlist.turnOrder?.length) return playlist.turnOrder;
    const ids = [playlist.ownerId, ...playlist.collaboratorIds];
    // Keep only ids that exist in participants, preserve order
    return ids.filter((id) => participants.some((p) => p.id === id));
}

function displayName(userId: string, participants: UserDocType[]): string {
    return participants.find((p) => p.id === userId)?.displayName ?? userId;
}

export function TurnManagementPanel({ playlist, participants, tracks, totalDurationMs, currentUserId }: TurnManagementPanelProps) {
    const tracksPerTurn = playlist.tracksPerTurn ?? 1;
    const maxTurns = playlist.maxTurns;
    const maxDurationMs = playlist.maxDurationMs;
    const turnsCompleted = playlist.turnsCompleted ?? 0;
    const isComplete = playlist.isComplete ?? false;

    // Derive from track history rather than trusting the stored counter
    const turnTracksAdded = inferTurnTracksAdded(tracks, playlist.currentTurnUserId, tracksPerTurn);

    const order = resolvedOrder(playlist, participants);
    const storedTurnIndex = order.indexOf(playlist.currentTurnUserId ?? order[0]);

    // When the derived count hits the quota, the stored currentTurnUserId hasn't advanced yet
    // (e.g. tracks added via Spotify sync bypass the service). Treat the turn as belonging to
    // the *next* person so the display is always correct.
    const turnQuotaFull = !isComplete && turnTracksAdded >= tracksPerTurn;
    const effectiveTurnIndex = turnQuotaFull
        ? (storedTurnIndex + 1) % order.length
        : storedTurnIndex;
    const effectiveTurnUserId = order[effectiveTurnIndex] ?? playlist.currentTurnUserId;
    const isMyTurn = !turnQuotaFull && playlist.currentTurnUserId === currentUserId;

    // The next person is "unknown" when: solo playlist (loops back to me), the effective user ID
    // isn't resolved in participants, or there are no other collaborators at all.
    const nextParticipant = participants.find((p) => p.id === effectiveTurnUserId);
    const awaitingContributor =
        !isMyTurn &&
        !isComplete &&
        (!nextParticipant || effectiveTurnUserId === currentUserId || order.length <= 1);

    // Auto-advance when track history shows the quota is full but the DB hasn't caught up
    useEffect(() => {
        if (turnQuotaFull && !isComplete) {
            advanceTurn(playlist.id);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [turnQuotaFull, isComplete, playlist.id]);

    const [confirmComplete, setConfirmComplete] = useState(false);

    const moveUp = (idx: number) => {
        if (idx === 0) return;
        const next = [...order];
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        setTurnOrder(playlist.id, next);
    };

    const moveDown = (idx: number) => {
        if (idx === order.length - 1) return;
        const next = [...order];
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
        setTurnOrder(playlist.id, next);
    };

    const handleSkipTurn = () => {
        advanceTurn(playlist.id);
    };

    return (
        <div className="card mb-4">
            <div className="card-header flex items-center justify-between">
                <span className="font-medium text-sm">
                    {isComplete ? 'Session Complete' : 'Turn Order'}
                </span>
                {isComplete ? (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                            {playlist.completedFromMode === 'turn_taking' ? 'Turn-taking' : playlist.completedFromMode ?? 'Collaborative'}
                        </span>
                        <button
                            onClick={() => reopenPlaylist(playlist.id)}
                            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                            title="Reopen and resume from previous mode"
                        >
                            Reopen
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        {maxTurns !== undefined && (
                            <span>{turnsCompleted} / {maxTurns} turns</span>
                        )}
                        {!confirmComplete ? (
                            <button
                                onClick={() => setConfirmComplete(true)}
                                className="text-gray-500 hover:text-gray-300 transition-colors"
                                title="Mark session as complete"
                            >
                                Mark complete
                            </button>
                        ) : (
                            <span className="flex items-center gap-1">
                                <span className="text-yellow-400">Complete?</span>
                                <button
                                    onClick={() => { markPlaylistComplete(playlist.id); setConfirmComplete(false); }}
                                    className="text-green-400 hover:text-green-300 font-medium"
                                >
                                    Yes
                                </button>
                                <button
                                    onClick={() => setConfirmComplete(false)}
                                    className="text-gray-500 hover:text-gray-300"
                                >
                                    No
                                </button>
                            </span>
                        )}
                    </div>
                )}
            </div>

            <div className="card-body space-y-4">
                {/* Current turn status */}
                {!isComplete && (
                    <div
                        className={`flex items-center gap-3 p-2 rounded-lg ${
                            isMyTurn ? 'bg-green-900/20 border border-green-700/40' : 'bg-gray-800/40'
                        }`}
                    >
                        {isMyTurn ? (
                            <>
                                <span className="relative flex h-2.5 w-2.5 shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                                </span>
                                <span className="text-sm font-semibold text-green-400">
                                    {tracksPerTurn === 1
                                        ? 'Your turn — add a track'
                                        : `Your turn — ${tracksPerTurn - turnTracksAdded} track${tracksPerTurn - turnTracksAdded !== 1 ? 's' : ''} left`}
                                </span>
                            </>
                        ) : awaitingContributor ? (
                            <>
                                <i className="fa-solid fa-ellipsis text-gray-600 text-xs shrink-0" />
                                <span className="text-sm text-gray-500 italic">
                                    What's next? Waiting for a collaborator to join.
                                </span>
                            </>
                        ) : (
                            <>
                                <i className="fa-solid fa-hourglass-half text-gray-500 text-xs shrink-0" />
                                <span className="text-sm text-gray-400">
                                    Waiting for{' '}
                                    <span className="font-medium text-gray-300">
                                        {nextParticipant?.displayName}
                                    </span>
                                    {!turnQuotaFull && tracksPerTurn > 1 && (
                                        <span className="text-gray-600">
                                            {' '}· {turnTracksAdded}/{tracksPerTurn} tracks
                                        </span>
                                    )}
                                </span>
                            </>
                        )}
                        {!isMyTurn && !awaitingContributor && (
                            <button
                                onClick={handleSkipTurn}
                                className="ml-auto text-xs text-gray-600 hover:text-gray-400 transition-colors"
                                title="Skip current turn"
                            >
                                Skip
                            </button>
                        )}
                    </div>
                )}

                {/* Turn order list */}
                <div className="space-y-1">
                    {order.map((userId, idx) => {
                        const isCurrent = idx === effectiveTurnIndex && !isComplete;
                        return (
                            <div
                                key={userId}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded ${
                                    isCurrent ? 'bg-gray-700/60' : ''
                                }`}
                            >
                                <span className="text-xs text-gray-600 w-4 text-right shrink-0">{idx + 1}</span>
                                <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">
                                    {displayName(userId, participants).charAt(0).toUpperCase()}
                                </div>
                                <span className={`text-sm flex-1 truncate ${isCurrent ? 'text-gray-100 font-medium' : 'text-gray-400'}`}>
                                    {displayName(userId, participants)}
                                    {userId === currentUserId && <span className="ml-1 text-xs text-gray-600">(you)</span>}
                                </span>
                                {isCurrent && !isComplete && !awaitingContributor && (
                                    <i className="fa-solid fa-chevron-right text-green-500 text-xs shrink-0" />
                                )}
                                {!isComplete && (
                                    <div className="flex gap-0.5 shrink-0">
                                        <button
                                            onClick={() => moveUp(idx)}
                                            disabled={idx === 0}
                                            className="text-gray-600 hover:text-gray-300 disabled:opacity-20 px-1"
                                            title="Move up"
                                        >
                                            <i className="fa-solid fa-chevron-up text-xs" />
                                        </button>
                                        <button
                                            onClick={() => moveDown(idx)}
                                            disabled={idx === order.length - 1}
                                            className="text-gray-600 hover:text-gray-300 disabled:opacity-20 px-1"
                                            title="Move down"
                                        >
                                            <i className="fa-solid fa-chevron-down text-xs" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Config: tracks per turn, turn limit, duration limit */}
                {!isComplete && (
                    <div className="space-y-2 pt-2 border-t border-gray-800">
                        {/* Row 1: tracks/turn + max turns */}
                        <div className="flex items-center gap-4 flex-wrap">
                            <ConfigField label="Tracks / turn">
                                <NumberInput
                                    value={tracksPerTurn}
                                    min={1}
                                    onChange={(n) => setTurnConfig(playlist.id, { tracksPerTurn: n })}
                                />
                            </ConfigField>

                            <ConfigField label="Max turns">
                                {maxTurns !== undefined ? (
                                    <div className="flex items-center gap-1.5">
                                        <NumberInput
                                            value={maxTurns}
                                            min={turnsCompleted + 1}
                                            onChange={(n) => setTurnConfig(playlist.id, { maxTurns: n })}
                                        />
                                        <button
                                            onClick={() => setTurnConfig(playlist.id, { maxTurns: null })}
                                            className="text-gray-600 hover:text-gray-400 transition-colors text-xs"
                                            title="Remove cap"
                                        >
                                            ✕
                                        </button>
                                        <span className="text-xs text-gray-600">({turnsCompleted} done)</span>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setTurnConfig(playlist.id, { maxTurns: turnsCompleted + order.length })}
                                        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                                    >
                                        + set limit
                                    </button>
                                )}
                            </ConfigField>
                        </div>

                        {/* Row 2: duration limit */}
                        <div className="flex items-center gap-4">
                            <ConfigField label="Max length">
                                {maxDurationMs !== undefined ? (
                                    <div className="flex items-center gap-1.5">
                                        <DurationInput
                                            valueMs={maxDurationMs}
                                            onChange={(ms) => setTurnConfig(playlist.id, { maxDurationMs: ms })}
                                        />
                                        <button
                                            onClick={() => setTurnConfig(playlist.id, { maxDurationMs: null })}
                                            className="text-gray-600 hover:text-gray-400 transition-colors text-xs"
                                            title="Remove limit"
                                        >
                                            ✕
                                        </button>
                                        <span className="text-xs text-gray-600">
                                            ({formatDurationHuman(totalDurationMs)} now)
                                        </span>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setTurnConfig(playlist.id, { maxDurationMs: 8 * 3_600_000 })}
                                        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                                    >
                                        + set limit
                                    </button>
                                )}
                            </ConfigField>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

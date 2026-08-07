/**
 * ParticipantRoster
 * Card listing session participants with their track counts and turn indicator.
 * Ordered by turnOrder when turn-taking mode is active.
 * Non-local participants can be renamed inline (click the pencil icon).
 */

import { useState, useCallback } from 'react';
import type { UserDocType, TrackDocType } from '../../db/schemas';
import { updateParticipantDisplayName } from '../../db/services/user-service';
import { artSrc } from '../../utils/artSrc';

interface ParticipantRosterProps {
    participants: UserDocType[];
    tracks: TrackDocType[];
    currentUserId: string | null;
    currentTurnUserId?: string | null;
    turnOrder?: string[];
    onParticipantRenamed?: () => void;
}

export function ParticipantRoster({
    participants,
    tracks,
    currentUserId,
    currentTurnUserId,
    turnOrder,
    onParticipantRenamed,
}: ParticipantRosterProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    const editInputRef = useCallback((node: HTMLInputElement | null) => {
        node?.focus();
    }, []);

    const startEditing = (p: UserDocType) => {
        setEditingId(p.id);
        setEditValue(p.displayName);
    };

    const commitRename = async () => {
        if (!editingId || !editValue.trim()) {
            setEditingId(null);
            return;
        }
        await updateParticipantDisplayName(editingId, editValue.trim());
        setEditingId(null);
        onParticipantRenamed?.();
    };

    // Display in explicit turn order when available; fall back to roster order
    const ordered = turnOrder?.length
        ? turnOrder
              .map((id) => participants.find((p) => p.id === id))
              .filter((p): p is UserDocType => p !== undefined)
        : participants;

    const isTurnTaking = !!turnOrder?.length;

    return (
        <div className="card" data-testid="participant-list">
            <div className="card-header">
                <span className="font-medium text-sm text-on-surface">
                    Participants
                </span>
            </div>
            <div className="card-body space-y-3">
                {ordered.map((p, idx) => {
                    const trackCount = tracks.filter(
                        (t) => t.addedBy === p.id,
                    ).length;
                    const isTurn = currentTurnUserId === p.id;
                    const isMe = p.id === currentUserId;
                    const canRename = !p.isLocal && !isMe;
                    const isHost = idx === 0 && !isTurnTaking; // first in roster when no turn order
                    const isCoHost = idx === 1 && !isTurnTaking;

                    // Ring styling based on role / turn state
                    let ringClass = '';
                    if (isTurn) {
                        ringClass = 'ring-2 ring-primary animate-pulse';
                    } else if (isHost) {
                        ringClass = 'ring-2 ring-primary';
                    } else if (isCoHost) {
                        ringClass = 'ring-2 ring-secondary';
                    }

                    const opacityClass =
                        isTurnTaking && currentTurnUserId && !isTurn
                            ? 'opacity-60'
                            : '';

                    return (
                        <div
                            key={p.id}
                            className={`flex items-center gap-2 group ${opacityClass}`}
                        >
                            {isTurnTaking && (
                                <span className="text-xs text-on-surface-variant w-4 text-right shrink-0">
                                    {idx + 1}
                                </span>
                            )}
                            <div className="relative shrink-0">
                                {artSrc(p.avatarLocalPath, p.avatarUrl) ? (
                                    <img
                                        src={artSrc(
                                            p.avatarLocalPath,
                                            p.avatarUrl,
                                        )}
                                        alt=""
                                        className={`w-8 h-8 rounded-full object-cover ${ringClass}`}
                                        onError={(e) => {
                                            e.currentTarget.style.display =
                                                'none';
                                            e.currentTarget.nextElementSibling?.classList.remove(
                                                'hidden',
                                            );
                                        }}
                                    />
                                ) : null}
                                <div
                                    className={`w-8 h-8 rounded-full bg-surface-high flex items-center justify-center text-sm font-bold text-on-surface-variant ${ringClass} ${artSrc(p.avatarLocalPath, p.avatarUrl) ? 'hidden' : ''}`}
                                >
                                    {p.displayName.charAt(0).toUpperCase()}
                                </div>
                                {isTurn && (
                                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-primary rounded-full border border-surface" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                {editingId === p.id ? (
                                    <input
                                        ref={editInputRef}
                                        className="bg-surface-high text-sm text-on-surface rounded px-1.5 py-0.5 w-full outline-none border border-outline-variant focus:border-primary"
                                        value={editValue}
                                        onChange={(e) =>
                                            setEditValue(e.target.value)
                                        }
                                        onBlur={commitRename}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter')
                                                commitRename();
                                            if (e.key === 'Escape')
                                                setEditingId(null);
                                        }}
                                    />
                                ) : (
                                    <p className="text-sm font-medium text-on-surface truncate">
                                        {p.displayName}
                                        {isMe && (
                                            <span className="ml-1 text-xs text-on-surface-variant">
                                                (you)
                                            </span>
                                        )}
                                        {canRename && (
                                            <button
                                                className="ml-1.5 text-on-surface-variant hover:text-on-surface opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={() => startEditing(p)}
                                                title="Set nickname"
                                            >
                                                <i className="fa-solid fa-pen text-[10px]" />
                                            </button>
                                        )}
                                    </p>
                                )}
                            </div>
                            {trackCount > 0 && (
                                <span className="text-xs text-on-surface-variant shrink-0">
                                    {trackCount}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

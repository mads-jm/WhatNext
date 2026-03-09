/**
 * ParticipantRoster
 * Left-column card listing session participants with their track counts and turn indicator.
 */

import type { UserDocType, TrackDocType } from '../../db/schemas';

interface ParticipantRosterProps {
    participants: UserDocType[];
    tracks: TrackDocType[];
    currentUserId: string | null;
    currentTurnUserId?: string | null;
}

export function ParticipantRoster({
    participants,
    tracks,
    currentUserId,
    currentTurnUserId,
}: ParticipantRosterProps) {
    return (
        <div className="card col-span-1" data-testid="participant-list">
            <div className="card-header">
                <span className="font-medium text-sm">Participants</span>
            </div>
            <div className="card-body space-y-3">
                {participants.map((p) => {
                    const trackCount = tracks.filter((t) => t.addedBy === p.id).length;
                    const isTurn = currentTurnUserId === p.id;

                    return (
                        <div key={p.id} className="flex items-center gap-2">
                            <div className="relative">
                                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-300">
                                    {p.displayName.charAt(0).toUpperCase()}
                                </div>
                                {isTurn && (
                                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border border-gray-900" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-200 truncate">
                                    {p.displayName}
                                    {p.id === currentUserId && (
                                        <span className="ml-1 text-xs text-gray-500">(you)</span>
                                    )}
                                </p>
                            </div>
                            {trackCount > 0 && (
                                <span className="text-xs text-gray-500 shrink-0">{trackCount}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

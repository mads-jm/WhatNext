/**
 * TurnIndicator
 * Banner displayed in turn-taking mode: "Your turn" or "Waiting for <name>".
 * Shows per-turn track progress and optional max-turns cap.
 * Displays the current turn user's avatar when available.
 */

import { artSrc } from '../../utils/artSrc';

interface TurnIndicatorProps {
    isMyTurn: boolean;
    currentTurnDisplayName?: string | null;
    currentTurnAvatarUrl?: string | null;
    currentTurnAvatarLocalPath?: string | null;
    tracksPerTurn?: number;
    turnTracksAdded?: number;
    turnsCompleted?: number;
    maxTurns?: number;
}

export function TurnIndicator({
    isMyTurn,
    currentTurnDisplayName,
    currentTurnAvatarUrl,
    currentTurnAvatarLocalPath,
    tracksPerTurn = 1,
    turnTracksAdded = 0,
    turnsCompleted,
    maxTurns,
}: TurnIndicatorProps) {
    const tracksRemaining = tracksPerTurn - turnTracksAdded;
    const avatarSrc = artSrc(
        currentTurnAvatarLocalPath ?? undefined,
        currentTurnAvatarUrl ?? undefined,
    );

    return (
        <div
            className={`card card-body flex items-center gap-3 ${
                isMyTurn
                    ? 'border-primary bg-primary/20 animate-pulse'
                    : 'bg-surface-high border-outline-variant/20'
            }`}
            data-testid="turn-indicator"
        >
            {isMyTurn ? (
                <>
                    <span className="relative flex h-3 w-3 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                    </span>
                    <span className="text-sm font-semibold text-primary">
                        Your turn!
                        {tracksPerTurn > 1
                            ? ` Add ${tracksRemaining} more track${tracksRemaining !== 1 ? 's' : ''}.`
                            : ' Add a track.'}
                    </span>
                </>
            ) : (
                <>
                    {avatarSrc ? (
                        <img
                            src={avatarSrc}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover shrink-0"
                        />
                    ) : (
                        <i className="fa-solid fa-hourglass-half text-on-surface-variant text-sm shrink-0" />
                    )}
                    <span className="text-sm text-on-surface-variant">
                        Waiting for{' '}
                        <span className="font-medium text-on-surface">
                            {currentTurnDisplayName ?? 'someone'}
                        </span>
                        {tracksPerTurn > 1 && (
                            <span className="text-on-surface-variant">
                                {' '}
                                · {turnTracksAdded}/{tracksPerTurn} tracks
                            </span>
                        )}
                        ...
                    </span>
                </>
            )}
            {maxTurns !== undefined && turnsCompleted !== undefined && (
                <span className="ml-auto text-xs font-headline font-bold text-on-surface-variant shrink-0">
                    {turnsCompleted}/{maxTurns} turns
                </span>
            )}
        </div>
    );
}

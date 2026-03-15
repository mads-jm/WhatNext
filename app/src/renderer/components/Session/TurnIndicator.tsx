/**
 * TurnIndicator
 * Banner displayed in turn-taking mode: "Your turn" or "Waiting for <name>".
 * Shows per-turn track progress and optional max-turns cap.
 */

interface TurnIndicatorProps {
    isMyTurn: boolean;
    currentTurnDisplayName?: string | null;
    tracksPerTurn?: number;
    turnTracksAdded?: number;
    turnsCompleted?: number;
    maxTurns?: number;
}

export function TurnIndicator({
    isMyTurn,
    currentTurnDisplayName,
    tracksPerTurn = 1,
    turnTracksAdded = 0,
    turnsCompleted,
    maxTurns,
}: TurnIndicatorProps) {
    const tracksRemaining = tracksPerTurn - turnTracksAdded;

    return (
        <div
            className={`card card-body flex items-center gap-3 ${
                isMyTurn ? 'border-green-600/60 bg-green-900/20' : 'border-gray-700'
            }`}
            data-testid="turn-indicator"
        >
            {isMyTurn ? (
                <>
                    <span className="relative flex h-3 w-3 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                    </span>
                    <span className="text-sm font-semibold text-green-400">
                        Your turn!
                        {tracksPerTurn > 1
                            ? ` Add ${tracksRemaining} more track${tracksRemaining !== 1 ? 's' : ''}.`
                            : ' Add a track.'}
                    </span>
                </>
            ) : (
                <>
                    <i className="fa-solid fa-hourglass-half text-gray-500 text-sm shrink-0" />
                    <span className="text-sm text-gray-400">
                        Waiting for{' '}
                        <span className="font-medium text-gray-300">
                            {currentTurnDisplayName ?? 'someone'}
                        </span>
                        {tracksPerTurn > 1 && (
                            <span className="text-gray-600"> · {turnTracksAdded}/{tracksPerTurn} tracks</span>
                        )}
                        ...
                    </span>
                </>
            )}
            {maxTurns !== undefined && turnsCompleted !== undefined && (
                <span className="ml-auto text-xs text-gray-600 shrink-0">
                    {turnsCompleted}/{maxTurns} turns
                </span>
            )}
        </div>
    );
}

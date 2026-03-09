/**
 * TurnIndicator
 * Banner displayed in turn-taking mode: "Your turn" or "Waiting for <name>".
 */

interface TurnIndicatorProps {
    isMyTurn: boolean;
    currentTurnDisplayName?: string | null;
}

export function TurnIndicator({ isMyTurn, currentTurnDisplayName }: TurnIndicatorProps) {
    return (
        <div
            className={`card card-body flex items-center gap-3 ${
                isMyTurn ? 'border-green-600/60 bg-green-900/20' : 'border-gray-700'
            }`}
            data-testid="turn-indicator"
        >
            {isMyTurn ? (
                <>
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                    </span>
                    <span className="text-sm font-semibold text-green-400">
                        Your turn! Add a track on Spotify.
                    </span>
                </>
            ) : (
                <>
                    <i className="fa-solid fa-hourglass-half text-gray-500 text-sm" />
                    <span className="text-sm text-gray-400">
                        Waiting for{' '}
                        <span className="font-medium text-gray-300">
                            {currentTurnDisplayName ?? 'someone'}
                        </span>
                        ...
                    </span>
                </>
            )}
        </div>
    );
}

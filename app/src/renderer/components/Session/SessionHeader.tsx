/**
 * SessionHeader
 * Top row: "End Session" button and optional track-source sync error banner.
 */

interface SessionHeaderProps {
    onEndSession: () => void;
    trackSourceError?: string | null;
}

export function SessionHeader({ onEndSession, trackSourceError }: SessionHeaderProps) {
    return (
        <div className="flex items-center gap-3" data-testid="session-header">
            <button className="btn-ghost text-sm" onClick={onEndSession}>
                <i className="fa-solid fa-arrow-left mr-2" />
                End Session
            </button>
            {trackSourceError && (
                <span className="text-xs text-red-400">
                    <i className="fa-solid fa-triangle-exclamation mr-1" />
                    Sync error: {trackSourceError}
                </span>
            )}
        </div>
    );
}

/**
 * SessionEmptyState
 * Shown when no playlist/session ID is active.
 */

export function SessionEmptyState() {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center text-on-surface-variant">
                <i className="fa-solid fa-satellite-dish text-4xl mb-4" />
                <h3 className="text-lg font-medium text-on-surface mb-2">No Active Session</h3>
                <p className="text-sm">Open a collaborative playlist to start a session</p>
            </div>
        </div>
    );
}

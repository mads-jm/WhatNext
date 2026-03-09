/**
 * SessionInfoBar
 * Card row showing playlist name, track/participant counts, and a Share button.
 */

interface SessionInfoBarProps {
    playlistName?: string | null;
    trackCount: number;
    participantCount: number;
    onShare: () => void;
}

export function SessionInfoBar({
    playlistName,
    trackCount,
    participantCount,
    onShare,
}: SessionInfoBarProps) {
    return (
        <div className="card card-body flex items-center justify-between" data-testid="session-info-bar">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
                    <i className="fa-solid fa-music text-white text-sm" />
                </div>
                <div>
                    <p className="font-semibold text-gray-100">{playlistName ?? 'Loading...'}</p>
                    <p className="text-xs text-gray-500">
                        {trackCount} tracks &middot; {participantCount} participant{participantCount !== 1 ? 's' : ''}
                    </p>
                </div>
            </div>
            <button
                className="btn-ghost text-sm"
                onClick={onShare}
                title="Copy session ID"
            >
                <i className="fa-solid fa-share-nodes mr-1" />
                Share
            </button>
        </div>
    );
}

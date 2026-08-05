/**
 * SessionInfoBar
 * Card row showing playlist name, track/participant counts, and a Share button.
 */

import { artSrc } from '../../utils/artSrc';

interface SessionInfoBarProps {
    playlistName?: string | null;
    coverArtLocalPath?: string;
    coverArtUrl?: string;
    trackCount: number;
    participantCount: number;
    onShare: () => void;
}

export function SessionInfoBar({
    playlistName,
    coverArtLocalPath,
    coverArtUrl,
    trackCount,
    participantCount,
    onShare,
}: SessionInfoBarProps) {
    const imgSrc = artSrc(coverArtLocalPath, coverArtUrl);

    return (
        <div
            className="card card-body flex items-center justify-between"
            data-testid="session-info-bar"
        >
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-dim to-primary flex items-center justify-center overflow-hidden shrink-0">
                    {imgSrc ? (
                        <img
                            src={imgSrc}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                if (coverArtUrl)
                                    e.currentTarget.src = coverArtUrl;
                            }}
                        />
                    ) : (
                        <i className="fa-solid fa-music text-on-surface text-sm" />
                    )}
                </div>
                <div>
                    <p className="font-semibold text-on-surface">
                        {playlistName ?? 'Loading...'}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                        {trackCount} tracks &middot; {participantCount}{' '}
                        participant{participantCount !== 1 ? 's' : ''}
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

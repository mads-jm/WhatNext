/**
 * SessionFeed
 * Right sidebar feed showing comments, system events, and reactions.
 * Wraps PlaylistComments with campfire session styling.
 */

import { PlaylistComments } from '../Social/PlaylistComments';

interface SessionFeedProps {
    playlistId: string;
}

export function SessionFeed({ playlistId }: SessionFeedProps) {
    return (
        <div className="w-80 shrink-0 bg-surface-high rounded-xl border border-outline-variant/10 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-outline-variant/10">
                <h3 className="text-xs uppercase tracking-widest text-on-surface-variant font-headline">
                    Session Feed
                </h3>
            </div>
            <div className="flex-1 overflow-y-auto">
                <PlaylistComments playlistId={playlistId} />
            </div>
        </div>
    );
}

/**
 * P2PPeerCard — discovered peer card with connect/disconnect/details actions.
 */

import type { PeerMetadata } from '../../../shared/core';

interface P2PPeerCardProps {
    peer: PeerMetadata;
    isConnected: boolean;
    onConnect: () => void;
    onDisconnect: () => void;
    onSelectDetails: () => void;
}

export function P2PPeerCard({ peer, isConnected, onConnect, onDisconnect, onSelectDetails }: P2PPeerCardProps) {
    return (
        <div className="bg-surface-high border border-outline-variant/20 rounded p-3 space-y-2">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="font-bold text-sm text-on-surface">{peer.displayName}</div>
                    <div className="text-xs text-on-surface-variant font-mono">{peer.peerId.slice(0, 20)}...</div>
                    <div className="text-xs text-on-surface-variant mt-1">
                        via {peer.discovered} &middot; {peer.multiaddrs?.length ?? 0} addr(s)
                    </div>
                </div>
                <div className="flex gap-1">
                    {isConnected ? (
                        <>
                            <button
                                onClick={onSelectDetails}
                                className="px-2 py-1 bg-primary/10 text-primary rounded text-xs hover:bg-primary/20"
                            >
                                Details
                            </button>
                            <button
                                onClick={onDisconnect}
                                className="px-2 py-1 bg-error/15 text-error rounded text-xs hover:bg-error/25"
                            >
                                Disconnect
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={onConnect}
                            className="px-2 py-1 bg-primary text-on-surface rounded text-xs hover:bg-primary-dim"
                        >
                            Connect
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

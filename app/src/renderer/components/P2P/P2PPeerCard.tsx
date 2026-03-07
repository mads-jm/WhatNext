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
        <div className="bg-gray-50 border border-gray-200 rounded p-3 space-y-2">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="font-bold text-sm text-gray-800">{peer.displayName}</div>
                    <div className="text-xs text-gray-500 font-mono">{peer.peerId.slice(0, 20)}...</div>
                    <div className="text-xs text-gray-400 mt-1">
                        via {peer.discovered} &middot; {peer.multiaddrs?.length ?? 0} addr(s)
                    </div>
                </div>
                <div className="flex gap-1">
                    {isConnected ? (
                        <>
                            <button
                                onClick={onSelectDetails}
                                className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200"
                            >
                                Details
                            </button>
                            <button
                                onClick={onDisconnect}
                                className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                            >
                                Disconnect
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={onConnect}
                            className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"
                        >
                            Connect
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

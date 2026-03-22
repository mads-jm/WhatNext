/**
 * P2PPeerDetails — expanded peer information panel.
 */

import type { PeerMetadata } from '../../../shared/core';
import { P2PInfoRow } from './P2PInfoRow';

interface P2PPeerDetailsProps {
    peer: PeerMetadata;
    onClose: () => void;
}

export function P2PPeerDetails({ peer, onClose }: P2PPeerDetailsProps) {
    return (
        <div className="space-y-3">
            <div className="flex justify-between items-center">
                <h3 className="font-bold text-sm">Connection Details</h3>
                <button
                    onClick={onClose}
                    className="px-2 py-1 bg-surface-high hover:bg-outline-variant rounded text-xs"
                >
                    Close
                </button>
            </div>

            <div className="space-y-2 text-xs">
                <P2PInfoRow label="Peer ID" value={peer.peerId} mono />
                <P2PInfoRow label="Display Name" value={peer.displayName} />
                <P2PInfoRow
                    label="Discovered"
                    value={`${peer.discovered}${peer.discoveredAt ? ` at ${new Date(peer.discoveredAt).toLocaleTimeString()}` : ''}`}
                />
                <P2PInfoRow label="Last Seen" value={new Date(peer.lastSeenAt).toLocaleTimeString()} />

                {(peer.protocols?.length ?? 0) > 0 && (
                    <div>
                        <span className="font-semibold text-on-surface-variant">Protocols ({peer.protocols!.length}):</span>
                        <div className="mt-1 space-y-1">
                            {peer.protocols!.map((protocol: string) => (
                                <div key={protocol} className="bg-primary/10 rounded px-2 py-1 font-mono">
                                    {protocol}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {(peer.multiaddrs?.length ?? 0) > 0 && (
                    <div>
                        <span className="font-semibold text-on-surface-variant">Multiaddrs ({peer.multiaddrs!.length}):</span>
                        <div className="mt-1 space-y-1">
                            {peer.multiaddrs!.map((addr: string) => (
                                <div key={addr} className="bg-surface-high rounded px-2 py-1 font-mono break-all">
                                    {addr}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

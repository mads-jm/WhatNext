/**
 * P2P Development Interface — slim orchestrator.
 * All state/logic lives in useP2PDevStatus; all UI primitives are sub-components.
 */

import { useP2PDevStatus } from '../../hooks/useP2PDevStatus';
import { P2PSection } from './P2PSection';
import { P2PInfoRow } from './P2PInfoRow';
import { P2PPeerCard } from './P2PPeerCard';
import { P2PPeerDetails } from './P2PPeerDetails';
import { P2PConnectForm } from './P2PConnectForm';
import { P2PDebugLog } from './P2PDebugLog';

export function P2PStatus() {
    const p2p = useP2PDevStatus();
    const { status, expandedSections } = p2p;

    const nodeStatusColor = status.nodeStarted ? 'bg-primary' : 'bg-secondary animate-pulse';
    const nodeStatusText = status.nodeStarted ? 'Online' : 'Starting...';

    return (
        <div className="space-y-4 font-mono text-sm">
            {/* Header */}
            <div className="bg-surface-high rounded-lg p-4 border-l-4 border-primary">
                <h1 className="text-2xl font-bold text-on-surface mb-1">Network Control</h1>
                <p className="text-xs text-on-surface-variant">Your node, your rules &mdash; direct peer connections with no intermediary</p>
            </div>

            {/* Node Status */}
            <P2PSection
                title="Node Status"
                expanded={expandedSections.nodeInfo}
                onToggle={() => p2p.toggleSection('nodeInfo')}
                badge={<div className={`w-3 h-3 rounded-full ${nodeStatusColor}`} />}
            >
                <div className="space-y-3">
                    <P2PInfoRow label="Status" value={nodeStatusText} />

                    {status.nodeStarted && (
                        <>
                            <P2PInfoRow
                                label="Peer ID"
                                value={status.peerId ?? ''}
                                mono
                                copyable
                                onCopy={() => p2p.copyToClipboard(status.peerId ?? '', 'Peer ID')}
                            />

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-on-surface-variant font-semibold text-xs">Connection URL:</span>
                                    <button
                                        onClick={() =>
                                            p2p.copyToClipboard(
                                                `whtnxt://connect/${status.peerId ?? ''}`,
                                                'Connection URL',
                                            )
                                        }
                                        className="px-2 py-1 bg-primary text-on-surface rounded text-xs hover:bg-primary-dim"
                                    >
                                        Copy URL
                                    </button>
                                </div>
                                <div className="bg-primary/10 border border-primary/20 rounded p-2 text-xs font-mono text-primary break-all">
                                    whtnxt://connect/{status.peerId ?? ''}
                                </div>
                            </div>

                            {status.multiaddrs.length > 0 && (
                                <div>
                                    <span className="text-on-surface-variant font-semibold text-xs">
                                        Listening Addresses ({status.multiaddrs.length}):
                                    </span>
                                    <div className="mt-1 space-y-1">
                                        {status.multiaddrs.map((addr) => (
                                            <div key={addr} className="bg-surface-high rounded px-2 py-1 text-xs break-all">
                                                {addr}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(status.protocols?.length ?? 0) > 0 && (
                                <div>
                                    <span className="text-on-surface-variant font-semibold text-xs">
                                        Supported Protocols ({status.protocols?.length ?? 0}):
                                    </span>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {(status.protocols ?? []).map((protocol) => (
                                            <span
                                                key={protocol}
                                                className="bg-primary/15 text-primary px-2 py-1 rounded text-xs"
                                            >
                                                {protocol}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </P2PSection>

            {/* Connect via URL */}
            <P2PSection title="Connect to Peer" expanded={true}>
                <P2PConnectForm
                    connectUrl={p2p.connectUrl}
                    onUrlChange={p2p.setConnectUrl}
                    onConnect={p2p.handleConnectViaUrl}
                />
            </P2PSection>

            {/* Discovered Peers */}
            <P2PSection
                title="Discovered Peers"
                expanded={expandedSections.discoveredPeers}
                onToggle={() => p2p.toggleSection('discoveredPeers')}
                badge={<span className="text-xs font-semibold text-on-surface-variant">{status.discoveredPeers.length}</span>}
            >
                {status.discoveredPeers.length === 0 ? (
                    <p className="text-xs text-on-surface-variant italic">
                        No peers discovered. Ensure another WhatNext instance is running on the same network.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {status.discoveredPeers.map((peer) => (
                            <P2PPeerCard
                                key={peer.peerId}
                                peer={peer}
                                isConnected={status.connectedPeers.includes(peer.peerId)}
                                onConnect={() => p2p.handleConnect(peer.peerId)}
                                onDisconnect={() => p2p.handleDisconnect(peer.peerId)}
                                onSelectDetails={() => p2p.openPeerDetails(peer)}
                            />
                        ))}
                    </div>
                )}
            </P2PSection>

            {/* Active Connections */}
            <P2PSection
                title="Active Connections"
                expanded={expandedSections.connectedPeers}
                onToggle={() => p2p.toggleSection('connectedPeers')}
                badge={<span className="text-xs font-semibold text-primary">{status.connectedPeers.length}</span>}
            >
                {status.connectedPeers.length === 0 ? (
                    <p className="text-xs text-on-surface-variant italic">No active connections</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {status.connectedPeers.map((peerId) => (
                            <div
                                key={peerId}
                                className="bg-primary/15 text-primary px-3 py-1 rounded text-xs font-semibold"
                            >
                                {peerId.slice(0, 12)}...
                            </div>
                        ))}
                    </div>
                )}
            </P2PSection>

            {/* Peer Details */}
            {p2p.selectedPeer && (
                <P2PSection
                    title={`Peer Details: ${p2p.selectedPeer.displayName}`}
                    expanded={expandedSections.peerDetails}
                    onToggle={() => p2p.toggleSection('peerDetails')}
                >
                    <P2PPeerDetails peer={p2p.selectedPeer} onClose={p2p.closePeerDetails} />
                </P2PSection>
            )}

            {/* Debug Logs */}
            <P2PSection
                title="Debug Log"
                expanded={expandedSections.logs}
                onToggle={() => p2p.toggleSection('logs')}
                badge={<span className="text-xs text-on-surface-variant">{p2p.logs.length}/50</span>}
            >
                <P2PDebugLog logs={p2p.logs} />
            </P2PSection>
        </div>
    );
}

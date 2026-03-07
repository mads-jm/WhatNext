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

    const nodeStatusColor = status.nodeStarted ? 'bg-green-500' : 'bg-yellow-500 animate-pulse';
    const nodeStatusText = status.nodeStarted ? 'Online' : 'Starting...';

    return (
        <div className="space-y-4 font-mono text-sm">
            {/* Header */}
            <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-blue-500">
                <h1 className="text-2xl font-bold text-gray-800 mb-1">P2P Development Interface</h1>
                <p className="text-xs text-gray-600">v0.0.1 Alpha &middot; Learning &amp; Exploration Mode</p>
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
                                    <span className="text-gray-600 font-semibold text-xs">Connection URL:</span>
                                    <button
                                        onClick={() =>
                                            p2p.copyToClipboard(
                                                `whtnxt://connect/${status.peerId ?? ''}`,
                                                'Connection URL',
                                            )
                                        }
                                        className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                                    >
                                        Copy URL
                                    </button>
                                </div>
                                <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs font-mono text-blue-900 break-all">
                                    whtnxt://connect/{status.peerId ?? ''}
                                </div>
                            </div>

                            {status.multiaddrs.length > 0 && (
                                <div>
                                    <span className="text-gray-600 font-semibold text-xs">
                                        Listening Addresses ({status.multiaddrs.length}):
                                    </span>
                                    <div className="mt-1 space-y-1">
                                        {status.multiaddrs.map((addr) => (
                                            <div key={addr} className="bg-gray-100 rounded px-2 py-1 text-xs break-all">
                                                {addr}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(status.protocols?.length ?? 0) > 0 && (
                                <div>
                                    <span className="text-gray-600 font-semibold text-xs">
                                        Supported Protocols ({status.protocols?.length ?? 0}):
                                    </span>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {(status.protocols ?? []).map((protocol) => (
                                            <span
                                                key={protocol}
                                                className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs"
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
                badge={<span className="text-xs font-semibold text-gray-600">{status.discoveredPeers.length}</span>}
            >
                {status.discoveredPeers.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">
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
                badge={<span className="text-xs font-semibold text-green-600">{status.connectedPeers.length}</span>}
            >
                {status.connectedPeers.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No active connections</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {status.connectedPeers.map((peerId) => (
                            <div
                                key={peerId}
                                className="bg-green-100 text-green-800 px-3 py-1 rounded text-xs font-semibold"
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

            {/* Data Transfer Testing */}
            <P2PSection
                title="Data Transfer Testing"
                expanded={expandedSections.testing}
                onToggle={() => p2p.toggleSection('testing')}
                badge={<span className="text-xs text-orange-600 font-semibold">COMING SOON</span>}
            >
                <div className="space-y-3">
                    <p className="text-xs text-gray-600 italic">
                        Testing utilities for playlist sync and file transfer will be added here.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            disabled
                            className="px-3 py-2 bg-gray-200 text-gray-500 rounded text-xs cursor-not-allowed"
                        >
                            Send Test Message
                        </button>
                        <button
                            disabled
                            className="px-3 py-2 bg-gray-200 text-gray-500 rounded text-xs cursor-not-allowed"
                        >
                            Send Test File
                        </button>
                    </div>
                </div>
            </P2PSection>

            {/* Debug Logs */}
            <P2PSection
                title="Debug Log"
                expanded={expandedSections.logs}
                onToggle={() => p2p.toggleSection('logs')}
                badge={<span className="text-xs text-gray-600">{p2p.logs.length}/50</span>}
            >
                <P2PDebugLog logs={p2p.logs} />
            </P2PSection>
        </div>
    );
}

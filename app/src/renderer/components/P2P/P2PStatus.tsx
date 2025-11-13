/**
 * P2P Development Interface
 *
 * Comprehensive P2P status display and testing interface for learning and development.
 * This component exposes maximum visibility into the P2P networking layer.
 *
 * PHILOSOPHY: This is a developer-first UI designed for exploration and learning.
 * It will be refined into a user-friendly interface once P2P patterns are mastered.
 */

import { useEffect, useState } from 'react';
import type { DetailedPeerInfo } from '../../../shared/core';

interface P2PStatus {
    nodeStarted: boolean;
    peerId: string;
    multiaddrs: string[];
    discoveredPeers: DetailedPeerInfo[];
    connectedPeers: string[];
    protocols: string[];
}

export function P2PStatus() {
    // === STATE ===
    const [status, setStatus] = useState<P2PStatus>({
        nodeStarted: false,
        peerId: '',
        multiaddrs: [],
        discoveredPeers: [],
        connectedPeers: [],
        protocols: [],
    });

    const [selectedPeer, setSelectedPeer] = useState<DetailedPeerInfo | null>(null);
    const [connectUrl, setConnectUrl] = useState<string>('');
    const [logs, setLogs] = useState<Array<{ time: string; level: string; message: string }>>([]);
    const [expandedSections, setExpandedSections] = useState({
        nodeInfo: true,
        discoveredPeers: true,
        connectedPeers: true,
        logs: true,
        peerDetails: false,
        testing: false,
    });

    // === LOGGING ===
    const addLog = (level: 'info' | 'warn' | 'error' | 'success', message: string) => {
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
        setLogs((prev) => [...prev.slice(-49), { time: timestamp, level, message }]);
        console.log(`[P2P UI ${timestamp}] [${level.toUpperCase()}] ${message}`);
    };

    // === POLLING & EVENTS ===
    useEffect(() => {
        if (!window.electron?.p2p) {
            addLog('error', 'P2P API not available');
            return;
        }

        addLog('info', 'P2P interface initialized');

        let polling = true;
        const knownPeerIds = new Set<string>();

        // Poll status every 1 second
        const pollStatus = async () => {
            try {
                const newStatus = await window.electron!.p2p.getStatus();

                // Log first-time events
                if (newStatus.nodeStarted && !status.nodeStarted) {
                    addLog('success', `Node started: ${newStatus.peerId.slice(0, 20)}...`);
                    addLog('info', `Listening on ${newStatus.multiaddrs?.length || 0} addresses`);
                }

                // Log newly discovered peers
                newStatus.discoveredPeers?.forEach((peer: DetailedPeerInfo) => {
                    if (!knownPeerIds.has(peer.peerId)) {
                        addLog('info', `🔍 Peer discovered: ${peer.displayName} (${peer.peerId.slice(0, 12)}...)`);
                        knownPeerIds.add(peer.peerId);
                    }
                });

                setStatus(newStatus);
            } catch (error) {
                addLog('error', `Poll failed: ${error}`);
            }

            if (polling) {
                setTimeout(pollStatus, 1000);
            }
        };

        pollStatus();

        // Event listeners for real-time updates
        const unsubConnected = window.electron.p2p.onConnectionEstablished((data) => {
            addLog('success', `✅ Connected to ${data.peerId.slice(0, 12)}...`);
        });

        const unsubDisconnected = window.electron.p2p.onConnectionClosed((data) => {
            addLog('warn', `❌ Disconnected from ${data.peerId.slice(0, 12)}...`);
            if (selectedPeer?.peerId === data.peerId) {
                setSelectedPeer(null);
            }
        });

        const unsubFailed = window.electron.p2p.onConnectionFailed((data) => {
            addLog('error', `⚠️ Connection failed: ${data.error || 'Unknown error'}`);
        });

        const unsubError = window.electron.p2p.onNodeError((data) => {
            addLog('error', `Node error: ${data.error || 'Unknown error'}`);
        });

        return () => {
            polling = false;
            unsubConnected();
            unsubDisconnected();
            unsubFailed();
            unsubError();
        };
    }, []);

    // === ACTIONS ===
    const handleConnect = async (peerId: string) => {
        try {
            addLog('info', `Connecting to ${peerId.slice(0, 12)}...`);
            await window.electron!.p2p.connect(peerId);
        } catch (error) {
            addLog('error', `Connection failed: ${error}`);
        }
    };

    const handleConnectViaUrl = async () => {
        if (!connectUrl.trim()) return;

        try {
            const url = new URL(connectUrl.trim());
            if (url.protocol !== 'whtnxt:') {
                addLog('error', 'Invalid URL: must start with whtnxt://');
                return;
            }

            const peerId = url.pathname.slice(1);
            if (!peerId) {
                addLog('error', 'Invalid URL: missing peer ID');
                return;
            }

            await handleConnect(peerId);
            setConnectUrl('');
        } catch (error) {
            addLog('error', `Invalid URL: ${error}`);
        }
    };

    const handleDisconnect = async (peerId: string) => {
        try {
            addLog('info', `Disconnecting from ${peerId.slice(0, 12)}...`);
            await window.electron!.p2p.disconnect(peerId);
        } catch (error) {
            addLog('error', `Disconnect failed: ${error}`);
        }
    };

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        addLog('info', `${label} copied to clipboard`);
    };

    const toggleSection = (section: keyof typeof expandedSections) => {
        setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    };

    // === COMPUTED ===
    const nodeStatusColor = status.nodeStarted ? 'bg-green-500' : 'bg-yellow-500 animate-pulse';
    const nodeStatusText = status.nodeStarted ? 'Online' : 'Starting...';

    // === RENDER ===
    return (
        <div className="space-y-4 font-mono text-sm">
            {/* Header */}
            <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-blue-500">
                <h1 className="text-2xl font-bold text-gray-800 mb-1">P2P Development Interface</h1>
                <p className="text-xs text-gray-600">
                    v0.0.0 Alpha • Learning & Exploration Mode
                </p>
            </div>

            {/* Node Status */}
            <Section
                title="Node Status"
                expanded={expandedSections.nodeInfo}
                onToggle={() => toggleSection('nodeInfo')}
                badge={<div className={`w-3 h-3 rounded-full ${nodeStatusColor}`} />}
            >
                <div className="space-y-3">
                    <InfoRow label="Status" value={nodeStatusText} />

                    {status.nodeStarted && (
                        <>
                            <InfoRow
                                label="Peer ID"
                                value={status.peerId}
                                mono
                                copyable
                                onCopy={() => copyToClipboard(status.peerId, 'Peer ID')}
                            />

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-gray-600 font-semibold text-xs">Connection URL:</span>
                                    <button
                                        onClick={() => copyToClipboard(`whtnxt://connect/${status.peerId}`, 'Connection URL')}
                                        className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                                    >
                                        Copy URL
                                    </button>
                                </div>
                                <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs font-mono text-blue-900 break-all">
                                    whtnxt://connect/{status.peerId}
                                </div>
                            </div>

                            {status.multiaddrs.length > 0 && (
                                <div>
                                    <span className="text-gray-600 font-semibold text-xs">
                                        Listening Addresses ({status.multiaddrs.length}):
                                    </span>
                                    <div className="mt-1 space-y-1">
                                        {status.multiaddrs.map((addr, i) => (
                                            <div key={i} className="bg-gray-100 rounded px-2 py-1 text-xs break-all">
                                                {addr}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {status.protocols.length > 0 && (
                                <div>
                                    <span className="text-gray-600 font-semibold text-xs">
                                        Supported Protocols ({status.protocols.length}):
                                    </span>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {status.protocols.map((protocol) => (
                                            <span key={protocol} className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs">
                                                {protocol}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </Section>

            {/* Connect via URL */}
            <Section title="Connect to Peer" expanded={true}>
                <div className="space-y-2">
                    <input
                        type="text"
                        value={connectUrl}
                        onChange={(e) => setConnectUrl(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleConnectViaUrl()}
                        placeholder="whtnxt://connect/12D3Koo..."
                        className="w-full px-3 py-2 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        onClick={handleConnectViaUrl}
                        disabled={!connectUrl.trim()}
                        className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs font-semibold"
                    >
                        Connect
                    </button>
                    <p className="text-xs text-gray-500">
                        Paste a whtnxt:// connection URL from another peer
                    </p>
                </div>
            </Section>

            {/* Discovered Peers */}
            <Section
                title="Discovered Peers"
                expanded={expandedSections.discoveredPeers}
                onToggle={() => toggleSection('discoveredPeers')}
                badge={<span className="text-xs font-semibold text-gray-600">{status.discoveredPeers.length}</span>}
            >
                {status.discoveredPeers.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">
                        No peers discovered. Ensure another WhatNext instance is running on the same network.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {status.discoveredPeers.map((peer) => (
                            <PeerCard
                                key={peer.peerId}
                                peer={peer}
                                isConnected={status.connectedPeers.includes(peer.peerId)}
                                onConnect={() => handleConnect(peer.peerId)}
                                onDisconnect={() => handleDisconnect(peer.peerId)}
                                onSelectDetails={() => {
                                    setSelectedPeer(peer);
                                    setExpandedSections((prev) => ({ ...prev, peerDetails: true }));
                                }}
                            />
                        ))}
                    </div>
                )}
            </Section>

            {/* Active Connections */}
            <Section
                title="Active Connections"
                expanded={expandedSections.connectedPeers}
                onToggle={() => toggleSection('connectedPeers')}
                badge={<span className="text-xs font-semibold text-green-600">{status.connectedPeers.length}</span>}
            >
                {status.connectedPeers.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No active connections</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {status.connectedPeers.map((peerId) => (
                            <div key={peerId} className="bg-green-100 text-green-800 px-3 py-1 rounded text-xs font-semibold">
                                {peerId.slice(0, 12)}...
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            {/* Peer Details */}
            {selectedPeer && (
                <Section
                    title={`Peer Details: ${selectedPeer.displayName}`}
                    expanded={expandedSections.peerDetails}
                    onToggle={() => toggleSection('peerDetails')}
                >
                    <PeerDetails peer={selectedPeer} onClose={() => setSelectedPeer(null)} />
                </Section>
            )}

            {/* Data Transfer Testing */}
            <Section
                title="Data Transfer Testing"
                expanded={expandedSections.testing}
                onToggle={() => toggleSection('testing')}
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
            </Section>

            {/* Debug Logs */}
            <Section
                title="Debug Log"
                expanded={expandedSections.logs}
                onToggle={() => toggleSection('logs')}
                badge={<span className="text-xs text-gray-600">{logs.length}/50</span>}
            >
                <div className="bg-gray-900 text-green-400 rounded p-3 font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
                    {logs.length === 0 ? (
                        <div className="text-gray-500 italic">No logs yet</div>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className="flex gap-2">
                                <span className="text-gray-500">[{log.time}]</span>
                                <span
                                    className={
                                        log.level === 'error'
                                            ? 'text-red-400'
                                            : log.level === 'warn'
                                              ? 'text-yellow-400'
                                              : log.level === 'success'
                                                ? 'text-green-400'
                                                : 'text-blue-400'
                                    }
                                >
                                    [{log.level.toUpperCase()}]
                                </span>
                                <span>{log.message}</span>
                            </div>
                        ))
                    )}
                </div>
            </Section>
        </div>
    );
}

// === SUBCOMPONENTS ===

interface SectionProps {
    title: string;
    expanded?: boolean;
    onToggle?: () => void;
    badge?: React.ReactNode;
    children: React.ReactNode;
}

function Section({ title, expanded = false, onToggle, badge, children }: SectionProps) {
    return (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full px-4 py-3 flex items-center justify-between bg-gray-100 hover:bg-gray-200 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-800 text-sm">{title}</span>
                    {badge}
                </div>
                {onToggle && <span className="text-gray-600">{expanded ? '▼' : '▶'}</span>}
            </button>
            {expanded && <div className="p-4">{children}</div>}
        </div>
    );
}

interface InfoRowProps {
    label: string;
    value: string;
    mono?: boolean;
    copyable?: boolean;
    onCopy?: () => void;
}

function InfoRow({ label, value, mono, copyable, onCopy }: InfoRowProps) {
    return (
        <div className="flex items-start justify-between gap-2">
            <span className="text-gray-600 font-semibold text-xs whitespace-nowrap">{label}:</span>
            <div className="flex-1 flex items-center justify-end gap-2">
                <span className={`text-gray-900 text-xs break-all text-right ${mono ? 'font-mono' : ''}`}>
                    {value}
                </span>
                {copyable && (
                    <button
                        onClick={onCopy}
                        className="px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded text-xs"
                    >
                        Copy
                    </button>
                )}
            </div>
        </div>
    );
}

interface PeerCardProps {
    peer: DetailedPeerInfo;
    isConnected: boolean;
    onConnect: () => void;
    onDisconnect: () => void;
    onSelectDetails: () => void;
}

function PeerCard({ peer, isConnected, onConnect, onDisconnect, onSelectDetails }: PeerCardProps) {
    return (
        <div className="bg-gray-50 border border-gray-200 rounded p-3 space-y-2">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="font-bold text-sm text-gray-800">{peer.displayName}</div>
                    <div className="text-xs text-gray-500 font-mono">{peer.peerId.slice(0, 20)}...</div>
                    <div className="text-xs text-gray-400 mt-1">
                        via {peer.discovered} • {peer.multiaddrs.length} addr(s)
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

interface PeerDetailsProps {
    peer: DetailedPeerInfo;
    onClose: () => void;
}

function PeerDetails({ peer, onClose }: PeerDetailsProps) {
    return (
        <div className="space-y-3">
            <div className="flex justify-between items-center">
                <h3 className="font-bold text-sm">Connection Details</h3>
                <button
                    onClick={onClose}
                    className="px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded text-xs"
                >
                    Close
                </button>
            </div>

            <div className="space-y-2 text-xs">
                <InfoRow label="Peer ID" value={peer.peerId} mono />
                <InfoRow label="Display Name" value={peer.displayName} />
                <InfoRow label="Discovered" value={`${peer.discovered} at ${new Date(peer.discoveredAt).toLocaleTimeString()}`} />
                <InfoRow label="Last Seen" value={new Date(peer.lastSeenAt).toLocaleTimeString()} />

                {peer.connection && (
                    <>
                        <div className="border-t pt-2 mt-2">
                            <span className="font-semibold text-gray-700">Connection Info:</span>
                        </div>
                        <InfoRow label="State" value={peer.connection.state} />
                        <InfoRow label="Direction" value={peer.connection.direction} />
                        <InfoRow label="Transport" value={peer.connection.transport} />
                        <InfoRow label="Streams" value={String(peer.connection.streams)} />
                        {peer.connection.latency && (
                            <InfoRow label="Latency" value={`${peer.connection.latency}ms`} />
                        )}
                    </>
                )}

                {peer.protocols.length > 0 && (
                    <div>
                        <span className="font-semibold text-gray-700">Protocols ({peer.protocols.length}):</span>
                        <div className="mt-1 space-y-1">
                            {peer.protocols.map((protocol: string) => (
                                <div key={protocol} className="bg-purple-50 rounded px-2 py-1 font-mono">
                                    {protocol}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {peer.multiaddrs.length > 0 && (
                    <div>
                        <span className="font-semibold text-gray-700">Multiaddrs ({peer.multiaddrs.length}):</span>
                        <div className="mt-1 space-y-1">
                            {peer.multiaddrs.map((addr: string, i: number) => (
                                <div key={i} className="bg-gray-100 rounded px-2 py-1 font-mono break-all">
                                    {addr}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {peer.metadata && (
                    <>
                        <div className="border-t pt-2 mt-2">
                            <span className="font-semibold text-gray-700">Metadata:</span>
                        </div>
                        {peer.metadata.appVersion && (
                            <InfoRow label="App Version" value={peer.metadata.appVersion} />
                        )}
                        {peer.metadata.protocolVersion && (
                            <InfoRow label="Protocol Version" value={peer.metadata.protocolVersion} />
                        )}
                        {peer.metadata.capabilities && peer.metadata.capabilities.length > 0 && (
                            <div>
                                <span className="font-semibold text-gray-700">Capabilities:</span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {peer.metadata.capabilities.map((cap: string) => (
                                        <span key={cap} className="bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                            {cap}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {peer.stats && (
                    <>
                        <div className="border-t pt-2 mt-2">
                            <span className="font-semibold text-gray-700">Statistics:</span>
                        </div>
                        <InfoRow label="Bytes Sent" value={formatBytes(peer.stats.bytesSent)} />
                        <InfoRow label="Bytes Received" value={formatBytes(peer.stats.bytesReceived)} />
                        <InfoRow label="Messages Sent" value={String(peer.stats.messagesSent)} />
                        <InfoRow label="Messages Received" value={String(peer.stats.messagesReceived)} />
                    </>
                )}
            </div>
        </div>
    );
}

// === UTILITIES ===

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

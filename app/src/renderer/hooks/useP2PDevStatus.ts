/**
 * useP2PDevStatus — polling, event listeners, log buffer, and connection actions
 * for the P2P Development Interface. Extracted from P2PStatus.tsx.
 */

import { useEffect, useState, useCallback } from 'react';
import type { PeerMetadata, P2PStatusPayload } from '../../shared/core';

export interface LogEntry {
    id: number;
    time: string;
    level: string;
    message: string;
}

let logIdCounter = 0;

export function useP2PDevStatus() {
    const [status, setStatus] = useState<P2PStatusPayload>({
        nodeStarted: false,
        peerId: '',
        multiaddrs: [],
        discoveredPeers: [],
        connectedPeers: [],
        protocols: [],
    });

    const [selectedPeer, setSelectedPeer] = useState<PeerMetadata | null>(null);
    const [connectUrl, setConnectUrl] = useState('');
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [expandedSections, setExpandedSections] = useState({
        nodeInfo: true,
        discoveredPeers: true,
        connectedPeers: true,
        logs: true,
        peerDetails: false,
        testing: false,
    });

    const addLog = useCallback((level: 'info' | 'warn' | 'error' | 'success', message: string) => {
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
        const id = ++logIdCounter;
        setLogs((prev) => [...prev.slice(-49), { id, time: timestamp, level, message }]);
        console.log(`[P2P UI ${timestamp}] [${level.toUpperCase()}] ${message}`);
    }, []);

    // Polling & event listeners
    useEffect(() => {
        if (!window.electron?.p2p) {
            addLog('error', 'P2P API not available');
            return;
        }

        addLog('info', 'P2P interface initialized');

        let polling = true;
        const knownPeerIds = new Set<string>();

        const pollStatus = async () => {
            try {
                const newStatus = await window.electron!.p2p.getStatus();

                if (newStatus.nodeStarted && !status.nodeStarted) {
                    addLog('success', `Node started: ${(newStatus.peerId ?? '').slice(0, 20)}...`);
                    addLog('info', `Listening on ${newStatus.multiaddrs?.length || 0} addresses`);
                }

                newStatus.discoveredPeers?.forEach((peer: PeerMetadata) => {
                    if (!knownPeerIds.has(peer.peerId)) {
                        addLog('info', `Peer discovered: ${peer.displayName} (${peer.peerId.slice(0, 12)}...)`);
                        knownPeerIds.add(peer.peerId);
                    }
                });

                setStatus(newStatus);
            } catch (error) {
                addLog('error', `Poll failed: ${error}`);
            }

            if (polling) setTimeout(pollStatus, 1000);
        };

        pollStatus();

        const unsubConnected = window.electron.p2p.onConnectionEstablished((data) => {
            addLog('success', `Connected to ${data.peerId.slice(0, 12)}...`);
        });
        const unsubDisconnected = window.electron.p2p.onConnectionClosed((data) => {
            addLog('warn', `Disconnected from ${data.peerId.slice(0, 12)}...`);
            if (selectedPeer?.peerId === data.peerId) setSelectedPeer(null);
        });
        const unsubFailed = window.electron.p2p.onConnectionFailed((data) => {
            addLog('error', `Connection failed: ${data.error || 'Unknown error'}`);
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

    const openPeerDetails = (peer: PeerMetadata) => {
        setSelectedPeer(peer);
        setExpandedSections((prev) => ({ ...prev, peerDetails: true }));
    };

    const closePeerDetails = () => setSelectedPeer(null);

    return {
        status,
        selectedPeer,
        connectUrl,
        setConnectUrl,
        logs,
        expandedSections,
        handleConnect,
        handleConnectViaUrl,
        handleDisconnect,
        copyToClipboard,
        toggleSection,
        openPeerDetails,
        closePeerDetails,
    };
}

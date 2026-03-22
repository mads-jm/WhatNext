/**
 * P2P Settings — Relay server configuration.
 *
 * Users control which relay infrastructure their sessions route through.
 * WhatNext does not mandate a specific relay; this page lets users:
 *   - See currently configured relay addresses
 *   - Add a new relay by pasting a multiaddr
 *   - Remove a relay
 *   - See the live connection status of each relay
 *
 * The relay server code is available at /relay in the WhatNext repo
 * and can be self-hosted on any VPS with ports 4001/4002 open.
 */

import { useState, useEffect } from 'react';

interface RelayEntry {
    address: string;
    connected: boolean;
}

export function P2PSettings() {
    const [relays, setRelays] = useState<RelayEntry[]>([]);
    const [newAddress, setNewAddress] = useState('');
    const [addError, setAddError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [connectedRelayAddr, setConnectedRelayAddr] = useState<string | null>(null);

    // Load current relay config
    useEffect(() => {
        window.electron?.p2p.getRelays().then(({ addresses }) => {
            setRelays(addresses.map((a) => ({ address: a, connected: false })));
        });
    }, []);

    // Listen for relay status updates
    useEffect(() => {
        const cleanup = window.electron?.p2p.onRelayStatus((status) => {
            setConnectedRelayAddr(status.connected ? status.relayMultiaddr : null);
            setRelays((prev) =>
                prev.map((r) => ({
                    ...r,
                    connected: status.connected && r.address === status.relayMultiaddr,
                }))
            );
        });
        return () => { cleanup?.(); };
    }, []);

    const handleAdd = async () => {
        const trimmed = newAddress.trim();
        if (!trimmed) return;

        // Basic multiaddr format validation
        if (!trimmed.startsWith('/')) {
            setAddError('A relay address must be a multiaddr starting with "/" (e.g. /ip4/1.2.3.4/tcp/4001/p2p/12D3Koo…)');
            return;
        }
        if (!trimmed.includes('/p2p/')) {
            setAddError('Relay address must include a /p2p/<PeerID> component');
            return;
        }

        setAddError(null);
        setAdding(true);
        try {
            const result = await window.electron?.p2p.addRelay(trimmed);
            if (result?.success) {
                setRelays(result.addresses.map((a) => ({
                    address: a,
                    connected: a === connectedRelayAddr,
                })));
                setNewAddress('');
            } else {
                setAddError(result?.error ?? 'Failed to add relay');
            }
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (address: string) => {
        const result = await window.electron?.p2p.removeRelay(address);
        if (result?.success) {
            setRelays(result.addresses.map((a) => ({
                address: a,
                connected: a === connectedRelayAddr,
            })));
        }
    };

    return (
        <div className="p-6 max-w-2xl">
            <h2 className="text-lg font-semibold text-on-surface mb-1">Relay Servers</h2>
            <p className="text-sm text-on-surface-variant mb-6">
                Relay servers enable WhatNext sessions between friends on different networks.
                Your session data routes through the relay you choose — WhatNext does not
                control this. You can{' '}
                <button
                    className="text-primary underline cursor-pointer"
                    onClick={() => window.electron?.shell.openExternal('https://github.com/mads-jm/WhatNext/tree/main/relay')}
                >
                    self-host the relay
                </button>{' '}
                on any VPS with ports 4001 and 4002 open.
            </p>

            {/* Current relay list */}
            <div className="space-y-2 mb-6">
                {relays.length === 0 && (
                    <div className="text-sm text-on-surface-variant py-3 text-center border border-dashed border-outline-variant rounded-lg">
                        No relay servers configured. Add one below to enable remote sessions.
                    </div>
                )}
                {relays.map((relay) => (
                    <div
                        key={relay.address}
                        className="flex items-center gap-3 bg-surface-high rounded-lg px-4 py-3"
                    >
                        {/* Status dot */}
                        <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${relay.connected ? 'bg-primary' : 'bg-outline-variant'}`}
                            title={relay.connected ? 'Connected' : 'Not connected'}
                        />
                        {/* Address */}
                        <span className="text-xs text-on-surface font-mono break-all flex-1">
                            {relay.address}
                        </span>
                        {/* Remove */}
                        <button
                            onClick={() => handleRemove(relay.address)}
                            className="text-on-surface-variant hover:text-error transition-colors text-sm flex-shrink-0"
                            title="Remove relay"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>

            {/* Add new relay */}
            <div className="space-y-2">
                <label htmlFor="p2p-relay-address" className="text-sm text-on-surface font-medium">Add Relay Address</label>
                <div className="flex gap-2">
                    <input
                        id="p2p-relay-address"
                        type="text"
                        value={newAddress}
                        onChange={(e) => {
                            setNewAddress(e.target.value);
                            setAddError(null);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        placeholder="/ip4/1.2.3.4/tcp/4001/p2p/12D3KooW…"
                        className="flex-1 bg-surface-high text-on-surface text-xs font-mono rounded-lg px-3 py-2 border border-outline-variant focus:border-primary focus:outline-none"
                    />
                    <button
                        onClick={handleAdd}
                        disabled={adding || !newAddress.trim()}
                        className="px-4 py-2 bg-primary hover:bg-primary-dim disabled:bg-surface-high disabled:text-on-surface-variant text-surface text-sm rounded-lg transition-colors"
                    >
                        {adding ? 'Adding…' : 'Add'}
                    </button>
                </div>
                {addError && (
                    <p className="text-xs text-error">{addError}</p>
                )}
                <p className="text-xs text-on-surface-variant">
                    Paste the multiaddr shown when you start the relay server (includes /p2p/&lt;PeerID&gt;).
                </p>
            </div>
        </div>
    );
}

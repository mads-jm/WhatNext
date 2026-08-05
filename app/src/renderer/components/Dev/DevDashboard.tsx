/**
 * Developer Dashboard - consolidates all dev/debug views into one page.
 */

import { useState } from 'react';
import { useDebugLogStore } from '../../stores/debug-log-store';
import { P2PDebugLog } from '../P2P/P2PDebugLog';

const PROTOCOLS = [
    {
        name: '/whatnext/handshake/1.0.0',
        label: 'Handshake',
        description: 'Identity verification and session authentication',
        icon: 'fa-solid fa-handshake',
    },
    {
        name: '/whatnext/rxdb-replication/1.0.0',
        label: 'RxDB Replication',
        description: 'Real-time database sync between peers',
        icon: 'fa-solid fa-arrows-rotate',
    },
    {
        name: '/whatnext/playlist-sync/1.0.0',
        label: 'Playlist Sync',
        description: 'Playlist-level change propagation',
        icon: 'fa-solid fa-list-check',
    },
];

export function DevDashboard() {
    const [activeTab, setActiveTab] = useState<'rxdb' | 'protocols' | 'testing' | 'debug'>('rxdb');
    const [resetting, setResetting] = useState(false);
    const [resetStatus, setResetStatus] = useState<string | null>(null);
    const logs = useDebugLogStore((s) => s.logs);

    const handleResetDB = async () => {
        setResetting(true);
        setResetStatus(null);
        try {
            if (window.resetRxDB) {
                await window.resetRxDB();
                setResetStatus('Database reset successfully. Reloading...');
                setTimeout(() => window.location.reload(), 1000);
            } else {
                setResetStatus('resetRxDB not available on window');
            }
        } catch (err) {
            setResetStatus(`Reset failed: ${err}`);
        } finally {
            setResetting(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Dev Quick Actions */}
            <div className="flex items-center gap-3 bg-surface-high/50 rounded-lg p-3">
                <button
                    onClick={handleResetDB}
                    disabled={resetting}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-error/15 text-error hover:bg-error/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <i className={`fa-solid ${resetting ? 'fa-spinner fa-spin' : 'fa-database'}`} />
                    {resetting ? 'Resetting...' : 'Reset Database'}
                </button>
                <span className="text-xs text-on-surface-variant">Clears IndexedDB and reinitializes — use after schema changes</span>
                {resetStatus && (
                    <span className={`text-xs ml-auto ${resetStatus.includes('failed') ? 'text-error' : 'text-primary'}`}>
                        {resetStatus}
                    </span>
                )}
            </div>

            {/* Tab Bar */}
            <div className="flex gap-1 bg-surface-high/50 rounded-lg p-1">
                {[
                    { id: 'rxdb' as const, label: 'Database', icon: 'fa-solid fa-database' },
                    { id: 'protocols' as const, label: 'Protocols', icon: 'fa-solid fa-code' },
                    { id: 'testing' as const, label: 'Testing', icon: 'fa-solid fa-vial' },
                    { id: 'debug' as const, label: 'Debug Console', icon: 'fa-solid fa-terminal' },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            activeTab === tab.id
                                ? 'bg-primary text-surface'
                                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-high/50'
                        }`}
                    >
                        <i className={tab.icon} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'rxdb' && null}

            {activeTab === 'protocols' && (
                <div className="space-y-3">
                    {PROTOCOLS.map((proto) => (
                        <div key={proto.name} className="bg-surface-high rounded-lg p-4 flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-purple-900/40 flex items-center justify-center flex-shrink-0">
                                <i className={`${proto.icon} text-purple-400`} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-medium text-on-surface">{proto.label}</h4>
                                <p className="text-xs text-on-surface-variant mt-0.5">{proto.description}</p>
                                <code className="text-xs text-purple-400 mt-1 block">{proto.name}</code>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {activeTab === 'testing' && (
                <div className="space-y-4">
                    <div className="bg-surface-high rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <i className="fa-solid fa-vial text-orange-400 text-xl mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-on-surface mb-1">Data Transfer Testing</h3>
                                <p className="text-sm text-on-surface-variant mb-3">
                                    Testing utilities for playlist sync and file transfer.
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        disabled
                                        className="px-3 py-2 bg-surface-high text-on-surface-variant rounded text-xs cursor-not-allowed"
                                    >
                                        Send Test Message
                                    </button>
                                    <button
                                        disabled
                                        className="px-3 py-2 bg-surface-high text-on-surface-variant rounded text-xs cursor-not-allowed"
                                    >
                                        Send Test File
                                    </button>
                                </div>
                                <p className="text-xs text-on-surface-variant mt-2 italic">
                                    Connect to a peer via the Network Status panel to enable testing.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'debug' && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-on-surface-variant">{logs.length}/50 entries</span>
                    </div>
                    <P2PDebugLog logs={logs} />
                </div>
            )}
        </div>
    );
}

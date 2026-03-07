/**
 * Developer Dashboard - consolidates all dev/debug views into one page.
 */

import { useState } from 'react';
import { RxDBSpikeTest } from '../../db/spike-test';

export function DevDashboard() {
    const [activeTab, setActiveTab] = useState<'rxdb' | 'protocols' | 'debug'>('rxdb');
    const [resetting, setResetting] = useState(false);
    const [resetStatus, setResetStatus] = useState<string | null>(null);

    const handleResetDB = async () => {
        setResetting(true);
        setResetStatus(null);
        try {
            if ((window as any).resetRxDB) {
                await (window as any).resetRxDB();
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
            <div className="flex items-center gap-3 bg-gray-800/50 rounded-lg p-3">
                <button
                    onClick={handleResetDB}
                    disabled={resetting}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-red-900/50 text-red-300 hover:bg-red-800/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <i className={`fa-solid ${resetting ? 'fa-spinner fa-spin' : 'fa-database'}`} />
                    {resetting ? 'Resetting...' : 'Reset Database'}
                </button>
                <span className="text-xs text-gray-500">Clears IndexedDB and reinitializes — use after schema changes</span>
                {resetStatus && (
                    <span className={`text-xs ml-auto ${resetStatus.includes('failed') ? 'text-red-400' : 'text-green-400'}`}>
                        {resetStatus}
                    </span>
                )}
            </div>

            {/* Tab Bar */}
            <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
                {[
                    { id: 'rxdb' as const, label: 'RxDB Evaluation', icon: 'fa-solid fa-flask' },
                    { id: 'protocols' as const, label: 'Protocols', icon: 'fa-solid fa-code' },
                    { id: 'debug' as const, label: 'Debug Console', icon: 'fa-solid fa-terminal' },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            activeTab === tab.id
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                        }`}
                    >
                        <i className={tab.icon} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'rxdb' && <RxDBSpikeTest />}
            {activeTab === 'protocols' && (
                <div className="space-y-4">
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <i className="fa-solid fa-code text-orange-600 text-xl mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-orange-900 mb-1">Protocol Development Workspace</h3>
                                <p className="text-sm text-orange-700 mb-3">
                                    Testing and development tools for custom libp2p protocols.
                                </p>
                                <div className="text-xs text-orange-600 space-y-1">
                                    <p>Handshake Protocol (/whatnext/handshake/1.0.0)</p>
                                    <p>RxDB Replication (/whatnext/rxdb-replication/1.0.0)</p>
                                    <p>Playlist Sync (/whatnext/playlist-sync/1.0.0)</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {activeTab === 'debug' && (
                <div className="flex items-center justify-center min-h-[400px]">
                    <div className="text-center text-gray-600">
                        <i className="fa-solid fa-terminal text-4xl mb-4" />
                        <h3 className="text-lg font-medium mb-2">Debug Console</h3>
                        <p className="text-sm">Unified logging interface coming soon</p>
                    </div>
                </div>
            )}
        </div>
    );
}

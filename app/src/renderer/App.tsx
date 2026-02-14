import { useState, useEffect } from 'react';
import { Sidebar } from './components/Layout/Sidebar';
import { Toolbar } from './components/Layout/Toolbar';
import { ConnectionStatus } from './components/Connection/ConnectionStatus';
import { PlaylistList } from './components/Playlist/PlaylistList';
import { PlaylistView } from './components/Playlist/PlaylistView';
import { CreatePlaylistDialog } from './components/Playlist/CreatePlaylistDialog';
import { SessionView } from './components/Session/SessionView';
import { SpotifyImport } from './components/Spotify/SpotifyImport';
import { RxDBSpikeTest } from './db/spike-test';
import { P2PStatus } from './components/P2P/P2PStatus';
import { initDatabase } from './db/database';
import { setupReplicationListeners } from './db/replication-handler';

type ViewId =
    | 'playlists'
    | 'library'
    | 'sessions'
    | 'session'
    | 'spotify'
    | 'p2p-status'
    | 'dev-dashboard'
    | 'settings-general'
    | 'settings-p2p'
    | 'settings-storage';

function App() {
    const [activeView, setActiveView] = useState<ViewId>('playlists');
    const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | undefined>();
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [sessionPlaylistId, setSessionPlaylistId] = useState<string | undefined>();

    // Initialize RxDB and replication on startup
    useEffect(() => {
        initDatabase().then(() => console.log('[App] RxDB initialized'));
        const cleanup = setupReplicationListeners();
        return cleanup;
    }, []);

    const renderView = () => {
        switch (activeView) {
            case 'playlists':
                return (
                    <div className="grid grid-cols-5 gap-6">
                        <div className="col-span-2">
                            <PlaylistList
                                onPlaylistSelect={setSelectedPlaylistId}
                                onCreatePlaylist={() => setShowCreateDialog(true)}
                                selectedPlaylistId={selectedPlaylistId}
                            />
                        </div>
                        <div className="col-span-3">
                            <PlaylistView
                                playlistId={selectedPlaylistId}
                                onOpenSession={(id) => {
                                    setSessionPlaylistId(id);
                                    setActiveView('session');
                                }}
                            />
                        </div>
                    </div>
                );

            case 'library':
                return (
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center text-gray-600">
                            <i className="fa-solid fa-music text-4xl mb-4" />
                            <h3 className="text-lg font-medium mb-2">Library View</h3>
                            <p className="text-sm">Local music library management coming soon</p>
                        </div>
                    </div>
                );

            case 'sessions':
            case 'session':
                return (
                    <SessionView
                        playlistId={sessionPlaylistId}
                        onBack={() => setActiveView('playlists')}
                    />
                );

            case 'spotify':
                return <SpotifyImport />;

            case 'p2p-status':
                return <P2PStatus />;

            case 'dev-dashboard':
                return <DevDashboard />;

            case 'settings-general':
            case 'settings-p2p':
            case 'settings-storage': {
                const settingsTitle: Record<string, string> = {
                    'settings-general': 'General Settings',
                    'settings-p2p': 'P2P Configuration',
                    'settings-storage': 'Storage Settings',
                };
                return (
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center text-gray-600">
                            <i className="fa-solid fa-gear text-4xl mb-4" />
                            <h3 className="text-lg font-medium mb-2">{settingsTitle[activeView]}</h3>
                            <p className="text-sm">Configuration options coming soon</p>
                        </div>
                    </div>
                );
            }

            default:
                return null;
        }
    };

    const viewTitles: Record<ViewId, string> = {
        playlists: 'My Playlists',
        library: 'Music Library',
        sessions: 'Collaborative Sessions',
        session: 'Active Session',
        spotify: 'Spotify Import',
        'p2p-status': 'P2P Network Status',
        'dev-dashboard': 'Developer Dashboard',
        'settings-general': 'General Settings',
        'settings-p2p': 'P2P Configuration',
        'settings-storage': 'Storage Settings',
    };

    return (
        <div className="flex h-screen overflow-hidden">
            <Sidebar
                activeView={activeView}
                onNavigate={(view) => setActiveView(view as ViewId)}
            />

            <div className="flex-1 flex flex-col overflow-hidden">
                <Toolbar
                    title={viewTitles[activeView]}
                    actions={<ConnectionStatus />}
                />

                <main className="flex-1 overflow-y-auto p-6">
                    {renderView()}
                </main>
            </div>

            {/* Modals */}
            <CreatePlaylistDialog
                open={showCreateDialog}
                onClose={() => setShowCreateDialog(false)}
                onCreated={(id) => setSelectedPlaylistId(id)}
            />
        </div>
    );
}

/**
 * Developer Dashboard - consolidates all dev/debug views into one page.
 */
function DevDashboard() {
    const [activeTab, setActiveTab] = useState<'rxdb' | 'protocols' | 'debug'>('rxdb');

    return (
        <div className="space-y-4">
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

export default App;

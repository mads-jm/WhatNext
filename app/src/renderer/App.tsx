import { useState } from 'react';
import { Sidebar } from './components/Layout/Sidebar';
import { Toolbar } from './components/Layout/Toolbar';
import { ConnectionStatus } from './components/Connection/ConnectionStatus';
import { PlaylistList } from './components/Playlist/PlaylistList';
import { PlaylistView } from './components/Playlist/PlaylistView';
import { RxDBSpikeTest } from './db/spike-test';
import { P2PStatus } from './components/P2P/P2PStatus';

type ViewId =
    | 'playlists'
    | 'library'
    | 'sessions'
    | 'p2p-status'
    | 'p2p-peers'
    | 'p2p-protocols'
    | 'rxdb-spike'
    | 'protocol-testing'
    | 'debug-console'
    | 'settings-general'
    | 'settings-p2p'
    | 'settings-storage';

function App() {
    const [activeView, setActiveView] = useState<ViewId>('playlists');
    const [selectedPlaylistId, setSelectedPlaylistId] = useState<
        string | undefined
    >();

    const renderView = () => {
        switch (activeView) {
            case 'playlists':
                return (
                    <div className="grid grid-cols-5 gap-6">
                        {/* Playlist List */}
                        <div className="col-span-2">
                            <PlaylistList
                                onPlaylistSelect={setSelectedPlaylistId}
                            />
                        </div>

                        {/* Playlist Detail */}
                        <div className="col-span-3">
                            <PlaylistView playlistId={selectedPlaylistId} />
                        </div>
                    </div>
                );

            case 'library':
                return (
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center text-gray-600">
                            <i className="fa-solid fa-music text-4xl mb-4" />
                            <h3 className="text-lg font-medium mb-2">
                                Library View
                            </h3>
                            <p className="text-sm">
                                Local music library management coming soon
                            </p>
                        </div>
                    </div>
                );

            case 'sessions':
                return (
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center text-gray-600">
                            <i className="fa-solid fa-users text-4xl mb-4" />
                            <h3 className="text-lg font-medium mb-2">
                                Collaborative Sessions
                            </h3>
                            <p className="text-sm">
                                P2P session management coming soon
                            </p>
                        </div>
                    </div>
                );

            case 'rxdb-spike':
                return <RxDBSpikeTest />;

            case 'p2p-status':
                return <P2PStatus />;

            case 'p2p-peers':
                return (
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center text-gray-600">
                            <i className="fa-solid fa-users-gear text-4xl mb-4" />
                            <h3 className="text-lg font-medium mb-2">
                                Peer Management
                            </h3>
                            <p className="text-sm mb-4">
                                Advanced peer management and friend lists
                            </p>
                            <div className="text-xs text-gray-500 space-y-1">
                                <p>• Save peers as friends</p>
                                <p>• Peer reputation tracking</p>
                                <p>• Connection history</p>
                            </div>
                        </div>
                    </div>
                );

            case 'p2p-protocols':
                return (
                    <div className="space-y-4">
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <i className="fa-solid fa-code text-orange-600 text-xl mt-0.5" />
                                <div>
                                    <h3 className="font-semibold text-orange-900 mb-1">
                                        Protocol Development Workspace
                                    </h3>
                                    <p className="text-sm text-orange-700 mb-3">
                                        This section will house protocol testing and development tools
                                        for building custom libp2p protocols.
                                    </p>
                                    <div className="text-xs text-orange-600 space-y-1">
                                        <p>📋 <strong>Planned:</strong> Handshake Protocol (/whatnext/handshake/1.0.0)</p>
                                        <p>📋 <strong>Planned:</strong> Data Test Protocol (/whatnext/data-test/1.0.0)</p>
                                        <p>📋 <strong>Planned:</strong> File Transfer (/whatnext/file-transfer/1.0.0)</p>
                                        <p>📋 <strong>Planned:</strong> Playlist Sync (/whatnext/playlist-sync/1.0.0)</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white rounded-lg border border-gray-200 p-4">
                                <h4 className="font-semibold text-gray-900 mb-2">Protocol Handler Registry</h4>
                                <p className="text-xs text-gray-600 mb-3">View and manage registered protocols</p>
                                <div className="text-xs text-gray-500 italic">Coming soon...</div>
                            </div>

                            <div className="bg-white rounded-lg border border-gray-200 p-4">
                                <h4 className="font-semibold text-gray-900 mb-2">Stream Inspector</h4>
                                <p className="text-xs text-gray-600 mb-3">Monitor active protocol streams</p>
                                <div className="text-xs text-gray-500 italic">Coming soon...</div>
                            </div>

                            <div className="bg-white rounded-lg border border-gray-200 p-4">
                                <h4 className="font-semibold text-gray-900 mb-2">Message Logger</h4>
                                <p className="text-xs text-gray-600 mb-3">Capture and analyze protocol messages</p>
                                <div className="text-xs text-gray-500 italic">Coming soon...</div>
                            </div>

                            <div className="bg-white rounded-lg border border-gray-200 p-4">
                                <h4 className="font-semibold text-gray-900 mb-2">Protocol Tester</h4>
                                <p className="text-xs text-gray-600 mb-3">Send test messages to peers</p>
                                <div className="text-xs text-gray-500 italic">Coming soon...</div>
                            </div>
                        </div>
                    </div>
                );

            case 'protocol-testing':
                return (
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center text-gray-600">
                            <i className="fa-solid fa-vial text-4xl mb-4" />
                            <h3 className="text-lg font-medium mb-2">
                                Protocol Testing Suite
                            </h3>
                            <p className="text-sm mb-4">
                                Automated testing for P2P protocols
                            </p>
                            <div className="text-xs text-gray-500 space-y-1">
                                <p>• Protocol integration tests</p>
                                <p>• Performance benchmarking</p>
                                <p>• Error scenario simulation</p>
                            </div>
                        </div>
                    </div>
                );

            case 'debug-console':
                return (
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center text-gray-600">
                            <i className="fa-solid fa-terminal text-4xl mb-4" />
                            <h3 className="text-lg font-medium mb-2">
                                Debug Console
                            </h3>
                            <p className="text-sm mb-4">
                                Unified logging and debugging interface
                            </p>
                            <div className="text-xs text-gray-500 space-y-1">
                                <p>• Main process logs</p>
                                <p>• Renderer logs</p>
                                <p>• P2P utility process logs</p>
                            </div>
                        </div>
                    </div>
                );

            case 'settings-general':
            case 'settings-p2p':
            case 'settings-storage':
                const settingsTitle = {
                    'settings-general': 'General Settings',
                    'settings-p2p': 'P2P Configuration',
                    'settings-storage': 'Storage Settings',
                }[activeView];

                return (
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center text-gray-600">
                            <i className="fa-solid fa-gear text-4xl mb-4" />
                            <h3 className="text-lg font-medium mb-2">
                                {settingsTitle}
                            </h3>
                            <p className="text-sm">
                                Configuration options coming soon
                            </p>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    const viewTitles: Record<ViewId, string> = {
        playlists: 'My Playlists',
        library: 'Music Library',
        sessions: 'Collaborative Sessions',
        'p2p-status': 'P2P Network Status',
        'p2p-peers': 'Peer Management',
        'p2p-protocols': 'Protocol Development',
        'rxdb-spike': 'RxDB Evaluation (Issue #4)',
        'protocol-testing': 'Protocol Testing',
        'debug-console': 'Debug Console',
        'settings-general': 'General Settings',
        'settings-p2p': 'P2P Configuration',
        'settings-storage': 'Storage Settings',
    };

    return (
        <div className="flex h-screen overflow-hidden">
            {/* Sidebar Navigation */}
            <Sidebar
                activeView={activeView}
                onNavigate={(view) => setActiveView(view as ViewId)}
            />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Toolbar */}
                <Toolbar
                    title={viewTitles[activeView]}
                    actions={<ConnectionStatus />}
                />

                {/* Content */}
                <main className="flex-1 overflow-y-auto p-6">
                    {renderView()}
                </main>
            </div>
        </div>
    );
}

export default App;

import { useState } from 'react';
import { Sidebar } from './components/Layout/Sidebar';
import { Toolbar } from './components/Layout/Toolbar';
import { ConnectionStatus } from './components/Connection/ConnectionStatus';
import { PlaylistList } from './components/Playlist/PlaylistList';
import { PlaylistView } from './components/Playlist/PlaylistView';
import { RxDBSpikeTest } from './db/spike-test';

type ViewId = 'playlists' | 'library' | 'sessions' | 'settings' | 'spike';

function App() {
    const [activeView, setActiveView] = useState<ViewId>('playlists');
    const [selectedPlaylistId, setSelectedPlaylistId] = useState<
        string | undefined
    >();

    const renderView = () => {
        switch (activeView) {
            case 'playlists':
                return (
                    <div className="grid grid-cols-5 gap-6 h-full">
                        {/* Playlist List */}
                        <div className="col-span-2 overflow-y-auto">
                            <PlaylistList
                                onPlaylistSelect={setSelectedPlaylistId}
                            />
                        </div>

                        {/* Playlist Detail */}
                        <div className="col-span-3 overflow-y-auto">
                            <PlaylistView playlistId={selectedPlaylistId} />
                        </div>
                    </div>
                );

            case 'library':
                return (
                    <div className="flex items-center justify-center h-full">
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
                    <div className="flex items-center justify-center h-full">
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

            case 'spike':
                return <RxDBSpikeTest />;

            case 'settings':
                return (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center text-gray-600">
                            <i className="fa-solid fa-gear text-4xl mb-4" />
                            <h3 className="text-lg font-medium mb-2">
                                Settings
                            </h3>
                            <p className="text-sm">
                                Application configuration coming soon
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
        spike: 'RxDB Evaluation (Issue #4)',
        settings: 'Settings',
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
                <main className="flex-1 overflow-hidden p-6">
                    {renderView()}
                </main>
            </div>
        </div>
    );
}

export default App;

import { useEffect } from 'react';
import { Sidebar } from './components/Layout/Sidebar';
import { Toolbar } from './components/Layout/Toolbar';
import { ViewRouter } from './components/Layout/ViewRouter';
import { ConnectionStatus } from './components/Connection/ConnectionStatus';
import { CreatePlaylistDialog } from './components/Playlist/CreatePlaylistDialog';
import { WelcomeModal } from './components/Onboarding/WelcomeModal';
import { PlaybackBar } from './components/Session/PlaybackBar';
import { useDatabaseStore } from './stores/database-store';
import { useUserStore } from './stores/user-store';
import { useNavigationStore, VIEW_TITLES } from './stores/navigation-store';
import { useSessionState } from './hooks/useSessionState';
import { setupReplicationListeners } from './db/replication-handler';

function App() {
    const activeView = useNavigationStore((s) => s.activeView);
    const sessionPlaylistId = useNavigationStore((s) => s.sessionPlaylistId);
    const userId = useUserStore((s) => s.userId);

    const { sessionState } = useSessionState(sessionPlaylistId ?? '');

    const isSpotifyPlayback = sessionState?.playbackProvider?.type === 'spotify';
    const isPlaybackOwner = !sessionState || sessionState.playbackOwnerId === userId;

    // Initialize database, user identity, and replication on startup
    useEffect(() => {
        useDatabaseStore
            .getState()
            .initialize()
            .then(() => useUserStore.getState().initialize())
            .then(() => console.log('[App] RxDB + User initialized'));
        const cleanup = setupReplicationListeners();
        return cleanup;
    }, []);

    return (
        <div className="flex h-screen overflow-hidden bg-surface">
            <Sidebar />

            <div className="flex-1 flex flex-col overflow-hidden">
                <Toolbar
                    title={VIEW_TITLES[activeView]}
                    actions={<ConnectionStatus />}
                />

                <main className="flex-1 overflow-y-auto p-6">
                    <ViewRouter />
                </main>

                {/* Shell-level PlaybackBar — persists across views */}
                {sessionPlaylistId && isSpotifyPlayback && (
                    <div className="shrink-0 backdrop-blur-xl bg-surface/80 border-t border-outline-variant/10">
                        <PlaybackBar enabled={isPlaybackOwner} />
                    </div>
                )}
            </div>

            <CreatePlaylistDialog />
            <WelcomeModal />
        </div>
    );
}

export default App;

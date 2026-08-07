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
import { useThemeStore } from './stores/theme-store';
import { useNavigationStore, VIEW_TITLES } from './stores/navigation-store';
import { useSessionState } from './hooks/useSessionState';
import { hasLocalPlaybackSurface } from './utils/playback-helpers';
import { setupReplicationListeners } from './db/replication-handler';

function App() {
    const activeView = useNavigationStore((s) => s.activeView);
    const sessionPlaylistId = useNavigationStore((s) => s.sessionPlaylistId);

    const { sessionState } = useSessionState(sessionPlaylistId ?? '');

    // Playback is a property of this device's session config, never of who
    // "owns" playback across peers — there is no such thing in Phase 1.
    const showPlaybackBar = hasLocalPlaybackSurface(sessionState);

    // Initialize theme (sync), then database + user identity
    useEffect(() => {
        useThemeStore.getState().initialize();

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
                {showPlaybackBar && (
                    <div className="shrink-0 backdrop-blur-xl bg-surface/80 border-t border-outline-variant/10">
                        <PlaybackBar />
                    </div>
                )}
            </div>

            <CreatePlaylistDialog />
            <WelcomeModal />
        </div>
    );
}

export default App;

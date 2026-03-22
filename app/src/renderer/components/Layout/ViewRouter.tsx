/**
 * ViewRouter — renders the active view based on navigation store state.
 * Extracted from App.tsx renderView() switch.
 */

import { useNavigationStore } from '../../stores/navigation-store';
import { PlaylistList } from '../Playlist/PlaylistList';
import { PlaylistView } from '../Playlist/PlaylistView';
import { LibraryView } from '../Library/LibraryView';
import { SessionView } from '../Session/SessionView';
import { SpotifyImport } from '../Spotify/SpotifyImport';
import { P2PStatus } from '../P2P/P2PStatus';
import { P2PSettings } from '../Settings/P2PSettings';
import { DevDashboard } from '../Dev/DevDashboard';
import { ProfileSettings } from '../Settings/ProfileSettings';
import { StorageSettings } from '../Settings/StorageSettings';
import { ThemeSettings } from '../Settings/ThemeSettings';

export function ViewRouter() {
    const activeView = useNavigationStore((s) => s.activeView);
    const selectedPlaylistId = useNavigationStore((s) => s.selectedPlaylistId);
    const sessionPlaylistId = useNavigationStore((s) => s.sessionPlaylistId);

    switch (activeView) {
        case 'playlists':
            return (
                <div className="grid grid-cols-5 gap-6">
                    <div className="col-span-2">
                        <PlaylistList />
                    </div>
                    <div className="col-span-3">
                        <PlaylistView playlistId={selectedPlaylistId} />
                    </div>
                </div>
            );

        case 'library':
            return <LibraryView />;

        case 'sessions':
        case 'session':
            return <SessionView playlistId={sessionPlaylistId} />;

        case 'spotify':
            return <SpotifyImport />;

        case 'p2p-status':
            return <P2PStatus />;

        case 'dev-dashboard':
            return <DevDashboard />;

        case 'settings-general':
            return <ProfileSettings />;

        case 'p2p-config':
            return <P2PSettings />;

        case 'settings-storage':
            return <StorageSettings />;

        case 'settings-appearance':
            return <ThemeSettings />;

        default:
            return null;
    }
}

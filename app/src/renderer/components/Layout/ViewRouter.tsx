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
import { DevDashboard } from '../Dev/DevDashboard';
import { ProfileSettings } from '../Settings/ProfileSettings';

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

        case 'settings-p2p':
        case 'settings-storage': {
            const settingsTitle: Record<string, string> = {
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
}

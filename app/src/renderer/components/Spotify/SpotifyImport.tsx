/**
 * SpotifyImport — thin orchestrator that routes to the correct sub-component
 * based on the current import state machine step.
 */

import { useNavigationStore } from '../../stores/navigation-store';
import { useSpotifyImport } from '../../hooks/useSpotifyImport';
import { SpotifyAuthGate } from './SpotifyAuthGate';
import { SpotifyPlaylistBrowser } from './SpotifyPlaylistBrowser';
import { SpotifyTrackSelector } from './SpotifyTrackSelector';
import { SpotifyImportComplete } from './SpotifyImportComplete';
import { SpotifyErrorState } from './SpotifyErrorState';

export function SpotifyImport() {
    const { selectPlaylist: navSelectPlaylist, navigate } = useNavigationStore();
    const sp = useSpotifyImport();

    // Auth gate (not authenticated, or connecting)
    if (!sp.authenticated || sp.state === 'connecting') {
        return (
            <SpotifyAuthGate
                connecting={sp.state === 'connecting'}
                error={sp.error}
                onConnect={sp.startAuth}
                onCancel={sp.resetAll}
            />
        );
    }

    // Loading playlists
    if (sp.state === 'loading-playlists') {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Loading your playlists...</p>
                </div>
            </div>
        );
    }

    // Import complete
    if (sp.state === 'done') {
        return (
            <SpotifyImportComplete
                importCount={sp.importCount}
                selectedPlaylist={sp.selectedPlaylist}
                createdPlaylistId={sp.createdPlaylistId}
                onImportMore={sp.goBackToPlaylists}
                onGoToPlaylist={(id) => {
                    navSelectPlaylist(id);
                    navigate('playlists');
                }}
                onDone={sp.resetAll}
            />
        );
    }

    // Error
    if (sp.state === 'error') {
        return <SpotifyErrorState error={sp.error} onRetry={sp.resetAll} />;
    }

    // Track selection (loading-tracks | selecting | importing)
    if (sp.selectedPlaylist) {
        return (
            <SpotifyTrackSelector
                playlist={sp.selectedPlaylist}
                tracks={sp.tracks}
                selectedTrackIds={sp.selectedTrackIds}
                loading={sp.state === 'loading-tracks'}
                importing={sp.state === 'importing'}
                onToggleTrack={sp.toggleTrack}
                onSelectAll={sp.selectAll}
                onSelectNone={sp.selectNone}
                onImport={sp.importSelected}
                onBack={sp.goBackToPlaylists}
            />
        );
    }

    // Playlist browser (default: browsing state)
    return (
        <SpotifyPlaylistBrowser
            playlists={sp.playlists}
            browsing={sp.state === 'browsing'}
            onRefresh={sp.loadPlaylists}
            onSelect={sp.loadTracks}
        />
    );
}

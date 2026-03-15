/**
 * Zustand Navigation Store
 * Manages app-level view state: active view, selected playlist, session, dialogs.
 * Replaces prop drilling from App.tsx → child components.
 */

import { create } from 'zustand';
import type { SessionState, StartSessionConfig } from '../../shared/session-interfaces';

export type ViewId =
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

export const VIEW_TITLES: Record<ViewId, string> = {
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

interface NavigationStore {
    activeView: ViewId;
    selectedPlaylistId: string | undefined;
    sessionPlaylistId: string | undefined;
    sessionState: SessionState | null;
    showCreateDialog: boolean;

    navigate: (view: ViewId) => void;
    selectPlaylist: (id: string | undefined) => void;
    openSession: (playlistId: string) => void;
    startSession: (config: StartSessionConfig) => void;
    endSession: () => void;
    openCreateDialog: () => void;
    closeCreateDialog: () => void;
    handOffPlayback: (toUserId: string) => void;
    takePlayback: (userId: string) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
    activeView: 'playlists',
    selectedPlaylistId: undefined,
    sessionPlaylistId: undefined,
    sessionState: null,
    showCreateDialog: false,

    navigate: (view) => set({ activeView: view }),
    selectPlaylist: (id) => set({ selectedPlaylistId: id }),
    openSession: (playlistId) => set({ sessionPlaylistId: playlistId, activeView: 'session' }),
    startSession: (config) => set({
        sessionPlaylistId: config.playlistId,
        activeView: 'session',
        sessionState: {
            status: 'active',
            playlistId: config.playlistId,
            trackSource: config.trackSource,
            playbackProvider: config.playbackProvider,
            participantIds: config.participantIds,
            hostId: config.hostId,
            coHostIds: config.coHostIds ?? [],
            playbackOwnerId: config.hostId, // Host owns playback initially
            startedAt: new Date().toISOString(),
        },
    }),
    endSession: () => set((state) => ({
        sessionState: state.sessionState
            ? { ...state.sessionState, status: 'ended' }
            : null,
    })),
    openCreateDialog: () => set({ showCreateDialog: true }),
    closeCreateDialog: () => set({ showCreateDialog: false }),
    handOffPlayback: (toUserId) => set((state) => ({
        sessionState: state.sessionState
            ? { ...state.sessionState, playbackOwnerId: toUserId }
            : null,
    })),
    takePlayback: (userId) => set((state) => ({
        sessionState: state.sessionState
            ? { ...state.sessionState, playbackOwnerId: userId }
            : null,
    })),
}));

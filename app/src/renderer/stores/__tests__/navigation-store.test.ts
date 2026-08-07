/**
 * Navigation store — session state shape ([[epic-session-liveness-fixes]] §WB5).
 *
 * A tripwire, not a behaviour test. `sessionState` is seeded independently on
 * every peer and never crosses the wire, so any field whose meaning requires
 * peers to *agree* (playback owner, co-host set) is a claim the app cannot back.
 * The exact-key assertion below fails the moment such a field is reintroduced,
 * which is the failure mode this cycle removed: two peers both rendering
 * "you own playback" because each seeded itself as owner.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useNavigationStore } from '../navigation-store';
import type { StartSessionConfig } from '../../../shared/session-interfaces';

const CONFIG: StartSessionConfig = {
    playlistId: 'playlist-1',
    trackSource: { type: 'manual' },
    playbackProvider: { type: 'spotify' },
    participantIds: ['user-host', 'user-guest'],
    hostId: 'user-host',
};

/** Every field a session may carry while no session-message channel exists. */
const ALLOWED_SESSION_FIELDS = [
    'status',
    'playlistId',
    'trackSource',
    'playbackProvider',
    'participantIds',
    'hostId',
    'startedAt',
].sort();

beforeEach(() => {
    useNavigationStore.setState({
        activeView: 'playlists',
        selectedPlaylistId: undefined,
        sessionPlaylistId: undefined,
        sessionState: null,
        showCreateDialog: false,
    });
});

describe('startSession', () => {
    it('seeds only device-local session fields — no cross-peer ownership state', () => {
        useNavigationStore.getState().startSession(CONFIG);

        const state = useNavigationStore.getState().sessionState;
        expect(state).not.toBeNull();
        expect(Object.keys(state!).sort()).toEqual(ALLOWED_SESSION_FIELDS);
    });

    it('opens the session view for the configured playlist', () => {
        useNavigationStore.getState().startSession(CONFIG);

        const store = useNavigationStore.getState();
        expect(store.activeView).toBe('session');
        expect(store.sessionPlaylistId).toBe('playlist-1');
        expect(store.sessionState?.status).toBe('active');
    });
});

describe('playback ownership actions', () => {
    it('are absent from the store', () => {
        // Deleted, not disabled. Reintroducing either action means a peer can
        // mutate an "owner" that no other peer will ever hear about.
        const store: object = useNavigationStore.getState();
        expect('takePlayback' in store).toBe(false);
        expect('handOffPlayback' in store).toBe(false);
    });
});

describe('endSession', () => {
    it('marks an active session ended without inventing state', () => {
        useNavigationStore.getState().startSession(CONFIG);
        useNavigationStore.getState().endSession();

        const state = useNavigationStore.getState().sessionState;
        expect(state?.status).toBe('ended');
        expect(Object.keys(state!).sort()).toEqual(ALLOWED_SESSION_FIELDS);
    });

    it('is a no-op when no session is active', () => {
        useNavigationStore.getState().endSession();
        expect(useNavigationStore.getState().sessionState).toBeNull();
    });
});

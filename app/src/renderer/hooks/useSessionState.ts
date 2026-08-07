/**
 * useSessionState
 * Reads the active session state for a given playlist from the navigation store.
 */

import { useNavigationStore } from '../stores/navigation-store';
import type { SessionState } from '../../shared/session-interfaces';

interface UseSessionStateResult {
    sessionState: SessionState | null;
    isActiveSession: boolean;
}

export function useSessionState(playlistId: string): UseSessionStateResult {
    const sessionState = useNavigationStore((s) => s.sessionState);

    const isActiveSession =
        sessionState?.status === 'active' &&
        sessionState.playlistId === playlistId;

    return {
        sessionState: isActiveSession ? sessionState : null,
        isActiveSession,
    };
}

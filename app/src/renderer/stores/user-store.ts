/**
 * Zustand User Store
 * Provides the current local user identity to all components.
 * Replaces all hardcoded 'local-user' references.
 *
 * First Zustand store in the codebase — establishes the stores/ directory convention.
 */

import { create } from 'zustand';
import type { UserDocType } from '../db/schemas';
import { getOrCreateLocalUser } from '../db/services/user-service';
import type { Subscription } from 'rxjs';

interface UserStore {
    user: UserDocType | null;
    userId: string; // Convenience: user.id or '' while loading
    loading: boolean;
    isFirstRun: boolean; // True when displayName === 'New User' (triggers onboarding)
    initialize: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

let rxSubscription: Subscription | null = null;

/**
 * Sync user identity to the P2P utility process via IPC.
 * Called after init and whenever the user profile changes.
 */
// TODO : Asset Transfer on consent / handshake
//      : avatar image transfer and caching in P2P process
//      : Consider sharing selected #1 track via P2P bundled with profile picture
function syncIdentityToP2P(user: UserDocType): void{
    window.electron?.user?.setIdentity({
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        userId: user.id,
    }).catch((err) => console.warn('[UserStore] Failed to sync identity to P2P:', err));
}

export const useUserStore = create<UserStore>((set, get) => ({
    user: null,
    userId: '',
    loading: true,
    isFirstRun: false,

    initialize: async () => {
        // Prevent double-init
        if (get().user) return;

        const localUser = await getOrCreateLocalUser();
        const userData = localUser.toJSON() as UserDocType;

        set({
            user: userData,
            userId: userData.id,
            loading: false,
            isFirstRun: userData.displayName === 'New User',
        });

        // Sync identity to P2P utility process
        syncIdentityToP2P(userData);

        // Subscribe to reactive RxDB updates on this document
        rxSubscription?.unsubscribe();
        rxSubscription = localUser.$.subscribe((updated) => {
            const data = updated as unknown as UserDocType;
            set({
                user: data,
                userId: data.id,
                isFirstRun: data.displayName === 'New User',
            });
            syncIdentityToP2P(data);
        });
    },

    refreshUser: async () => {
        const localUser = await getOrCreateLocalUser();
        const userData = localUser.toJSON() as UserDocType;

        set({
            user: userData,
            userId: userData.id,
            loading: false,
            isFirstRun: userData.displayName === 'New User',
        });

        // Sync identity to P2P utility process
        syncIdentityToP2P(userData);

        // Re-subscribe to reactive updates
        rxSubscription?.unsubscribe();
        rxSubscription = localUser.$.subscribe((updated) => {
            const data = updated as unknown as UserDocType;
            set({
                user: data,
                userId: data.id,
                isFirstRun: data.displayName === 'New User',
            });
            syncIdentityToP2P(data);
        });
    },
}));

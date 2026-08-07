/**
 * Zustand Database Store
 * Wraps the RxDB singleton so components can access the database
 * without repeating the useState/useEffect init pattern.
 */

import { create } from 'zustand';
import { initDatabase } from '../db/database';
import type { WhatNextDatabase } from '../db/schemas';

interface DatabaseStore {
    db: WhatNextDatabase | null;
    loading: boolean;
    error: Error | null;
    initialize: () => Promise<void>;
}

export const useDatabaseStore = create<DatabaseStore>((set, get) => ({
    db: null,
    loading: true,
    error: null,

    initialize: async () => {
        if (get().db) return;
        try {
            const db = await initDatabase();
            set({ db, loading: false });
        } catch (error) {
            set({ error: error as Error, loading: false });
        }
    },
}));

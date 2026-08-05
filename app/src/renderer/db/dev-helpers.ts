/**
 * Development-only database utilities.
 * Exposes window.resetRxDB and window.nukeRxDB for console use.
 * Imported as a side-effect from database.ts in dev mode.
 */

import { resetDatabase } from './database';

// Declared, not cast: these are console-only dev affordances, but they are
// still part of the window contract. Optional because they are only assigned
// outside production builds. Mirrors the `window.electron` augmentation in
// src/main/preload.ts.
declare global {
    interface Window {
        resetRxDB?: () => Promise<void>;
        nukeRxDB?: () => Promise<void>;
    }
}

if (process.env.NODE_ENV !== 'production') {
    window.resetRxDB = async () => {
        console.log('[Dev] Resetting RxDB database...');
        try {
            await resetDatabase();
        } catch (err) {
            console.warn('[Dev] Failed to reset via API, clearing IndexedDB directly...', err);
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
                if (db.name?.startsWith('whatnext_db') || db.name?.includes('rxdb')) {
                    console.log(`[Dev] Deleting database: ${db.name}`);
                    indexedDB.deleteDatabase(db.name);
                }
            }
        }
        console.log('[Dev] Database reset complete. Reloading page...');
        window.location.reload();
    };

    window.nukeRxDB = async () => {
        console.log('[Dev] Nuking all RxDB databases from IndexedDB...');
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
            if (db.name?.startsWith('whatnext_db') || db.name?.includes('rxdb')) {
                console.log(`[Dev] Deleting database: ${db.name}`);
                indexedDB.deleteDatabase(db.name);
            }
        }
        console.log('[Dev] All RxDB databases deleted. Reloading page...');
        window.location.reload();
    };
}

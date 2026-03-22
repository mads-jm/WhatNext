/**
 * Development-only database utilities.
 * Exposes window.resetRxDB and window.nukeRxDB for console use.
 * Imported as a side-effect from database.ts in dev mode.
 */

import { resetDatabase } from './database';

if (process.env.NODE_ENV !== 'production') {
    (window as any).resetRxDB = async () => {
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

    (window as any).nukeRxDB = async () => {
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

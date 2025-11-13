/**
 * RxDB Database Initialization
 * Creates and configures the local-first database for WhatNext
 */

import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import type { WhatNextDatabase, WhatNextCollections } from './schemas';
import {
    userSchema,
    trackSchema,
    trackInteractionSchema,
    playlistSchema,
} from './schemas';

// Add query builder plugin (required for .find(), .findOne(), etc.)
addRxPlugin(RxDBQueryBuilderPlugin);

let dbPromise: Promise<WhatNextDatabase> | null = null;
let devModeLoaded = false;

/**
 * Load dev-mode plugin for better error messages in development
 */
async function loadDevMode(): Promise<void> {
    if (devModeLoaded) return;

    if (process.env.NODE_ENV !== 'production') {
        const { RxDBDevModePlugin } = await import('rxdb/plugins/dev-mode');
        addRxPlugin(RxDBDevModePlugin);
        devModeLoaded = true;
        console.log('[RxDB] Dev-mode plugin loaded');
    }
}

/**
 * Get storage with validation in dev-mode
 */
function getStorage() {
    const baseStorage = getRxStorageDexie();

    // Wrap with schema validation in development
    if (process.env.NODE_ENV !== 'production') {
        return wrappedValidateAjvStorage({ storage: baseStorage });
    }

    return baseStorage;
}

/**
 * Initialize the RxDB database
 * Uses Dexie (IndexedDB wrapper) as storage engine
 * Singleton pattern - only creates database once
 */
export async function initDatabase(): Promise<WhatNextDatabase> {
    // Return existing database if already initialized
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = (async () => {
        // Load dev-mode plugin first
        await loadDevMode();

        console.log('[RxDB] Initializing database...');

        // Create database with Dexie storage (IndexedDB)
        // In dev: wrapped with schema validation
        const db = await createRxDatabase<WhatNextCollections>({
            name: 'whatnext_db',
            storage: getStorage(),
            multiInstance: false, // Single instance per browser
            ignoreDuplicate: true,
        });

        console.log('[RxDB] Database created, adding collections...');

        // Add collections for P2P collaborative features
        await db.addCollections({
            users: {
                schema: userSchema,
            },
            tracks: {
                schema: trackSchema,
            },
            trackInteractions: {
                schema: trackInteractionSchema,
            },
            playlists: {
                schema: playlistSchema,
            },
        });

        console.log('[RxDB] Collections added successfully');

        // Development: Log database stats
        const userCount = await db.users.count().exec();
        const trackCount = await db.tracks.count().exec();
        const interactionCount = await db.trackInteractions.count().exec();
        const playlistCount = await db.playlists.count().exec();
        console.log(
            `[RxDB] Database ready - ${userCount} users, ${trackCount} tracks, ${interactionCount} interactions, ${playlistCount} playlists`
        );

        return db;
    })();

    return dbPromise;
}

/**
 * Get the database instance (must be initialized first)
 */
export async function getDatabase(): Promise<WhatNextDatabase> {
    if (!dbPromise) {
        throw new Error(
            'Database not initialized. Call initDatabase() first.'
        );
    }
    return dbPromise;
}

/**
 * Destroy the database (for testing/cleanup)
 */
export async function destroyDatabase(): Promise<void> {
    if (dbPromise) {
        const db = await dbPromise;
        await db.remove();
        dbPromise = null;
        console.log('[RxDB] Database destroyed');
    }
}

/**
 * Reset the database (destroy and reinitialize)
 * Useful during development when schemas change
 */
export async function resetDatabase(): Promise<WhatNextDatabase> {
    console.log('[RxDB] Resetting database...');
    await destroyDatabase();
    return initDatabase();
}

// Development helper: expose reset function to window
if (process.env.NODE_ENV !== 'production') {
    (window as any).resetRxDB = async () => {
        console.log('[Dev] Resetting RxDB database...');
        try {
            await resetDatabase();
        } catch (err) {
            console.warn('[Dev] Failed to reset via API, clearing IndexedDB directly...', err);
            // If reset fails, clear IndexedDB directly
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

    // Additional helper to directly nuke all RxDB-related IndexedDB databases
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

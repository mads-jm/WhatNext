/**
 * RxDB Database Initialization
 * Creates and configures the local-first database for WhatNext
 */

import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import type { WhatNextDatabase, WhatNextCollections } from './schemas';
import { playlistSchema, trackSchema } from './schemas';

let dbPromise: Promise<WhatNextDatabase> | null = null;

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
        console.log('[RxDB] Initializing database...');

        // Create database with Dexie storage (IndexedDB)
        const db = await createRxDatabase<WhatNextCollections>({
            name: 'whatnext_db',
            storage: getRxStorageDexie(),
            multiInstance: false, // Single instance per browser
            ignoreDuplicate: true,
        });

        console.log('[RxDB] Database created, adding collections...');

        // Add collections
        await db.addCollections({
            playlists: {
                schema: playlistSchema,
            },
            tracks: {
                schema: trackSchema,
            },
        });

        console.log('[RxDB] Collections added successfully');

        // Development: Log database stats
        const playlistCount = await db.playlists.count().exec();
        const trackCount = await db.tracks.count().exec();
        console.log(
            `[RxDB] Database ready - ${playlistCount} playlists, ${trackCount} tracks`
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

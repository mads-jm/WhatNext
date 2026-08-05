/**
 * RxDB Database Initialization
 * Creates and configures the local-first database for WhatNext
 */

import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import type { WhatNextDatabase, WhatNextCollections } from './schemas';
import {
    userSchema,
    trackSchema,
    trackInteractionSchema,
    playlistSchema,
    commentSchema,
} from './schemas';

// Add query builder plugin (required for .find(), .findOne(), etc.)
addRxPlugin(RxDBQueryBuilderPlugin);
// Add update plugin (required for document.update({ $set: ... }))
addRxPlugin(RxDBUpdatePlugin);
// Add migration plugin (required for schema version upgrades)
addRxPlugin(RxDBMigrationSchemaPlugin);

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
                migrationStrategies: {
                    // v0 → v1: Added avatarSource, linkedAccounts, updatedAt, bio, avatarLocalPath, avatarUrl
                    1(oldDoc) {
                        return {
                            ...oldDoc,
                            avatarSource: oldDoc.avatarSource ?? 'none',
                            linkedAccounts: oldDoc.linkedAccounts ?? [],
                            updatedAt: oldDoc.updatedAt ?? oldDoc.createdAt ?? new Date().toISOString(),
                            avatarLocalPath: oldDoc.avatarLocalPath ?? undefined,
                            avatarUrl: oldDoc.avatarUrl ?? undefined,
                            bio: oldDoc.bio ?? undefined,
                        };
                    },
                },
            },
            tracks: {
                schema: trackSchema,
                migrationStrategies: {
                    // v0 → v1: Added albumArtUrl, albumArtLocalPath
                    1(oldDoc) {
                        return {
                            ...oldDoc,
                            albumArtUrl: oldDoc.albumArtUrl ?? undefined,
                            albumArtLocalPath: oldDoc.albumArtLocalPath ?? undefined,
                        };
                    },
                    // v1 → v2: Added Audio Acquisition Service fields
                    // Backfills source: Spotify tracks get 'spotify', others get 'manual'
                    2(oldDoc) {
                        return {
                            ...oldDoc,
                            localFilePath: undefined,
                            localFileSize: undefined,
                            source: oldDoc.spotifyId ? 'spotify' : 'manual',
                            sourceUrl: undefined,
                            audioFormat: undefined,
                            audioBitrate: undefined,
                            purchaseLinks: undefined,
                            userPurchased: undefined,
                        };
                    },
                    // v2 → v3: Added updatedAt for P2P replication (LWW checkpoint sync)
                    3(oldDoc) {
                        return {
                            ...oldDoc,
                            updatedAt: oldDoc.addedAt ?? new Date().toISOString(),
                        };
                    },
                },
            },
            trackInteractions: {
                schema: trackInteractionSchema,
            },
            playlists: {
                schema: playlistSchema,
                migrationStrategies: {
                    // v0 → v1: Added coverArtUrl, coverArtLocalPath
                    1(oldDoc) {
                        return {
                            ...oldDoc,
                            coverArtUrl: oldDoc.coverArtUrl ?? undefined,
                            coverArtLocalPath: oldDoc.coverArtLocalPath ?? undefined,
                        };
                    },
                    // v1 → v2: Added turn management fields
                    2(oldDoc) {
                        return {
                            ...oldDoc,
                            turnOrder: undefined,
                            tracksPerTurn: undefined,
                            turnTracksAdded: undefined,
                            maxTurns: undefined,
                            turnsCompleted: undefined,
                            isComplete: undefined,
                        };
                    },
                    // v2 → v3: Added maxDurationMs
                    3(oldDoc) {
                        return { ...oldDoc, maxDurationMs: undefined };
                    },
                    // v3 → v4: Added completedFromMode
                    4(oldDoc) {
                        return { ...oldDoc, completedFromMode: undefined };
                    },
                    // v4 → v5: Added coHostIds for co-host model
                    5(oldDoc) {
                        return { ...oldDoc, coHostIds: oldDoc.coHostIds ?? [] };
                    },
                },
            },
            comments: {
                schema: commentSchema,
                migrationStrategies: {
                    // v0 → v1: Added userAvatarUrl
                    1(oldDoc) {
                        return { ...oldDoc, userAvatarUrl: undefined };
                    },
                },
            },
        });

        console.log('[RxDB] Collections added successfully');

        // Development: Log database stats
        const userCount = await db.users.count().exec();
        const trackCount = await db.tracks.count().exec();
        const interactionCount = await db.trackInteractions.count().exec();
        const playlistCount = await db.playlists.count().exec();
        const commentCount = await db.comments.count().exec();
        console.log(
            `[RxDB] Database ready - ${userCount} users, ${trackCount} tracks, ${interactionCount} interactions, ${playlistCount} playlists, ${commentCount} comments`
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

// Load dev helpers (window.resetRxDB, window.nukeRxDB) as side-effect
import('./dev-helpers');

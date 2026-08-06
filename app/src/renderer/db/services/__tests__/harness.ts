/**
 * Shared scaffolding for the renderer db-service suites (#26).
 *
 * The five services under `db/services/` all reach the database through
 * `getDatabase()` from `../../database`, which is a Dexie/IndexedDB singleton —
 * unbootable under Vitest's default `node` environment. Rather than fake RxDB
 * (as `track-sink.test.ts` does, because *its* subject is a mapping layer), the
 * service suites run against a real RxDB instance backed by
 * `rxdb/plugins/storage-memory`: the services' contracts are largely *about*
 * RxDB semantics — `$regex` selectors, `findByIds` maps, `doc.update({ $set })`,
 * primary-key upserts — and a hand-rolled fake would pin the fake, not the code.
 *
 * Each suite registers the module mock itself (mocks are per-file and hoisted):
 *
 *     vi.mock('../../database', async () => {
 *         const { getTestDatabase } = await import('./harness');
 *         return { getDatabase: getTestDatabase };
 *     });
 *
 * and then drives `createTestDatabase()` / `closeTestDatabase()` from
 * `beforeEach` / `afterEach` so every test gets a clean, isolated database.
 *
 * Consumers: `playlist-service.crud.test.ts`, `playlist-service.tracks.test.ts`,
 * `playlist-service.turns.test.ts`, `track-service.test.ts`,
 * `user-service.test.ts`, `comment-service.test.ts`, `reaction-service.test.ts`.
 */

import { vi } from 'vitest';
import { createRxDatabase, addRxPlugin, randomToken } from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import { RxDBDevModePlugin, disableWarnings } from 'rxdb/plugins/dev-mode';
import type { WhatNextDatabase, WhatNextCollections } from '../../schemas';
import {
    userSchema,
    trackSchema,
    trackInteractionSchema,
    playlistSchema,
    commentSchema,
} from '../../schemas';
import type { CreateTrackInput, CreatePlaylistInput } from '../../types';

// The services rely on the query-builder shorthand (`.find().sort(...)`,
// `.findOne(id)`) and on `doc.update({ $set })`; `database.ts` registers these
// as import side effects, and any harness that bypasses it inherits the job.
addRxPlugin(RxDBQueryBuilderPlugin);
addRxPlugin(RxDBUpdatePlugin);
addRxPlugin(RxDBMigrationSchemaPlugin);
// `database.ts` loads dev-mode outside production too. It is what turns RxDB's
// opaque error codes into readable messages, which is the difference between a
// diagnosable test failure and a bare "RxError (DB9)". `disableWarnings()`
// silences only its per-run "you are in dev-mode" banner.
disableWarnings();
addRxPlugin(RxDBDevModePlugin);

let current: WhatNextDatabase | null = null;

/**
 * Stand-in for every schema version bump between 0 and the schema's current
 * version. A freshly created in-memory database holds no documents from an
 * older version, so these never run — they exist only because RxDB refuses to
 * add a collection whose schema version is > 0 without them. Duplicating
 * `database.ts`'s real strategies here would just be drift waiting to happen.
 */
function noopMigrations(version: number) {
    const strategies: Record<number, (doc: unknown) => unknown> = {};
    for (let v = 1; v <= version; v++) {
        strategies[v] = (doc) => doc;
    }
    return strategies;
}

/**
 * Create a fresh, isolated, memory-backed database with the production schemas
 * and install it as the one `getTestDatabase()` hands out.
 *
 * Storage is wrapped in the ajv validator exactly as `database.ts` does outside
 * production, so a service that writes a document violating its schema fails
 * the test instead of silently persisting garbage.
 */
export async function createTestDatabase(): Promise<WhatNextDatabase> {
    const db = await createRxDatabase<WhatNextCollections>({
        // Unique per call: memory storage is process-global, and reusing a name
        // would leak state between tests.
        name: `whatnext_test_${randomToken(10)}`,
        storage: wrappedValidateAjvStorage({ storage: getRxStorageMemory() }),
        multiInstance: false,
    });

    await db.addCollections({
        users: {
            schema: userSchema,
            migrationStrategies: noopMigrations(userSchema.version),
        },
        tracks: {
            schema: trackSchema,
            migrationStrategies: noopMigrations(trackSchema.version),
        },
        trackInteractions: { schema: trackInteractionSchema },
        playlists: {
            schema: playlistSchema,
            migrationStrategies: noopMigrations(playlistSchema.version),
        },
        comments: {
            schema: commentSchema,
            migrationStrategies: noopMigrations(commentSchema.version),
        },
    });

    current = db;
    return db;
}

/**
 * The `getDatabase` replacement each suite mocks `../../database` with.
 */
export async function getTestDatabase(): Promise<WhatNextDatabase> {
    if (!current) {
        throw new Error(
            'Test database not created. Call createTestDatabase() in beforeEach.',
        );
    }
    return current;
}

export async function closeTestDatabase(): Promise<void> {
    if (current) {
        await current.close();
        current = null;
    }
}

/**
 * Freeze `Date` (and only `Date` — RxDB's internals schedule real timers, so
 * faking those would deadlock) at a known instant.
 *
 * Several services stamp `new Date().toISOString()` on write; asserting an
 * `updatedAt` bump against the real clock flakes at millisecond resolution.
 * With the clock frozen, tests advance it explicitly and can assert exact
 * timestamps. Suites that use this must call `vi.useRealTimers()` in cleanup.
 */
export const FIXED_NOW = '2026-03-01T12:00:00.000Z';

export function freezeClock(at: string = FIXED_NOW): void {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at));
}

/** Advance the frozen clock; returns the new ISO instant. */
export function tickClock(ms: number): string {
    const next = new Date(Date.now() + ms);
    vi.setSystemTime(next);
    return next.toISOString();
}

export const OWNER_ID = 'user-owner';

/** Minimal valid `createPlaylist` input; override anything a test cares about. */
export function playlistInput(
    overrides: Partial<CreatePlaylistInput> = {},
): CreatePlaylistInput {
    return {
        playlistName: 'Test Playlist',
        ownerId: OWNER_ID,
        ...overrides,
    };
}

/** Minimal valid `createTrack` input; override anything a test cares about. */
export function trackInput(
    overrides: Partial<CreateTrackInput> = {},
): CreateTrackInput {
    return {
        title: 'Test Track',
        artists: ['Test Artist'],
        album: 'Test Album',
        durationMs: 180000,
        addedBy: OWNER_ID,
        ...overrides,
    };
}

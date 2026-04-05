---
tags:
  - data/rxdb
  - core/vision/local-first
  - ux/reactive
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Monday, March 9th 2026, 12:20:49 am
---

# RxDB

## What It Is

RxDB is a reactive, NoSQL database for JavaScript applications that works with IndexedDB, SQLite, and other storage backends. Built on RxJS observables, it provides realtime reactivity, offline-first capabilities, and P2P replication out of the box.

In WhatNext, RxDB serves as the local-first data layer—the canonical source of truth for all user data (playlists, tracks, metadata).

## Why We Use It

Chosen after successful spike evaluation (Issue):

- __Local-first__: Database is the source of truth, fully functional offline
- __Reactive streams__: Query results update automatically when data changes (perfect for React)
- __Schema validation__: Built-in JSON Schema validation prevents invalid data
- __P2P replication__: Native support for replicating over custom transports (libp2p)
- __Migration path__: Start with IndexedDB (Dexie), migrate to SQLite for premium features
- __Excellent DX__: TypeScript-first, comprehensive docs, helpful error messages

__Performance__: Sub-millisecond indexed queries, instant writes, smooth 60fps UI updates.

## How It Works

### Architecture in WhatNext

RxDB runs in the renderer process (React UI context):

```ts
┌─────────────────────────────────────┐
│         Renderer Process            │
│  ┌────────────┐      ┌──────────┐  │
│  │   React    │ ←──→ │   RxDB   │  │
│  │ Components │      │ Database │  │
│  └────────────┘      └──────────┘  │
│                           ↓         │
│                      ┌──────────┐  │
│                      │  Dexie   │  │
│                      │IndexedDB │  │
│                      └──────────┘  │
└─────────────────────────────────────┘
```

__Storage__: Dexie adapter (IndexedDB wrapper) for MVP, with migration path to SQLite for better performance and features.

### Database Initialization

```typescript
import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';

// Singleton pattern
let dbPromise: Promise<WhatNextDatabase> | null = null;

export async function initDatabase(): Promise<WhatNextDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = (async () => {
        // Load dev-mode plugin first (development only)
        await loadDevMode();

        // Get storage with validation wrapper (dev only)
        const storage = getStorage();

        const db = await createRxDatabase({
            name: 'whatnext_db',
            storage,
            multiInstance: false,
            ignoreDuplicate: true
        });

        // Add collections (5 total, with migration strategies for versioned schemas)
        await db.addCollections({
            users: { schema: userSchema, migrationStrategies: { 1: (old) => ({ ...old, avatarSource: 'none', linkedAccounts: [], updatedAt: old.createdAt }) } },
            tracks: { schema: trackSchema, migrationStrategies: { 1: (old) => ({ ...old, albumArtUrl: undefined, albumArtLocalPath: undefined }) } },
            trackInteractions: { schema: trackInteractionSchema },
            playlists: { schema: playlistSchema, migrationStrategies: { 1: (old) => ({ ...old, coverArtUrl: undefined, coverArtLocalPath: undefined }) } },
            comments: { schema: commentSchema },
        });

        return db as WhatNextDatabase;
    })();

    return dbPromise;
}
```

### Schemas

WhatNext uses JSON Schema with RxDB extensions. Current schema versions: `users` v1, `tracks` v1, `playlists` v1, `trackInteractions` v0, `comments` v0. See `app/src/renderer/db/schemas.ts` for the authoritative definitions.

Example (tracks v1, simplified):

```typescript
export const trackSchema: RxJsonSchema<TrackDocType> = {
    version: 1,  // v0→v1 migration added albumArtUrl, albumArtLocalPath
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 100 },
        title: { type: 'string' },
        artists: { type: 'array', items: { type: 'string' } },
        album: { type: 'string' },
        durationMs: { type: 'number', minimum: 0 },
        spotifyId: { type: 'string', maxLength: 100 },
        albumArtUrl: { type: 'string' },         // Added in v1
        albumArtLocalPath: { type: 'string' },   // Added in v1
        addedAt: { type: 'string', format: 'date-time', maxLength: 30 },
        addedBy: { type: 'string', maxLength: 100 },
        notes: { type: 'string' },
    },
    required: ['id', 'title', 'artists', 'album', 'durationMs', 'addedAt', 'addedBy'],
    indexes: ['addedAt', 'addedBy'],  // Only required fields can be indexed with Dexie
};
```

### Reactive Queries with React

RxDB queries return RxJS observables that React can subscribe to:

```typescript
import { useEffect, useState } from 'react';

function PlaylistList() {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);

    useEffect(() => {
        // Subscribe to reactive query
        const sub = db.playlists
            .find()
            .sort({ updatedAt: 'desc' })
            .$.subscribe((docs) => {
                setPlaylists(docs);
            });

        // Cleanup subscription
        return () => sub.unsubscribe();
    }, []);

    return (
        <div>
            {playlists.map(p => <div key={p.id}>{p.playlistName}</div>)}
        </div>
    );
}
```

__Result__: UI automatically updates when any playlist is created, updated, or deleted.

## Key Patterns

### Pattern 1: CRUD Service Layer

Encapsulate RxDB operations in service modules:

```typescript
// src/renderer/db/services/track-service.ts
export const TrackService = {
    async createTrack(input: CreateTrackInput): Promise<Track> {
        const db = await initDatabase();
        const track = {
            id: uuidv4(),
            ...input,
            addedAt: new Date().toISOString()
        };
        await db.tracks.insert(track);
        return track;
    },

    getAllTracks(): Observable<Track[]> {
        return from(initDatabase()).pipe(
            switchMap(db => db.tracks.find().sort({ addedAt: 'desc' }).$)
        );
    },

    async updateTrack(id: string, updates: Partial<Track>): Promise<Track> {
        const db = await initDatabase();
        const doc = await db.tracks.findOne(id).exec();
        if (!doc) throw new Error('Track not found');
        await doc.patch(updates);
        return doc.toJSON();
    },

    async deleteTrack(id: string): Promise<void> {
        const db = await initDatabase();
        const doc = await db.tracks.findOne(id).exec();
        if (!doc) throw new Error('Track not found');
        await doc.remove();
    }
};
```

### Pattern 2: Development Helpers

Clear IndexedDB during development when schemas change:

```typescript
// In database.ts (dev-mode only)
if (process.env.NODE_ENV !== 'production') {
    (window as any).nukeRxDB = async () => {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
            if (db.name?.startsWith('whatnext_db')) {
                indexedDB.deleteDatabase(db.name);
            }
        }
        window.location.reload();
    };
}
```

__Usage__: Run `nukeRxDB()` in browser console when schema changes.

### Pattern 3: Storage Configuration

Wrap storage with validation in development:

```typescript
function getStorage() {
    const baseStorage = getRxStorageDexie();

    // Add validation wrapper in development
    if (process.env.NODE_ENV !== 'production') {
        return wrappedValidateAjvStorage({ storage: baseStorage });
    }

    return baseStorage;
}
```

### Pattern 4: Plugin Loading

Load required plugins before database creation:

```typescript
import { addRxPlugin } from 'rxdb';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';

// Required for .find(), .findOne(), etc.
addRxPlugin(RxDBQueryBuilderPlugin);

// Dev-mode plugin (development only)
if (process.env.NODE_ENV !== 'production') {
    const { RxDBDevModePlugin } = await import('rxdb/plugins/dev-mode');
    addRxPlugin(RxDBDevModePlugin);
}
```

### Pattern 5: Complex Queries

```typescript
// Search tracks by title or artist
async function searchTracks(query: string): Promise<Track[]> {
    const db = await initDatabase();
    const regex = `.*${query}.*`;

    return db.tracks
        .find({
            selector: {
                $or: [
                    { title: { $regex: regex, $options: 'i' } },
                    { artists: { $elemMatch: { $regex: regex, $options: 'i' } } }
                ]
            }
        })
        .exec();
}
```

## Common Pitfalls

### Pitfall 1: Optional Fields Cannot Be Indexed (Dexie)

__Problem__: Dexie storage adapter doesn't support indexing optional fields.

```typescript
// ❌ This fails with Dexie
indexes: ['spotifyId']  // spotifyId is optional

// ✅ This works
indexes: ['addedAt']  // addedAt is required
```

__Solution__: Only index required fields when using Dexie, or migrate to RxDB Premium storage.

__Trade-off__: Queries on optional fields do full collection scans (slower but functional).

### Pitfall 2: String Indexes Need maxLength

__Problem__: RxDB requires `maxLength` on all indexed string fields.

```typescript
// ❌ Missing maxLength
interactionType: {
    type: 'string',
    enum: ['vote', 'like', 'skip']
}

// ✅ With maxLength
interactionType: {
    type: 'string',
    enum: ['vote', 'like', 'skip'],
    maxLength: 10
}
```

__Error__: `SC34 - Fields of type string that are used in an index, must have set the maxLength attribute`

### Pitfall 3: Schema Changes Require Migration

__Problem__: Changing schemas causes hash mismatch (DB6 error).

__Solution__:
- __Development__: Clear IndexedDB via `nukeRxDB()` helper
- __Production__: Increment schema version and write migration:

```typescript
export const trackSchema: RxJsonSchema<Track> = {
    version: 1,  // Incremented from 0
    // ... schema
};

// Add migration strategy
await db.addCollections({
    tracks: {
        schema: trackSchema,
        migrationStrategies: {
            1: (oldDoc) => {
                // Transform v0 doc to v1 format
                oldDoc.newField = 'default value';
                return oldDoc;
            }
        }
    }
});
```

### Pitfall 4: Query Builder Plugin Required

__Problem__: `.find()` and `.findOne()` methods don't exist.

__Solution__: Import and register the query builder plugin:

```typescript
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
addRxPlugin(RxDBQueryBuilderPlugin);
```

### Pitfall 5: Dev-Mode Plugin Must Load First

__Problem__: `ignoreDuplicate` option causes DB9 error.

__Solution__: Load dev-mode plugin before calling `createRxDatabase()`:

```typescript
// MUST be before createRxDatabase()
await loadDevMode();

const db = await createRxDatabase({
    name: 'whatnext_db',
    storage: getStorage(),
    ignoreDuplicate: true  // Now allowed
});
```

### Pitfall 6: Forgetting to Unsubscribe

__Problem__: Memory leaks from React subscriptions.

__Solution__: Always return cleanup function in useEffect:

```typescript
useEffect(() => {
    const sub = db.playlists.find().$.subscribe(setPlaylists);
    return () => sub.unsubscribe();  // ← Critical!
}, []);
```

## Session Patterns (v1)

Sessions v1 added several user-service patterns for participant attribution:

```typescript
// Map Spotify user ID → WhatNext UserDocType (checks linkedAccounts)
const user = await resolveSpotifyUser('spotify_user_id');

// Auto-create a stub participant when no WhatNext user matches
const doc = await createSessionParticipant('Unknown', 'spotify_user_id');
// Creates UserDocType with isLocal: false, linkedAccounts: [{ provider: 'spotify', ... }]

// Fetch all non-local users for the participant picker
const users = await getAllUsers();
const nonLocal = users.filter((u) => !u.isLocal);
```

See `app/src/renderer/db/services/user-service.ts` and [[Sessions]].

## Related Concepts

- [[libp2p]] - P2P networking for RxDB replication
- [[Electron-IPC]] - Database operations in renderer context
- [[React-Patterns]] - Reactive query patterns with React hooks
- [[Sessions]] - Session participant attribution via RxDB user service
- [[adr-251109-database-storage-location]] - Where RxDB data is stored

## References

### Official Documentation

- [RxDB Documentation](https://rxdb.info/)
- [RxDB Schema Guide](https://rxdb.info/rx-schema.html)
- [Dexie Storage](https://rxdb.info/rx-storage-dexie.html)
- [Replication Protocol](https://rxdb.info/replication.html)

### WhatNext Implementation

- Database: `app/src/renderer/db/database.ts`
- Schemas: `app/src/renderer/db/schemas.ts` (users v1, tracks v1, playlists v1, trackInteractions v0, comments v0)
- Services: `app/src/renderer/db/services/` (playlist, track, user, comment, reaction)
- Types: `app/src/renderer/db/types.ts` (view models, CRUD input types)
- Query helpers: `app/src/renderer/db/query-helpers.ts`
- Replication handler: `app/src/renderer/db/replication-handler.ts`

### Related Issues

- Issue: RxDB Evaluation
- Issue: Schema Integration
- Issue: CRUD Operations

### Learning Resources

- [RxDB Examples](https://github.com/pubkey/rxdb/tree/master/examples)
- [RxJS Documentation](https://rxjs.dev/)
- [JSON Schema](https://json-schema.org/)

---

__Status__: ✅ Production-ready, running in WhatNext v0.2.0
__Storage__: Dexie (IndexedDB) for MVP, SQLite migration planned
__Last Updated__: 2026-03-07


# RxDB Schema Validation & Dexie Storage Constraints

**Date**: 2025-11-09
**Status**: ✅ Resolved
**Context**: Initial RxDB integration spike test

## Problem

When attempting to initialize RxDB with Dexie storage for the first time, encountered a cascade of schema validation errors that prevented database creation. These errors revealed important constraints and requirements for RxDB schemas when using the Dexie.js (IndexedDB) storage adapter.

## Errors Encountered (In Order)

### 1. Missing `maxLength` on Indexed String Fields
**Error Code**: `SC34`

```
Error message: Fields of type string that are used in an index, must have set the maxLength attribute in the schema
Error code: SC34
Field: "interactionType"
```

**Root Cause**: RxDB requires all string fields used in indexes to have a `maxLength` constraint defined. This is necessary for the underlying storage engine to allocate appropriate index space.

**Solution**: Added `maxLength: 10` to the `interactionType` field in `trackInteractionSchema`:

```typescript
interactionType: {
    type: 'string',
    enum: ['vote', 'like', 'skip', 'play', 'queue'],
    maxLength: 10, // Longest enum value is 'queue' (5 chars), set to 10 for safety
}
```

**Learning**: Always add `maxLength` to string fields that will be indexed. Consider the longest possible value and add buffer for safety.

---

### 2. Schema Hash Mismatch (Database Already Exists)
**Error Code**: `DB6`

```
Error message: RxDatabase.addCollections(): another instance created this collection with a different schema
previousSchemaHash: "556f65dc752a78028914ff1624d8cf8e0900d73386924f588827b05f27dd4403"
schemaHash: "8e2a9ace862d2bab0028d9068d13b6fe1d23513fcad3016a1544baac357c40ae"
```

**Root Cause**: RxDB stores the schema hash in IndexedDB. When schemas change during development, the old schema persists in the browser's IndexedDB, causing a hash mismatch.

**Solution**: Created development helpers to clear IndexedDB:

```typescript
// In database.ts - development-only helpers
if (process.env.NODE_ENV !== 'production') {
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
```

**Usage**: Call `nukeRxDB()` in browser console whenever schemas change during development.

**Learning**:
- RxDB schema changes require database migration or deletion
- In production, use schema versioning and migration strategies
- In development, clear IndexedDB when schemas change
- The `destroyDatabase()` API method doesn't work if the schema is invalid

---

### 3. Optional Fields Cannot Be Indexed with Dexie
**Error**:
```
Error message: non-required index fields are not possible with the dexie.js RxStorage
```

**Root Cause**: The Dexie.js storage adapter has a constraint that **all indexed fields must be required**. This is a Dexie-specific limitation, not a general RxDB limitation.

**Fields Affected**:
- `trackSchema`: `spotifyId` (optional, but was indexed)
- `trackInteractionSchema`: `playlistId` (optional, but was indexed)
- `playlistSchema`: `linkedSpotifyId` (optional, but was indexed)

**Solution**: Removed optional fields from index arrays:

```typescript
// trackSchema - BEFORE
indexes: ['addedAt', 'spotifyId', 'addedBy']

// trackSchema - AFTER
indexes: ['addedAt', 'addedBy'] // Removed 'spotifyId' - optional fields can't be indexed with Dexie

// trackInteractionSchema - BEFORE
indexes: ['userId', 'trackId', 'playlistId', 'interactionType', 'updatedAt']

// trackInteractionSchema - AFTER
indexes: ['userId', 'trackId', 'interactionType', 'updatedAt'] // Removed 'playlistId'

// playlistSchema - BEFORE
indexes: ['updatedAt', 'linkedSpotifyId', 'ownerId', 'isCollaborative']

// playlistSchema - AFTER
indexes: ['updatedAt', 'ownerId', 'isCollaborative'] // Removed 'linkedSpotifyId'
```

**Trade-offs**:
- **Performance**: Queries filtering by these optional fields will be slower (full collection scan vs. index lookup)
- **Functionality**: Queries still work, just not optimized
- **Future**: Can migrate to premium RxDB storage that supports optional indexes if needed

**Alternative Solutions**:
1. Make fields required with empty string/sentinel values (breaks data model semantics)
2. Use RxDB Premium storage plugins (cost, but better performance)
3. Accept the performance trade-off for optional fields (chosen approach for MVP)

**Learning**: Different RxDB storage adapters have different constraints. Dexie is free and works well but has limitations. Plan indexing strategy based on storage choice.

---

### 4. Missing Query Builder Plugin
**Error**:
```
Error: You are using a function which must be overwritten by a plugin.
You should either prevent the usage of this function or add the plugin via:
    import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
    addRxPlugin(RxDBQueryBuilderPlugin);
```

**Root Cause**: RxDB uses a plugin architecture. The Query Builder plugin (which provides `.find()`, `.findOne()`, `.count()`, etc.) must be explicitly imported and registered.

**Solution**: Added plugin import and registration:

```typescript
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';

// Add query builder plugin (required for .find(), .findOne(), etc.)
addRxPlugin(RxDBQueryBuilderPlugin);
```

**Learning**: RxDB is modular - only include plugins you need. Common plugins:
- `query-builder`: Query methods (`.find()`, `.findOne()`)
- `dev-mode`: Enhanced error messages (dev only)
- `validate-ajv`: Schema validation
- `replication`: P2P sync (future)
- `update`: Update operations
- `migration-storage`: Schema migrations

---

## Complete Solution Summary

### Files Modified

#### `app/src/renderer/db/schemas.ts`
1. Added `maxLength: 10` to `trackInteractionSchema.interactionType`
2. Removed optional fields from all schema index arrays

#### `app/src/renderer/db/database.ts`
1. Added `RxDBQueryBuilderPlugin` import and registration
2. Added development helpers: `resetRxDB()` and `nukeRxDB()`

### Development Workflow for Schema Changes

1. **Modify schema** in `schemas.ts`
2. **Clear database** by running `nukeRxDB()` in browser console
3. **Verify** in DevTools → Application → IndexedDB that old databases are gone
4. **Reload** page (happens automatically with `nukeRxDB()`)
5. **Test** that new schema initializes successfully

### Production Migration Strategy (Future)

When we need to change schemas in production:

1. **Increment schema version**: `version: 0` → `version: 1`
2. **Write migration strategy**: Define how to transform old data to new schema
3. **Use RxDB migration plugin**: Handle version bumps gracefully
4. **Test migrations thoroughly**: Can't roll back IndexedDB changes easily

Reference: https://rxdb.info/migration-schema.html

---

## Key Learnings

### RxDB Schema Design Principles

1. **All indexed string fields need `maxLength`**: Plan these based on actual data
2. **Optional fields cannot be indexed with Dexie**: Choose storage based on needs
3. **Schema changes require migration or reset**: Plan schema carefully upfront
4. **Plugin architecture is explicit**: Only import what you need
5. **Dev-mode plugin is invaluable**: Always use in development for better errors

### Dexie Storage Constraints

- ✅ Free and open source
- ✅ Good performance for most use cases
- ✅ Works in all browsers with IndexedDB support
- ❌ Cannot index optional/nullable fields
- ❌ Cannot do full-text search natively
- ⚠️  Best for structured data with well-defined schemas

### Development Helpers Created

```javascript
// Browser console commands (dev-mode only)
resetRxDB()  // Try to destroy via API, fallback to IndexedDB deletion
nukeRxDB()   // Nuclear option - directly delete all RxDB IndexedDB databases
```

---

## Testing Validation

After all fixes applied:

1. ✅ RxDB initializes without errors
2. ✅ All four collections created: `users`, `tracks`, `trackInteractions`, `playlists`
3. ✅ Query methods available (`.find()`, `.insert()`, etc.)
4. ✅ Dev-mode warnings appear (expected, can be silenced later)
5. ✅ Database persists across page reloads
6. ✅ Schema hash is stable (no more DB6 errors)

---

## References

- RxDB Documentation: https://rxdb.info/
- Schema Validation: https://rxdb.info/rx-schema.html
- Dexie Storage: https://rxdb.info/rx-storage-dexie.html
- Error Codes: https://rxdb.info/errors.html
- Migration Guide: https://rxdb.info/migration-schema.html
- Plugins: https://rxdb.info/plugins.html

---

## Next Steps

1. **Spike Test Completion**: Verify CRUD operations work as expected
2. **Evaluate Indexing Strategy**: Monitor query performance on optional fields
3. **Plan Schema Versioning**: Set up migration strategy before production
4. **Consider Premium Storage**: Evaluate if optional field indexing is critical
5. **Add Replication Plugin**: Required for P2P collaboration (Phase 1 MVP)

---

## Related Files

- `app/src/renderer/db/database.ts` - Database initialization
- `app/src/renderer/db/schemas.ts` - Schema definitions
- `app/src/renderer/db/spike-test.tsx` - Initial integration test

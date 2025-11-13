# RxDB Dev-Mode Plugin Setup

**Date**: 2025-11-09
**Issue**: RxDB Error DB9 - `ignoreDuplicate` not allowed without dev-mode plugin
**Status**: ✅ Resolved

## Problem

When initializing RxDB in development, received error:
```
RxError (DB9): ignoreDuplicate is only allowed in dev-mode
```

The application was trying to use `ignoreDuplicate: true` option in the database configuration, but this setting requires the dev-mode plugin to be loaded.

## Root Cause

RxDB requires the dev-mode plugin to be explicitly loaded for:
1. Better error messages (including full error text instead of codes)
2. Schema validation
3. Development-only features like `ignoreDuplicate`

Without the plugin, RxDB throws DB9 error to prevent accidental production deployment of dev-only code.

## Solution

### Step 1: Import and Load Dev-Mode Plugin

In `src/renderer/db/database.ts`:

```typescript
import { addRxPlugin } from 'rxdb';

let devModeLoaded = false;

async function loadDevMode(): Promise<void> {
    if (devModeLoaded) return;

    if (process.env.NODE_ENV !== 'production') {
        const { RxDBDevModePlugin } = await import('rxdb/plugins/dev-mode');
        addRxPlugin(RxDBDevModePlugin);
        devModeLoaded = true;
        console.log('[RxDB] Dev-mode plugin loaded');
    }
}
```

### Step 2: Load Before Database Creation

**Critical**: The plugin must be loaded **before** calling `createRxDatabase()`:

```typescript
export async function initDatabase(): Promise<WhatNextDatabase> {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = (async () => {
        // Load dev-mode plugin FIRST
        await loadDevMode();

        // THEN create database
        const db = await createRxDatabase({
            name: 'whatnext_db',
            storage: getRxStorageDexie(),
            multiInstance: false,
            ignoreDuplicate: true, // Now allowed!
        });

        // ... rest of setup
    })();

    return dbPromise;
}
```

## Key Learnings

1. **Plugin Loading Order Matters**: Dev-mode must be loaded before any RxDB operations
2. **Environment-Specific**: Only load in development (`process.env.NODE_ENV !== 'production'`)
3. **Dynamic Import**: Use `await import()` to avoid bundling plugin in production
4. **Singleton Pattern**: Track if plugin is loaded to avoid duplicate registration
5. **Better DX**: Dev-mode provides full error messages instead of error codes

## Benefits of Dev-Mode Plugin

- **Full error messages**: Instead of "DB9", see complete explanation
- **Schema validation**: Catches schema mistakes early
- **API validation**: Warns about incorrect RxDB API usage
- **Development features**: Enables `ignoreDuplicate` and other dev tools

## Production Considerations

**Never deploy with dev-mode plugin** because:
- Increases bundle size significantly
- Reduces runtime performance
- Exposes development-only error messages

The conditional import ensures it's automatically excluded from production builds.

## References

- [RxDB Dev-Mode Plugin Docs](https://rxdb.info/dev-mode.html)
- [RxDB Error DB9](https://rxdb.info/errors.html#db9)

## Additional Fix Required: Schema Validation (DVM1)

After loading dev-mode, encountered **Error DVM1**:
```
When dev-mode is enabled, your storage must use one of the schema validators at the top level.
```

### Solution: Wrap Storage with Validator

```typescript
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';

function getStorage() {
    const baseStorage = getRxStorageDexie();

    // Wrap with schema validation in development
    if (process.env.NODE_ENV !== 'production') {
        return wrappedValidateAjvStorage({ storage: baseStorage });
    }

    return baseStorage;
}

// Use in database creation
const db = await createRxDatabase({
    name: 'whatnext_db',
    storage: getStorage(), // Validated storage
    multiInstance: false,
    ignoreDuplicate: true,
});
```

### Why This Works
- **AJV validator**: Fast, JSON Schema compliant
- **Conditional**: Only in development (performance + build size)
- **Wrapping pattern**: Decorator around base storage
- **Schema safety**: Catches invalid data before persistence

## Testing

After fixes:
1. ✅ RxDB initializes without errors
2. ✅ Dev-mode plugin loads in development
3. ✅ Schema validation wrapper applied
4. ✅ Full error messages displayed in console
5. ✅ `ignoreDuplicate` setting works correctly
6. ✅ Database operations function normally
7. ✅ Invalid data rejected by validator

**Result**: RxDB spike test component now works perfectly!

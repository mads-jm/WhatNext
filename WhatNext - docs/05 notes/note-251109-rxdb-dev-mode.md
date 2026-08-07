---
tags:
  - data/rxdb/plugins
  - data/rxdb/dev-mode
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Monday, March 9th 2026, 12:20:48 am
status: archived
---

> **ARCHIVED** — consolidated into [[RxDB]] (Pattern: Plugin Loading / dev-mode) on 2026-08-06. Kept for historical context; code paths, line numbers, and status claims herein reflect November 2025 and may be stale.

# RxDB Dev-Mode Plugin Setup

__Date__: 2025-11-09
__Issue__: RxDB Error DB9 - `ignoreDuplicate` not allowed without dev-mode plugin
__Status__: ✅ Resolved

## Problem

When initializing RxDB in development, received error:

```ts
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

__Critical__: The plugin must be loaded __before__ calling `createRxDatabase()`:

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

1. __Plugin Loading Order Matters__: Dev-mode must be loaded before any RxDB operations
2. __Environment-Specific__: Only load in development (`process.env.NODE_ENV !== 'production'`)
3. __Dynamic Import__: Use `await import()` to avoid bundling plugin in production
4. __Singleton Pattern__: Track if plugin is loaded to avoid duplicate registration
5. __Better DX__: Dev-mode provides full error messages instead of error codes

## Benefits of Dev-Mode Plugin

- __Full error messages__: Instead of "DB9", see complete explanation
- __Schema validation__: Catches schema mistakes early
- __API validation__: Warns about incorrect RxDB API usage
- __Development features__: Enables `ignoreDuplicate` and other dev tools

## Production Considerations

__Never deploy with dev-mode plugin__ because:
- Increases bundle size significantly
- Reduces runtime performance
- Exposes development-only error messages

The conditional import ensures it's automatically excluded from production builds.

## References

- [RxDB Dev-Mode Plugin Docs](https://rxdb.info/dev-mode.html)
- [RxDB Error DB9](https://rxdb.info/errors.html#db9)

## Additional Fix Required: Schema Validation (DVM1)

After loading dev-mode, encountered __Error DVM1__:

```ts
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

- __AJV validator__: Fast, JSON Schema compliant
- __Conditional__: Only in development (performance + build size)
- __Wrapping pattern__: Decorator around base storage
- __Schema safety__: Catches invalid data before persistence

## Testing

After fixes:
1. ✅ RxDB initializes without errors
2. ✅ Dev-mode plugin loads in development
3. ✅ Schema validation wrapper applied
4. ✅ Full error messages displayed in console
5. ✅ `ignoreDuplicate` setting works correctly
6. ✅ Database operations function normally
7. ✅ Invalid data rejected by validator

__Result__: RxDB spike test component now works perfectly!

---

## Related Concepts

[[RxDB]]



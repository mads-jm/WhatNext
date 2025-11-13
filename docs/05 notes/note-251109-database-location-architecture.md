# Database Location: Renderer vs Main Process

**Date**: 2025-11-09
**Question**: Should RxDB be in renderer process or main process?
**Status**: ⚖️ Architectural Decision - Renderer is Correct

## Understanding Electron Process Architecture

Before deciding where the database should live, it's critical to understand what each process is and what it can do:

### Main Process
- **What it is**: A Node.js process running Chromium's backend
- **Capabilities**:
  - Full Node.js APIs (fs, path, crypto, etc.)
  - Electron APIs (BrowserWindow, app, dialog, etc.)
  - OS-level operations (file system, native modules)
  - Lifecycle management (quit, relaunch, etc.)
- **Limitations**:
  - No access to DOM
  - No access to browser APIs (localStorage, IndexedDB, WebRTC)
  - No React/Vue/UI frameworks
- **When to use**: System operations, window management, native integrations

### Renderer Process
- **What it is**: A Chromium browser instance running your web app
- **Capabilities**:
  - Full browser APIs (DOM, IndexedDB, WebRTC, fetch, etc.)
  - React/UI frameworks
  - Limited Node.js (if nodeIntegration enabled - **we don't do this**)
- **Limitations**:
  - Sandboxed (can't access file system directly)
  - Must use IPC to communicate with main process
  - Can't use Node.js native modules (without preload bridge)
- **When to use**: UI rendering, user interactions, browser-native features

## The Question

Currently, RxDB database code is in `/app/src/renderer/db/`. Is this the right location for a production Electron app, or should it be in the main process?

**TL;DR**: Renderer is correct because RxDB fundamentally requires browser APIs that don't exist in Node.js.

## Analysis

### Option 1: Database in Renderer (Current)
**Location**: `/app/src/renderer/db/`

#### Pros ✅
1. **Direct UI Integration**: React components can directly subscribe to reactive RxDB queries
2. **No IPC Overhead**: Zero latency for UI updates
3. **Simpler Architecture**: Fewer moving parts, less code
4. **RxDB Design**: RxDB is specifically built for browser/renderer environments (IndexedDB)
5. **Reactive Patterns**: Rx observables work naturally with React hooks
6. **Local-First**: Database IS the UI state - perfect alignment

#### Cons ❌
1. **Multiple Windows**: Each renderer window would have its own DB instance
2. **Security Surface**: Renderer has more attack surface than main
3. **Resource Usage**: Each window duplicates database code in memory

### Option 2: Database in Main Process
**Location**: `/app/src/main/db/`

#### Pros ✅
1. **Single Source of Truth**: One DB instance for all windows
2. **Better Security**: Main process is more isolated
3. **Centralized Control**: Easier to manage database lifecycle
4. **Node.js Storage Options**: Could use SQLite, LevelDB, etc.

#### Cons ❌
1. **IPC Overhead**: Every query requires IPC round-trip (adds ~5-50ms latency)
2. **Lost Reactivity**: Can't use RxDB's reactive queries directly in UI
3. **Complexity**: Need to implement pub/sub over IPC for updates
4. **Performance**: Network-like latency for local data
5. **RxDB Fundamentally Can't Work**: RxDB requires IndexedDB which **doesn't exist in Node.js**
   - IndexedDB is a **browser-only** API
   - Main process = Node.js, not a browser
   - Would need completely different storage (SQLite, LevelDB)
   - Would lose RxDB's reactive queries, replication, and entire ecosystem

#### Why Main Process Doesn't Work for RxDB

**Critical blocker**: IndexedDB is a Web API, not a Node.js API.

```javascript
// In Renderer (Browser Context) ✅
const storage = getRxStorageDexie(); // Uses IndexedDB - works!

// In Main Process (Node.js Context) ❌
const storage = getRxStorageDexie(); // IndexedDB undefined - crashes!
```

To use RxDB in main process, you'd need:
1. Different storage adapter (e.g., `getRxStorageLokijs`, `getRxStorageMemory`)
2. File-based storage (not IndexedDB)
3. Custom storage implementation

**But**: This defeats the purpose of using RxDB, which is optimized for browser environments.

## Decision: **Keep in Renderer** ✅

### Core Technical Reason

**RxDB requires browser APIs that don't exist in Node.js**:
- IndexedDB (browser storage)
- WebRTC (for P2P replication)
- Reactive observables optimized for UI

The main process is Node.js, not a browser. Using RxDB there would require:
- Abandoning IndexedDB for file-based storage
- Losing reactive query streams
- Implementing custom replication
- Adding IPC overhead for every operation

This negates all benefits of using RxDB.

### Architectural Rationale

For WhatNext's architecture, **renderer-based database is the correct choice** because:

1. **RxDB is Browser-Native**
   - Uses IndexedDB (browser API, not available in Node.js main process)
   - Would require different storage adapter for main process
   - Designed for this exact use case

2. **Local-First = UI-First**
   - The database IS the application state
   - React components should directly query/mutate
   - Reactive updates are the core feature

3. **WhatNext is Single-Window**
   - MVP doesn't need multi-window support
   - If needed later, can use RxDB's multi-tab sync

4. **Performance is Critical**
   - Music apps need instant UI updates
   - IPC latency would hurt UX
   - Reactive queries eliminate unnecessary re-renders

5. **P2P Replication**
   - RxDB's P2P sync happens in renderer anyway (WebRTC)
   - Keeping DB in renderer simplifies P2P architecture

### When to Reconsider

Move to main process if:
- Multi-window support becomes critical
- Need to access DB when all windows are closed
- Security requirements change significantly
- Need to use Node.js-only database (unlikely with RxDB)

## Addressing Security Concerns

**Question**: "Isn't renderer less secure?"

**Answer**: Yes, but it's properly mitigated:

### 1. Security Hardening (Already Implemented)
```typescript
// main.ts - Renderer is sandboxed
webPreferences: {
    nodeIntegration: false,      // ✅ No Node.js in renderer
    contextIsolation: true,       // ✅ Isolate context
    preload: preloadPath,         // ✅ Safe bridge only
}

// ✅ Renderer cannot:
// - Access file system directly
// - Execute arbitrary Node.js code
// - Access main process memory
// - Open new windows without permission
```

### 2. What Renderer CAN Access
```typescript
// ✅ Safe browser APIs
- IndexedDB (sandboxed per-origin)
- localStorage (sandboxed per-origin)
- WebRTC (permission-gated)
- Fetch (CORS-restricted)

// ❌ Cannot access:
- File system (requires IPC to main)
- Native modules
- System APIs
```

### 3. Database Security
```typescript
// ✅ IndexedDB is isolated per-origin
// Each Electron app has its own isolated storage
// No cross-app data access

// ✅ Data validation at schema level
wrappedValidateAjvStorage({ storage: baseStorage })

// ✅ No raw DB exposure to window object
// Access only through controlled React hooks
```

### 2. Single Instance Management
```typescript
// ✅ Use singleton pattern
let dbPromise: Promise<WhatNextDatabase> | null = null;

// ✅ Handle multi-tab with RxDB's multiInstance
multiInstance: false, // Or true with proper leader election
```

### 3. Data Persistence
```typescript
// ✅ Store in userData, not temp
const userDataPath = app.getPath('userData');

// ✅ Implement backup/export
// Plaintext export to markdown for resilience
```

### 4. Lifecycle Management
```typescript
// ✅ Clean shutdown
window.addEventListener('beforeunload', async () => {
    await db.remove(); // If needed
});
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      MAIN PROCESS (Node.js)                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │   Window Management, IPC Handlers, File System Access  │ │
│  │   - Create/destroy windows                             │ │
│  │   - Native dialogs                                     │ │
│  │   - Export playlists to markdown (file writes)         │ │
│  │   - System tray, menus, shortcuts                      │ │
│  └──────────────────────┬─────────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────────┘
                          │ IPC (Secure Bridge)
                          │ - dialog:openFile
                          │ - app:getPath
                          │ - window:maximize
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              RENDERER PROCESS (Chromium Browser)            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              React Components (UI Layer)                │ │
│  │   - PlaylistView, TrackList, ConnectionStatus          │ │
│  │   - useEffect hooks subscribe to RxDB queries          │ │
│  └───────────────────┬────────────────────────────────────┘ │
│                      │ Direct JS calls (0ms latency)        │
│                      ▼                                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              RxDB Database (Data Layer)                 │ │
│  │   - Reactive queries (Observable streams)               │ │
│  │   - CRUD operations (insert, update, delete)            │ │
│  │   - Schema validation (dev-mode)                        │ │
│  │   - P2P replication (WebRTC sync)                       │ │
│  └───────────────────┬────────────────────────────────────┘ │
│                      │ Storage API calls                    │
│                      ▼                                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │        IndexedDB (Browser-Native Storage)               │ │
│  │   - Persistent key-value store                          │ │
│  │   - Transactional, ACID-compliant                       │ │
│  │   - Sandboxed per-origin (secure)                       │ │
│  │   - ~50MB-100GB capacity                                │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┴──────────────────┐
        │                                    │
        ▼                                    ▼
  P2P Replication                   Export to Plaintext
  (WebRTC in Renderer)              (IPC to Main Process)
  - Direct peer connections         - Request via IPC
  - Real-time sync                  - Main writes markdown
  - No server required              - User's file system
```

### Why This Architecture Works

1. **Renderer has the APIs**: IndexedDB, WebRTC are browser-only
2. **Zero latency**: React → RxDB → IndexedDB (all in same process)
3. **Reactive updates**: Observable streams drive UI automatically
4. **Secure**: Sandboxed renderer can't harm system
5. **Backup escape hatch**: Main process exports to plaintext via IPC

## Comparison with Other Architectures

### Obsidian (Most Similar to WhatNext)
```
Architecture: Renderer-based with file system integration
- Vault data in renderer (React + CodeMirror)
- Markdown files synced via main process
- Plugin system runs in renderer
- Excellent performance, local-first

Why similar: Local-first, user-owned data, extensible
```

### VS Code
```
Architecture: Main-process-heavy with renderer UI
- Language servers in main process (Node.js)
- File system access via main
- Extensions run in separate processes
- UI in renderer (Monaco editor)

Why different: Code editor needs Node.js APIs for tooling
              Files are the source of truth, not a database
```

### Discord/Slack
```
Architecture: Renderer with remote sync
- IndexedDB cache in renderer
- API client in renderer
- Main process for notifications/system tray

Why different: Cloud-first, server is source of truth
              Local DB is just a cache
```

### Traditional Electron DB Apps (e.g., some POS systems)
```
Architecture: Main process with SQLite
- Main process: SQLite database
- Renderer: UI only
- IPC for every query
- Multiple windows share one DB

Why different: Multi-window requirement
              Traditional SQL needs (joins, complex queries)
              No need for reactive UI updates
              Offline-first with sync-to-server
```

### Why WhatNext is Different

**WhatNext combines**:
- Local-first (like Obsidian)
- Reactive UI (like modern web apps)
- P2P collaboration (like gaming/WebRTC apps)
- Music management (real-time, latency-sensitive)

**This requires**:
- Browser APIs (IndexedDB, WebRTC) → **Renderer**
- Reactive queries (RxDB observables) → **Renderer**
- Zero-latency UI updates → **Renderer**
- P2P replication → **Renderer** (WebRTC)

## Common Misconceptions Addressed

### "Main process is always more secure"
**Reality**: Main process has MORE capabilities, not less attack surface
- Main can access file system, spawn processes, access OS APIs
- Renderer is sandboxed by Chromium's security model
- For WhatNext: Renderer sandboxing is sufficient and appropriate

### "Database should be centralized in main"
**Reality**: Only true for multi-window apps with shared state
- WhatNext is single-window (MVP)
- Future multi-tab: RxDB handles sync natively
- Multi-window would need main DB OR multi-instance RxDB with sync

### "Renderer databases are just caches"
**Reality**: With local-first architecture, renderer DB IS the source of truth
- IndexedDB is persistent, transactional, ACID-compliant
- Not a cache - it's the canonical data store
- Plaintext export (via main) is backup, not source

### "Performance will be bad"
**Reality**: Renderer DB is actually FASTER
- No IPC overhead (0ms vs 5-50ms per query)
- Reactive queries eliminate polling
- IndexedDB is highly optimized by browser vendors
- Benchmark: IndexedDB can handle 10,000+ operations/sec

## Conclusion

**Database location: `/app/src/renderer/db/` is architecturally sound** for WhatNext because:

### Technical Necessity
1. **RxDB requires browser APIs** (IndexedDB, WebRTC)
2. **Main process is Node.js**, not a browser
3. **IndexedDB doesn't exist in Node.js**

### Architectural Benefits
4. **Zero-latency UI updates** (no IPC overhead)
5. **Reactive query streams** work natively with React
6. **P2P replication** uses WebRTC (renderer-only API)
7. **Local-first design** - database IS the application state

### Security & Best Practices
8. **Renderer is properly sandboxed** (nodeIntegration: false)
9. **Single-window app** doesn't need main process DB
10. **Follows Electron patterns** for browser-first apps

**No changes needed** ✅

### When to Reconsider (Future)

Move to main process ONLY if:
- Switching from RxDB to SQLite/LevelDB (unlikely)
- Need multi-window with perfectly shared state (Phase 3+)
- Security model changes dramatically (not planned)
- Adding server-side sync hub (contradicts local-first)

## References

- [RxDB Electron Integration](https://rxdb.info/electron.html)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- WhatNext spec §2.1: Local-First Data with User-Accessible Storage

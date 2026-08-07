---
tags:
  - ux/react
  - architecture/patterns/hooks
  - data/rxdb
date created: Sunday, March 8th 2026, 12:14:26 am
date modified: Monday, March 9th 2026, 12:20:51 am
---

# React Patterns

## What It Is

Established patterns for React components, hooks, and state management in WhatNext's renderer process. The renderer is a standard React 19 app running in sandboxed Chromium with no direct Node.js access — all system calls go through `window.electron`.

## Key Patterns

### Pattern 1: Reactive RxDB Query in useEffect

The standard pattern for subscribing to a live RxDB query. Always return the unsubscribe cleanup or you get memory leaks and stale updates after unmount.

```typescript
const [playlists, setPlaylists] = useState<PlaylistDocType[]>([]);

useEffect(() => {
    let alive = true;
    let sub: { unsubscribe: () => void } | null = null;

    getDatabase().then((db) => {
        if (!alive) return;
        sub = db.playlists
            .find()
            .sort({ updatedAt: 'desc' })
            .$.subscribe((docs) => {
                if (alive) setPlaylists(docs.map((d) => d.toJSON() as PlaylistDocType));
            });
    });

    return () => {
        alive = false;
        sub?.unsubscribe();
    };
}, []);
```

The `alive` flag guards against the async `getDatabase()` resolving after unmount, which can happen on fast navigation.

### Pattern 2: useRxDBDocument Hook

For subscribing to a single document reactively, `useRxDBDocument` wraps the boilerplate:

```typescript
// Usage
const { doc: playlist, loading } = useRxDBDocument<PlaylistDocType>(
    () => db && playlistId ? db.playlists.findOne(playlistId).exec() : null,
    [db, playlistId]
);
```

The hook returns `{ doc, loading }`. The `doc` is the plain JSON of the RxDB document (`.toJSON()` applied internally), not the RxDocument — safe to pass as props.

### Pattern 3: useDatabase Hook

Provides the RxDB instance and a `loading` flag. Prefer this over calling `getDatabase()` directly in components:

```typescript
const { db, loading } = useDatabase();

useEffect(() => {
    if (!db || !playlistId) return;
    // use db here
}, [db, playlistId]);
```

### Pattern 4: Zustand Stores — Slice Selection

WhatNext uses Zustand for non-persistent UI state. Always select specific slices, never the whole store object, to prevent unnecessary re-renders:

```typescript
// navigation-store: active view, selected playlist, session state
const activeView = useNavigationStore((s) => s.activeView);
const navigate = useNavigationStore((s) => s.navigate);
const sessionState = useNavigationStore((s) => s.sessionState);

// user-store: local user identity
const user = useUserStore((s) => s.user);
const userId = useUserStore((s) => s.userId);
```

### Pattern 5: Dependency Array with Derived Primitive

When a `useEffect` depends on an array field of a document (e.g. `playlist.trackIds`), including the array directly causes infinite re-renders because a new array reference is created each render. Use a stable primitive instead:

```typescript
// Without this, the effect re-runs on every render
useEffect(() => { ... }, [playlist?.trackIds]);            // ❌

// Stable: only re-runs when the joined string changes
useEffect(() => { ... }, [playlist?.trackIds.join(',')]);  // ✅
```

This pattern is used in `SessionView` for the track list subscription.

### Pattern 6: IPC Calls in useEffect

IPC calls are async. Guard against component unmount with a cancelled flag:

```typescript
useEffect(() => {
    let cancelled = false;

    const poll = async () => {
        const result = await window.electron.spotify.getPlaybackState();
        if (cancelled) return;
        setState(result);
    };

    poll();
    const id = setInterval(poll, 5000);

    return () => {
        cancelled = true;
        clearInterval(id);
    };
}, [enabled]);
```

This pattern is used in both `usePlaybackState` and `useTrackSource`.

### Pattern 7: Event Listener Cleanup from Preload

Preload event listeners (push events from main process) return a cleanup function. Always call it:

```typescript
useEffect(() => {
    const cleanup = window.electron.spotify.onAuthComplete(() => {
        setAuthenticated(true);
    });

    return cleanup;  // Removes the ipcRenderer listener on unmount
}, []);
```

### Pattern 8: Session State Hooks

Structured hooks for reading session state without coupling to the store directly:

```typescript
// useSessionState — reads active session for a given playlist
const { sessionState, isActiveSession } = useSessionState(playlistId);

// isActiveSession: sessionState?.status === 'active' && sessionState.playlistId === playlistId
// sessionState: null when not active for this playlist
```

### Pattern 9: RxDB One-Shot Query (exec)

For data needed once (not reactively), use `.exec()` directly — no subscription required:

```typescript
const playlist = await db.playlists.findOne(playlistId).exec();
// Returns RxDocument | null. Call .toJSON() to get plain object.
```

Use this inside service functions and one-time async operations (e.g. in `useTrackSource` inside the poll loop).

### Pattern 10: Conditional Subscription (enabled flag)

Hooks that start/stop polling based on a boolean condition use the `enabled` parameter in the `useEffect` dependency array:

```typescript
export function usePlaybackState(enabled: boolean) {
    useEffect(() => {
        if (!enabled) return;   // ← early return, no cleanup needed
        // ... start polling
        return () => { /* cleanup */ };
    }, [enabled]);
}
```

## Common Pitfalls

### Pitfall 1: Missing alive/cancelled Guard

Skipping the `alive` or `cancelled` flag causes state updates on unmounted components. React 18+ no longer throws for this (it was removed as a warning), but it still indicates a logic error and can cause stale state bugs.

### Pitfall 2: Subscribing to RxDocument Methods

RxDB documents returned from subscriptions are live `RxDocument` objects. Passing them directly as React props is safe for rendering but can cause unexpected behaviour if stored in state (they mutate). Always call `.toJSON()` when storing in `useState`:

```typescript
.$.subscribe((docs) => {
    setItems(docs.map((d) => d.toJSON() as MyDocType));  // ✅
    setItems(docs);  // ❌ — live RxDocument objects in state
});
```

### Pitfall 3: Querying Optional Fields Without an Index

Dexie (RxDB's IndexedDB adapter) cannot index optional fields. Queries on `spotifyId`, `linkedSpotifyId`, etc. do full collection scans. This is acceptable at MVP scale but watch query frequency. See [[RxDB]] — Pitfall 1.

### Pitfall 4: Zustand Outside React

Zustand state can be read outside React (e.g., in service functions) via `.getState()`:

```typescript
import { useUserStore } from '../stores/user-store';

// Inside an async service function (not a component):
const userId = useUserStore.getState().userId;
```

Do not use `useUserStore()` (the hook) outside of React components or custom hooks — it will throw.

### Pitfall 5: Eslint-disable for Intentional Dep Omissions

Some hooks intentionally omit dependencies to avoid re-subscribing on every render (e.g., `config.type` is used instead of the full `config` object in `useTrackSource`). These are marked with `// eslint-disable-next-line react-hooks/exhaustive-deps`. Audit these comments when the hook's logic changes.

## Related Concepts

- [[RxDB]] — Database layer that reactive queries subscribe to
- [[Electron-IPC]] — How `window.electron` calls reach the main process
- [[Sessions]] — Session hooks: `useSessionState`, `useTrackSource`, `usePlaybackState`
- [[Tailwind-v4]] — Styling utilities applied in JSX
- [[UI-Development]] — Renderer development guide
- [[mvp-reality-react-quality]] — React quality audit of the MVP codebase

## References

### Official Documentation

- [React useEffect](https://react.dev/reference/react/useEffect)
- [React 19 Release Notes](https://react.dev/blog/2024/12/05/react-19)
- [Zustand Documentation](https://zustand.docs.pmnd.rs/)
- [RxJS Subscription](https://rxjs.dev/guide/subscription)

### WhatNext Implementation

- Hooks: `app/src/renderer/hooks/`
- Navigation store: `app/src/renderer/stores/navigation-store.ts`
- User store: `app/src/renderer/stores/user-store.ts`
- useDatabase: `app/src/renderer/hooks/useDatabase.ts`
- useRxDBDocument: `app/src/renderer/hooks/useRxDBCollection.ts`
- Session hooks: `useSessionState`, `useTrackSource`, `usePlaybackState`

---

__Status__: Established patterns, in use across all components
__Last Updated__: 2026-03-07


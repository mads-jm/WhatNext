# Coding Standards

#guides/standards

> Living document. Reflects decisions made during MVP development with an eye toward post-MVP extensibility and eventual platform migration.

---

## 1. Architecture Boundaries: Portable Core vs. Shell

WhatNext treats Electron + React as a **replaceable shell** around a **portable core**. The long-term target is Rust/WASM for cross-platform delivery. Standards must protect this boundary.

### Portable Core (framework-agnostic)

Code that must remain decoupled from React and Electron:

| Layer | Location | Rule |
|-------|----------|------|
| Domain types | `app/src/shared/` | No React imports. No Electron imports. Pure TypeScript. |
| Domain constants | `app/src/shared/core/reactions.ts` | Reaction emoji vocabulary. No framework deps. |
| Data schemas | `app/src/renderer/db/schemas.ts` | RxDB-specific but logic is portable. Schema shape is the contract. |
| Services | `app/src/renderer/db/services/` | Pure async functions. No hooks, no UI state, no `window.*` access. |
| Pure utilities | `app/src/renderer/utils/` | Framework-free transforms, aggregations, helpers. |
| Mappers | `app/src/main/spotify/spotify-mapper.ts` | Pure transformations. Zero side effects. |
| P2P protocol | `app/src/shared/core/` | Message types, config, protocol definitions. |
| IPC protocol | `app/src/shared/core/ipc-protocol.ts` | Channel definitions and message shapes. |

**Guiding principle:** If you can't run it in a Rust test harness by reimplementing the same interface, it doesn't belong in core.

### Replaceable Shell (React/Electron-coupled)

| Layer | Location | Coupling accepted |
|-------|----------|-------------------|
| Components | `app/src/renderer/components/` | React |
| Hooks | `app/src/renderer/hooks/` | React |
| Stores | `app/src/renderer/stores/` | Zustand (React) |
| Main process | `app/src/main/main.ts`, `preload.ts` | Electron IPC |
| UI kit | `app/src/renderer/components/UI/` | React + Tailwind |

### Enforcement

- **Review gate:** PRs that add React or Electron imports to `shared/` or `services/` must be flagged.
- **No framework-coupled UI libraries** (Radix, Headless UI, etc.). These are React-only and non-portable. Build accessible primitives manually using Tailwind + ARIA attributes.

---

## 2. Component Standards

### File Structure

- One component per `.tsx` file
- No barrel exports for component folders (direct imports)
- Styles via inline Tailwind classes (no CSS modules, no styled-components)
- Props interface defined at top of file, named `[ComponentName]Props`
- Components are `function` declarations, not arrow functions assigned to `const`

```typescript
interface SessionCardProps {
    session: SessionDocType;
    onJoin: (id: string) => void;
    isActive?: boolean;
}

function SessionCard({ session, onJoin, isActive = false }: SessionCardProps) {
    // ...
}

export default SessionCard;
```

### Component Tiers

**Presentational** — Data in, callbacks out. No hooks except `useState` for ephemeral UI (toggle, hover).
```
P2PPeerCard, TurnIndicator, SessionTrackList, TrackRow
```

**Orchestrators** — Thin routing layer. Consume one hook, dispatch to sub-components based on state.
```
SpotifyImport (routes on import state machine), ViewRouter
```

**Containers** — Compose multiple hooks and subscriptions. Render orchestrators and presentational components.
```
SessionView, PlaylistView
```

### Splitting Guideline (soft threshold)

Consider extracting when a component:
- Exceeds **~150 lines** of logic (excluding JSX template)
- Manages **2+ independent data subscriptions**
- Contains **distinct concerns** that change for different reasons

This is guidance, not a hard rule. A 200-line component with one cohesive concern is fine. A 100-line component doing two unrelated things should split.

### Callback Naming

- Props: `on[Action]` — `onConnect`, `onRemoveTrack`, `onParticipantRenamed`
- Optional callbacks: always marked with `?`
- Handler functions inside components: `handle[Action]` — `handleConnect`, `handleRemoveTrack`

---

## 3. State Management: Three-Tier Model

### Tier 1: Zustand — Cross-Component Global State

**For:** State shared across unrelated component trees.

| Store | Purpose |
|-------|---------|
| `navigation-store` | Active view, selected playlist, session state |
| `user-store` | Current user identity, loading state |
| `database-store` | RxDB instance, initialization |
| `debug-log-store` | Dev diagnostics |

**Rules:**
- Zustand stores hold **UI state only** — never cache RxDB documents
- Use selectors to minimize re-renders: `useNavigationStore((s) => s.activeView)`
- Actions are methods on the store, not external functions
- Stores must be idempotent on double-init (guard with `if (get().db) return`)

### Tier 2: useReducer — Complex Local Flows

**For:** State machines with **>4 states** scoped to a component tree.

Examples: import wizard, connection handshake, session setup flow.

```typescript
type ImportState =
    | { status: 'idle' }
    | { status: 'connecting' }
    | { status: 'loading-playlists' }
    | { status: 'browsing'; playlists: SpotifyPlaylist[] }
    | { status: 'loading-tracks'; playlistId: string }
    | { status: 'selecting'; tracks: MappedTrack[] }
    | { status: 'importing'; progress: number }
    | { status: 'done'; playlistId: string }
    | { status: 'error'; message: string };

type ImportAction =
    | { type: 'START_AUTH' }
    | { type: 'PLAYLISTS_LOADED'; playlists: SpotifyPlaylist[] }
    | { type: 'IMPORT_FAILED'; message: string }
    // ...

function importReducer(state: ImportState, action: ImportAction): ImportState {
    // Exhaustive switch on action.type
}
```

**Why not Zustand here:** These flows are instance-scoped. Promoting them to a global store leaks ephemeral state and requires manual cleanup.

**Why not useState strings:** Reducers make transitions explicit, states exhaustive, and the logic unit-testable in isolation.

### Tier 3: useState — Simple Ephemeral UI

**For:** Toggles, input values, modal open/close, hover state, expanded sections.

```typescript
const [isEditing, setIsEditing] = useState(false);
const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
```

No `useState` for anything with more than 4 possible values or complex transitions.

---

## 4. Hooks

### Naming

`use[Feature][Domain].ts` — `useSpotifyImport`, `usePlaybackState`, `useP2PDevStatus`

### Categories

| Pattern | Purpose | Example |
|---------|---------|---------|
| **Data subscription** | RxDB reactive query → `{data, loading, error}` | `useRxDBQuery`, `useRxDBDocument` |
| **State machine** | Complex flow with useReducer | `useSpotifyImport` |
| **Polling** | Interval-based refresh with cleanup | `usePlaybackState` |
| **Derived state** | Thin computation over store/db state | `useSessionState` |
| **Side-effect bridge** | IPC calls + event listener setup | `useP2PDevStatus`, `useCompanionBridge` |

### Data Access Rule

**All data operations go through hooks.** Components never import services directly.

- Reads and subscriptions: via data subscription hooks
- Mutations: wrapped in hooks that manage loading/error state
- One-shot fire-and-forget: still wrapped in a hook, even if the hook is thin

**Why:** Testability (mock the hook, not the service), consistent error handling, and a single place to add loading/optimistic update logic later.

### Return Shape

All data hooks return the triple:

```typescript
{ data: T, loading: boolean, error: Error | null }
```

Action hooks return the action + status:

```typescript
{ execute: (...args) => Promise<void>, loading: boolean, error: Error | null }
```

### Cleanup

- RxDB subscriptions: use `alive` flag pattern to prevent post-unmount updates
- Polling: clear intervals on unmount
- Event listeners: return unsubscribe function from `useEffect`

```typescript
useEffect(() => {
    let alive = true;
    const sub = query.$.subscribe((results) => {
        if (alive) setData(results);
    });
    return () => { alive = false; sub.unsubscribe(); };
}, [deps]);
```

### Memoization

- `useCallback` for action functions returned from hooks (stable references)
- `useMemo` / `React.memo` only when profiling shows a measurable problem
- Don't memoize preemptively

---

## 5. Services & Data Layer

### Service Functions

Services are **pure async functions** in `app/src/renderer/db/services/`. They:
- Accept typed input objects (`CreateTrackInput`, `UpdatePlaylistInput`)
- Return RxDB documents or null
- Generate IDs (`uuidv4()`) and timestamps internally
- Use `$set` operator for updates
- Never access React state, hooks, or `window.*`

```typescript
export async function createTrack(input: CreateTrackInput): Promise<TrackDocument> {
    const db = await getDatabase();
    const doc: TrackDocType = {
        id: uuidv4(),
        ...input,
        addedAt: input.addedAt ?? new Date().toISOString(),
    };
    return db.tracks.insert(doc);
}
```

### Database Access

- Singleton via `getDatabase()` — lazily initialized, idempotent
- No dependency injection — direct import of `getDatabase()`
- RxDB queries return observables, not data — components subscribe via hooks

### Schema Conventions

- Doc types: `[Entity]DocType` — `TrackDocType`, `PlaylistDocType`
- Documents: `[Entity]Document` — RxDB document wrapper
- Collections: `[Entity]Collection`
- Primary keys: UUID strings
- Timestamps: ISO 8601 strings (`createdAt`, `updatedAt`)
- Foreign keys: `[entity]Id` suffix — `ownerId`, `addedBy`
- Asset URLs: dual-field pattern — `albumArtUrl` (remote) + `albumArtLocalPath` (local cache)

### Schema Versioning

- Increment version on any field addition/removal/rename
- Migration strategies handle each version step explicitly
- New optional fields default to `undefined` in migrations
- Never delete data in migrations without a documented reason

### P2P Integration

Services that modify P2P-replicated collections accept an optional `ReplicationSink` callback to push changes to peers. The sink is **injected by the caller** (a component or hook in the shell layer), keeping services decoupled from `window.electron`:

```typescript
import type { ReplicationSink } from '../../../shared/core/types';

export async function createComment(
    input: CreateCommentInput,
    replicationSink?: ReplicationSink,
): Promise<CommentDocument> {
    const doc = await db.comments.insert(comment);
    await replicationSink?.('comments', [{ id, data, updatedAt }]);
    return doc;
}
```

The shell layer imports `pushLocalChanges` from `replication-handler.ts` and passes it:

```typescript
import { pushLocalChanges } from '../../db/replication-handler';
await createComment(input, pushLocalChanges);
```

**Why injection:** Services must never access `window.*`. The `ReplicationSink` type (`shared/core/types.ts`) is the portable contract — any future runtime (Rust/WASM) implements the same signature.

### Soft Deletes

Collections replicated over P2P use `isDeleted: boolean` for tombstoning, not physical deletion.

---

## 6. Error Handling

### Main Process (IPC Handlers)

Every handler returns a consistent result shape:

```typescript
// Success
{ success: true, playlists: [...], total: 42 }

// Failure
{ success: false, error: 'Human-readable message' }
```

- Wrap handler body in try/catch
- Convert errors to strings: `String(error)`
- Log to console with `[Main]` prefix before returning

### Renderer (Hooks)

All hooks surface errors — never swallow silently.

**Data hooks** return the triple: `{ data, loading, error }`

**Action hooks** manage error state internally and expose it:

```typescript
const [error, setError] = useState<string | null>(null);
const execute = useCallback(async () => {
    setError(null);
    try { /* ... */ }
    catch (err) { setError(String(err)); }
}, []);
return { execute, error, loading };
```

### User-Facing Errors

User-visible errors go through a **centralized toast/notification system** (to be built as part of UI kit).

- Transient errors (network timeout, API rate limit): toast with auto-dismiss
- Permanent errors (auth failure, corrupt data): persistent notification with action
- Dev diagnostics: route to `debug-log-store`, not shown to users in production

### Debug Logging

Development-only diagnostics use the debug log store:

```typescript
useDebugLogStore.getState().addLog('error', 'P2P connection failed', details);
```

---

## 7. Styling

### Approach

Pure Tailwind CSS. No CSS modules, no styled-components, no framework-coupled UI libraries.

**Why no Radix/Headless UI:** These are React-only. Given the Rust/WASM migration path, avoid dependencies that don't survive a framework change. Tailwind is framework-agnostic.

### Internal UI Kit

Build thin, reusable components in `app/src/renderer/components/UI/` using Tailwind + ARIA attributes for accessibility.

**Extraction rule:** Organic. Extract a kit component when duplication becomes painful — no fixed threshold. Trust developer judgment.

**Kit components own their Tailwind classes.** Consumers pass data and callbacks, not class overrides.

```typescript
// Good: kit component encapsulates styling
<StatusBadge status="active" label="In Session" />

// Avoid: consumer overriding kit styles
<StatusBadge className="bg-red-500 text-white" />
```

### Accessibility

Since we're not using a headless UI library, interactive primitives (modals, dropdowns, tabs) must manually implement:
- ARIA roles and attributes
- Keyboard navigation (arrow keys, Escape, Enter)
- Focus management (trap focus in modals, restore on close)

Document a11y patterns in the kit component itself.

### Dark Mode

Class-based (`darkMode: 'class'` in Tailwind config). Use `dark:` variant prefix. Toggle mechanism TBD.

---

## 8. Types & Imports

### Type Location

| Scope | Location |
|-------|----------|
| Cross-process contracts (IPC messages, P2P payloads) | `app/src/shared/` — **always** |
| Domain types used by both main and renderer | `app/src/shared/` |
| RxDB doc types, input types, view models | `app/src/renderer/db/types.ts` |
| Component props | Co-located in the component file |
| Hook-internal types | Co-located in the hook file |

**Rule:** If a type crosses the main/renderer boundary, it lives in `shared/`. If a renderer type *happens* to match a main type but isn't used across the boundary, it stays co-located — don't force it into shared.

### Type Conventions

- Use `interface` for object shapes (enables declaration merging)
- Use `type` for unions, intersections, and aliases
- Input types are sparse (optional fields with defaults applied in service)
- Doc types are complete (all fields required or explicitly optional)
- View models flatten relational data for UI rendering

### Import Style

- **Services:** Barrel export via `services/index.ts` — import from barrel
- **Shared types:** Barrel export via `shared/core/index.ts` — import from barrel
- **Components:** Direct file imports — no barrel exports
- **Hooks:** Direct file imports — no barrel exports

**Why selective barrels:** Stable API surfaces (services, shared types) benefit from clean imports. Components and hooks change frequently — barrels add indirection and circular dependency risk.

### Path Aliases

Use configured aliases for cleaner imports:

```typescript
import { TrackDocType } from '@renderer/db/schemas';
import { getAssetPath } from '@assets/utils';
```

---

## 9. IPC Communication

### Channel Naming

`domain:action` in kebab-case — `spotify:get-playlists`, `p2p:connect`, `artwork:download`

Constants defined in `shared/core/ipc-protocol.ts` as `IPC_CHANNELS` enum.

### Preload API Surface

Grouped by domain namespace on `window.electron`:

```typescript
window.electron.spotify.getPlaylists()
window.electron.p2p.connect(peerId)
window.electron.artwork.download(url)
```

**Rules:**
- Every IPC channel has a typed handler in main and a typed method in preload
- Event subscriptions return an unsubscribe function
- Keep the IPC surface minimal — don't expose internal main process APIs
- No direct `ipcRenderer` access in renderer — always through preload

### Main → Renderer Events

Use `mainWindow.webContents.send()` for push events (peer discovered, auth complete). Preload wraps these as `on[Event]` methods returning cleanup functions.

---

## 10. Testing Strategy

### Test Pyramid

| Level | Scope | Tool | Priority |
|-------|-------|------|----------|
| **Unit** | Pure functions: mappers, helpers, reducers, turn logic | Vitest | High — validate core logic |
| **Integration** | Services against in-memory RxDB | Vitest | High — validate data operations |
| **Component** | React components with mocked hooks | React Testing Library + Vitest | Medium |
| **E2E** | Critical user flows end-to-end | Playwright | High — validate user experience |

### E2E: Page Object Model

E2E tests use the **Page Object Model (POM)** pattern to keep frontend implementation changes from breaking tests.

```typescript
// pages/session-page.ts
class SessionPage {
    constructor(private page: Page) {}

    async joinSession(code: string) {
        await this.page.getByLabel('Session code').fill(code);
        await this.page.getByRole('button', { name: 'Join' }).click();
    }

    async getParticipantCount(): Promise<number> {
        return this.page.getByTestId('participant-roster').locator('li').count();
    }
}

// tests/session-flow.spec.ts
test('participant can join session', async ({ page }) => {
    const session = new SessionPage(page);
    await session.joinSession('ABC123');
    expect(await session.getParticipantCount()).toBe(2);
});
```

**Rules:**
- POMs live in `e2e/pages/`
- Tests never use raw selectors — always go through POMs
- POMs use accessible selectors (`getByRole`, `getByLabel`) over test IDs where possible
- Test IDs (`data-testid`) are acceptable for complex composite components

### Test File Location

```
app/src/**/__tests__/*.test.ts      # Unit + integration tests (co-located)
app/e2e/tests/*.spec.ts             # E2E tests
app/e2e/pages/*.ts                  # Page Object Models
```

### What Must Be Tested

- **Always:** Reducers, mappers, pure helpers, service CRUD operations
- **Before merge:** Critical user flows via E2E (import, session join, playback)
- **Encouraged:** Hook behavior via React Testing Library
- **Optional:** Presentational component snapshots

---

## 11. Naming Conventions

| Entity | Convention | Example |
|--------|-----------|---------|
| Components | PascalCase `.tsx` | `SessionView.tsx` |
| Props | `[Component]Props` interface | `SessionViewProps` |
| Hooks | `use[Feature][Domain].ts` | `useSpotifyImport.ts` |
| Services | `[domain]-service.ts` | `playlist-service.ts` |
| Stores | `[domain]-store.ts` | `navigation-store.ts` |
| Types | `[Entity]DocType`, `[Entity]Document` | `TrackDocType` |
| Input types | `Create[Entity]Input`, `Update[Entity]Input` | `CreateTrackInput` |
| IPC channels | `domain:action` kebab-case | `spotify:get-playlists` |
| Test files | `*.test.ts` (unit/integration), `*.spec.ts` (E2E) | `mapper.test.ts` |

### Functions

- Service functions: `verb[Entity]` — `createTrack`, `updatePlaylist`, `bulkImportTracks`
- Hook actions: `verb[Object]` — `loadPlaylists`, `importSelected`
- Component handlers: `handle[Action]` — `handleConnect`, `handleRemoveTrack`
- Props callbacks: `on[Action]` — `onConnect`, `onRemoveTrack`

---

## 12. Code Style

Enforced by tooling — not subject to review debate.

- **Prettier:** Single quotes, 4-space indentation
- **TypeScript:** Strict mode. No `any` where avoidable. Explicit return types on exported functions.
- **ESLint:** React hooks + refresh plugins. No custom overrides without team discussion.
- **Comments:** Self-documenting code with good naming. Only comment the *why*, never the *what*. No JSDoc unless intent is genuinely non-obvious.
- **Commits:** Conventional Commits — `type(scope): summary` (see CLAUDE.md for details)

---

## 13. Post-MVP Considerations

These are not current standards but architectural directions the codebase should not conflict with.

### Monorepo Tooling

`app/`, `relay/`, `service/` will likely move to Nx or Turborepo for shared builds, dependency graph management, and build caching. Standards today should:
- Keep package boundaries clean (no cross-package imports outside `shared/`)
- Maintain independent `package.json` per workspace

### Storybook

Component development in isolation is planned. Standards today should:
- Keep presentational components pure (easy to render in Storybook)
- UI kit components are natural Storybook entries
- Avoid components that can only render inside a specific provider tree

### Plugin Architecture

Obsidian-inspired extensibility is a Phase 3 goal. Standards today should:
- Keep the UI kit as a composable surface plugins could consume
- Maintain clear service boundaries (plugins call services, not RxDB directly)
- Avoid god-components that bundle too many concerns

### Rust/WASM Migration

The portable core boundary (Section 1) is the primary preparation. Additionally:
- Core logic should be expressible as pure functions with typed inputs/outputs
- Avoid patterns that deeply couple to React's render cycle (e.g., hooks that do domain logic)
- Data schemas are the contract — keep them clean and well-documented

---

## Related Documents

- [[CLAUDE.md]] — Project overview, build commands, commit conventions
- [[architecture-whatnext]] — System architecture
- [[srs-whatnext]] — Software Requirements Specification
- [[workflow-story-to-pr]] — Development workflow

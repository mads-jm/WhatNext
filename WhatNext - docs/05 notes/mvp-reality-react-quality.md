# MVP Reality Check: React Quality & Best Practices

#architecture/review #react #quality

**Date**: 2026-03-15
**Scope**: Full renderer codebase audit

## Executive Summary

The codebase is in surprisingly good shape for an MVP. Component decomposition follows a clean orchestrator-plus-sub-component pattern, Zustand stores are well-scoped, and the RxDB reactive layer is used consistently. The biggest structural risks are: SessionView carrying too much orchestration logic (160+ lines of hooks and derived state before the JSX), PlaylistView at 426 lines doing the same, zero error boundaries anywhere, no React.StrictMode, and a total absence of component-level tests. The foundation is solid, but the "thick orchestrator" pattern will become a maintenance liability as features grow.

## Component Architecture

### Current State

The codebase uses a clear pattern: orchestrator components (SessionView, SpotifyImport, P2PStatus) coordinate state while delegating rendering to focused sub-components (SessionTrackList, TurnIndicator, PlaybackBar). This is good practice. The Spotify import flow is a textbook example of state-machine-driven decomposition -- `useSpotifyImport` owns the state machine, `SpotifyImport.tsx` routes to the correct sub-component, and each sub-component is purely presentational.

Component count: ~45 `.tsx` files. Most are reasonably sized (under 150 lines). Sub-components like TurnIndicator, SessionEmptyState, SessionHeader, SessionInfoBar, and TrackEndingWarning are well-extracted and focused.

### Issues Found

1. **SessionView is a god-orchestrator** (`app/src/renderer/components/Session/SessionView.tsx`). Lines 34-191 contain 7 separate `useEffect` hooks, 5 `useState` calls, and multiple derived computations before any JSX renders. The component directly calls `getDatabase()` in 4 places, manually subscribes to RxDB observables, and manages playlist, tracks, participants, and turn state all in one place. This is the single largest technical debt item.

2. **PlaylistView is similarly overloaded** (`app/src/renderer/components/Playlist/PlaylistView.tsx`, 426 lines). It mixes track table rendering, export dropdown, turn management panel, comment thread, context menus, and Spotify sync status into one component. The track table alone (lines 302-401) should be its own component.

3. **No error boundaries anywhere.** Not in `App.tsx`, not wrapping ViewRouter, not around any async-heavy component. A single RxDB query failure or Spotify API error in SessionView will crash the entire app.

4. **No React.StrictMode** in `index.tsx` (line 11). This means double-render bugs and missing cleanup won't surface during development.

5. **No Suspense boundaries.** The database is loaded asynchronously in App.tsx's useEffect, but there's no Suspense wrapping -- instead, individual components check `loading` states independently, creating a patchwork of loading UIs.

6. **Duplicated artwork rendering pattern.** The same `artSrc()` + `<img onError>` + fallback `<div>` pattern appears in at least 6 files: SessionTrackList.tsx:81-94, PlaylistList.tsx:93-104, PlaylistView.tsx:157-168, LibraryView.tsx:230-242, ParticipantRoster.tsx:75-88, SessionInfoBar.tsx:30-43. This should be an `<ArtworkImage>` component.

7. **TurnManagementPanel at 409 lines** (`app/src/renderer/components/Playlist/TurnManagementPanel.tsx`) contains 3 inline sub-components (ConfigField, NumberInput, DurationInput), turn derivation logic, and the full management UI. The inline components are good candidates for extraction to a shared UI directory.

8. **Modal implementation is inconsistent.** CreatePlaylistDialog, TurnSetupModal, and TrackPickerModal each implement their own backdrop + centering + click-outside logic. There is a `ModalPortal.tsx` file that exists but is not used by any of them.

### Recommendations

- Extract a `usePlaylistData(playlistId)` hook from SessionView that handles the 4 RxDB subscriptions (playlist, tracks, participants, turn user) and returns a clean data object.
- Extract an `<ArtworkImage>` component to eliminate the 6-way duplication.
- Add an `<ErrorBoundary>` wrapper around ViewRouter at minimum; ideally one per major view.
- Add `<React.StrictMode>` to `index.tsx`.
- Extract track table from PlaylistView into its own `<PlaylistTrackTable>` component.
- Standardize modal rendering by using ModalPortal or a shared `<Modal>` wrapper.

## State Management

### Current State

Four Zustand stores, each well-scoped:
- `navigation-store.ts`: View routing, session state, dialog visibility. ~95 lines.
- `database-store.ts`: RxDB singleton wrapper. ~32 lines.
- `user-store.ts`: Local user identity with RxDB reactive subscription. ~102 lines.
- `debug-log-store.ts`: Ring buffer for P2P debug logs. ~32 lines.

The Zustand usage is disciplined -- every `useNavigationStore` call uses a selector function to minimize re-renders (e.g., `useNavigationStore((s) => s.activeView)`). This is correct practice.

### Issues Found

1. **Session state lives in navigation-store but deserves its own store.** `SessionState` (including `trackSource`, `playbackProvider`, `participantIds`, `hostId`, `coHostIds`, `playbackOwnerId`) is ephemeral session state mixed into what is conceptually a navigation concern. `navigation-store.ts` lines 63-76 show `startSession` setting 8 fields at once. This coupling means any component needing session data must also subscribe to the navigation store.

2. **SessionView duplicates RxDB state into local useState.** Lines 45-48 of SessionView create local `useState` for `playlist`, `tracks`, `participants`, and `currentTurnUser` -- all of which are already available reactively from RxDB. This creates a secondary state source that can drift. The same pattern appears in PlaylistView lines 74-98.

3. **usePlaybackState polls at 3-second intervals** (`app/src/renderer/hooks/usePlaybackState.ts:10`) regardless of whether the user is looking at the session or doing something else. The polling continues as long as `enabled` is true, which is tied to session activity, not visibility. For battery/CPU efficiency this should use `document.visibilityState`.

4. **useP2PStatus uses recursive setTimeout** (`app/src/renderer/hooks/useP2PStatus.ts:33`) instead of setInterval, which means poll timing drifts by the duration of each poll call. More importantly, the `useP2PDevStatus` hook (used by P2PStatus.tsx) has a 1-second poll interval that creates significant overhead.

5. **StorageSettings uses localStorage directly** (`app/src/renderer/components/Settings/StorageSettings.tsx:8-9`) instead of RxDB or Zustand. This is the only place in the app that uses localStorage, creating an inconsistent persistence pattern.

### Recommendations

- Extract `SessionState` into its own `session-store.ts`.
- Replace the manual RxDB subscriptions in SessionView/PlaylistView with custom hooks that return reactive data (leverage `useRxDBQuery` which already exists).
- Add visibility-based polling to `usePlaybackState` and `useP2PStatus`.
- Move StorageSettings preferences into Zustand or RxDB for consistency.

## TypeScript Quality

### Current State

Type safety is generally strong. The `app/src/renderer/db/types.ts` file establishes a clean separation between doc types (from schemas), view models (TrackViewModel), and input types (CreatePlaylistInput, UpdatePlaylistInput, etc.). The shared interfaces in `app/src/shared/session-interfaces.ts` are well-designed discriminated unions.

### Issues Found

1. **`any` usage in database.ts migration strategies** (`app/src/renderer/db/database.ts:93,110,134,145,149,155`). Every migration function takes `oldDoc: any`. This is somewhat unavoidable for RxDB migrations, but the migration return values could be typed.

2. **`as any` casts in useSessionReplication** (`app/src/renderer/hooks/useSessionReplication.ts:53,113,142`). The `(db as any)[col]` pattern bypasses type checking when accessing collections dynamically. A typed helper function would be safer.

3. **`as unknown as` double-cast pattern** in user-store.ts (line 66: `updated as unknown as UserDocType`) and useRxDBCollection.ts (line 74: `latest as unknown as RxDocument<T>`). These indicate a type mismatch between RxDB's runtime emission types and the declared types. Should be investigated and resolved with proper generic constraints.

4. **`toggleReaction` in PlaylistView accepts `playlistId!`** (line 113 of PlaylistView.tsx). The non-null assertion is safe in context but masks the fact that the function is called inside a closure where `playlistId` is already validated. Restructuring the component would eliminate the need.

5. **`input.ownerId!` non-null assertion** in `playlist-service.ts:35`. The `CreatePlaylistInput.ownerId` is typed as `string | undefined` but always required at runtime. The type should be `string` with no `?`.

6. **`input.addedBy!` non-null assertion** in `track-service.ts:28,130`. Same issue -- `CreateTrackInput.addedBy` is optional in the type but required at runtime.

7. **Reaction metadata stored as JSON string** (`TrackInteractionDocType.metadata` is `string`). This means every reaction read requires `JSON.parse` (seen in `useReactions.ts:54-58`). A typed `metadata` field or a separate `reactionEmoji` column would be safer.

### Recommendations

- Make `CreatePlaylistInput.ownerId` and `CreateTrackInput.addedBy` required (non-optional) to eliminate the `!` assertions.
- Create a typed collection accessor that replaces `(db as any)[col]` with a proper typed lookup.
- Consider adding a `reactionEmoji` field to TrackInteractionDocType instead of encoding it in a JSON string.

## Testing Readiness

### Current State

**Test coverage is minimal.** Three test files exist:
- `app/src/renderer/utils/__tests__/format.test.ts` -- 14 test cases for format utilities. Well-written.
- `app/src/renderer/services/export/__tests__/markdown-formatter.test.ts` -- 16 test cases for markdown export. Well-written with proper mocking.
- `app/src/renderer/services/export/__tests__/html-formatter.test.ts` -- exists (presumably similar).

**No component tests.** Zero `*.test.tsx` files exist. No React Testing Library, no snapshot tests, no interaction tests.

**No E2E tests.** No Playwright or Cypress configuration found.

The components are moderately testable -- the use of hooks for logic extraction (useSpotifyImport, usePlaybackState, useComments, etc.) means business logic can be tested independently from rendering. However, the direct `getDatabase()` calls scattered throughout SessionView and PlaylistView make those components hard to test without mocking the entire database layer.

### Critical User Flows for E2E

1. **Spotify Import Flow**: Auth gate -> playlist browser -> track selector -> import -> playlist created. This is the primary onboarding funnel and touches every layer: IPC, RxDB, navigation store.

2. **Session Lifecycle**: Open playlist -> enable collaborative -> open session -> configure (track source, playback, participants) -> start session -> end session. This exercises the most complex state machine in the app.

3. **Turn-Taking Complete Cycle**: Start turn-taking session -> user adds tracks (tracks appear in list) -> turn advances -> mark complete -> reopen. This is the core collaborative mechanic.

4. **Playlist CRUD + Export**: Create playlist -> add tracks from library -> export to markdown -> verify file contents. Tests the full data pipeline from creation to output.

5. **P2P Connection + Replication**: Start P2P node -> connect to test peer -> verify replication changes flow bidirectionally. This is the hardest to test but also the highest-risk feature.

### Recommendations

- Add Vitest component tests for the most logic-heavy hooks: `useSpotifyImport`, `useTrackSource`, `usePlaybackState`, `useComments`.
- Add React Testing Library tests for the state-machine-driven flows: SpotifyImport routing, SessionView setup-vs-active branching.
- Set up Playwright for the 5 critical flows listed above.
- Refactor `getDatabase()` usage in components to use the `useDatabase()` hook consistently, making mocking easier.

## Hook Quality

### Current State

Custom hooks are well-structured and follow React conventions. `useRxDBQuery` and `useRxDBDocument` are clean generic hooks for reactive data. `useSpotifyImport` is an excellent example of extracting a complete state machine from a component. `useContextMenu`, `useAddToPlaylist`, and `useComments` are focused and reusable.

### Issues Found

1. **eslint-disable for exhaustive-deps** appears in 4 places:
   - `SessionView.tsx:101` -- `playlist?.trackIds.join(',')` as dependency. This is a legitimate workaround for array reference instability but the comment should explain why.
   - `SessionView.tsx:126` -- `sessionState?.participantIds.join(',')` same pattern.
   - `useTrackSource.ts:315` -- `config.type` is used but `config` is destructured; `onNewTracks` is excluded from deps, which means the callback reference can go stale.
   - `TurnManagementPanel.tsx:155` -- `[turnQuotaFull, isComplete, playlist.id]` deps with eslint disabled. The disable is correct here.

2. **`useP2PDevStatus` has empty dependency array** (`app/src/renderer/hooks/useP2PDevStatus.ts:95`, `useEffect(fn, [])`). The effect references `status.nodeStarted` (line 52) to compare against previous state, but `status` is not in the deps array. This means the "Node started" log will only fire if the node starts before the first poll completes.

3. **`onNewTracks` callback excluded from deps in useTrackSource** (`app/src/renderer/hooks/useTrackSource.ts:316`). If the parent re-renders with a new `onNewTracks` callback, the old one will be used. This should use `useRef` for the callback.

4. **`useRxDBQuery` and `useRxDBDocument` accept raw deps arrays** (`app/src/renderer/hooks/useRxDBCollection.ts:17,56`). The `deps` parameter is typed as `unknown[]` and passed directly to `useEffect`. ESLint cannot validate these deps, so callers can silently omit dependencies. This is a footgun.

5. **`formatTime` is defined inside PlaybackBar's render function** (`app/src/renderer/components/Session/PlaybackBar.tsx:79-83`). It is recreated on every render. Should be extracted to module scope or the shared `format.ts` utility.

6. **Duplicate `formatTimeAgo`** exists in both `app/src/renderer/utils/format.ts` and `app/src/renderer/components/Social/CommentItem.tsx:125-134`. The CommentItem version is identical in logic.

### Recommendations

- Extract the stale callback issue in `useTrackSource` by storing `onNewTracks` in a ref.
- Fix `useP2PDevStatus` deps or use a ref to track previous node state.
- Consolidate `formatTimeAgo` -- CommentItem should import from `utils/format.ts`.
- Move `formatTime` out of PlaybackBar render scope.
- Consider making `useRxDBQuery` use `useMemo` for the query factory to get proper dep checking.

## Performance Concerns

1. **ReactionBar renders per-track, each with its own RxDB subscription.** In SessionTrackList (line 111) and PlaylistView (line 354), every track in the list creates a `useReactions` hook that subscribes to a separate RxDB query. A playlist with 50 tracks creates 50 active subscriptions. Consider batching reactions at the playlist level. (`app/src/renderer/components/Social/ReactionBar.tsx:18`)

2. **`artSrc()` called twice in SessionTrackList** (lines 81 and 83). The first call is for the conditional check, the second for the `src` attribute. Should compute once and reuse. (`app/src/renderer/components/Session/SessionTrackList.tsx:81,83`)

3. **ParticipantRoster does O(n*m) work per render** (line 64: `tracks.filter((t) => t.addedBy === p.id)` inside a `.map()` over participants). For 10 participants and 200 tracks, this is 2000 comparisons per render. Should pre-compute a `Map<userId, count>`. (`app/src/renderer/components/Session/ParticipantRoster.tsx:64`)

4. **PlaylistView loads all tracks non-reactively** (line 80: `findTrackViewModels(db, trackIds).then(setTracks)`). This is a one-shot load that will not update if tracks change (e.g., artwork download completes). The playlist subscription triggers re-fetches, but only when `trackIds` changes -- not when individual track documents update. (`app/src/renderer/components/Playlist/PlaylistView.tsx:80`)

5. **`useTrackSource` polls every 2 seconds** (`app/src/renderer/hooks/useTrackSource.ts:27`) even when the app is minimized or the user is on a different view. Combined with `usePlaybackState` at 3 seconds, an active session generates ~50 IPC calls per minute.

6. **LibraryView subscribes to ALL tracks** (`app/src/renderer/components/Library/LibraryView.tsx:49`) and converts every document to JSON on every change. For a large library (1000+ tracks), this means serializing the entire collection on any single track update. Pagination or virtualization is needed.

7. **`handleSpotifyLink` in ProfileSettings** (`app/src/renderer/components/Settings/ProfileSettings.tsx:97-118`) is defined but never called -- dead code.

## Priority Refactors

1. **Add ErrorBoundary around ViewRouter** -- prevents app-wide crashes from individual view errors. Effort: low. Impact: high.

2. **Extract `useSessionData(playlistId)` hook** from SessionView -- consolidates the 4 RxDB subscriptions and derived turn state into a single hook. Reduces SessionView from ~320 lines to ~150. Effort: medium. Impact: high.

3. **Create `<ArtworkImage>` component** -- eliminates 6-way code duplication. Effort: low. Impact: medium.

4. **Add visibility-based polling** to usePlaybackState and useTrackSource -- reduces battery/CPU impact. Effort: low. Impact: medium.

5. **Batch ReactionBar queries** -- fetch all reactions per playlist instead of per track. Effort: medium. Impact: high for large playlists.

6. **Split PlaylistView** -- extract track table into `<PlaylistTrackTable>`, export dropdown into `<ExportMenu>`. Effort: medium. Impact: medium.

7. **Add React.StrictMode** to index.tsx -- catches cleanup bugs during development. Effort: trivial. Impact: medium.

8. **Standardize modal pattern** -- use ModalPortal or create a shared `<Modal>` component. Effort: low. Impact: low.

9. **Add component tests for state-machine hooks** -- useSpotifyImport, useTrackSource, usePlaybackState. Effort: medium. Impact: high (prevents regression in most complex logic).

10. **Extract session state into dedicated Zustand store** -- cleaner separation of concerns, easier testing. Effort: medium. Impact: medium.

## Related Concepts

- [[React]]
- [[Zustand]]
- [[RxDB]]
- [[Electron-IPC]]
- [[P2P]]

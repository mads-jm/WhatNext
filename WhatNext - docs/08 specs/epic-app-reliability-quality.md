---
tags:
  - specs/quality
  - architecture/review
  - ux/react
status: draft
date created: 2026-06-27
date modified: 2026-06-27
---

# Epic: App Reliability & Quality

**Status**: Draft
**GitHub**: #49, #50, #48, #26, #22
**Depends on**: none (cross-cutting; do alongside feature epics)
**Source audit**: [[report-260627-mvp-state-of-the-union]] §5, [[mvp-reality-react-quality]]

> WhatNext's renderer is in good structural shape for an MVP, but it has no safety net: a single unhandled RxDB query or Spotify API error crashes the whole app (no error boundaries, no `StrictMode`), the largest orchestrator components duplicate RxDB state into local `useState`, there are zero component or E2E tests, the service-layer CRUD that backs every playlist is untested, and electron-builder is configured but no distributable has ever been built and smoke-tested. This epic is the cross-cutting hardening that keeps regressions visible and crashes contained while the feature epics move forward.

## Problem & Current State

The renderer is ~45 `.tsx` components following a clean orchestrator-plus-sub-component pattern, with disciplined Zustand selectors and a consistent RxDB reactive layer ([[mvp-reality-react-quality]] §Component Architecture). What it lacks is *resilience and verification infrastructure*:

- **No crash containment.** There are no React error boundaries anywhere — not in `App.tsx`, not around the view router — and no `React.StrictMode`. `app/src/renderer/index.tsx:11` renders a bare `<App />`. One throw in a deep async component takes down the entire window.
- **Thick orchestrators duplicate reactive state.** `SessionView.tsx` runs five `useEffect` subscriptions, calls `getDatabase()` directly in four places, and mirrors RxDB into five local `useState` slots (`playlist`, `tracks`, `participants`, `currentTurnUser`, `showSharePanel`). `PlaylistView.tsx` (~426 lines) repeats the smell. This secondary state source can drift and makes both components hard to test.
- **No behavioural tests.** Vitest covers a handful of pure utilities and protocol/IPC units, but there are **zero** component tests and the Playwright scaffold is empty.
- **Untested data layer.** `playlist-service.ts` and `track-service.ts` — the CRUD that every playlist mutation flows through — have no tests, and carry non-null-assertion footguns (`input.ownerId!`, `input.addedBy!`).
- **Never packaged.** `electron-builder` is configured and `npm run package` exists, but no installer has been produced or launched on any platform, so packaged-build path resolution (OAuth callback, companion server, static resources) is unverified.

## Goals

- Contain renderer crashes so a failure in one view degrades gracefully instead of white-screening the app.
- Surface development-time correctness bugs (double-invoke, missing cleanup) via `StrictMode`.
- Make RxDB-backed orchestrators testable by consolidating their subscriptions into reusable hooks.
- Establish an executable regression net for the five critical user flows and the service-layer CRUD.
- Prove the packaged app boots and works end-to-end on all three target platforms.

## Non-Goals

- The broader refactor backlog from [[mvp-reality-react-quality]] (`<ArtworkImage>` dedup, modal standardisation, `session-store` extraction, visibility-based polling, `ReactionBar` batching). Worthwhile, but tracked separately — this epic is reliability-and-verification, not aesthetic cleanup.
- CRDT migration, replication-protocol changes, or anything under the `CLAUDE.md` Agentic Work Policy P2P off-limits list. E2E *exercises* replication; it does not modify it.
- New product features. This epic adds no user-visible capability beyond graceful error recovery.

## Proposed Approach

Sequence by cost-to-impact ratio. Error boundaries and `StrictMode` are nearly free and immediately stop the worst failure mode, so they go first. The `useSessionData` extraction both reduces debt and *unblocks* clean component tests, so it precedes the test build-out. Service-layer tests and E2E flows then layer the regression net onto the now-testable surface. Packaging smoke-test is independent and can proceed in parallel, but is sequenced last because it validates the whole assembled product.

Test infrastructure already exists to build on: **Vitest** is the unit runner (`npm test` → `vitest run`); a **Playwright** scaffold is already present (`app/playwright.config.ts`, `app/e2e/` with `pages/` and an empty `tests/`, `@playwright/test` devDep, `npm run test:e2e`). The gap is *content*, not setup.

## Work Breakdown

### #49 — React error boundaries + StrictMode

**Rationale.** Highest impact for the lowest effort. Today any unhandled error — an RxDB query rejection, a Spotify 429, a malformed track doc — propagates to the root and unmounts everything. There is no `componentDidCatch` anywhere in the tree.

**Approach.**
- Add a reusable `<ErrorBoundary>` class component (renderer has no boundary primitive yet) with a fallback UI offering "reload view" and surfacing the error message in dev.
- Wrap the view router at minimum; ideally wrap each major view (Session, Playlist, Library, Settings, Spotify import) so a crash in one is locally contained and the shell/nav survives.
- Wrap the root render in `app/src/renderer/index.tsx:11` with `<React.StrictMode>`.
- Triage any double-invoke / missing-cleanup warnings that StrictMode surfaces (the manual RxDB subscriptions in `SessionView` are the prime suspects — verify their teardown is idempotent).

**Acceptance criteria.**
- [ ] `<ErrorBoundary>` component exists with a graceful, recoverable fallback.
- [ ] The view router is wrapped; at least the five major views are individually boundaried.
- [ ] `<React.StrictMode>` wraps the root in `index.tsx`.
- [ ] A thrown error in one view renders the fallback without white-screening the shell (demonstrated by a test or manual repro).
- [ ] No new StrictMode double-invoke warnings remain unaddressed (fixed or explained).

### #50 — Thin SessionView / extract `useSessionData`

**Rationale.** `SessionView.tsx` is the single largest debt item: it owns subscription wiring, derived turn state, and RxDB-to-local-state mirroring all before any JSX. Extracting the data layer shrinks the component and — critically — makes it testable by mocking one hook instead of the whole database.

**Approach.**
- Create `useSessionData(playlistId)` consolidating the four reactive concerns currently inline in `SessionView`:
  - playlist subscription — `SessionView.tsx:59-77`
  - ordered tracks subscription — `SessionView.tsx:80-109`
  - participants resolution — `SessionView.tsx:112-134`
  - current-turn-user resolution — `SessionView.tsx:143-155`
- Return a clean `{ playlist, tracks, participants, currentTurnUser }` object; move the four `getDatabase()` calls (`:64, :89, :117, :148`) inside the hook. Prefer the existing `useRxDBQuery` / `useRxDBDocument` primitives over hand-rolled subscriptions where the query shape allows.
- Replace the five local `useState` slots (`SessionView.tsx:52-56`) — keeping only genuine UI state like `showSharePanel`.
- Note `PlaylistView.tsx` (~426 lines) as the related follow-up: it has the same RxDB-into-`useState` duplication and a one-shot non-reactive track load. A parallel `usePlaylistData` is the obvious next step but is out of scope for this issue unless cheap.

**Acceptance criteria.**
- [ ] `useSessionData(playlistId)` exists and is the sole owner of the playlist/tracks/participants/turn subscriptions.
- [ ] `SessionView` no longer calls `getDatabase()` directly and no longer mirrors reactive data into `useState`.
- [ ] Turn-derivation behaviour (`computeEffectiveTurn`, auto-advance on quota-full) is preserved — verified by the turn-taking E2E (#48) or a hook unit test.
- [ ] `typecheck` and `lint` pass; the two `eslint-disable exhaustive-deps` array-join workarounds are carried into the hook with explanatory comments.
- [ ] `PlaylistView` follow-up captured as a tracked note/issue.

### #48 — Critical-flow E2E tests

**Rationale.** These five flows touch every layer (IPC, RxDB, navigation, P2P) and are exactly where silent regressions hide. The framework is already stood up; the `e2e/tests/` directory is empty.

**Approach.** Author Playwright specs (driving Electron, not just the Vite URL — note the config's `baseURL` is the dev server and packaged builds use the custom protocol, so the Electron launch path needs wiring in `e2e/`) for the flows enumerated in [[mvp-reality-react-quality]] §Critical User Flows:
1. **Spotify import funnel** — auth gate → playlist browser → track selector → import → playlist created.
2. **Session lifecycle** — open playlist → enable collaborative → open session → configure → start → end.
3. **Turn-taking cycle** — start turn-taking → add tracks → turn advances → mark complete → reopen.
4. **Playlist CRUD + export** — create → add tracks → export to markdown → assert file contents.
5. **P2P replication** (hardest) — start node → connect to test peer → assert bidirectional change flow. Read-only against the protocol per the Agentic Work Policy; uses `test-peer` as the counterparty.

**Acceptance criteria.**
- [ ] Electron-launch harness wired in `e2e/` (page objects under `e2e/pages/`).
- [ ] Specs 1–4 pass deterministically in CI.
- [ ] Spec 5 exists and passes locally against `test-peer`; if CI-flaky, gated/tagged rather than deleted, with a note.
- [ ] `npm run test:e2e` is wired into a CI job (allowed to be a separate, non-blocking lane initially).

### #26 — Service-layer CRUD tests

**Rationale.** `playlist-service.ts` and `track-service.ts` back every playlist mutation yet have no tests. The turn-taking side effects inside `addTrackToPlaylist` (`playlist-service.ts:132-190`: dedup, `turnTracksAdded` increment, `turnFull` → `advanceTurn`, max-duration auto-complete) are intricate and easy to break.

**Approach.**
- Vitest suites against an in-memory RxDB instance (memory storage adapter) so no Electron/IPC dependency.
- Cover create / update / delete for playlists and tracks; `addTrackToPlaylist` including the duplicate-skip path (`:144`), the turn-quota advance, and the `maxDurationMs` auto-complete; `removeTrackFromPlaylist`, `reorder`, `bulkAdd`, `clear`; `advanceTurn` order/wrap and `maxTurns` auto-complete.
- Pin the non-null-assertion footguns: add tests asserting `createPlaylist` requires `ownerId` (`playlist-service.ts:34`, `input.ownerId!`) and `createTrack` requires `addedBy` (`track-service.ts:28` and `:143`, `input.addedBy!`). Then tighten the input types — make `CreatePlaylistInput.ownerId` and `CreateTrackInput.addedBy` non-optional in `app/src/renderer/db/types.ts` and drop the `!` assertions.

**Acceptance criteria.**
- [ ] Vitest suites for `playlist-service.ts` and `track-service.ts` against in-memory RxDB.
- [ ] `addTrackToPlaylist` dedup, turn-quota advance, and duration auto-complete each covered.
- [ ] `CreatePlaylistInput.ownerId` / `CreateTrackInput.addedBy` made required; the four `!` assertions removed; `typecheck` passes.
- [ ] Suites run under `npm test` in CI.

### #22 — Packaging smoke-test

**Rationale.** `electron-builder` is configured (`app/package.json:24` `package` script, `:100-127` `build` block) but no distributable has been produced or launched. Packaged builds resolve paths differently from dev — every filesystem assumption is unverified in production layout.

**Approach.**
- Produce installers for macOS, Windows, and Linux. **Note:** the current `build` block only defines a `win` `portable` target (`package.json:111-116`) — mac and linux targets must be added before they can be built.
- Launch each artifact and verify the production path:
  - app boots and the window renders;
  - RxDB initialises and persists to the packaged userData location;
  - `whtnxt://` OAuth callback round-trips (`app/src/main/main.ts:451`, `:525` protocol registration) — single-instance argv handoff included on win/linux;
  - the companion HTTP server binds and serves;
  - **companion-web resources resolve from `resources/`.** `resolveCompanionWebDir()` (`app/src/main/companion/companion-server.ts:91-105`) expects the prod path `process.resourcesPath/companion-web` (`:98`), but `extraResources` currently only copies `../assets` (`package.json:121-126`) — **`src/companion-web/` is not in the packaged resources**, so this will fail until added. Flag and fix.

**Acceptance criteria.**
- [ ] `build` config gains mac and linux targets alongside the existing win target.
- [ ] `src/companion-web/` added to `extraResources` (or otherwise copied into `resources/`); `resolveCompanionWebDir()` resolves the prod path.
- [ ] Installer produced and launched on each of the three platforms; checklist (boot, RxDB init, `whtnxt://` callback, companion bind, companion-web served) passes per platform.
- [ ] Results recorded as a short smoke-test note; any platform-specific defects filed.

## Epic Acceptance Criteria (Definition of Done)

- [ ] No single component error can white-screen the app (#49).
- [ ] `StrictMode` enabled; surfaced warnings resolved (#49).
- [ ] `SessionView` data layer lives in `useSessionData`; no direct `getDatabase()` or mirrored reactive `useState` in the component (#50).
- [ ] Five critical flows have passing E2E specs (replication spec may be a gated lane) (#48).
- [ ] `playlist-service` and `track-service` covered by Vitest; the four `!` footguns eliminated at the type level (#26).
- [ ] Packaged installers built and smoke-tested on mac/win/linux, including the companion-web resources fix (#22).
- [ ] `lint`, `typecheck`, `npm test` all green; `test:e2e` wired into CI.

## Risks & Open Questions

- **RxDB in-memory for tests** — does the project already bundle a memory storage adapter, or must one be added as a devDependency? (Current deps use the default storage; confirm before #26.)
- **Electron + Playwright in CI** — Electron E2E needs a virtual display (xvfb) on Linux CI; the replication spec additionally needs `test-peer` running. Expect this lane to be the flakiest; tag accordingly.
- **StrictMode fallout** — double-invoked effects may expose latent bugs in the manual RxDB subscriptions; budget time to fix rather than suppress.
- **Cross-platform packaging** — building mac artifacts typically requires macOS hardware/CI; win/linux can cross-build. Signing is disabled (`package.json:115`), so notarisation is out of scope for the smoke-test.
- **Are `epic-spotify-resilience` and `epic-audio-acquisition-hardening` the canonical filenames** for the cross-linked feature epics? On-disk siblings today are `audio-acquisition-service.md` and `epic-replication-reliability.md`; reconcile when those epics land.

## Dependencies & Sequencing

1. **#49** (error boundaries + StrictMode) — first; cheap, high impact, unblocks safe iteration.
2. **#50** (`useSessionData`) — second; reduces debt and makes #48/#26 component-level tests tractable.
3. **#26** (service CRUD tests) — third; can overlap #50; pure-unit, no UI dependency.
4. **#48** (E2E flows) — fourth; benefits from #50's testability; replication spec last within the issue.
5. **#22** (packaging) — independent; runnable in parallel, but validate after the shell is stable.

Cross-cutting: do alongside the feature epics rather than blocking them. None of this work touches the P2P protocol surface restricted by the `CLAUDE.md` Agentic Work Policy (E2E only observes replication).

## References

- Audit: [[report-260627-mvp-state-of-the-union]] §5, [[mvp-reality-react-quality]]
- Patterns: [[React-Patterns]]
- Concepts: [[React]], [[Electron]]
- Cleanup backlog: [[dead-code-audit-260322]]
- Related epics: [[epic-spotify-resilience]], [[epic-audio-acquisition-hardening]]
- Code: `app/src/renderer/index.tsx`, `app/src/renderer/components/Session/SessionView.tsx`, `app/src/renderer/components/Playlist/PlaylistView.tsx`, `app/src/renderer/db/services/playlist-service.ts`, `app/src/renderer/db/services/track-service.ts`, `app/src/main/companion/companion-server.ts`, `app/src/main/main.ts`, `app/package.json`, `app/playwright.config.ts`

---
tags:
  - specs/sessions
  - architecture/patterns/adapters
status: draft
date created: 2026-06-27
date modified: 2026-06-27
---

# Epic: Track Sourcing Completion

**Status**: Draft
**GitHub**: #37, #38
**Depends on**: [[epic-replication-reliability]] (the P2P source rides on trustworthy replication)
**Source audit**: [[report-260627-mvp-state-of-the-union]] §3

> ⚠️ The P2P track source (#38) touches the P2P protocol — needs explicit human approval before agentic work (CLAUDE.md / `needs-p2p-review`). The Manual source (#37) does NOT.

> WhatNext's session layer already abstracts track input behind a `TrackSourceConfig` discriminated union (`spotify-collab` | `manual` | `p2p`), but only the `spotify-collab` arm is real. `manual` and `p2p` are no-op stubs, so today a session is *impossible* without one coordinator holding a Spotify Premium account — directly contradicting the user-sovereignty thesis. This epic finishes the abstraction so a session can be sourced from the local library / manual entry (#37) and from remote peers over replication (#38), making WhatNext usable with zero Spotify dependency.

## Problem & Current State

The `TrackSource` abstraction is declared but not delivered.

- The union is defined in `app/src/shared/session-interfaces.ts:33-36`:
  ```ts
  export type TrackSourceConfig =
      | { type: 'spotify-collab'; spotifyPlaylistId: string }
      | { type: 'manual' }
      | { type: 'p2p' };
  ```
- The only working consumer, `app/src/renderer/hooks/useTrackSource.ts`, runs a real 5-second polling loop for `spotify-collab` (`useTrackSource.ts:186-316`): it diffs the remote Spotify playlist, calls `processIncomingTracks(...)` (`useTrackSource.ts:48`) to normalize → write `TrackDocType` → reconcile the playlist, and fires the `onNewTracks` callback that the session feed / turn logic listen on.
- For the other two arms the hook short-circuits to a no-op **after** the effect, at `useTrackSource.ts:322-324` (verified verbatim):
  ```ts
  if (config.type === 'manual' || config.type === 'p2p') {
      return { syncing: false, lastSyncAt: null, error: null, syncNow: null };
  }
  ```
  No track ever enters a `manual` or `p2p` session through this path, and there is no alternative UI affordance that does.

So the canonical pipeline (`createTrack` → `addTrackToPlaylist` → feed/turn) exists and is exercised by Spotify, but the two source-agnostic entry points are dark. This is itemized in [[report-260627-mvp-state-of-the-union]] §3 ("Manual & P2P track sources are stubbed — `useTrackSource.ts:322`") and §6 ("A. Finish stubbed features", items 2 and 3).

**Canonical model is ready.** Tracks normalize to `TrackDocType` (`app/src/renderer/db/schemas.ts:125-147`, schema `version: 3` at `schemas.ts:152-246`). The v3 schema already carries the fields a non-Spotify source needs — `source` (`'spotify' | 'youtube' | 'soundcloud' | 'bandcamp' | 'local' | 'manual'`), `localFilePath`, `localFileSize`, `audioFormat`, `audioBitrate`, `purchaseLinks` — all optional and backward-compatible. The services to write into it already exist: `createTrack` (`app/src/renderer/db/services/track-service.ts:19`), `searchTracks` (`track-service.ts:64`), `getTracksByIds` (`track-service.ts:122`), and `addTrackToPlaylist` (`app/src/renderer/db/services/playlist-service.ts:132`).

**Feeder already exists.** Local file import (recursive scanner + `music-metadata` extraction + filename-parser fallback) is implemented and unit-tested under `app/src/main/media/` (`scanner.ts`, `filename-parser.ts`, `local-media-mapper.ts`). It is the natural backing store for a Manual source — see [[local-file-import-adapter]] and [[audio-acquisition-service]].

## Goals

- Make `type: 'manual'` a first-class, fully-functional track source: a UI affordance to add tracks (local library pick / manual entry / search) that writes a `TrackDocType` and surfaces it in the session feed, counting as a turn when turn-taking is active.
- Make `type: 'p2p'` functional: remote peers' track additions arrive via RxDB replication fan-in (not polling) and surface identically in the local feed/turn flow.
- Keep the source abstraction honest: the session/feed/turn layers must remain agnostic to which `TrackSourceConfig` arm is active — they consume `TrackDocType` and `onNewTracks`, nothing platform-specific (per [[adr-260307-session-architecture-provider-abstraction]]).
- Deliver a session that works end-to-end with **zero** Spotify account, library, or network dependency (Manual, offline).

## Non-Goals

- No new external import adapters (Apple Music, YouTube Music as *sources*) — Phase 2.
- No CRDT migration; LWW conflict resolution stands (out of scope, owned by [[epic-replication-reliability]]).
- No change to the `spotify-collab` arm beyond refactoring shared normalization helpers if extraction is clean.
- No playback-provider work — sourcing only. Playback mutex / handoff is [[epic-session-coordination]].
- No fixing of the underlying replication transport — #38 *depends on* that being fixed elsewhere, it does not fix it.

## Proposed Approach

Treat the two arms as a shared write-path with two different *inputs*:

1. **Shared sink (refactor first).** Extract the "normalize an `IncomingTrack` → `createTrack` → `addTrackToPlaylist` → emit `onNewTracks`" tail of `processIncomingTracks` (`useTrackSource.ts:48-147`) into a source-agnostic helper so all three arms write tracks identically. This guarantees a manual/P2P track is indistinguishable from a Spotify one downstream (feed render, turn accounting, replication).

2. **Manual arm (#37) = local-initiated writes.** A session UI affordance (modal / inline composer in `SessionView`) lets a participant add a track via: (a) pick from local library (`searchTracks`), (b) manual title/artist/album entry, (c) future: search/import. On confirm it builds an `IncomingTrack` with `externalSource: 'manual'` (or `'local'` when backed by a scanned file with `localFilePath`) and runs it through the shared sink. `useTrackSource` for `manual` returns a real `syncNow`/state object instead of the no-op, even though there is no poll loop — its job is to expose the add affordance's plumbing, not to fetch.

3. **P2P arm (#38) = manual + replication fan-in.** A P2P-sourced session *is* a manual session whose `tracks`/`playlists` collections are replicated across peers. A remote peer's "manual add" lands in their RxDB, replication pushes the `TrackDocType` to the local replica, and a reactive query on the session's playlist re-derives the feed. The hook's responsibility for `p2p` is to subscribe to that reactive query and translate inserts into `onNewTracks` events (deduping against locally-originated adds), **not** to poll. This is why #38 strictly depends on [[epic-replication-reliability]]: if checkpoints don't persist (#40) or pulls drop silently (#41), a "P2P source" silently loses tracks with no error surface.

## Work Breakdown

### #37 — Manual TrackSource  *(recommended FIRST build target — no P2P approval needed)*

**Rationale.** This is the path that makes WhatNext usable with zero Spotify dependency and is the cleanest expression of the user-sovereignty thesis ([[the-walled-garden-cracks]]). It touches no P2P-protocol code, so it is fully eligible for autonomous agentic work and unblocks demoing sessions without a Premium account.

**Approach.**
- Replace the `manual` branch of the `useTrackSource.ts:322` no-op with a real implementation that exposes an `addTrack(incoming: IncomingTrack)` (or returns a usable `syncNow`) wired to the shared sink from "Proposed Approach §1".
- Build a session-level "Add track" affordance (UI) offering: local-library search (`searchTracks`, `track-service.ts:64`), manual entry, and a hook for future search/import.
- Normalize manual entries to `TrackDocType` with `source: 'manual'` (or `'local'` + `localFilePath` when chosen from a scanned library item via `app/src/main/media/`).
- Ensure the new track flows through `onNewTracks` so the feed renders it and, when turn-taking is active, it counts as the adder's turn (mirror the Spotify path's emission at `useTrackSource.ts:243-245`).

**Acceptance criteria.**
- [ ] In a `type: 'manual'` session, a participant can add a track from the local library and it appears in the session feed within one reactive tick.
- [ ] A manual track can be entered by hand (title/artist/album/duration) with no library file and persists as a valid `TrackDocType` (`source: 'manual'`).
- [ ] The added track is attributed to the adder (`addedBy`) and, with turn-taking on, advances the turn exactly once (no double-advance — cf. the turn-advance race noted in §3).
- [ ] `useTrackSource` no longer returns the `useTrackSource.ts:322` no-op for `manual`; it returns live state and a functional add/`syncNow`.
- [ ] A full session can be created, populated, and played-back-listed end-to-end with **no Spotify auth and no network** (offline manual session).
- [ ] Unit coverage for the shared normalize→write sink and the manual add path (the audit flags zero session-layer tests — do not extend that gap).

### #38 — P2P TrackSource  *(needs explicit human P2P approval — `needs-p2p-review`)*

**Rationale.** Lets a participant who is *not* the coordinator contribute tracks: their additions replicate to every peer and appear in the shared feed, completing the "everyone collaborates" half of the Coordinator Model. It is the smallest possible P2P feature because it reuses the manual write-path entirely — the only new behavior is *fan-in over replication*.

**Approach.**
- Define the `p2p` arm as **manual + replication fan-in**: same `TrackDocType` writes, same shared sink; the difference is that the session's `tracks`/`playlists` collections are replicated and a remote insert is a valid source event.
- Replace the `p2p` branch of the `useTrackSource.ts:322` no-op with a subscription to a reactive query over the session playlist; on a newly-replicated `TrackDocType` insert (not locally originated), emit `onNewTracks` so the feed/turn layer treats it identically to a local add.
- Dedupe locally-originated vs. replicated inserts so a peer's own add isn't double-counted when it round-trips through replication.
- **Do not** add a polling loop; the source of truth is the replicated collection.
- Document the dependency: P2P sourcing is only as reliable as replication — surface a sync error/state rather than silently dropping (ties to #41).

**Acceptance criteria.**
- [ ] In a `type: 'p2p'` session, a track added by a remote peer appears in the local feed via replication (no polling), attributed to the remote `addedBy`.
- [ ] A locally-added track is *not* double-counted when it round-trips through replication (dedup verified).
- [ ] Turn-taking accounts for remote adds correctly across at least two peers.
- [ ] The `p2p` arm surfaces a non-silent error/sync state when replication stalls (no silent track loss).
- [ ] Explicit human P2P approval recorded before merge (CLAUDE.md Agentic Work Policy / `needs-p2p-review`).
- [ ] Behavior verified against persisted checkpoints (depends on #40) — a P2P session survives an app restart without losing previously-replicated tracks.

## Epic Acceptance Criteria (Definition of Done)

- [ ] All three `TrackSourceConfig` arms (`spotify-collab`, `manual`, `p2p`) are functional; the `useTrackSource.ts:322` no-op is gone.
- [ ] The session/feed/turn layers remain source-agnostic — no new branch on `config.type` leaks into UI components beyond the source hook and the add affordance.
- [ ] A Spotify-free session is demonstrable end-to-end (Manual, offline) and a peer-contributed session is demonstrable (P2P, two peers).
- [ ] Track normalization is shared across all three arms (single sink), verified by tests.
- [ ] [[report-260627-mvp-state-of-the-union]] §6 items A.2 (un-stub Manual) and A.3 (un-stub P2P) can be checked off.

## Risks & Open Questions

- **Replication trust (blocking #38).** P2P sourcing inherits every fragility in §3 — in-memory checkpoints (#40) and silent empty-pull drops (#41). #38 must not ship before [[epic-replication-reliability]] lands those, or it will lose tracks invisibly.
- **Turn-advance race.** §3 notes `advanceTurn()` can fire twice on concurrent adds and the UI re-derives turn from history (`TurnManagementPanel.tsx:127`). Both new arms add tracks → both can trip this. *Open: does turn accounting belong in the source hook or stay in the turn manager?*
- **Manual vs. local provenance.** *Open:* should a library-backed manual add use `source: 'local'` (+ `localFilePath`) while a hand-typed add uses `source: 'manual'`, and does anything downstream branch on that distinction?
- **Dedup key for fan-in.** *Open:* what uniquely identifies a track for replicated-vs-local dedup — `TrackDocType.id` (UUID, stable across replication) is the obvious key; confirm it survives the round-trip unchanged.
- **No session-layer tests today.** §3: zero tests for session/replication/turn. Adding two source arms without tests compounds the highest-risk gap; tests are in-scope, not optional.
- **UI ownership.** *Open:* where does the "Add track" affordance live in the god-orchestrator `SessionView` (flagged in [[mvp-reality-react-quality]]) without growing it further?

## Dependencies & Sequencing

1. **#37 first** — independent of P2P, no approval gate, unblocks zero-Spotify demos. Build the shared sink here.
2. **[[epic-replication-reliability]] (#40, #41)** — hard prerequisite for #38; do not start #38's merge path until checkpoints persist and pulls don't drop silently.
3. **#38 second** — reuses #37's shared sink + manual write-path; adds only replication fan-in. Requires explicit human P2P approval before agentic work.
4. Coordinates with [[epic-session-coordination]] (turn-taking / playback mutex) on shared turn-advance behavior, but does not depend on it for sourcing.

## References

- Audit: [[report-260627-mvp-state-of-the-union]] §3 (stub), §6.A (last mile)
- Concepts: [[Sessions]], [[Spotify-Integration]], [[the-walled-garden-cracks]]
- ADR: [[adr-260307-session-architecture-provider-abstraction]] (the provider abstraction this completes)
- Sibling epics: [[epic-replication-reliability]], [[epic-session-coordination]]
- Feeders: [[local-file-import-adapter]], [[audio-acquisition-service]]
- Code:
  - `app/src/shared/session-interfaces.ts:33-36` — `TrackSourceConfig` union
  - `app/src/renderer/hooks/useTrackSource.ts:48,186-316,322-324` — Spotify poll, normalize sink, the stub
  - `app/src/renderer/db/schemas.ts:125-147,152-246` — `TrackDocType` + schema v3
  - `app/src/renderer/db/services/track-service.ts:19,64,122` — `createTrack`, `searchTracks`, `getTracksByIds`
  - `app/src/renderer/db/services/playlist-service.ts:132` — `addTrackToPlaylist`
  - `app/src/main/media/` — local import feeder (`scanner.ts`, `filename-parser.ts`, `local-media-mapper.ts`)

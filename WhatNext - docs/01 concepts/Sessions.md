---
tags:
  - architecture/patterns/sessions
  - architecture/patterns/adapters
  - core/sessions
date created: Sunday, March 8th 2026, 12:12:43 am
date modified: Monday, March 9th 2026, 12:20:52 am
---

# Sessions

## What It Is

A WhatNext session is a live, collaborative playlist-building experience hosted by one peer (the coordinator) around a shared playlist. Sessions are ephemeral — they exist in memory while running, but all playlist and track data they produce persists in RxDB.

Sessions v1 shipped with the __provider abstraction__: the session layer is platform-agnostic and never imports Spotify directly. All external platform interaction is behind two interfaces — `TrackSource` and `PlaybackProvider`.

> ⚠️ **Reliability status (2026-06-27)** — v1 is feature-present but *Spotify-only-robust*; the collaborative path is fragile. Known gaps (see [[report-260627-mvp-state-of-the-union]] §3):
> - **Manual & P2P `TrackSource` are no-op stubs** (`useTrackSource.ts:322`) — remediation tracked in [[epic-track-sourcing]].
> - **Playback mutex unimplemented** — `coHostIds`/`playbackOwnerId` are schema fields only; no enforcement or handoff ([[epic-session-coordination]]; design in [[adr-260315-p2p-session-pairing]]).
> - **Companion is snapshot-only** — bidirectional control (react / request-time) is stubbed.
> - **Turn-advance race** on concurrent adds (see Pitfall 5 — the per-track loop is *not* coordinated across peers).
> - **Zero tests** on session/replication/turn logic.

## Why We Use It

The session concept decouples *where tracks come from* and *how they play* from the collaboration mechanics. This means:

- Adding Apple Music or a P2P track source in future requires only a new adapter, not touching session logic
- Sessions can run in metadata-only mode (`playbackProvider: none`) without Spotify Premium
- The coordinator model — one person imports, everyone collaborates — maps cleanly onto the provider pattern

See [[adr-260307-session-architecture-provider-abstraction]] for the decision record.

## How It Works

### Provider Interfaces

Defined in `app/src/shared/session-interfaces.ts`:

```typescript
// Where tracks come from
type TrackSourceConfig =
    | { type: 'spotify-collab'; spotifyPlaylistId: string }
    | { type: 'manual' }
    | { type: 'p2p' };

// How music plays
type PlaybackProviderConfig =
    | { type: 'spotify' }
    | { type: 'none' };
```

Both are discriminated unions serialised into Zustand — no class instances, no runtime polymorphism needed.

### Session State Lifecycle

Session state lives in the navigation store (Zustand, in-memory only):

```ts
sessionState = null             → no session (SessionSetup shown)
sessionState.status = 'active'  → session running (SessionView shown)
sessionState.status = 'ended'   → session ended, navigated to playlists
```

Closing the app ends the session; all playlist and track data survives in RxDB.

### SessionSetup Flow (2 steps)

__Step 1 — Configure source and playback:__
- Loads the playlist from RxDB (`getPlaylist(playlistId)`)
- If `playlist.linkedSpotifyId` exists, pre-selects `spotify-collab` source and `spotify` playback
- User can switch to `manual` source or `none` playback

__Step 2 — Register participants:__
- Lists all non-local users from RxDB as suggestions (toggle checkboxes)
- Host can add new participants by display name + Spotify username (`createSessionParticipant`)
- Host is always prepended to the participant list as participant 0

On "Start Session", calls `startSession(config)` in the navigation store, setting `sessionState.status = 'active'`.

### Active Session — Track Source Polling

`useTrackSource` runs the polling loop for `spotify-collab`:

```ts
Every 5 seconds:
1. Call spotify.getPlaylistTracksFull(spotifyPlaylistId)
2. If snapshotId unchanged → short-circuit (no re-parse)
3. For each track not yet in RxDB (deduped by spotifyId):
   a. resolveSpotifyUser(addedBySpotifyId) → WhatNext userId
   b. If no match → createSessionParticipant('Unknown', spotifyId)
   c. Insert TrackDocType into RxDB
   d. addTrackToPlaylist(playlistId, trackId)
   e. If playlist is turn_taking and adder == currentTurnUserId → advanceTurn()
4. Emit onNewTracks callback
```

The snapshot ID optimisation avoids re-processing the full track list when the Spotify playlist hasn't changed — critical for a 5 s poll interval.

### Active Session — Playback

`usePlaybackState` polls `GET /me/player` every 5 s when `isSpotifyPlayback` is true. Returns `PlaybackState | null` (null when Spotify reports 204 No Content — no active device).

`PlaybackBar` renders transport controls (play/pause/skip) and a progress bar using this state. Controls invoke IPC directly: `spotify.pausePlayback()`, `spotify.skipToNext()`, etc.

### Attribution Chain

```ts
Spotify collaborative playlist
    → added_by.id (Spotify user ID)
    → resolveSpotifyUser(spotifyId)     [checks linkedAccounts in RxDB users]
    → WhatNext UserDocType
    → TrackDocType.addedBy = whatnext userId
    → SessionView participant roster: trackCount per participant
```

If no WhatNext user matches a Spotify `added_by` ID, a stub profile is auto-created (`isLocal: false`, `linkedAccounts: [{ provider: 'spotify', providerUserId: spotifyId }]`). The stub can be named later.

## Key Patterns

### Pattern 1: Starting a Session

```typescript
const startSession = useNavigationStore((s) => s.startSession);

startSession({
    playlistId,
    trackSource: { type: 'spotify-collab', spotifyPlaylistId: 'abc123' },
    playbackProvider: { type: 'spotify' },
    participantIds: [hostId, ...otherIds],
    hostId,
});
```

### Pattern 2: Reading Session State in a Component

```typescript
import { useSessionState } from '../hooks/useSessionState';

const { sessionState, isActiveSession } = useSessionState(playlistId);

// isActiveSession = sessionState?.status === 'active' && sessionState.playlistId === playlistId
```

### Pattern 3: Enabling a Playlist for Sessions

A playlist must have `isCollaborative: true` for the "Open Session" button to appear in `PlaylistView`. When importing from Spotify, pass the `collaborative` flag through:

```typescript
await createPlaylist({
    ...
    isCollaborative: selectedSpotifyPlaylist.collaborative,
});
```

Playlists imported before this was wired up can be patched via `updatePlaylist(id, { isCollaborative: true })`.

### Pattern 4: Ending a Session

```typescript
const endSession = useNavigationStore((s) => s.endSession);

endSession();           // Sets status = 'ended', keeps playlist/tracks
navigate('playlists'); // Return to playlist view
```

`useTrackSource` cleans up its polling interval via the `useEffect` cleanup function (cancelled flag + `clearInterval`).

## Common Pitfalls

### Pitfall 1: Playlist not Showing "Open Session"

`PlaylistView` gates the button on `playlist.isCollaborative`. Playlists imported from Spotify before the `isCollaborative` flag was wired into the import flow will have `isCollaborative: false`. Use the "Enable Collaborative" button that appears on any Spotify-linked playlist without the flag set, or re-import.

### Pitfall 2: Spotify Source Requires Coordinator to Be Authenticated

`useTrackSource` calls `window.electron.spotify.getPlaylistTracksFull`. This IPC call requires the main process to have a valid Spotify access token. If the coordinator hasn't completed OAuth, the source will error with `'Spotify IPC not available'` or an auth error.

### Pitfall 3: Playback Requires Spotify Premium

`GET /me/player`, `PUT /me/player/play`, etc. all require a Spotify Premium subscription. If the account is free tier, playback controls silently fail (Spotify returns 403). Sessions still work fully in metadata-only mode by setting `playbackProvider: none`.

### Pitfall 4: snapshotId only Guards Re-parse, not Re-fetch

The snapshot ID check short-circuits the track-processing loop but still makes the API call. If the playlist hasn't changed, the response is cheap (just the snapshot_id header is compared), but the network round-trip still happens every 5 s.

### Pitfall 5: Turn-advance Fires once per New Track per Poll Cycle

`advanceTurn` is called inside the per-track loop. If multiple tracks arrived since the last poll (e.g. app was backgrounded), the turn will advance for each of them in sequence within a single poll cycle. This is correct behaviour — each added track counts as one turn — but can feel fast if tracks were queued up offline.

### Participant Roles

| Role | Platform | Capabilities |
|------|----------|-------------|
| **Host** (coordinator) | Electron desktop | Full control: playback, queue, import, session lifecycle |
| **Co-host** | Electron desktop (P2P) | _Planned_ — playback transfer/queue edits depend on the unimplemented mutex |
| **Desktop participant** | Electron desktop (P2P) | Add tracks, react, comment (via RxDB replication) |
| **Companion participant** | Phone browser | View-only today; react / request-more-time are _stubbed_ (snapshot-only) |

Companion participants connect via the [[Companion-Client]] — a lightweight web page served by the coordinator's Electron app over local WiFi. They don't need WhatNext installed or a Spotify account.

## Related Concepts

- [[adr-260307-session-architecture-provider-abstraction]] — The architectural decision this implements
- [[adr-260315-p2p-session-pairing]] — Remote pairing, invite URLs, and the playback mutex design
- [[Spotify-Integration]] — Spotify adapter: OAuth, polling, playback IPC
- [[RxDB]] — All session data (tracks, participants) persists here
- [[RxDB-Replication]] — How session data syncs between desktop participants
- [[React-Patterns]] — Subscription patterns used in SessionView
- [[the-walled-garden-cracks]] — Coordinator model rationale
- [[Companion-Client]] — Phone browser session viewer for lightweight participation

## References

- Session interfaces: `app/src/shared/session-interfaces.ts`
- Track source hook: `app/src/renderer/hooks/useTrackSource.ts`
- Playback state hook: `app/src/renderer/hooks/usePlaybackState.ts`
- Session state hook: `app/src/renderer/hooks/useSessionState.ts`
- Session view: `app/src/renderer/components/Session/SessionView.tsx`
- Session setup: `app/src/renderer/components/Session/SessionSetup.tsx`
- Playback bar: `app/src/renderer/components/Session/PlaybackBar.tsx`
- Navigation store: `app/src/renderer/stores/navigation-store.ts`
- User service: `app/src/renderer/db/services/user-service.ts`
- Companion bridge hook: `app/src/renderer/hooks/useCompanionBridge.ts`
- Companion server: `app/src/main/companion/companion-server.ts`
- Milestone note: [[note-260307-sessions-v1-implementation]]

---

__Status__: v1 shipped 2026-03-07 (Spotify collab + playback). ManualTrackSource and P2PTrackSource are stubs; playback mutex and companion control unimplemented — see reliability callout above and [[report-260627-mvp-state-of-the-union]].
__Last Updated__: 2026-06-27 (reality-checked)


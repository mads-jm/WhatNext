---
tags:
  - notes/milestone/sessions
  - architecture/patterns/adapters
  - architecture/patterns/sessions
date created: Saturday, March 7th 2026, 7:44:10 pm
date modified: Monday, March 9th 2026, 12:20:47 am
---

# Sessions V1 — Implementation Complete

## What Was Built

Sessions v1 is the collaborative playlist-building experience at the heart of the WhatNext MVP. The core loop:

1. Host links a Spotify collaborative playlist and starts a session
2. Participants are registered with local WhatNext profiles linked to their Spotify user IDs
3. Everyone adds tracks to the Spotify playlist from their phones
4. WhatNext polls the playlist every 5s, detects new additions, maps `added_by` → local profiles
5. Turn order advances automatically when the expected participant's track is detected
6. Host controls playback (play/pause/skip) from WhatNext

## Architecture

Implemented the __provider abstraction__ decided in [[adr-260307-session-architecture-provider-abstraction]]. The session layer is platform-agnostic — it never imports from `spotify-client` directly. All platform interaction is behind two interfaces:

- __`TrackSource`__ — where new tracks come from. v1 ships `spotify-collab` (polling) and `manual` (stub). Config is a discriminated union serialised into Zustand.
- __`PlaybackProvider`__ — how music plays. v1 ships `spotify` and `none`.

Adding a future source (Apple Music, P2P, local files) means implementing the interface, not touching the session layer.

## Key Files

### Shared (both processes)

| File | Purpose |
|------|---------|
| `app/src/shared/session-interfaces.ts` | `TrackSourceConfig`, `PlaybackProviderConfig`, `SessionState`, `IncomingTrack`, `PlaybackState` |
| `app/src/shared/core/ipc-protocol.ts` | 8 new IPC channels + Spotify playback payload types |

### Platform Layer (main process)

| File | Purpose |
|------|---------|
| `app/src/main/spotify/spotify-client.ts` | Added `getPlaybackState`, `getDevices`, `startPlayback`, `pausePlayback`, `resumePlayback`, `skipToNext`, `skipToPrevious`, `getPlaylistTracksFull` |
| `app/src/main/main.ts` | 8 new `ipcMain.handle` blocks for playback + polling |
| `app/src/main/preload.ts` | All new methods exposed on `window.electron.spotify` |
| `app/src/shared/spotify-config.ts` | Added `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing` scopes |

### Session Layer (renderer)

| File | Purpose |
|------|---------|
| `app/src/renderer/hooks/usePlaybackState.ts` | Polls `getPlaybackState` every 5s, returns `PlaybackState \| null` |
| `app/src/renderer/hooks/useTrackSource.ts` | `SpotifyCollabSource` — polls playlist, deduplicates by `spotifyId`, creates tracks + advances turns |
| `app/src/renderer/hooks/useSessionState.ts` | Reads `SessionState` from nav store for a given playlist ID |
| `app/src/renderer/stores/navigation-store.ts` | Added `sessionState`, `startSession()`, `endSession()` |
| `app/src/renderer/db/services/user-service.ts` | Added `createSessionParticipant()`, `resolveSpotifyUser()`, `getAllUsers()` |
| `app/src/renderer/components/Session/PlaybackBar.tsx` | Transport controls, progress bar, now-playing info |
| `app/src/renderer/components/Session/SessionSetup.tsx` | 2-step setup: source/provider config + participant registration |
| `app/src/renderer/components/Session/SessionView.tsx` | Full rework: setup flow, turn banner, participant roster, live track list with attribution, now-playing highlight |

## Attribution Chain

```ts
Spotify collaborative playlist → added_by.id (Spotify user ID)
    → resolveSpotifyUser(spotifyId) → WhatNext UserDocType (via linkedAccounts)
    → TrackDocType.addedBy = WhatNext userId
    → SessionView participant roster shows displayName + track count
```

If no profile is found for a `added_by.id`, `createSessionParticipant('Unknown', spotifyId)` auto-creates a stub profile that can be named later.

## Spotify API Notes

- __Playback endpoints__ require Premium. `GET /me/player` returns `204 No Content` (not an error) when no active device — handled via `spotifyFetchRaw` returning raw `Response` before `.json()`.
- __`getPlaylistTracksFull`__ uses the `fields` query parameter to fetch only `snapshot_id`, track metadata, `added_at`, and `added_by` — minimising payload on every 5s poll.
- __Snapshot ID optimisation__: if the playlist's `snapshot_id` hasn't changed since the last poll, the hook short-circuits without re-processing the track list.
- __`POST /users/{id}/playlists`__ was removed in Feb 2026 — playlist must be pre-created in Spotify. This aligns with the v1 model (participants use their own Spotify apps).

## Session State Lifecycle

```ts
Navigation store:
  sessionState = null          → no session (show SessionSetup)
  sessionState.status = active → session running (show SessionView)
  sessionState.status = ended  → session ended, playlist persists
```

Session state is ephemeral (Zustand, in-memory). The playlist and all tracks persist in RxDB. Closing the app ends the session but the playlist data survives.

## What's Not in V1

- __ManualTrackSource__: stub only — host would enter tracks directly in WhatNext (good for offline/no-Spotify sessions)
- __P2PTrackSource__: stub — participants running WhatNext submit tracks via libp2p
- __Per-user Spotify auth in sessions__: all attribution flows through `added_by` from the collaborative playlist; participants don't need to auth with WhatNext
- __Session persistence/history__: ephemeral by design, clear migration path if needed
- __Relay-based remote sessions__: mDNS discovery only for now

## Related

- [[adr-260307-session-architecture-provider-abstraction]] — The architectural decision this implements
- [[the-walled-garden-cracks]] — Why the provider abstraction matters (Spotify API restrictions)
- [[RxDB]] — Local data layer, all tracks/playlists/users persist here
- [[libp2p]] — P2P transport (used indirectly via replication, directly in future P2PTrackSource)



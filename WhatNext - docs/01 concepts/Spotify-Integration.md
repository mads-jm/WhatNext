---
tags:
  - integrations/spotify
  - architecture/patterns/adapters
  - core/net/oauth
date created: Sunday, March 8th 2026, 12:13:43 am
date modified: Monday, March 9th 2026, 12:20:45 am
---

# Spotify Integration

## What It Is

WhatNext's Spotify integration is a __read-and-control adapter__ — it reads playlists and tracks from Spotify, imports them into the local RxDB, and drives Spotify playback from the session UI. It does not write playlists back to Spotify (see sync modes in the spec for future True Collaborate / Proxy Owner modes).

All Spotify interaction is in the __main process__ behind IPC. The renderer never calls the Spotify API directly.

> ⚠️ **Reliability status (2026-06-27)** — OAuth PKCE, token refresh, import, and playback control are **implemented and work for a Premium account**, but error handling is **naive** (see [[report-260627-mvp-state-of-the-union]] §2, issue N9). The Premium/204 guidance in *Common Pitfalls* below describes what the code *should* do — currently every non-200 throws a generic `Spotify API error {status}` (`spotify-client.ts:76–77`): **no 403/Premium detection, no 429/rate-limit backoff, no retry, no request timeout.** Token can also expire mid-flow (`main.ts:498` TODO). OAuth + playback paths are **untested.**

## Why We Use It

Spotify is the coordinator's source platform for MVP: they import a collaborative playlist, WhatNext polls it for new tracks added by participants on their own Spotify apps, and plays it back. The February 2026 API restrictions (Premium required, 5-user cap, 16 endpoints removed) validated keeping Spotify as a peripheral adapter rather than a core dependency — see [[the-walled-garden-cracks]].

## How It Works

### OAuth PKCE Flow

WhatNext uses __PKCE (Proof Key for Code Exchange)__ — the correct OAuth flow for desktop apps that cannot safely store a client secret.

```ts
Main process                              Spotify
    |                                         |
    |-- generatePKCE() ---------------------->|  (local: verifier + SHA256 challenge)
    |-- shell.openExternal(authUrl) --------->|  (opens system browser)
    |                                         |
    |         (user approves in browser)      |
    |                                         |
    |<-- whtnxt://spotify-callback?code=xxx --|  (custom protocol handler)
    |                                         |
    |-- POST /api/token (code + verifier) --->|
    |<-- { access_token, refresh_token } -----|
    |                                         |
    |-- saveTokens() (encrypted, userData)    |
    |-- initSpotifyClient(tokens)             |
    |-- webContents.send('auth-complete') --> renderer
```

The `whtnxt://` custom protocol is registered in `main.ts` via `app.setAsDefaultProtocolClient('whtnxt')`. The callback URL is `whtnxt://spotify-callback`.

__Scopes requested:__

| Scope | Purpose |
|-------|---------|
| `playlist-read-private` | Read user's private playlists |
| `playlist-read-collaborative` | Read collaborative playlists |
| `user-library-read` | Read saved library |
| `user-read-playback-state` | Poll current track and device |
| `user-modify-playback-state` | Play, pause, skip (Premium) |
| `user-read-currently-playing` | Now-playing info |

Config lives in `app/src/shared/spotify-config.ts`. The Client ID is set there — register at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

### Token Management

Tokens are stored in `userData` via `token-store.ts` (Electron `app.getPath('userData')`). Before every API call, `getValidToken()` checks if the token expires within the next 5 minutes (`REFRESH_BUFFER_MS = 300_000`) and refreshes proactively via `POST /api/token` with the refresh token.

### Import Adapter Architecture

```ts
SpotifyPlaylistBrowser          SpotifyTrackSelector
  lists user playlists            shows tracks for selection
       |                               |
       v                               v
  useSpotifyImport.loadTracks()   useSpotifyImport.importSelected()
  GET /playlists/{id}/tracks          |
                                       v
                              bulkImportTracks()  →  RxDB tracks collection
                              createPlaylist()    →  RxDB playlists collection
                                isCollaborative: playlist.collaborative
                                linkedSpotifyId:  playlist.id
                                spotifySyncMode:  'accessory'
```

The `SpotifyPlaylist.collaborative` flag from the Spotify API __must__ be passed through to `createPlaylist` as `isCollaborative` — this is what unlocks the "Open Session" button in `PlaylistView`.

### Collaborative Playlist Polling (Session Source)

Used by `useTrackSource` during an active session. Fetches the full track list with attribution data using the `fields` query parameter to minimise payload:

```typescript
const fields = [
    'snapshot_id',
    'tracks.items(track(id,name,artists(name),album(name,images),duration_ms),added_at,added_by(id))',
    'tracks.total,tracks.next,tracks.offset,tracks.limit'
].join(',');

GET /playlists/{id}?fields={encodeURIComponent(fields)}
```

__Snapshot ID optimisation:__ The response includes `snapshot_id` — a version fingerprint for the playlist. If it matches the last known snapshot, the hook short-circuits without re-processing the track list. This avoids CPU and allocation cost on every 5 s tick when the playlist is idle.

__Pagination:__ The first response includes `tracks.next`. If non-null, the hook follows the cursor until all pages are fetched. Each page uses the raw `nextUrl` returned by Spotify (already includes limit/offset).

### Playback Control IPC

All playback calls go through the main process. IPC channels (defined in `ipc-protocol.ts`):

| Channel | Method | Spotify Endpoint |
|---------|--------|-----------------|
| `spotify:get-playback-state` | `getPlaybackState()` | `GET /me/player` |
| `spotify:get-devices` | `getDevices()` | `GET /me/player/devices` |
| `spotify:start-playback` | `startPlayback(params)` | `PUT /me/player/play` |
| `spotify:pause-playback` | `pausePlayback(deviceId?)` | `PUT /me/player/pause` |
| `spotify:resume-playback` | `resumePlayback(deviceId?)` | `PUT /me/player/play` |
| `spotify:skip-next` | `skipToNext(deviceId?)` | `POST /me/player/next` |
| `spotify:skip-previous` | `skipToPrevious(deviceId?)` | `POST /me/player/previous` |
| `spotify:get-playlist-tracks-full` | `getPlaylistTracksFull(id)` | `GET /playlists/{id}?fields=…` |

Playback endpoints use `spotifyFetchRaw` (returns `Response`, not `.json()`) to handle 204 No Content without throwing.

## Key Patterns

### Pattern 1: Calling Playback from the Renderer

```typescript
// Start playing the collaborative playlist context
await window.electron.spotify.startPlayback({
    contextUri: `spotify:playlist:${linkedSpotifyId}`,
    deviceId: activeDeviceId,   // optional
    offsetIndex: 0,             // optional — start from track N
});

// Pause
await window.electron.spotify.pausePlayback();

// Skip
await window.electron.spotify.skipToNext();
```

### Pattern 2: Polling Playback State

```typescript
// usePlaybackState.ts — polls every 5s
const result = await window.electron.spotify.getPlaybackState();
// result.success: boolean
// result.state: SpotifyPlaybackStateResult | null  (null = 204, no active device)
```

`PlaybackState` (the normalised form) is defined in `session-interfaces.ts`:

```typescript
interface PlaybackState {
    isPlaying: boolean;
    currentTrackExternalId: string | null;  // Spotify track ID
    progressMs: number;
    durationMs: number;
    deviceName: string | null;
    trackTitle?: string;
    trackArtists?: string[];
}
```

### Pattern 3: Resolving Spotify Users to WhatNext Profiles

```typescript
import { resolveSpotifyUser } from '../db/services/user-service';

const user = await resolveSpotifyUser(spotifyUserId);
// Searches UserDocType.linkedAccounts for { provider: 'spotify', providerUserId: spotifyUserId }
// Returns null if no match → caller should createSessionParticipant()
```

## Common Pitfalls

### Pitfall 1: Playback Requires Spotify Premium

`PUT /me/player/play`, `PUT /me/player/pause`, `POST /me/player/next`, `GET /me/player` all return `403` for free-tier accounts. The session still works fully in metadata-only mode (`playbackProvider: none`). Do not surface a generic error — detect 403 and show a "Premium required" message.

### Pitfall 2: GET /me/player Returns 204 (Not an Error)

Spotify returns `204 No Content` when there is no active device, not an error status. Using `spotifyFetch` (which calls `.json()`) would throw. Always use `spotifyFetchRaw` for playback endpoints and check `response.status === 204`:

```typescript
const response = await spotifyFetchRaw('/me/player');
if (response.status === 204) return null;  // No active device
const data = await response.json();
```

### Pitfall 3: Collaborative Flag Must Flow Through Import

`SpotifyPlaylist.collaborative` comes back from `GET /me/playlists`. It must be passed as `isCollaborative` when calling `createPlaylist`. If it's dropped, `PlaylistView` won't show the "Open Session" button and the coordinator cannot start a session.

### Pitfall 4: POST /users/{id}/playlists Removed Feb 2026

Creating playlists via the API was removed in Spotify's February 2026 restrictions. Playlists must be pre-created in the Spotify app. WhatNext v1 aligns with this — we import, not create.

### Pitfall 5: Relay PeerId and Client ID Are Separate Concerns

`CLIENT_ID` in `spotify-config.ts` is the Spotify OAuth app ID. It is not a secret (PKCE doesn't use one), but it should match the app registered at the Spotify Developer Dashboard with `whtnxt://spotify-callback` as an allowed redirect URI. Mismatched redirect URI causes a silent OAuth failure.

### Pitfall 6: Token Store Is Per-Machine

Tokens are stored in Electron's `userData` directory. On first launch (or after clearing userData), the coordinator must re-authenticate. There is currently no token-sharing mechanism across peers — each coordinator authenticates independently.

## Related Concepts

- [[Sessions]] — How the import adapter feeds the active session polling loop
- [[Electron-IPC]] — All Spotify calls cross the IPC boundary
- [[the-walled-garden-cracks]] — Context for why Spotify is a peripheral adapter
- [[RxDB]] — Imported tracks and playlists are stored here

## References

### Official Documentation

- [Spotify Web API Reference](https://developer.spotify.com/documentation/web-api)
- [Authorization Code with PKCE Flow](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Spotify OAuth Scopes](https://developer.spotify.com/documentation/web-api/concepts/scopes)
- [Get Playback State](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback)
- [February 2026 API Changes](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)

### WhatNext Implementation

- OAuth flow: `app/src/main/spotify/spotify-auth.ts`
- API client: `app/src/main/spotify/spotify-client.ts`
- Token storage: `app/src/main/spotify/token-store.ts`
- Config (scopes, endpoints, client ID): `app/src/shared/spotify-config.ts`
- IPC channels: `app/src/shared/core/ipc-protocol.ts` (`IPC_CHANNELS.SPOTIFY_*`)
- Preload API surface: `app/src/main/preload.ts` (`window.electron.spotify`)
- Import hook: `app/src/renderer/hooks/useSpotifyImport.ts`
- Import UI: `app/src/renderer/components/Spotify/`
- Track source (session polling): `app/src/renderer/hooks/useTrackSource.ts`
- Playback state hook: `app/src/renderer/hooks/usePlaybackState.ts`

---

__Status__: Read-only import + playback control operational (Premium); error handling naive and untested — see reliability callout. Write-back (True Collaborate, Proxy Owner) planned for Phase 2.
__Last Updated__: 2026-06-27 (reality-checked)


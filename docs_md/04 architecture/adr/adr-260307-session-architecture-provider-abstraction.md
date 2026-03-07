# ADR: Session Architecture — Provider Abstraction

**Date**: 2026-03-07
**Status**: Accepted

#architecture/decisions #architecture/patterns/sessions #architecture/patterns/adapters

## Context

WhatNext is approaching MVP with a Sessions feature — live collaborative playlist building with turn-taking, playback, and per-user attribution. The immediate implementation targets Spotify (collaborative playlists, playback control, `added_by` attribution), but Spotify's February 2026 API restrictions (Premium required, 5-user cap, `POST /users/{id}/playlists` removed, metadata fields stripped) reinforce that coupling to any single platform contradicts the project's core values of [[User Sovereignty]] and [[Local-First Data]].

The question: how do we ship a Spotify-powered session experience while architecting for platform independence from day one?

## Decision

**Sessions are platform-agnostic orchestration.** The session itself knows nothing about Spotify. All platform-specific behavior is isolated behind two provider interfaces: **TrackSource** (where new tracks come from) and **PlaybackProvider** (how music plays). The session operates on the canonical data model ([[RxDB]] collections) and delegates all external interaction to pluggable adapters.

### The Session Layer (Platform-Independent)

The session manages:
- **Participants** — WhatNext user profiles, optionally linked to external accounts
- **Turn order** — whose turn to add, auto-advance on detection, pass/skip
- **Track list** — canonical `TrackDocType` documents, platform-agnostic
- **Social layer** — reactions, comments (already implemented)
- **Lifecycle** — start, active, ended

The session never imports from any platform-specific module. It receives tracks in canonical format and tells a playback provider "play track N."

### TrackSource Interface

Answers: "Where do new tracks come from?"

```typescript
interface TrackSource {
    type: string;
    poll?(): Promise<IncomingTrack[]>;
    onTrack?(cb: (track: IncomingTrack) => void): void;
    resolveUser?(externalId: string): Promise<string | null>;
}

interface IncomingTrack {
    title: string;
    artists: string[];
    album: string;
    durationMs: number;
    externalId?: string;        // spotify track ID, MusicBrainz ID, etc.
    externalSource?: string;    // 'spotify' | 'musicbrainz' | 'manual'
    addedByExternalId?: string; // external user ID for attribution
}
```

**v1 implementation:** `SpotifyCollabSource` — polls a Spotify collaborative playlist, detects new track additions, maps `added_by.id` to WhatNext user profiles via `linkedAccounts`.

**Future implementations:**
- `ManualTrackSource` — host types track info or pastes a URL
- `P2PTrackSource` — participants running WhatNext submit tracks via libp2p
- `AppleMusicSource` — same polling pattern, different API
- `LocalFileSource` — pick tracks from local audio library

### PlaybackProvider Interface

Answers: "How do we play music?"

```typescript
interface PlaybackProvider {
    type: string;
    getState(): Promise<PlaybackState>;
    play(trackIndex: number): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    skipNext(): Promise<void>;
    skipPrevious(): Promise<void>;
}

interface PlaybackState {
    isPlaying: boolean;
    currentTrackIndex: number | null;
    currentTrackExternalId?: string;
    progressMs: number;
    durationMs: number;
}
```

**v1 implementation:** `SpotifyPlaybackProvider` — controls Spotify playback on the host's device via Web API (`PUT /me/player/play`, `PUT /me/player/pause`, etc.).

**Future implementations:**
- `NullPlaybackProvider` — no playback, just collaborative playlist building
- `LocalFilePlaybackProvider` — play audio files from disk
- `YouTubePlaybackProvider` — embed YouTube for playback (no Premium required)

### Session State Model

Session state lives in the navigation store (Zustand) as ephemeral UI state. It references providers by type configuration, not by platform:

```typescript
sessionState: {
    status: 'idle' | 'active' | 'ended';
    playlistId: string;
    trackSource: { type: 'spotify-collab'; spotifyPlaylistId: string }
               | { type: 'manual' }
               | { type: 'p2p' };
    playbackProvider: { type: 'spotify' }
                    | { type: 'none' };
    participantIds: string[];
    hostId: string;
    startedAt: string;
} | null;
```

## The v1 Session Loop (Spotify-Powered)

```
1. Host links Spotify, selects a collaborative playlist
2. Host registers participants (WhatNext profiles linked to Spotify user IDs)
3. Host starts session -> SpotifyCollabSource begins polling, SpotifyPlaybackProvider ready
4. Screen shows "It's [Name]'s turn"
5. That person adds a track on their phone (Spotify app)
6. SpotifyCollabSource detects new track via polling -> maps added_by -> canonical track
7. Turn auto-advances, track appears in session with attribution
8. Host controls playback from WhatNext (play/pause/skip)
9. Repeat until session ends
```

**Key**: Participants don't need WhatNext installed. They use Spotify on their phones. WhatNext is the shared-screen session controller.

## The No-Spotify Session (Available Near-Term)

The same architecture supports sessions with zero platform dependency:

```
1. Host starts session with ManualTrackSource + NullPlaybackProvider
2. Participants call out songs
3. Host enters track info (or participants submit via P2P in future)
4. Turn-taking, reactions, comments all work identically
5. Playlist is built in WhatNext's canonical format
```

Not as slick, but fully functional. Proves platform independence isn't a future promise — it's a launch capability.

## Consequences

### Benefits
- **Sessions work without Spotify from day one** — even if degraded
- **Adding a new platform is "implement 2-3 functions"** — not rewriting the session
- **If Spotify kills more endpoints, we swap the adapter** — not the feature
- **Aligns with the project's adapter pattern** — same philosophy as import adapters, just applied to live sessions
- **The canonical data model is the integration point** — tracks are tracks regardless of source

### Trade-offs
- Small upfront abstraction cost (~2-3 hours) for interfaces that v1 only uses one implementation of
- Polling-based track detection adds latency (mitigated: 5s interval is responsive enough for in-person sessions)
- Per-user attribution via Spotify's `added_by` requires each participant to have a Spotify account for v1 (mitigated: the abstraction allows non-Spotify attribution paths in future)

### API Rate Budget (v1 Spotify)
- Track polling: ~12 req/min (every 5s)
- Playback state: ~12 req/min (every 5s)
- Total: ~24 req/min — well within Spotify's ~180 req/min limit

## Alternatives Considered

### 1. Spotify-Coupled Sessions
Build sessions directly against Spotify APIs without abstraction. Rejected — creates immediate tech debt, contradicts project values, and makes inevitable platform migration painful.

### 2. Full P2P Sessions Only (No External Platform)
Skip Spotify integration entirely, require all participants to run WhatNext. Rejected for v1 — too much friction for MVP. The phone-based Spotify flow is the lowest-friction entry point for real-world use.

### 3. Embedded Spotify Playback (Web Playback SDK)
Embed Spotify's player directly in WhatNext. Rejected for v1 — adds complexity, requires Premium for the listener too, and tightens the Spotify coupling we're trying to loosen.

## Implementation Work Packages

1. **WP1: Spotify API Expansion** — Playback control + enhanced track polling (IPC, scopes, client functions)
2. **WP2: Session Participant Profiles** — Local user creation linked to Spotify IDs, `resolveSpotifyUser()`
3. **WP3: Session Lifecycle & State** — Zustand session state, start/end/join, provider configuration
4. **WP4: TrackSource Polling** — `useTrackSource` hook delegating to `SpotifyCollabSource`
5. **WP5: PlaybackProvider Controls** — `PlaybackBar` component through `PlaybackProvider` interface
6. **WP6: Enhanced SessionView** — Setup flow, turn display, live track list, playback bar, attribution

WP1+WP2 parallelizable. WP3-WP6 sequential.

## Related Concepts

- [[the-walled-garden-cracks]] — Coordinator model and service abstraction vision
- [[whtnxt-nextspec]] — Full technical specification
- [[architecture-whatnext]] — System architecture (adapter pattern, P2P, local-first)
- [[RxDB]] — Canonical local data store
- [[libp2p]] — P2P transport for future `P2PTrackSource`

## References

- Spotify Web API Feb 2026 Changelog: removed `POST /users/{id}/playlists`, field stripping
- Spotify Player Endpoints: `GET /me/player`, `PUT /me/player/play`, `PUT /me/player/pause`, `POST /me/player/next`
- Spotify Track Item: `added_by.id` field on collaborative playlist tracks

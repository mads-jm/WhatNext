---
tags:
  - architecture/decisions
  - architecture/patterns/p2p
  - core/net/p2p/relay
  - core/sessions
date created: Sunday, March 15th 2026, 12:00:00 am
date modified: Sunday, March 15th 2026, 12:00:00 am
---

# ADR: Remote Session Pairing Architecture

**Date**: 2026-03-15
**Status**: Accepted

#architecture/decisions

## Context

WhatNext sessions v1 (shipped 2026-03-07) established the provider abstraction layer and Spotify-based track source. All collaboration happened on the same LAN: mDNS discovers peers automatically, and WebRTC connects them. No cross-network pairing existed.

Milestone 1 (Remote Session Pairing) required answering four questions:

1. How do peers on different LANs find and connect to each other?
2. How does a host share session access in a zero-friction way?
3. How do we persist relay identity across server restarts without breaking invite links?
4. How do we handle playback control in a session where multiple peers could claim the right to control music?

## Decisions

### 1. Circuit Relay + DCUtR, not DHT

**Decision**: Use circuit relay v2 for initial cross-network connection and DCUtR for direct upgrade. Defer DHT-based peer discovery to Phase 2.

**Rationale**:
- DHT requires a bootstrapped network of peers. WhatNext has no peer network yet.
- Circuit relay is deterministic: the host's relay address is known at invite time.
- DCUtR fires automatically after the relay connection is established — no additional code needed once the service is wired into libp2p config.
- The relay-based approach is simpler to reason about for an MVP.

**Trade-off accepted**: Sessions require at least one peer to have a relay configured. Purely LAN sessions (mDNS) continue to work without a relay.

### 2. User-Configured Relay, Not Hardcoded

**Decision**: Relay addresses are stored in `userData/relay-config.json` (via `relay-config-store.ts`) and managed by users through Settings > P2P. No relay addresses are hardcoded in source.

**Rationale**: Hardcoding relay addresses in source code violates User Sovereignty. If the hardcoded relay goes offline or is discontinued, all users are broken with no recourse. User-configured relays mean:
- Users can self-host for full sovereignty
- A community relay can be shared without depending on WhatNext infrastructure
- Users are never silently broken by a service they don't control

**Trade-off accepted**: New users have no relay configured by default and must add one. The Settings > P2P UI with clear onboarding copy is required to mitigate the friction.

### 3. Invite URL with Encoded PeerId + Relay, Not @libp2p/rendezvous

**Decision**: Generate invite URLs of the form `whtnxt://connect/<peerId>?relay=<addr>&session=<id>`. Provide a 4-character base36 short code alongside for voice-friendly sharing.

**Rationale**: `@libp2p/rendezvous` does not exist as a published npm package. Even if it did, rendezvous requires a rendezvous server, adding infrastructure dependency. The invite URL encodes everything the joiner needs: the host's peer ID and a relay address through which to reach them. This requires no additional server beyond the relay.

The 4-character short code (`generateShortCode(id)` in `app/src/shared/core/protocol.ts`) truncates the session ID to a base36 value. It is not globally unique — it is for in-person convenience ("the code is X5R2") not for security. The full URL carries the authoritative identity.

**Trade-off accepted**: Invite URLs are long. The short code eases in-person sharing but cannot be the sole join mechanism.

### 4. Replication Pull-Request Bridge: Utility → Main → Renderer Correlation

**Decision**: When the utility process needs data from the renderer's RxDB (for responding to a remote peer's pull request), it sends a `REPLICATION_PULL_REQUEST` event to main, which forwards it to the renderer with a `requestId`. The renderer queries RxDB, calls `replication.respondToPullRequest(requestId, docs)`, which routes back to main and resolves a pending Promise in the utility process keyed by `requestId`.

**Rationale**: RxDB runs in the renderer (Chromium/IndexedDB). The utility process cannot access IndexedDB directly. The renderer must do the query. A simple request-response correlation with a `Map<requestId, {resolve, reject}>` and a 5-second timeout is sufficient. If the renderer does not respond in time, the utility resolves with an empty response so the remote peer is not left waiting forever.

**Trade-off accepted**: The 5-second timeout means a slow renderer could cause remote peers to see stale data. This is acceptable at MVP scale. If it becomes a problem, the timeout can be tuned or the renderer query path optimized.

### 5. Playback Mutex: Single Owner, Transferable

**Decision**: `SessionState` carries `playbackOwnerId: string` and `coHostIds: string[]`. Only the peer whose `localUser.id === playbackOwnerId` renders the active `PlaybackBar`. The host can transfer ownership to any co-host via a dropdown; a co-host can also claim ownership via a "Take Playback" button.

**Rationale**: Concurrent playback control (multiple peers all able to play/pause simultaneously) creates a poor user experience: controls fight each other and the playback state becomes unpredictable. A mutex with explicit transfer:
- Guarantees exactly one person controls playback at any moment
- Allows graceful handoff (host loses connectivity → co-host takes over)
- Mirrors the real-world "DJ" mental model: one person has the deck

**Trade-off accepted**: If the playback owner disconnects without handing off, playback control is temporarily lost until someone claims it. The "Take Playback" button for co-hosts mitigates this.

## Consequences

### Benefits

- Remote sessions work across NAT boundaries without requiring WhatNext infrastructure
- Invite URL format is self-contained and survives relay restarts (stable relay peer ID)
- Playback mutex is simple, predictable, and maps to real-world social norms
- The pull-request bridge is the minimal IPC required to keep RxDB in the renderer while P2P runs in the utility process

### Trade-offs Accepted

- Users must configure a relay to use remote sessions (no relay = LAN-only)
- Invite URLs are long; short codes are not globally unique
- 5-second pull-request timeout can produce stale data responses under load
- Playback mutex requires manual handoff if owner disconnects unexpectedly

## Alternatives Considered

### DHT Global Discovery
Would allow peers to find each other without shared relay knowledge. Rejected for MVP — requires bootstrapped peer network. Deferred to Phase 2.

### Hardcoded Community Relay
Would reduce new-user friction (relay works out-of-box). Rejected — violates User Sovereignty thesis. WhatNext infrastructure cannot be a single point of failure for core user-to-user features.

### @libp2p/rendezvous
Would enable rendezvous-point-based session discovery. Rejected — package not published on npm. The invite URL achieves the same outcome without a rendezvous server.

### Concurrent Playback Control
All participants can control playback simultaneously. Rejected — creates conflicting control states and contradicts the "DJ at the deck" social model.

### CRDT Replication Pull (no bridge)
Move RxDB to utility process to avoid the IPC bridge. Rejected — RxDB requires IndexedDB (Chromium API), which is only available in the renderer. The bridge is a structural constraint, not a design choice.

## References

- Related concepts: [[libp2p]], [[Circuit-Relay]], [[RxDB-Replication]], [[Sessions]]
- Spec: [[p2p-session-pairing-spec]]
- Relay config store: `app/src/main/relay-config-store.ts`
- Relay manager: `app/src/utility/relay-manager.ts`
- Protocol URL helpers: `app/src/shared/core/protocol.ts`
- IPC channels: `app/src/shared/core/ipc-protocol.ts`
- Session state: `app/src/renderer/stores/navigation-store.ts`
- Session interfaces: `app/src/shared/session-interfaces.ts`

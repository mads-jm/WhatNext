---
tags:
  - specs/p2p
  - core/net/p2p/relay
  - core/sessions
  - data/rxdb/replication
date created: Sunday, March 15th 2026, 12:00:00 am
date modified: Sunday, March 15th 2026, 12:00:00 am
---

# Spec: P2P Session Pairing (Milestones 1–3)

**Implemented**: 2026-03-15
**ADR**: [[adr-260315-p2p-session-pairing]]
**Status**: Shipped

This spec covers the implementation of remote session pairing across three milestones: cross-network [[Circuit-Relay|relay]] connectivity (M1), [[RxDB-Replication|RxDB replication]] wired to [[Sessions|sessions]] (M2), and the co-host/playback mutex model (M3).

---

## Milestone 1: Remote Session Pairing

### Relay Configuration Store

**File**: `app/src/main/relay-config-store.ts`
**Storage**: `userData/relay-config.json` (Electron `app.getPath('userData')`)

```typescript
// Public API
getRelayAddresses(): string[]
addRelayAddress(addr: string): void     // validates multiaddr format, persists
removeRelayAddress(addr: string): void  // removes by exact string match
```

The store is the sole source of relay addresses at runtime. `p2p-config.ts` no longer contains a static `RELAY.ADDRESSES` array. All relay addresses flow from `getRelayAddresses()` at node startup and on each `P2P_RELAY_ADD` / `P2P_RELAY_REMOVE` IPC event.

### Relay Server: Persistent Key

**File**: `relay/relay-server.mjs`

On first start, `loadOrCreateKey()` generates an ed25519 keypair via `@libp2p/crypto` and saves it to `relay/relay-key.json`. On subsequent starts, the persisted key is loaded. This guarantees a stable peer ID across restarts.

The relay peer ID appears in every invite URL. If it changed, previously shared links would be unresolvable.

**Backup instruction**: `relay-key.json` must be backed up. If lost, all previously distributed invite URLs become invalid and users must reshare.

### RelayManager

**File**: `app/src/utility/relay-manager.ts`

`RelayManager` is instantiated once in `p2p-service.ts` after the [[libp2p]] node starts. It accepts a list of multiaddr strings and:

1. Dials each relay address using `node.dial(multiaddr)`
2. On connection success, emits `{ status: 'connected', addr }` via the provided status callback
3. On failure, schedules a retry with exponential backoff
4. On `relay:remove`, cancels pending retries for that address and closes existing connection
5. Exposes a `shutdown()` method for graceful teardown

Status events are forwarded to the renderer via `webContents.send(P2P_RELAY_STATUS, payload)` in `main.ts`.

### DCUtR Integration

DCUtR is added to the libp2p services config in `p2p-service.ts`:

```typescript
import { dcutr } from '@libp2p/dcutr';

services: {
    identify: identify(),
    dcutr: dcutr(),
}
```

After two peers connect through the relay, DCUtR fires automatically. It coordinates a simultaneous dial from both sides, attempting to punch through both NATs. On success, a direct connection replaces the relayed one.

### Ping/Presence Protocol

**File**: `app/src/utility/protocols/ping.ts`
**Protocol ID**: `/whatnext/ping/1.0.0`

`registerPingProtocol(node)` registers the echo handler on the libp2p node.

`startPresenceTracking(node, onPresenceChange)` returns a cleanup function. It:
- Sends a ping to every connected peer every 30 seconds
- Uses a 10-second timeout per ping attempt
- Calls `onPresenceChange({ peerId, online: boolean })` on success or timeout
- Cleans up intervals/timeouts when the returned cleanup function is called

Presence events are forwarded to the renderer as `P2P_PEER_PRESENCE` IPC events.

### Invite URL Format

**File**: `app/src/shared/core/protocol.ts`

```
whtnxt://connect/<hostPeerId>?relay=<relayMultiaddr>&session=<sessionId>
```

- `<hostPeerId>`: the host's libp2p peer ID string (base58btc-encoded multihash)
- `<relayMultiaddr>`: URL-encoded multiaddr of the relay the host is connected through (e.g. `/ip4/1.2.3.4/tcp/4001/p2p/12D3KooW...`)
- `<sessionId>`: the RxDB playlist/session ID for the shared session

`createConnectUrl(peerId, relayAddr, sessionId)` constructs the URL.
`parseProtocolUrl(url)` returns `{ peerId, relay, session }` or `null` on parse failure.

### Short Code

`generateShortCode(id: string): string` returns the first 4 characters of `parseInt(id.slice(0, 8), 16).toString(36).toUpperCase()`. The result is always 4 characters, zero-padded if necessary.

The short code is displayed alongside the full invite URL in the `ShareSessionPanel` UI. It is for in-person verbal sharing only — not for programmatic join. The full URL is required for joining.

### New IPC Channels (Milestone 1)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `P2P_GET_INVITE_URL` | Renderer → Main | Get the full invite URL + short code for the current session |
| `P2P_JOIN_SESSION` | Renderer → Main | Dial host via peerId + relay from parsed invite URL |
| `P2P_RELAY_GET` | Renderer → Main | Get current relay address list |
| `P2P_RELAY_ADD` | Renderer → Main | Add a relay address |
| `P2P_RELAY_REMOVE` | Renderer → Main | Remove a relay address |
| `P2P_RELAY_STATUS` | Main → Renderer | Push relay connection status updates |
| `P2P_PEER_PRESENCE` | Main → Renderer | Push peer online/offline presence events |

### New UI Components (Milestone 1)

**`app/src/renderer/components/Settings/P2PSettings.tsx`**
- Lists configured relay addresses with live status indicators (green dot = connected, grey = disconnected)
- Add relay form with multiaddr format validation
- Remove button per relay
- Link to self-hosting relay documentation
- Subscribes to `onRelayStatus` events for live updates

**`app/src/renderer/components/Session/ShareSessionPanel.tsx`**
- Displays the full `whtnxt://` invite URL with a copy button
- Displays the 4-character short code with a copy button
- Input field accepting either a full invite URL or a short code for joining sessions

---

## Milestone 2: Replication Wired to Sessions

### useSessionReplication Hook

**File**: `app/src/renderer/hooks/useSessionReplication.ts`

Called from `SessionView.tsx` with `useSessionReplication(isActiveSession)`. The hook does nothing when `isActiveSession` is false.

When active:

**Outbound (push on change)**:

Subscribes to RxDB change streams for these collections: `playlists`, `tracks`, `trackInteractions`, `comments`, `users`. Each collection subscription is debounced by 500ms. On change, calls `window.electron.replication.pushChanges(collection, changedDocs)`.

**Inbound (apply remote changes)**:

Subscribes to `window.electron.replication.onReplicationChanges`. For each incoming document:
- If `doc.deleted === true`: calls `rxCollection.findOne(doc.id).remove()`
- Otherwise: calls `rxCollection.upsert(doc.data)`

**Pull-request response (serve remote peers)**:

Subscribes to `window.electron.replication.onPullRequest`. On each event:
1. Receives `{ requestId, collection, checkpoint }` — `checkpoint` is an ISO timestamp or `null`
2. Queries RxDB: all documents in `collection` where `updatedAt > checkpoint` (or all if checkpoint is null)
3. Calls `window.electron.replication.respondToPullRequest(requestId, docs)` to resolve the pending Promise in the utility process
4. Falls back to an empty response on any error (so the utility Promise is never left dangling)

### Replication Pull-Request Bridge

The bridge spans three process boundaries:

```
Remote Peer's Utility → [libp2p stream] → Local Utility
                                                |
                                         P2P_REPLICATION_PULL_REQUEST
                                                |
                                           Main Process
                                                |
                                    webContents.send(REPLICATION_PULL_REQUEST)
                                                |
                                           Renderer (RxDB query)
                                                |
                                    ipcRenderer.invoke(REPLICATION_PULL_RESPONSE)
                                                |
                                           Main Process
                                                |
                                    pendingPullRequests.get(requestId).resolve(docs)
                                                |
                                          Local Utility → [libp2p stream] → Remote Peer
```

The `pendingPullRequests` map lives in `main.ts` (not in the utility process). It maps `requestId → { resolve, reject }`. A 5-second `setTimeout` calls `resolve([])` if the renderer has not responded, ensuring the utility's awaiting Promise always resolves.

---

## Milestone 3: Co-Host Model + Playback Mutex

### SessionState Extensions

**File**: `app/src/shared/session-interfaces.ts`

```typescript
interface SessionState {
    // ... existing fields
    coHostIds: string[];         // peers who can claim playback ownership
    playbackOwnerId: string;     // peer ID of current playback controller
}

interface StartSessionConfig {
    // ... existing fields
    coHostIds?: string[];        // optional at session start; defaults to []
}
```

### Database Persistence

**File**: `app/src/renderer/db/schemas.ts`

`PlaylistDocType` gains an optional `coHostIds?: string[]` field. This persists co-host assignments across sessions started from the same playlist.

Schema version bumped from 1 to 2. Migration in `database.ts`:

```typescript
// v1 → v2
migrationStrategies: {
    2: (oldDoc) => ({ ...oldDoc, coHostIds: [] })
}
```

### Navigation Store: Playback Control Actions

**File**: `app/src/renderer/stores/navigation-store.ts`

```typescript
// Transfer playback ownership to another peer (host or current owner only)
handOffPlayback(toUserId: string): void

// Claim playback ownership (co-host or host only)
takePlayback(userId: string): void
```

Both actions update `sessionState.playbackOwnerId` in the Zustand store and trigger RxDB replication via the `useSessionReplication` hook's outbound push.

On `startSession()`, the store initialises:
```typescript
coHostIds: config.coHostIds ?? []
playbackOwnerId: config.hostId
```

### SessionView: Playback Gate

**File**: `app/src/renderer/components/Session/SessionView.tsx`

```typescript
const isPlaybackOwner = localUser.id === session.playbackOwnerId;
```

- `PlaybackBar` is rendered only when `isPlaybackOwner === true`
- When `isPlaybackOwner` is true, a handoff dropdown lists all co-hosts; selecting one calls `handOffPlayback(selectedId)`
- When the local user is a co-host but not the current owner, a "Take Playback" button is shown that calls `takePlayback(localUser.id)`
- Non-co-host participants see no playback controls at all

---

## libp2p v2 Stream API: Breaking Changes Applied

All protocol handlers in `handshake.ts`, `replication.ts`, and `ping.ts` were updated:

| Location | Old | New |
|----------|-----|-----|
| Reading from stream | `for await (const chunk of stream.source)` | `for await (const chunk of stream)` |
| Writing to stream | `await stream.sink([data])` | `await stream.send(data); await stream.close()` |
| StreamHandler args | `({ stream })` | `(stream, connection)` |
| peerStore iteration | `for await (const peer of peerStore.all())` | `const peers = await peerStore.all()` |
| mDNS config key | `serviceName` | `serviceTag` |
| Listen addresses | `P2P_CONFIG.LISTEN_ADDRESSES` (readonly array) | spread with `[...P2P_CONFIG.LISTEN_ADDRESSES]` |

---

## File Inventory

| File | Status | Purpose |
|------|--------|---------|
| `relay/relay-server.mjs` | Modified | Persistent ed25519 key via `loadOrCreateKey()` |
| `relay/package.json` | Modified | Added `@libp2p/crypto` |
| `app/package.json` | Modified | Added `@libp2p/dcutr` |
| `app/src/main/relay-config-store.ts` | New | User-persisted relay addresses |
| `app/src/shared/p2p-config.ts` | Modified | Removed static `RELAY.ADDRESSES` |
| `app/src/utility/relay-manager.ts` | New | Relay connect/retry/status manager |
| `app/src/utility/protocols/ping.ts` | New | `/whatnext/ping/1.0.0` heartbeat protocol |
| `app/src/utility/p2p-service.ts` | Modified | RelayManager, DCUtR, pull-request bridge, `getInviteData()` |
| `app/src/shared/core/ipc-protocol.ts` | Modified | New channels and payload types |
| `app/src/shared/core/protocol.ts` | Modified | `session` param in URL, `generateShortCode()` |
| `app/src/main/main.ts` | Modified | New IPC handlers for relay CRUD, invite URL, pull-request bridge |
| `app/src/main/preload.ts` | Modified | Exposed new p2p and replication APIs |
| `app/src/renderer/components/Settings/P2PSettings.tsx` | New | Relay management UI |
| `app/src/renderer/components/Session/ShareSessionPanel.tsx` | New | Session invite URL + short code UI |
| `app/src/renderer/hooks/useSessionReplication.ts` | New | RxDB change push/receive + pull-request response |
| `app/src/renderer/components/Session/SessionView.tsx` | Modified | `useSessionReplication`, playback mutex gate |
| `app/src/shared/session-interfaces.ts` | Modified | `coHostIds`, `playbackOwnerId` |
| `app/src/renderer/db/schemas.ts` | Modified | `coHostIds` on playlist, schema v2 |
| `app/src/renderer/db/database.ts` | Modified | v1→v2 migration |
| `app/src/renderer/stores/navigation-store.ts` | Modified | `handOffPlayback()`, `takePlayback()` |
| `app/src/main/handshake.ts` | Modified | libp2p v2 stream API |
| `app/src/utility/protocols/replication.ts` | Modified | libp2p v2 stream API |

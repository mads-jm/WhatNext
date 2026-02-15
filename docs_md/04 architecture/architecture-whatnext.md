---
title: WhatNext Architecture Design Document
version: 0.1.0
status: Living Document
created: 2026-02-14
updated: 2026-02-14
tags:
  - "#architecture/design"
  - "#core/architecture"
  - "#p2p/libp2p"
  - "#data/rxdb"
  - "#integration/spotify"
  - architecture/design
  - core/architecture
date created: Sunday, February 15th 2026, 7:36:38 am
date modified: Sunday, February 15th 2026, 8:27:28 pm
---

# WhatNext Architecture Design Document

## Changelog

| Version | Date       | Author       | Description                              |
|---------|------------|--------------|------------------------------------------|
| v0.1.0  | 2026-02-14 | WhatNext Dev | MVP baseline -- three-process Electron model, RxDB local-first data, libp2p P2P networking, Spotify import adapter |

---

## 1. Introduction

### 1.1 Purpose

This document defines the software architecture of WhatNext, a resilient, user-centric music management platform. It serves as the authoritative reference for how components are structured, how they communicate, and why specific technical decisions were made.

### 1.2 Scope

This architecture covers the MVP (Phase 1: Collaborative Playlist Accessory), including:

- The Electron desktop application and its three-process model
- Local-first data storage with RxDB over IndexedDB (Dexie adapter)
- P2P networking via libp2p for peer discovery and data replication
- Spotify integration as the first import adapter via OAuth PKCE
- The coordinator model for zero-friction collaborative sessions

### 1.3 Architectural Drivers

| Driver                   | Description                                                                 |
|--------------------------|-----------------------------------------------------------------------------|
| User Sovereignty         | Users own their data in local, readable formats. No vendor lock-in.         |
| Local-First              | The local database is canonical. Full functionality without internet.       |
| Decentralized            | P2P collaboration with no central server for core features.                 |
| Platform Abstraction     | Streaming services are interchangeable adapters, not dependencies.          |
| Security-by-Default      | Renderer sandbox enforced, encrypted P2P channels, minimal IPC surface.     |

### 1.4 Related Documents

- [[whtnxt-nextspec]] -- Technical specification (source of truth)
- [[adr-251110-electron-process-model]] -- Three-process architecture decision
- [[adr-251110-libp2p-vs-simple-peer]] -- Why libp2p over simple-peer
- [[adr-251109-database-storage-location]] -- RxDB storage location decision
- [[libp2p]], [[RxDB]], [[RxDB-Replication]], [[Circuit-Relay]], [[Handshake-Protocol]], [[Electron-IPC]], [[WebRTC]], [[Electron]]

---

## 2. Architectural Principles

### 2.1 User Sovereignty

The user's local database is the absolute source of truth. All external services (Spotify, future Apple Music, MusicBrainz) are enhancement layers that feed into the local store. Data is stored in user-accessible formats (RxDB over IndexedDB for runtime, with planned Markdown + YAML frontmatter plaintext export) so users can read, edit, and migrate their data without any WhatNext tooling.

### 2.2 Local-First

WhatNext is fully functional offline. The application reads from and writes to the local RxDB database before any network synchronization occurs. Network connectivity enhances the experience (P2P collaboration, Spotify import) but is never a prerequisite for core functionality.

### 2.3 Decentralized Collaboration

Peer-to-peer networking via libp2p enables collaborative playlist management without routing data through a central server. A helper service exists only for NAT traversal (circuit relay signaling) and OAuth coordination -- never for storing or processing user data.

### 2.4 Platform Abstraction

Streaming platform integrations are implemented as import adapters behind a common interface. The canonical internal data model (RxDB schemas) is platform-agnostic. Spotify is the first adapter; the architecture is designed for Apple Music, YouTube Music, local files, and MusicBrainz adapters to follow.

### 2.5 Security-by-Default

The renderer process runs in a sandboxed Chromium environment with `nodeIntegration: false` and `contextIsolation: true`. All main process communication passes through a preload script that exposes a minimal, explicit API via `contextBridge`. P2P connections use the Noise protocol for encryption. OAuth uses PKCE (no client secret stored).

---

## 3. System Context

The following C4 context diagram shows WhatNext and the external systems it interacts with.

```plantuml
@startuml WhatNext System Context
!include <C4/C4_Context>

title WhatNext - System Context Diagram

Person(user, "Music Listener", "Creates and manages collaborative playlists")

System(whatnext, "WhatNext Desktop App", "Electron application for collaborative, local-first music management")

System_Ext(spotify, "Spotify Web API", "Music streaming platform -- playlist and track metadata source")
System_Ext(relay, "Circuit Relay Server", "VPS running libp2p relay for NAT traversal (signaling only)")
System_Ext(musicbrainz, "MusicBrainz API", "Open music metadata database (future)")

System(peer, "WhatNext Peer", "Another WhatNext instance on the local network or reachable via relay")

Rel(user, whatnext, "Creates playlists, imports from Spotify, collaborates with peers")
Rel(whatnext, spotify, "OAuth PKCE auth, playlist/track import", "HTTPS")
Rel(whatnext, peer, "P2P replication, handshake, playlist sync", "libp2p (TCP/WS/WebRTC)")
Rel(whatnext, relay, "NAT traversal signaling for remote peers", "libp2p circuit-relay-v2")
Rel(whatnext, musicbrainz, "Metadata enrichment (future)", "HTTPS")

@enduml
```

---

## 4. Process Architecture

WhatNext uses a three-process Electron architecture, chosen to isolate the P2P networking stack from both the UI and the main process. See [[adr-251110-electron-process-model]] for the full decision record.

```plantuml
@startuml Electron Process Model
!include <C4/C4_Component>

title WhatNext - Electron Process Model

rectangle "Main Process\n(app/src/main/main.ts)" as main {
    component "Window Manager" as wm
    component "IPC Router" as ipc
    component "Spotify Auth\n(OAuth PKCE)" as spotify
    component "Utility Process\nManager" as upm
    component "Protocol Handler\n(whtnxt://)" as proto
    component "P2P State Cache" as p2pstate
}

rectangle "Renderer Process\n(app/src/renderer/)" as renderer {
    component "React 19 UI" as ui
    component "Zustand Store\n(UI state)" as zustand
    component "RxDB Database\n(IndexedDB/Dexie)" as rxdb
    component "IPC Client\n(via preload)" as ipcc
}

rectangle "Utility Process\n(app/src/utility/p2p-service.ts)" as utility {
    component "P2P Service\n(libp2p node)" as p2p
    component "Handshake Protocol\n/whatnext/handshake/1.0.0" as handshake
    component "Replication Protocol\n/whatnext/rxdb-replication/1.0.0" as repl
    component "Connection Manager\n(max 10 connections)" as connmgr
}

renderer -[#blue]-> main : "Electron IPC\n(ipcRenderer.invoke / ipcMain.handle)\nChannels: p2p:*, replication:*, spotify:*"
main -[#green]-> utility : "MessagePort\n(process.parentPort)\nMainToUtility / UtilityToMain enums"
main -[#blue]-> renderer : "webContents.send\n(push events to renderer)"

note right of main
  Node.js context.
  Manages lifecycle, windows, OS capabilities.
  Routes IPC between renderer and utility.
end note

note right of renderer
  Sandboxed Chromium.
  nodeIntegration: false
  contextIsolation: true
  Preload script as secure bridge.
end note

note right of utility
  Separate Node.js process.
  Spawned via utilityProcess.fork().
  Full Node.js capabilities, no window/UI.
  FaultTolerance.NO_FATAL for Windows.
end note

@enduml
```

### 4.1 Main Process (`app/src/main/main.ts`)

The main process runs in a Node.js context and is responsible for:

- __Window management__: Creating and configuring `BrowserWindow` instances
- __IPC routing__: Bridging communication between the renderer and utility processes
- __Spotify OAuth__: Handling the PKCE flow (code verifier generation, browser launch, callback processing, token exchange)
- __Utility process lifecycle__: Spawning the P2P utility process via `utilityProcess.fork()`, monitoring its health, relaying messages
- __Protocol URL handling__: Registering and processing `whtnxt://` custom protocol URLs (peer connections and Spotify callbacks)
- __P2P state caching__: Maintaining a `P2PStatusPayload` mirror so the renderer can poll status without round-tripping through the utility process

### 4.2 Renderer Process (`app/src/renderer/`)

The renderer runs React 19 in a sandboxed Chromium environment:

- __React UI__: Component tree for playlists, connections, Spotify import, session views
- __Zustand__: Non-persistent UI state (connection status, active views, UI preferences)
- __RxDB__: Local-first reactive database over IndexedDB via the Dexie adapter. Reactive queries drive UI re-renders.
- __IPC Client__: All main process communication goes through the preload-exposed `window.electron` API

### 4.3 Utility Process (`app/src/utility/p2p-service.ts`)

The utility process is a separate Node.js process spawned by Electron's `utilityProcess.fork()`:

- __libp2p node__: Full P2P networking stack with TCP, WebSockets, WebRTC, and circuit relay transports
- __Protocol handlers__: Handshake and replication protocol implementations
- __Connection management__: Peer discovery via mDNS, connection lifecycle, relay connectivity
- __Communication__: Receives commands from main via `process.parentPort` (MessagePort), sends events back

### 4.4 IPC Message Types

__Main to Utility__ (`MainToUtilityMessageType`):

| Message Type            | Purpose                                    |
|-------------------------|--------------------------------------------|
| `START_NODE`            | Initialize and start the libp2p node       |
| `STOP_NODE`             | Gracefully shut down the libp2p node       |
| `CONNECT_TO_PEER`       | Dial a peer by PeerId (optional relay)     |
| `DISCONNECT_FROM_PEER`  | Hang up connection to a peer               |
| `GET_DISCOVERED_PEERS`  | Request list of mDNS-discovered peers      |
| `GET_CONNECTED_PEERS`   | Request list of currently connected peers  |
| `REPLICATION_PUSH`      | Push RxDB documents to all connected peers |
| `REPLICATION_PULL`      | Pull RxDB documents from connected peers   |

__Utility to Main__ (`UtilityToMainMessageType`):

| Message Type              | Purpose                                       |
|---------------------------|-----------------------------------------------|
| `READY`                   | Utility process initialized, awaiting commands |
| `NODE_STARTED`            | libp2p node running, includes peerId + multiaddrs |
| `NODE_STOPPED`            | Node shut down cleanly                        |
| `NODE_ERROR`              | Fatal or non-fatal error in the P2P layer     |
| `PEER_DISCOVERED`         | New peer found via mDNS                       |
| `PEER_LOST`               | Previously discovered peer no longer visible  |
| `CONNECTION_ESTABLISHED`  | Successfully connected to a peer              |
| `CONNECTION_FAILED`       | Dial attempt failed                           |
| `CONNECTION_CLOSED`       | Peer disconnected                             |
| `CONNECTION_REQUEST`      | Inbound connection request from a peer        |
| `REPLICATION_CHANGES`     | Received replicated documents from a peer     |
| `REPLICATION_STATE`       | Replication sync state update                 |
| `HANDSHAKE_COMPLETE`      | Handshake protocol finished with a peer       |

__Renderer to Main__ (Electron IPC Channels):

| Channel Prefix    | Examples                                  | Direction         |
|-------------------|-------------------------------------------|-------------------|
| `p2p:*`           | `p2p:connect`, `p2p:disconnect`, `p2p:get-status` | Renderer -> Main |
| `p2p:*`           | `p2p:node-started`, `p2p:peer-discovered`, `p2p:connection-established` | Main -> Renderer |
| `replication:*`   | `replication:push`, `replication:pull`     | Renderer -> Main  |
| `replication:*`   | `replication:changes`, `replication:state` | Main -> Renderer  |
| `spotify:*`       | `spotify:auth-start`, `spotify:get-playlists`, `spotify:get-tracks` | Renderer -> Main |
| `spotify:*`       | `spotify:auth-complete`, `spotify:auth-error` | Main -> Renderer |

---

## 5. Component Architecture

```plantuml
@startuml WhatNext C4 Component Diagram
!include <C4/C4_Component>

title WhatNext - Component Architecture

Container_Boundary(renderer_boundary, "Renderer Process (Sandboxed Chromium)") {
    Component(react_ui, "React 19 UI", "TSX, Tailwind CSS", "Playlist management, P2P status, Spotify import, session views")
    Component(zustand_store, "Zustand Store", "Zustand", "Non-persistent UI state: connection status, active views, preferences")
    Component(rxdb_db, "RxDB Database", "RxDB + Dexie + IndexedDB", "Reactive local database: users, tracks, trackInteractions, playlists")
    Component(replication_handler, "Replication Handler", "TypeScript", "Bridges IPC replication events with local RxDB writes")
    Component(ipc_client, "IPC Client (Preload)", "contextBridge", "Type-safe API exposed as window.electron")
    Component(rx_hooks, "RxDB Hooks", "React Hooks", "useRxDBCollection -- reactive query subscriptions")

    Rel(react_ui, zustand_store, "Reads/writes UI state")
    Rel(react_ui, rx_hooks, "Subscribes to reactive queries")
    Rel(rx_hooks, rxdb_db, "RxDB .find().$")
    Rel(react_ui, ipc_client, "Invokes IPC methods")
    Rel(replication_handler, rxdb_db, "Applies remote changes")
    Rel(replication_handler, ipc_client, "Listens for replication:changes")
}

Container_Boundary(main_boundary, "Main Process (Node.js)") {
    Component(window_mgr, "Window Manager", "Electron BrowserWindow", "Creates windows, manages lifecycle, devtools")
    Component(ipc_router, "IPC Router", "ipcMain.handle", "Routes renderer requests to utility or local handlers")
    Component(spotify_auth, "Spotify Auth", "OAuth PKCE", "Code verifier/challenge generation, token exchange, refresh")
    Component(spotify_client, "Spotify Client", "fetch + token management", "API calls: playlists, tracks, token lifecycle")
    Component(spotify_mapper, "Spotify Mapper", "TypeScript", "Maps Spotify API responses to WhatNext TrackDocType")
    Component(utility_mgr, "Utility Process Manager", "utilityProcess.fork()", "Spawns, monitors, and communicates with P2P utility")
    Component(protocol_handler, "Protocol URL Handler", "whtnxt://", "Parses whtnxt:// URLs for peer connect and Spotify callback")
    Component(p2p_state, "P2P State Cache", "In-memory object", "Mirrors utility P2P state for renderer polling")

    Rel(ipc_router, utility_mgr, "Forwards P2P commands")
    Rel(ipc_router, spotify_auth, "Delegates auth requests")
    Rel(ipc_router, spotify_client, "Delegates API requests")
    Rel(spotify_client, spotify_mapper, "Maps responses")
    Rel(utility_mgr, p2p_state, "Updates cached state")
    Rel(protocol_handler, ipc_router, "Triggers connect/auth flows")
}

Container_Boundary(utility_boundary, "Utility Process (Node.js)") {
    Component(p2p_service, "P2P Service", "libp2p", "Full P2P node: TCP, WS, WebRTC, circuit relay transports")
    Component(handshake_proto, "Handshake Handler", "/whatnext/handshake/1.0.0", "Exchanges HandshakeData: displayName, version, capabilities, peerId")
    Component(replication_proto, "Replication Handler", "/whatnext/rxdb-replication/1.0.0", "Checkpoint-based document sync: push, pull-request, pull-response, push-ack")
    Component(conn_mgr, "Connection Manager", "libp2p connectionManager", "Max 10 connections, 30s dial timeout")
    Component(mdns_discovery, "mDNS Discovery", "@libp2p/mdns", "_whatnext._udp.local, 1s interval")

    Rel(p2p_service, handshake_proto, "Registers protocol")
    Rel(p2p_service, replication_proto, "Registers protocol")
    Rel(p2p_service, conn_mgr, "Manages connections")
    Rel(p2p_service, mdns_discovery, "Discovers local peers")
}

Rel(ipc_client, ipc_router, "Electron IPC (invoke/handle)")
Rel(ipc_router, ipc_client, "webContents.send (push events)")
Rel(utility_mgr, p2p_service, "MessagePort (postMessage)")
Rel(p2p_service, utility_mgr, "process.parentPort (events)")

@enduml
```

---

## 6. Data Architecture

### 6.1 Storage Layers

```plantuml
@startuml Data Storage Layers
!include <C4/C4_Component>

title WhatNext - Data Storage Layers

rectangle "Application Layer" {
    component "React Components" as react
    component "Zustand Store\n(volatile UI state)" as zustand
}

rectangle "Database Layer" {
    component "RxDB\n(Reactive queries, schema validation)" as rxdb
    component "Collections:\nusers | tracks | trackInteractions | playlists" as collections
}

rectangle "Storage Engine" {
    component "Dexie.js\n(IndexedDB wrapper)" as dexie
}

rectangle "Browser Storage" {
    component "IndexedDB\n(whatnext_db)" as idb
}

rectangle "Disk" {
    database "Chromium IndexedDB Files\n(app/userData/)" as disk
}

rectangle "Future: Plaintext Export" as future #lightyellow {
    component "Markdown + YAML Frontmatter\n(user-accessible files on disk)" as plaintext
}

react --> zustand : "UI state\n(non-persistent)"
react --> rxdb : "Reactive queries\n(.find().$)"
rxdb --> collections : "Schema v0\nall collections"
collections --> dexie : "CRUD operations"
dexie --> idb : "Indexed reads/writes"
idb --> disk : "Persisted by Chromium"
rxdb ..> plaintext : "Planned export/import\n(Phase 2+)"

@enduml
```

### 6.2 RxDB Schema Summary

All schemas are at version 0. The database name is `whatnext_db`.

__users__ -- Peer identity and status tracking

| Field         | Type    | Required | Indexed | Notes                              |
|---------------|---------|----------|---------|-------------------------------------|
| `id`          | string  | PK       | PK      | Unique peer ID                      |
| `displayName` | string  | Yes      | No      |                                     |
| `avatarUrl`   | string  | No       | No      |                                     |
| `isLocal`     | boolean | Yes      | Yes     | True for the local user             |
| `lastSeenAt`  | string  | Yes      | Yes     | ISO 8601 timestamp                  |
| `publicKey`   | string  | No       | No      | Future encryption/verification      |
| `createdAt`   | string  | Yes      | No      | ISO 8601 timestamp                  |

__tracks__ -- Music tracks with attribution

| Field        | Type     | Required | Indexed | Notes                            |
|--------------|----------|----------|---------|-----------------------------------|
| `id`         | string   | PK       | PK      |                                   |
| `title`      | string   | Yes      | No      |                                   |
| `artists`    | string[] | Yes      | No      | Array of artist names             |
| `album`      | string   | Yes      | No      |                                   |
| `durationMs` | number   | Yes      | No      | Track duration in milliseconds    |
| `spotifyId`  | string   | No       | No      | Optional Spotify track ID         |
| `addedAt`    | string   | Yes      | Yes     | ISO 8601 timestamp                |
| `addedBy`    | string   | Yes      | Yes     | User ID of who added this track   |
| `notes`      | string   | No       | No      | User notes (local user only)      |

__trackInteractions__ -- User-track relationships for social features

| Field            | Type   | Required | Indexed | Notes                                          |
|------------------|--------|----------|---------|-------------------------------------------------|
| `id`             | string | PK       | PK      | Composite: `${userId}_${trackId}_${interactionType}` |
| `userId`         | string | Yes      | Yes     |                                                 |
| `trackId`        | string | Yes      | Yes     |                                                 |
| `playlistId`     | string | No       | No      | Context of the interaction                      |
| `interactionType`| string | Yes      | Yes     | Enum: `vote`, `like`, `skip`, `play`, `queue`   |
| `value`          | number | No       | No      | For votes (+1/-1) or play counts                |
| `createdAt`      | string | Yes      | No      | ISO 8601 timestamp                              |
| `updatedAt`      | string | Yes      | Yes     | ISO 8601 timestamp                              |
| `metadata`       | string | No       | No      | JSON string for extensible data                 |

__playlists__ -- Collaborative playlists with ownership and permissions

| Field              | Type     | Required | Indexed | Notes                                                  |
|--------------------|----------|----------|---------|--------------------------------------------------------|
| `id`               | string   | PK       | PK      |                                                        |
| `playlistName`     | string   | Yes      | No      |                                                        |
| `description`      | string   | No       | No      |                                                        |
| `trackIds`         | string[] | Yes      | No      | Ordered list of track IDs                              |
| `createdAt`        | string   | Yes      | No      | ISO 8601 timestamp                                     |
| `updatedAt`        | string   | Yes      | Yes     | ISO 8601 timestamp                                     |
| `ownerId`          | string   | Yes      | Yes     | User ID of playlist creator                            |
| `collaboratorIds`  | string[] | Yes      | No      | User IDs with write access                             |
| `isCollaborative`  | boolean  | Yes      | Yes     | Whether P2P collaboration is enabled                   |
| `isPublic`         | boolean  | Yes      | No      | Whether discoverable (future)                          |
| `linkedSpotifyId`  | string   | No       | No      | Spotify playlist ID                                    |
| `spotifySyncMode`  | string   | No       | No      | Enum: `accessory`, `true_collaborate`, `proxy_owner`   |
| `tags`             | string[] | Yes      | No      | User-defined tags                                      |
| `queueMode`        | string   | No       | No      | Enum: `free_for_all`, `turn_taking`, `vote_based`      |
| `currentTurnUserId`| string   | No       | No      | For `turn_taking` mode                                 |

> __Note on Dexie indexes__: Optional fields cannot be indexed with the Dexie adapter. This is why `spotifyId` (tracks), `playlistId` (trackInteractions), and `linkedSpotifyId` (playlists) are not indexed despite being useful query targets.

### 6.3 Local Data Flow

```plantuml
@startuml Local Data Flow
title WhatNext - Local Data Flow

actor User
participant "React Component" as RC
participant "Zustand Store" as ZS
participant "RxDB" as DB
participant "IndexedDB/Dexie" as IDB

User -> RC : Interaction\n(e.g., add track to playlist)
RC -> ZS : Update UI state\n(optimistic)
RC -> DB : db.playlists.upsert(doc)
DB -> IDB : Write via Dexie
IDB --> DB : Ack
DB --> RC : Reactive query emits\n(.find().$ observable)
RC -> RC : Re-render with\nupdated data

note over ZS
  Zustand holds volatile state:
  - Connection status
  - Active view/tab
  - UI preferences
  Not persisted across restarts.
end note

note over DB
  RxDB holds persistent state:
  - Users, tracks, playlists
  - Track interactions
  Survives restarts via IndexedDB.
  Reactive queries auto-update UI.
end note

@enduml
```

### 6.4 P2P Replication Flow

```plantuml
@startuml P2P Replication Flow
title WhatNext - P2P Replication Flow

participant "Local RxDB\n(Renderer)" as LDB
participant "Replication Handler\n(Renderer)" as RH
participant "IPC Client\n(Preload)" as IPC_R
participant "Main Process\nIPC Router" as Main
participant "Utility Process\nP2P Service" as Utility
participant "libp2p Stream" as Stream
participant "Remote Peer\nUtility Process" as Remote
participant "Remote Peer\nMain -> Renderer" as RemoteR

== Push: Local Change to Remote ==

LDB -> RH : RxDB change event\n(new/updated document)
RH -> IPC_R : replication:push\n{collection, documents[]}
IPC_R -> Main : ipcRenderer.invoke()
Main -> Utility : postMessage\n(REPLICATION_PUSH)
Utility -> Stream : dialProtocol\n(/whatnext/rxdb-replication/1.0.0)
Utility -> Stream : writeStreamMessage\n{type:"push", collection, documents}
Stream -> Remote : libp2p stream
Remote -> Remote : onPushReceived callback
Remote -> RemoteR : REPLICATION_CHANGES\n(via parentPort -> webContents.send)
RemoteR -> RemoteR : Apply to local RxDB\n(LWW conflict resolution)
Remote -> Stream : push-ack

== Pull: Request Changes from Remote ==

RH -> IPC_R : replication:pull\n{collection, checkpoint}
IPC_R -> Main : ipcRenderer.invoke()
Main -> Utility : postMessage\n(REPLICATION_PULL)
Utility -> Stream : dialProtocol
Utility -> Stream : {type:"pull-request",\ncollection, checkpoint, limit}
Stream -> Remote : libp2p stream
Remote -> Remote : onPullRequest callback
Remote -> Stream : {type:"pull-response",\ncollection, documents, checkpoint}
Stream -> Utility : readStreamMessage
Utility -> Main : REPLICATION_CHANGES
Main -> RH : replication:changes event
RH -> LDB : Apply documents

@enduml
```

### 6.5 Conflict Resolution

__Current strategy: Last-Write-Wins (LWW)__

Each `ReplicationDocument` carries an `updatedAt` ISO timestamp. When two peers modify the same document concurrently, the document with the later `updatedAt` value wins. This is simple and sufficient for the MVP, where collaborative sessions are typically synchronous.

__Migration path: CRDTs__

The architecture is designed for eventual migration to CRDTs (Conflict-free Replicated Data Types). The replication protocol's checkpoint-based design and per-document sync granularity are compatible with CRDT-based merge functions. The `trackInteractions` collection (votes, likes) is a natural candidate for CRDT counters. Ordered lists (playlist `trackIds`) will require a sequence CRDT (e.g., RGA or LSEQ) for true concurrent editing support.

---

## 7. P2P Networking Architecture

### 7.1 Network Topology

```plantuml
@startuml Network Topology
title WhatNext - P2P Network Topology

cloud "Internet" as inet {
    node "Circuit Relay Server\n(VPS)" as relay {
        component "libp2p relay v2" as relayv2
    }
}

node "Local Network A" as netA {
    rectangle "Peer A\n(WhatNext)" as peerA
    rectangle "Peer B\n(WhatNext)" as peerB
}

node "Local Network B (NAT)" as netB {
    rectangle "Peer C\n(WhatNext)" as peerC
}

peerA <-[#green]-> peerB : "Direct TCP/WS\n(mDNS discovered)"
peerA <-[#blue,dashed]-> relay : "Relay connection\n(circuit-relay-v2)"
peerC <-[#blue,dashed]-> relay : "Relay connection\n(circuit-relay-v2)"
peerA <.[#orange].> peerC : "Relayed via\ncircuit relay\nor WebRTC"

note bottom of peerA
  Listens on:
  /ip4/127.0.0.1/tcp/0
  /ip4/127.0.0.1/tcp/0/ws
  Remote peers use WebRTC/relay.
end note

note bottom of relay
  Signaling only.
  No user data stored.
  Peers relay through
  for NAT traversal.
end note

legend right
  |= Connection Type |= Protocol |
  | Local (same network) | TCP or WebSocket via mDNS |
  | Remote (across NAT) | Circuit Relay v2 / WebRTC |
  | All connections | Noise encryption + Yamux mux |
endlegend

@enduml
```

### 7.2 Connection Establishment

```plantuml
@startuml Connection Establishment
title WhatNext - Peer Connection Establishment

participant "Peer A\nUtility Process" as A
participant "mDNS" as MDNS
participant "Peer B\nUtility Process" as B

== Discovery Phase ==

A -> MDNS : Broadcast presence\n(_whatnext._udp.local, 1s interval)
B -> MDNS : Broadcast presence\n(_whatnext._udp.local, 1s interval)
MDNS -> A : peer:discovery event\n(Peer B's PeerId + multiaddrs)
MDNS -> B : peer:discovery event\n(Peer A's PeerId + multiaddrs)

A -> A : Notify main process\n(PEER_DISCOVERED)

== Connection Phase ==

A -> B : libp2p.dial(peerB)\n(tries known multiaddrs)
B -> A : peer:connect event
A -> A : peer:connect event
A -> A : Notify main\n(CONNECTION_ESTABLISHED)

== Handshake Phase ==

A -> B : dialProtocol\n(/whatnext/handshake/1.0.0)
A -> B : JSON: {displayName, version,\ncapabilities[], peerId}
B -> B : readMessage (parse handshake)
B -> A : newStream (handshake response)
B -> A : JSON: {displayName, version,\ncapabilities[], peerId}
A -> A : Notify main\n(HANDSHAKE_COMPLETE)
B -> B : Notify main\n(HANDSHAKE_COMPLETE)

== Replication Ready ==

note over A, B
  Both peers now know each other's
  displayName, version, and capabilities.
  Replication can begin via
  /whatnext/rxdb-replication/1.0.0
end note

@enduml
```

### 7.3 libp2p Stack Configuration

| Layer           | Technology                    | Configuration                                   |
|-----------------|-------------------------------|--------------------------------------------------|
| Transports      | TCP, WebSockets, WebRTC, Circuit Relay v2 | TCP + WS on localhost:0; WebRTC for remote peers |
| Encryption      | Noise protocol                | `@chainsafe/libp2p-noise`                        |
| Multiplexing    | Yamux                         | `@chainsafe/libp2p-yamux`                        |
| Discovery       | mDNS                          | `_whatnext._udp.local`, 1000ms interval          |
| Services        | Identify                      | Required for WebRTC transport                    |
| Connection Mgr  | libp2p built-in               | `maxConnections: 10`                             |
| Fault Tolerance | `FaultTolerance.NO_FATAL`     | Windows Electron utility process compatibility   |

### 7.4 Protocol Specifications

__Handshake Protocol__ (`/whatnext/handshake/1.0.0`)

Exchanged after connection to share peer metadata. Uses JSON-over-stream.

```typescript
interface HandshakeData {
    displayName: string;   // Human-readable peer name
    version: string;       // Protocol version (e.g., "1.0.0")
    capabilities: string[];// Supported features: ["playlist-sync", "rxdb-replication"]
    peerId: string;        // libp2p PeerId as string
}
```

__Replication Protocol__ (`/whatnext/rxdb-replication/1.0.0`)

Checkpoint-based document synchronization. Uses JSON-over-stream with four message types:

```typescript
type ReplicationMessageType = 'pull-request' | 'pull-response' | 'push' | 'push-ack';

interface ReplicationMessage {
    type: ReplicationMessageType;
    collection: string;               // RxDB collection name
    documents?: ReplicationDocument[]; // For push and pull-response
    checkpoint?: string | null;        // ISO timestamp for incremental sync
    limit?: number;                    // Max documents per pull (default: 100)
}

interface ReplicationDocument {
    id: string;
    data: Record<string, unknown>;
    updatedAt: string;  // ISO timestamp (used for LWW resolution)
    deleted?: boolean;  // Soft delete flag
}
```

Message flow:
1. __pull-request__: "Give me documents updated after this checkpoint"
2. __pull-response__: "Here are the documents and the new checkpoint"
3. __push__: "Here are documents I've changed"
4. __push-ack__: "I received your push"

__Playlist Sync Protocol__ (`/whatnext/playlist-sync/1.0.0`) -- Defined in configuration but not yet implemented. Reserved for real-time collaborative queue operations (turn-taking, vote-based ordering).

### 7.5 NAT Traversal Strategy

1. __Local network__: mDNS discovery enables zero-configuration connection between peers on the same subnet. Peers dial directly via TCP or WebSocket.

2. __Remote peers (across NAT)__: Circuit relay v2 provides NAT traversal. The relay server is a lightweight VPS running a libp2p relay node. The relay handles only signaling -- no user data passes through it. Configuration is in `P2P_CONFIG.RELAY` with auto-connect, retry intervals (10s), and max retries (5).

3. __WebRTC__: Available as a transport for browser-to-browser and NAT-punched connections. Requires the identify service and circuit relay transport as dependencies.

---

## 8. Integration Architecture

### 8.1 Import Adapter Pattern

```plantuml
@startuml Adapter Pattern
title WhatNext - Import Adapter Pattern (Class Diagram)

interface "ImportAdapter" as IA {
    +connect(): Promise<AuthResult>
    +fetchPlaylists(): Promise<PlaylistMetadata[]>
    +fetchTracks(playlistId: string): Promise<TrackMetadata[]>
    +normalize(tracks: TrackMetadata[]): TrackDocType[]
}

class "SpotifyAdapter" as SA {
    -spotifyAuth: SpotifyAuth
    -spotifyClient: SpotifyClient
    -spotifyMapper: SpotifyMapper
    +connect(): Opens OAuth PKCE browser flow
    +fetchPlaylists(): GET /v1/me/playlists
    +fetchTracks(id): GET /v1/playlists/{id}/tracks
    +normalize(items): mapSpotifyTracks()
}

class "AppleMusicAdapter" as AMA #lightyellow {
    <<future>>
    +connect()
    +fetchPlaylists()
    +fetchTracks()
    +normalize()
}

class "LocalFilesAdapter" as LFA #lightyellow {
    <<future>>
    +connect()
    +fetchPlaylists()
    +fetchTracks()
    +normalize()
}

class "MusicBrainzAdapter" as MBA #lightyellow {
    <<future - metadata enrichment>>
    +connect()
    +fetchPlaylists()
    +fetchTracks()
    +normalize()
}

IA <|.. SA : implements
IA <|.. AMA : implements
IA <|.. LFA : implements
IA <|.. MBA : implements

package "Canonical Format (RxDB Schemas)" as canonical {
    class "TrackDocType" as TDT {
        +id: string
        +title: string
        +artists: string[]
        +album: string
        +durationMs: number
        +spotifyId?: string
        +addedAt: string
        +addedBy: string
        +notes?: string
    }

    class "PlaylistDocType" as PDT {
        +id: string
        +playlistName: string
        +trackIds: string[]
        +ownerId: string
        +collaboratorIds: string[]
        +isCollaborative: boolean
        +linkedSpotifyId?: string
        +spotifySyncMode?: enum
        ...
    }
}

SA --> TDT : "normalizes to"
SA --> PDT : "normalizes to"

note right of SA
  Currently implemented.
  Uses OAuth PKCE (no client secret).
  Scopes: playlist-read-private,
  playlist-read-collaborative,
  user-library-read.
end note

note bottom of canonical
  All adapters normalize to
  the same RxDB document types.
  Platform-specific IDs stored
  as optional fields (e.g., spotifyId).
end note

@enduml
```

### 8.2 Spotify Import Sequence

```plantuml
@startuml Spotify Import Sequence
title WhatNext - Spotify Import Flow

actor User
participant "React UI\n(SpotifyImport)" as UI
participant "Preload\n(window.electron.spotify)" as Pre
participant "Main Process" as Main
participant "Spotify Auth\n(PKCE)" as Auth
participant "Spotify Client" as Client
participant "Spotify Mapper" as Mapper
participant "System Browser" as Browser
participant "Spotify Web API" as API

== OAuth PKCE Authentication ==

User -> UI : Click "Connect Spotify"
UI -> Pre : spotify.startAuth()
Pre -> Main : ipcRenderer.invoke('spotify:auth-start')
Main -> Auth : startSpotifyAuth()
Auth -> Auth : Generate PKCE pair\n(verifier + SHA256 challenge)
Auth -> Browser : shell.openExternal(authUrl)\nwith code_challenge
Browser -> API : User authorizes\n(Spotify login page)
API -> Browser : Redirect to\nwhtnxt://spotify-callback?code=xxx

Browser -> Main : whtnxt:// protocol handler
Main -> Auth : handleSpotifyCallback(code)
Auth -> API : POST /api/token\n(code + code_verifier)
API --> Auth : {access_token, refresh_token, expires_in}
Auth --> Main : SpotifyTokens
Main -> Main : saveTokens() + initSpotifyClient()
Main -> UI : spotify:auth-complete event

== Playlist Import ==

User -> UI : Click "Import Playlists"
UI -> Pre : spotify.getPlaylists()
Pre -> Main : ipcRenderer.invoke('spotify:get-playlists')
Main -> Client : getUserPlaylists()
Client -> API : GET /v1/me/playlists
API --> Client : {items: SpotifyPlaylist[]}
Client --> Main : Playlist list
Main --> UI : {success, playlists[], total}

User -> UI : Select playlist, click "Import"
UI -> Pre : spotify.getTracks(playlistId)
Pre -> Main : ipcRenderer.invoke('spotify:get-tracks', id)
Main -> Client : getPlaylistTracks(playlistId)
Client -> API : GET /v1/playlists/{id}/tracks
API --> Client : {items: SpotifyTrackItem[]}
Main -> Mapper : mapSpotifyTracks(items, userId)
Mapper -> Mapper : Filter nulls, map fields\n{id: uuid, title, artists[], album,\ndurationMs, spotifyId, addedAt, addedBy}
Mapper --> Main : MappedTrack[]
Main --> UI : {success, tracks[], total}

UI -> UI : Store tracks in RxDB\n(renderer-side)

@enduml
```

### 8.3 Coordinator Model

The coordinator model enables zero-friction collaborative sessions:

1. __Coordinator connects to source__: The session initiator authenticates with Spotify (only they need OAuth), imports a playlist, and normalizes it to canonical format in RxDB.
2. __Coordinator opens P2P session__: A `whtnxt://connect/<peerId>` link is generated and shared.
3. __Participants join__: Peers connect via the link. No Spotify authentication required for participants -- they receive normalized track data over P2P replication.
4. __Collaboration in WhatNext P2P layer__: All participants can add tracks, vote, and interact. Changes replicate in real-time via the replication protocol.
5. __Optional sync-back__: The coordinator can optionally push changes back to the source platform (Spotify) via the appropriate sync mode (`accessory`, `true_collaborate`, or `proxy_owner` per spec section 8.1).

---

## 9. Deployment Architecture

```plantuml
@startuml Deployment Architecture
title WhatNext - Deployment Architecture

node "User Desktop\n(Windows / macOS / Linux)" as desktop {
    artifact "WhatNext.exe / .app / .AppImage" as app {
        component "Main Process" as main_d
        component "Renderer\n(Chromium)" as renderer_d
        component "Utility Process\n(libp2p)" as utility_d
    }
    database "IndexedDB\n(whatnext_db)" as idb_d
    file "Token Store\n(electron-store)" as tokens_d
}

node "VPS (Optional)" as vps {
    component "Circuit Relay Server\n(libp2p relay v2)" as relay_d
}

cloud "External Services" as ext {
    component "Spotify Web API\n(accounts.spotify.com\napi.spotify.com)" as spotify_d
    component "MusicBrainz API\n(future)" as mb_d
}

main_d --> renderer_d : Electron IPC
main_d --> utility_d : MessagePort
utility_d --> idb_d : (indirect via renderer)
main_d --> tokens_d : Read/write OAuth tokens
utility_d <--> relay_d : "libp2p\ncircuit-relay-v2\n(TCP/WS)"
main_d --> spotify_d : "HTTPS\n(OAuth + API calls)"
main_d ..> mb_d : "HTTPS\n(future)"

note bottom of desktop
  Packaged with electron-builder.
  No native dependencies (currently).
  All user data stored locally.
end note

note bottom of vps
  Lightweight relay only.
  No user data stored.
  Optional -- local network
  peers work without it.
end note

@enduml
```

### 9.1 Build and Packaging

| Component       | Build Tool | Output              | Format |
|-----------------|------------|----------------------|--------|
| Main process    | tsup       | `app/dist/main.js`   | CJS    |
| Preload script  | tsup       | `app/dist/preload.js` | CJS   |
| Utility process | tsup       | `app/dist/p2p-service.mjs` | ESM |
| Renderer        | Vite       | `app/dist/` (HTML/JS/CSS) | ESM  |
| Packaging       | electron-builder | Platform-specific installers | --  |

The utility process is built as ESM (`p2p-service.mjs`) because libp2p and its dependencies are ESM-only packages. The main and preload processes use CJS for Electron compatibility.

---

## 10. Security Architecture

### 10.1 Threat Model Summary

| Threat                          | Mitigation                                                      |
|---------------------------------|------------------------------------------------------------------|
| Malicious code in renderer      | Sandbox: `nodeIntegration: false`, `contextIsolation: true`      |
| XSS via external content        | No remote content loaded; external links open in system browser  |
| OAuth token theft                | PKCE flow (no client secret); tokens stored via electron-store   |
| P2P eavesdropping               | All libp2p connections encrypted with Noise protocol             |
| Malicious peer data             | Schema validation in RxDB (AJV in dev mode); message type checking |
| Renderer window hijacking       | `setWindowOpenHandler` returns `{ action: 'deny' }` globally     |
| Protocol URL injection          | `parseProtocolUrl()` validates scheme, action, and PeerId format |
| Utility process crash           | Exit handler notifies renderer; does not crash main process      |

### 10.2 Renderer Sandbox

The renderer process operates under strict security constraints:

```typescript
webPreferences: {
    nodeIntegration: false,    // No Node.js APIs in renderer
    contextIsolation: true,    // Separate JS contexts for preload and renderer
    preload: preloadPath,      // Explicit preload script path
}
```

The preload script (`app/src/main/preload.ts`) exposes a minimal, typed API via `contextBridge.exposeInMainWorld('electron', electronHandler)`. The renderer accesses this as `window.electron`. No raw `ipcRenderer` access is available to renderer code.

### 10.3 OAuth PKCE

Spotify integration uses the PKCE (Proof Key for Code Exchange) extension, designed for public clients:

1. Main process generates a cryptographically random `code_verifier` (32 bytes, base64url)
2. SHA-256 hashes it to produce `code_challenge`
3. `code_challenge` is sent with the authorization request
4. `code_verifier` is sent with the token exchange request
5. No client secret is stored or transmitted

### 10.4 P2P Encryption

All libp2p connections use the __Noise protocol__ (`@chainsafe/libp2p-noise`) for authenticated encryption. This provides:

- Confidentiality: All stream data is encrypted
- Integrity: Tampered messages are detected and rejected
- Authentication: Peers are authenticated by their libp2p PeerId (public key)

### 10.5 Message Validation

- All IPC messages conform to the `IPCMessage<T>` interface with a `type`, `payload`, `timestamp`, and optional `requestId`
- The utility process validates message types against `MainToUtilityMessageType` enum before processing
- Replication documents are typed as `ReplicationDocument` with required `id`, `data`, and `updatedAt` fields
- Protocol URLs are validated for scheme (`whtnxt:`), action (enum check), and PeerId format (prefix + charset validation)

---

## 11. Technology Stack

| Technology         | Version   | Purpose                                    | Rationale                                              |
|--------------------|-----------|--------------------------------------------|---------------------------------------------------------|
| Electron           | Latest    | Desktop application framework              | Cross-platform, mature, supports utility processes      |
| React              | 19        | UI framework                               | Component model, hooks, concurrent features             |
| TypeScript         | Strict    | Type safety across all processes            | Catch errors at compile time, self-documenting code     |
| Vite               | Latest    | Renderer build tool and dev server          | Fast HMR, ESM-native, minimal config                   |
| Tailwind CSS       | Latest    | Utility-first styling                       | Rapid UI development, small bundle with purge           |
| Zustand            | Latest    | Lightweight state management                | Simple API, no boilerplate, non-persistent UI state     |
| RxDB               | Latest    | Reactive local-first database               | Reactive queries, replication-ready, IndexedDB storage  |
| Dexie.js           | Latest    | IndexedDB wrapper (RxDB storage engine)     | Reliable IndexedDB access, used via RxDB storage plugin |
| libp2p             | Latest    | P2P networking framework                    | Modular, multi-transport, battle-tested ([[adr-251110-libp2p-vs-simple-peer]]) |
| @chainsafe/libp2p-noise | Latest | Connection encryption                  | Authenticated encryption, libp2p standard               |
| @chainsafe/libp2p-yamux | Latest | Stream multiplexing                    | Efficient multiplexing, low overhead                    |
| @libp2p/tcp        | Latest    | TCP transport                              | Reliable local connections                              |
| @libp2p/websockets | Latest    | WebSocket transport                        | Browser compatibility (future web client)               |
| @libp2p/webrtc     | Latest    | WebRTC transport                           | NAT traversal, browser-to-browser                       |
| @libp2p/circuit-relay-v2 | Latest | Circuit relay transport              | NAT traversal signaling                                 |
| @libp2p/mdns       | Latest    | mDNS peer discovery                        | Zero-config local network discovery                     |
| @libp2p/identify   | Latest    | Peer identification service                | Required by WebRTC transport                            |
| tsup               | Latest    | Main/preload/utility bundler               | Fast TypeScript bundler, supports CJS and ESM           |
| electron-builder   | Latest    | Application packaging                      | Cross-platform installers and auto-update               |
| uuid               | Latest    | Unique ID generation                       | Track and entity IDs                                    |
| concurrently       | Latest    | Parallel dev process runner                | Runs Vite, tsup watchers, and Electron simultaneously   |

---

## 12. File Structure Map

```ts
app/
  src/
    main/                              # Main Process (Node.js context)
      main.ts                          # Entry point: window, IPC routing, utility lifecycle, protocol handler
      preload.ts                       # Secure bridge: contextBridge API exposed as window.electron
      menu.ts                          # Application menu configuration
      utils/
        environment.ts                 # isDev helper
        path.ts                        # Path utilities
      spotify/
        spotify-auth.ts                # OAuth PKCE flow: verifier/challenge, token exchange, refresh
        spotify-client.ts              # Spotify API client: playlists, tracks, token management
        spotify-mapper.ts              # Maps SpotifyTrackItem -> MappedTrack (WhatNext canonical format)
        token-store.ts                 # Persists OAuth tokens via electron-store
      types/
        index.ts                       # Main process types (PKCEPair, SpotifyTokens)
        spotify.ts                     # Spotify API response types

    renderer/                          # Renderer Process (Sandboxed Chromium)
      index.tsx                        # React entry point
      App.tsx                          # Root component
      components/
        Connection/
          ConnectionStatus.tsx         # P2P connection status display
        Layout/
          Toolbar.tsx                  # Top toolbar
          Sidebar.tsx                  # Navigation sidebar
        P2P/
          P2PStatus.tsx                # Detailed P2P node status (dev view)
        Playlist/
          PlaylistList.tsx             # Playlist listing
          PlaylistView.tsx             # Single playlist view with tracks
          CreatePlaylistDialog.tsx     # New playlist creation dialog
        Session/
          SessionView.tsx              # Collaborative session view
        Spotify/
          SpotifyImport.tsx            # Spotify import UI
      db/
        database.ts                    # RxDB initialization (singleton, Dexie storage)
        schemas.ts                     # RxDB schemas: users, tracks, trackInteractions, playlists
        types.ts                       # Database type exports
        query-helpers.ts               # Common query patterns
        replication-handler.ts         # Bridges IPC replication events with RxDB writes
        services/
          index.ts                     # Service barrel exports
          playlist-service.ts          # Playlist CRUD operations
          track-service.ts             # Track CRUD operations
      hooks/
        useRxDBCollection.ts           # React hook for reactive RxDB query subscriptions
        useP2PStatus.ts                # React hook for P2P status polling
      services/
        turn-service.ts                # Turn-taking logic for collaborative queues

    utility/                           # Utility Process (Separate Node.js process)
      p2p-service.ts                   # Entry point: P2PService class, libp2p node lifecycle
      protocols/
        handshake.ts                   # /whatnext/handshake/1.0.0 implementation
        replication.ts                 # /whatnext/rxdb-replication/1.0.0 implementation
      types/
        index.ts                       # Utility process type exports
        libp2p.ts                      # libp2p event and type aliases

    shared/                            # Shared across all processes
      core/
        index.ts                       # Barrel exports
        ipc-protocol.ts                # IPC message types, channel names, payload interfaces
        types.ts                       # PeerId, ConnectionState, PeerMetadata, P2PConnection, etc.
        protocol.ts                    # whtnxt:// URL parsing and generation
      p2p-config.ts                    # P2P configuration: mDNS, protocols, connection limits, relay
      spotify-config.ts                # Spotify OAuth config: client ID, scopes, API endpoints

  dist/                                # Build output (tsup + Vite)
    main.js                            # Main process (CJS)
    preload.js                         # Preload script (CJS)
    p2p-service.mjs                    # Utility process (ESM)
    index.html + assets/               # Renderer (Vite build)

test-peer/                             # Standalone libp2p test peer for P2P development
  src/
    index.js                           # Interactive CLI for testing P2P connections

scripts/                               # Development scripts
  start-dev.mjs                        # Starts Electron app + test peer together
  start-app.mjs                        # Starts the Electron app in dev mode
  dev-init.sh                          # Initial setup: nvm, Node, dependencies

docs/                                  # Project documentation (Obsidian vault)
  INDEX.md                             # Complete documentation map
  whtnxt-nextspec.md                   # Technical specification (source of truth)
```

---

## References

- [[whtnxt-nextspec]] -- Full technical specification
- [[adr-251110-electron-process-model]] -- Three-process architecture decision
- [[adr-251110-libp2p-vs-simple-peer]] -- libp2p selection rationale
- [[adr-251109-database-storage-location]] -- RxDB/IndexedDB storage decision
- [[libp2p]] -- libp2p concept page
- [[RxDB]] -- RxDB concept page
- [[RxDB-Replication]] -- Replication strategy details
- [[Circuit-Relay]] -- NAT traversal via circuit relay
- [[Handshake-Protocol]] -- Handshake protocol details
- [[Electron-IPC]] -- IPC patterns and lessons learned
- [[WebRTC]] -- WebRTC transport notes
- [[Electron]] -- Electron platform notes
- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [libp2p Documentation](https://docs.libp2p.io/)
- [RxDB Documentation](https://rxdb.info/)

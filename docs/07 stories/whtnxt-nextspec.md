#core/vision
# Project Specification: WhatNext (nextspec)

## 1. Introduction & Vision

### 1.1. Project Goals & Core Concept

**WhatNext** is a resilient, user-centric music management platform designed for musical permanence and deep collaboration. The core concept is to architect a system where **[[User Sovereignty]]** is the central, non-negotiable design principle. It achieves this through a decentralized, **[[Peer-to-Peer]]** networking for playlist management and social interaction, complemented by a **[[Local-First Data]]** storage model that gives users complete ownership and control over their musical lives.

This project is a direct response to the systemic fragility of the centralized streaming ecosystem, where licensing volatility, economic curation, and abrupt service shutdowns can decimate a user's curated music collection. WhatNext is conceived as a necessary antidote, a sovereign tool designed for resilience and permanence.

The primary goals are:

- **[[User Sovereignty]]:** To prioritize a [[Local-First Data]] architecture where the user's local database is the absolute source of truth. Data will be stored in a user-accessible, [[Plaintext Data Format]], ensuring longevity, transparency, and interoperability.
    
- **Decentralized Collaboration:** To build playlist management and social features on a [[Peer-to-Peer]] Network, allowing users to collaborate directly without reliance on a central server for core functionality. This enhances privacy, reduces latency, and eliminates central points of failure.
    
- **Rich & Intelligent Music Experience:** To deliver a superior user experience that rivals the best proprietary tools. This includes deep metadata enrichment inspired by Roon, intelligent discovery powered by local AI analysis like Plexamp, and powerful organizational tools like Serato's "Smart Crates".
    
- **Extensible & Resilient Foundation:** To build a modular, extensible platform with a potential [[Plugin Architecture]], ensuring the application can adapt and grow over the long term. The architecture will be designed to be resilient against the transient nature of web services, providing a fundamentally safer and more reliable home for a user's music collection.
    

### 1.2. Target Platform: Electron Desktop Application

The initial target platform is a cross-platform desktop application built using **[[Electron]]**. This choice is critical for fulfilling the project's core mission:

- **Direct Filesystem & System Access:** Essential for the [[Local-First Data]] model, enabling the application to manage data directly on the user's machine and integrate deeply with the operating system.
    
- **Rich, Performant User Experience:** Allows for the creation of a powerful and responsive UI, leveraging a well-defined process model to keep intensive tasks off the main UI thread, preventing sluggishness.
    
- **Cross-Platform Compatibility:** A single TypeScript codebase can be deployed on Windows, macOS, and Linux, maximizing reach and simplifying development.
    
- **Mature Ecosystem:** Leverages the vast ecosystem of web technologies (HTML, CSS, TypeScript) and Node.js libraries.
    

### 1.3. Backend Technology: TypeScript & Decentralized Architecture

The application's "backend" is not a traditional monolithic server. Instead, it's a two-part system:

1. **Decentralized P2P Network:** The core of all collaborative and social functionality will be built on a [[Peer-to-Peer]] Network, likely leveraging **[[WebRTC]]**. This handles all user-to-user interactions, such as sharing playlists and collaborative editing. There is no central database of user data.
    
2. **[[Helper Backend Service]]:** A lightweight backend service, written in **TypeScript** on Node.js, will exist solely to perform tasks that cannot be decentralized. Its primary responsibility will be managing interactions with third-party, centralized APIs (e.g., authenticating with the Spotify API, fetching track metadata) and brokering initial P2P connections via a **[[Signaling Server]]**.
    

This hybrid approach ensures that user data and social interactions remain sovereign and decentralized, while still allowing for powerful integrations with the wider music ecosystem.

### 1.4. Key Principle: Local-First Data with User-Accessible Plaintext Storage

This is a foundational principle. Data is stored locally first, making the application fully functional offline. All core user data, especially playlists, will be stored in a user-accessible, [[Plaintext Data Format]] like **Structured Markdown with YAML Frontmatter**.

- **User Control & Ownership:** Users can directly access, read, edit, back up, or use version control (like Git) on their data files.
    
- **Longevity & Resilience:** The user's curated playlists are not dependent on any central server. They exist, intact, on the user's machine forever.
    
- **Transparency & Interoperability:** The data format is human-readable and can be used by other scripts or applications.
    

**Decision:** We will proceed with **Structured Markdown with YAML Frontmatter** as the primary [[Plaintext Data Format]]. It provides the ideal balance of structured, machine-readable metadata (in the frontmatter) and human-readable, rich-text notes and descriptions (in the Markdown body), aligning perfectly with the project's "searchable magazine" and deep organizational goals.

### 1.5. External Integrations (Spotify)

The primary external integration will be with **Spotify**. This will be a "progressive enhancement," not a core dependency. The integration will use Spotify as a data source and playback service, but never as the canonical owner of the user's playlists. Functionality will include:

- Importing Spotify playlists into the local, permanent WhatNext format.
    
- Fetching rich track metadata from Spotify to enrich the local library.
    
- Synchronizing playlist changes _from_ WhatNext _to_ Spotify using the [[Spotify Collaborative Sync Strategy]].
    
- Controlling Spotify playback.
    

### 1.6. Future Scalability: A Plugin & Mobile Ecosystem

The architecture is explicitly designed for future growth.

- **[[Plugin Architecture]]:** Inspired by Obsidian, a robust plugin architecture is a key long-term goal. This will allow the community to extend WhatNext with new features, data sources, and integrations, fostering a vibrant ecosystem.
    
- **Mobile Client:** The [[Helper Backend Service]] can be leveraged by a future mobile client (e.g., using React Native). The [[Local-First Data]] and [[Peer-to-Peer]] Network principles will be adapted for mobile, likely using a local mobile database (like SQLite) and synchronizing with the user's desktop instance(s).
    
- **Abstracted Sync Engines:** The project will monitor the evolution of schema-aware synchronization engines like Triplit or ElectricSQL. As these technologies mature, migrating to a more comprehensive solution could be a strategic move to further enhance capabilities.
    

## 2. System Architecture

The WhatNext architecture is designed around three core principles: **[[Local-First Data]]**, **decentralized collaboration**, and **modular integration** with external services. It separates the user-facing application from the collaborative logic and external API management.

### 2.1. High-Level Overview

The system consists of three primary architectural components:

1. **The [[Electron]] Client:** The user's interface to their music world. It handles rendering the UI, managing the [[Local Database]], and interacting directly with the local filesystem.
    
2. **The [[Peer-to-Peer]] Network Layer:** The substrate for all collaboration. It allows multiple Electron clients to connect directly to each other to share and synchronize playlist data without a central server.
    
3. **The [[Helper Backend Service]]:** A lightweight, optional cloud service whose only roles are to assist with P2P connection discovery ([[Signaling Server]]) and to manage authenticated communication with centralized services like Spotify.
    

```
sequenceDiagram
    participant ClientA as WhatNext Client (User A)
    participant P2P_Network as Peer-to-Peer Network
    participant ClientB as WhatNext Client (User B)
    participant HelperService as Helper Backend Service
    participant SpotifyAPI as Spotify API

    Note over ClientA: User A adds a track to a shared playlist.
    ClientA->>ClientA: 1. Update Local DB (RxDB)
    ClientA->>P2P_Network: 2. Replicate DB change
    P2P_Network-->>ClientB: 3. Receive replicated change
    ClientB->>ClientB: 4. Update Local DB & UI

    Note over ClientA: User A wants to import a Spotify playlist.
    ClientA->>HelperService: 5. Request Spotify Import
    HelperService->>SpotifyAPI: 6. Fetch Playlist Data (via OAuth)
    SpotifyAPI-->>HelperService: 7. Return Track Info
    HelperService-->>ClientA: 8. Send Formatted Data
    ClientA->>ClientA: 9. Save to Local DB
```

### 2.2. Frontend: Electron Application Architecture

The [[Electron]] application follows a standard multi-process model to ensure a responsive and powerful user experience.

- **UI/UX Philosophy:** Inspired by tools like Obsidian and VS Code, the UI will be fast, keyboard-friendly, and unobtrusive. A central command palette will be a key interaction model, allowing users to perform most actions without leaving the keyboard. The interface will be built for information density and efficient organization.
    
- **Main** Process (**`main.ts`):**
    
    - Runs in a Node.js environment.
        
    - Manages the application lifecycle and has access to privileged OS-level functions.
        
    - Initializes and manages the window(s) for the renderer process.
        
- **Renderer Process (`renderer.tsx`):**
    
    - Runs the user interface in a sandboxed Chromium environment.
        
    - Built using **React** and TypeScript.
        
    - Manages all application state and interaction logic.
        
    - Hosts the [[Local Database]] instance and the P2P connection logic.
        
- **Inter-Process Communication (IPC):**
    
    - The renderer process communicates with the main process using Electron's `ipcRenderer` and `ipcMain` modules for tasks that the renderer cannot perform directly, such as triggering native file dialogs.
        

### 2.3. Backend & Network Architecture

This is not a traditional backend but a combination of a decentralized network and a minimal helper service.

- **Pathway A: [[Peer-to-Peer]] Network (WebRTC)**
    
    - **Description:** This is the primary pathway for collaboration. WebRTC allows for direct, app-to-app communication of arbitrary data. It is highly suitable for replicating database state between peers in a collaborative session.
        
    - **[[Signaling Server]]:** A lightweight signaling server, hosted by the [[Helper Backend Service]], is required to allow peers to find each other and broker the initial connection.
        
- **Pathway B: Peer-to-Peer Network (Libp2p)**
    
    - **Description:** A more modular and extensible P2P networking stack from the IPFS ecosystem. It is transport-agnostic and provides more robust features for peer discovery and stream multiplexing.
        
    - **Fit:** While powerful, this may be over-engineering for the initial scope but remains a viable path for future evolution towards a more truly distributed network.
        
- **[[Helper Backend Service]] (TypeScript)**
    
    - **Role:** A minimal, stateless API built with Node.js and a lightweight framework (e.g., Express, Fastify).
        
    - **Responsibilities:**
        
        1. **Signaling:** Provide WebSocket endpoints for WebRTC signaling.
            
        2. **OAuth Coordination:** Handle the server-side portions of OAuth flows for services like Spotify.
            
        3. **API Proxy (Optional):** Act as a simple proxy to third-party APIs to hide API keys from the client application.
            

### 2.4. Data Model & Core Entities

The core data entities will be stored in the [[Local Database]] and serialized to [[Plaintext Data Format]] files.

- **Playlist:** `id`, `playlistName`, `description`, ordered list of `tracks`, `createdAt`, `updatedAt`, `linkedSpotifyId`, `tags`.
    
- **Track:** `id`, `title`, `artists`, `album`, `durationMs`, `spotifyId`, `addedAt`, `notes`.
    
- **UserIdentity (for P2P):** `peerId` (cryptographic public key), `displayName`.
    

### 2.5. Local Database & Persistence Strategy

The choice of [[Local Database]] technology is critical for performance, reactivity, and enabling P2P synchronization.

- **Pathway 1: Reactive Database ([[RxDB]])**
    
    - **Description:** A reactive, NoSQL-style database for JavaScript applications. Its reactive query streams are a powerful pattern for building modern UIs that update automatically.
        
    - **Storage Engine:** RxDB is a wrapper and can use different storage engines. The pragmatic approach is to start with **IndexedDB** (built-in) and later offer a premium build using a native **SQLite** adapter for superior performance.
        
    - **Fit:** This pathway is highly recommended as it directly addresses the needs for reactivity, offline-first functionality, and data replication required by the project's core architecture.
        
- **Pathway 2: Direct Filesystem Management**
    
    - **Description:** A simpler approach that reads/writes the Markdown files directly, managing state in memory.
        
    - **Fit:** Aligned with the plaintext principle but scales poorly. Querying and reliable P2P state synchronization become immensely complex. This is not a recommended long-term path.
        

### 2.6. Data Flow & Event Model

The flow of data is designed to be unidirectional and predictable, leveraging the reactive nature of [[RxDB]].

```
graph TD
    subgraph Electron Client
        A[User Action in UI] --> B{State Update};
        B --> C[Update RxDB Database];
        C --> D{Database emits change event};
        D --> E[UI Components subscribed to query re-render];
        subgraph P2P Replication
            C --> F[Replication Protocol listens for DB changes];
            F --> G((P2P Network));
        end
    end

    subgraph Peer's Client
        G --> H[Replication Protocol receives change];
        H --> I[Update Peer's RxDB Database];
        I --> J{Peer's DB emits change event};
        J --> K[Peer's UI Components re-render];
    end
```

## 4. Core Features & Functionality

This section translates the architectural concepts into tangible user-facing features.

### 4.1. Playlist Management

- **Local Playlist Management:** Full CRUD operations on local playlists, with all changes saved to the [[Local Database]] and reflected in the [[Plaintext Data Format]] files.
    
- **Spotify Playlist Importing:** A one-way import function to copy a Spotify playlist into a new, independent, local-first playlist in WhatNext.
    

### 4.2. Music Discovery & Playback

- **Local Library Browsing and Searching:** Metadata-based search of the local collection.
    
- **Integrated** Playback **Controls:** Standard playback controls that act as a remote for the user's official Spotify client via the Spotify Connect API.
    

### 4.3. Collaborative & Social Features

This is the core of the WhatNext experience, built on the [[Peer-to-Peer]] Network.

- **User Identity:** Each user's identity is a cryptographic key pair, with the public key serving as their unique `peerId`.
    
- **Connection & Sharing Flow:** A hybrid model for connecting with peers.
    
    1. **Initiation:** A user shares a `whtnxt://connect?with=<peerId>` link to establish a direct P2P connection.
        
    2. **Session Type:** This creates a temporary, session-based connection for immediate collaboration.
        
    3. **Persistence (Friendship):** Either user can choose to "Save as Friend," saving the other's `peerId` for easy future collaboration.
        
- **Real-Time Collaboration:** Changes to a shared playlist are replicated in near real-time to all connected collaborators.
    
- **[[Conflict Resolution]]:** The system is designed for eventual consistency.
    
    - **Architecture Goal:** The architecture will be built with **Conflict-Free Replicated Data Types (CRDTs)** in mind to ensure concurrent edits are merged logically without data loss.
        
    - **Initial Implementation:** The MVP may start with a simpler "Last-Write-Wins" (LWW) strategy, with a clear path to migrate to true CRDTs.
        

### 4.4. Spotify Integration

- **Authentication (OAuth 2.0):** The app will use the Authorization Code with PKCE flow, coordinated by the [[Helper Backend Service]].
    
- **API Usage:** The client will use the access token to fetch user data, search for tracks, and control playback.
    
- **Data Mapping:** A dedicated module will translate data from the Spotify API's format into the internal WhatNext data models.
    

## 5. Technical Implementation Details

This section outlines the specific technologies, libraries, and implementation patterns.

### 5.1. Frontend (Electron Application)

- **Core Technologies:** [[Electron]], **React**, and **TypeScript**.
    
- **State Management:** Primary state will be driven by reactive queries from **[[RxDB]]**. Non-persistent UI state will be managed with a lightweight library like **Zustand** or **Jotai**.
    
- **Electron APIs:** `ipcMain`/`ipcRenderer`, `shell`, and a custom protocol handler for `whtnxt://` links.
    

### 5.2. Services & External API Integration

- **[[Helper Backend Service]]**: A minimal **Node.js** server in **TypeScript** using a lightweight framework like **Express.js**. Its responsibilities are limited to WebRTC signaling and Spotify OAuth management.
    
- **[[Spotify Collaborative Sync Strategy]]:** The application will support multiple sync strategies to provide maximum flexibility and user choice. See [[#8.1. Spotify Integration Strategies]] for a detailed breakdown.
    

### 5.3. Build & Packaging

- **Packaging Tool: electron-builder:** The standard tool for building, signing, and packaging the application for all platforms.
    
- **Handling Native Modules:** The CI/CD pipeline must integrate **`electron-rebuild`** from the outset to correctly compile any native dependencies (like a future SQLite driver) against the Electron runtime.
    

## 6. Development, Operations, & Deployment (DevOps)

This section details the tools and processes for building, testing, and deploying the application.

- **CI/CD Pipeline: GitHub Actions:** The project will use GitHub Actions for its CI/CD pipeline, providing tight integration with the source code repository.
    
- **Pipeline Strategy:** The pipeline will include stages for Linting & Testing, Building (with `electron-rebuild`), Packaging & Signing, and creating a draft Release on GitHub.
    
- **Testing Strategy:** A multi-layered approach including Unit Tests, Integration Tests, and End-to-End (E2E) Tests.
    

## 7. Strategic Roadmap

This roadmap prioritizes the core collaborative experience as the central feature of the MVP.

- **Phase** 1 **(MVP): The Collaborative Playlist Accessory**
    
    - **Goal:** Deliver the core value of a shared, real-time music session that acts as a social accessory to Spotify.
        
    - **Core Features:**
        
        - Rock-solid P2P connection flow (`whtnxt://`).
            
        - **"Accessory Mode"** Spotify sync ([[Spotify Integration Strategies]]).
            
        - A social layer for turn-taking or a shared queue.
            
        - A robust [[Electron]] shell using [[RxDB]].
            
    - **Success Metric:** Two or more users can join a session, link a Spotify playlist, and use WhatNext to socially manage their listening session.
        
- **Phase 2: Active Management & Advanced Sync**
    
    - **Goal:** Allow users to manage playlists directly from within WhatNext, providing flexible sync options.
        
    - **Core Features:**
        
        - Direct track management from within the WhatNext UI.
            
        - Implementation of **"True Collaborate Mode"** and **"Proxy Mode"** sync strategies ([[Spotify Integration Strategies]]).
            
        - Creation of local-only, unlinked playlists.
            
    - **Success Metric:** A user can collaboratively edit a playlist within WhatNext, with changes syncing back to Spotify using the most appropriate strategy.
        
- **Phase 3: The Sovereign Music Platform**
    
    - **Goal:** Realize the full vision of a resilient, intelligent, and self-sufficient music platform.
        
    - **Core Features:**
        
        - Local audio file management.
            
        - Local, privacy-preserving LLM integration for semantic search.
            
        - A public [[Plugin Architecture]].
            
    - **Success Metric:** WhatNext becomes a premier tool for managing both streaming and local music libraries, with unique, AI-driven discovery features that respect [[User Sovereignty]].
        

## 8. Appendix

### 8.1. Spotify Integration Strategies

To provide maximum flexibility and compatibility, WhatNext will support three distinct modes for interacting with Spotify playlists. The UI will be designed to make it clear which mode is active for a given collaborative session.

- **Mode 1: Accessory (Read-Only Sync)**
    
    - **Description:** WhatNext acts as a social companion to the main Spotify application. It polls the Spotify playlist at regular intervals and updates its own state to reflect any changes. All track additions and removals are performed by the users in their Spotify client.
        
    - **Use Case:** The primary mode for the MVP. Perfect for "playlist turn-taking" sessions.
        
    - **Pros:** Simplest to implement, bypasses all Spotify write permission complexities.
        
- **Mode 2: True Collaborate**
    
    - **Description:** For playlists set as "Collaborative" on Spotify. Each authenticated user's client makes its own API calls to Spotify, correctly attributing track additions.
        
    - **Use Case:** The ideal state for a fully integrated, multi-user editing experience.
        
    - **Pros:** Correctly attributes who added each track in Spotify.
        
    - **Cons:** Requires the playlist owner to have manually invited every participant as a collaborator on Spotify.
        
- **Mode 3: Proxy Owner**
    
    - **Description:** A designated "Playlist Owner" acts as a proxy. Their client is responsible for making all API calls to Spotify on behalf of the group.
        
    - **Use Case:** A fallback for when "True Collaborate" mode is not possible.
        
    - **Pros:** Allows collaborative management of any playlist the owner can edit.
        
    - **Cons:** All tracks added to Spotify are attributed to the "Proxy Owner." Sync is dependent on the owner being online.
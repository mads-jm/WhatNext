# Custom Protocol & Barebones Peer for Testing

**Date**: 2025-11-09
**Issue**: #10 - Handle `whtnxt://connect` Custom Protocol
**Question**: Should we create a barebones peer for testing? Can it be auto-generated?
**Status**: 📋 Design & Implementation Plan

## Question from Developer

> "Does it make sense to develop / create a barebones peer for testing? Can this be auto generated based on our existing/future client updates? I want this to be as procedural / automatable as possible."

## Answer: Yes, Absolutely — With Smart Architecture

Creating a **barebones test peer** is not just a good idea — it's **essential** for developing and testing the `whtnxt://` protocol and P2P networking features. And yes, it **can and should be automated**.

Here's the strategic approach:

---

## 1. Why We Need a Barebones Test Peer

### The Problem with Testing P2P in a Single Client
- **You can't handshake with yourself**: P2P connections require at least 2 distinct peers
- **Manual testing is painful**: Opening multiple Electron instances, managing state, clicking through flows
- **Race conditions are invisible**: Without automated peers, timing bugs go undetected
- **Regression testing is impossible**: Every protocol change requires manual re-testing

### What a Barebones Peer Solves
✅ **Automated testing**: Spin up synthetic peers programmatically for integration tests
✅ **Protocol validation**: Verify handshake, replication, and disconnect flows
✅ **Load testing**: Simulate 5, 10, 50 peers to test scaling
✅ **CI/CD integration**: Automated tests on every commit
✅ **Developer ergonomics**: Quick feedback loop during development

---

## 2. Architecture: Two-Tier Test Peer Strategy

### Tier 1: Headless Test Peer (Immediate Priority)
A minimal Node.js process that speaks the P2P protocol without the Electron/UI overhead.

**What it includes**:
- RxDB database (same schemas as client)
- P2P networking layer (WebRTC via SimplePeer or similar)
- Protocol handling (`whtnxt://` parsing)
- Basic replication logic

**What it excludes**:
- Electron (no window management, no IPC)
- React UI (headless)
- Spotify integration (not needed for P2P testing)

**Use cases**:
- Automated integration tests
- CI/CD pipeline testing
- Load/stress testing
- Protocol development iteration

### Tier 2: Minimal Electron Test Client (Future)
A stripped-down Electron app with minimal UI for visual debugging.

**What it includes**:
- Full Electron stack (for protocol handler testing)
- Bare-bones UI (connection status, peer list, simple playlist view)
- Same P2P layer as production client

**Use cases**:
- Visual debugging of P2P connections
- Testing protocol handler registration
- Cross-platform verification (Windows/Mac/Linux)

---

## 3. Code Sharing Strategy: Shared Core Library

The key to automation is **extracting the P2P logic into a shared library** that both the main client and test peers consume.

### Proposed Structure

```
/app
  /src
    /main              # Electron main process
    /renderer          # React UI + RxDB
      /db              # Database (schemas, services)
      /p2p             # 🎯 P2P CORE (to be extracted)
        /protocol      # Protocol parsing, message types
        /replication   # RxDB replication logic
        /webrtc        # WebRTC connection management
        /signaling     # Signaling server client
    /shared            # 🆕 Shared code for all environments
      /core            # Core P2P logic (protocol-agnostic)
      /types           # Shared TypeScript types

/test-peer             # 🆕 Headless test peer
  /src
    /index.ts          # Entry point (Node.js)
    /peer-controller.ts # Peer lifecycle management
    /test-scenarios.ts  # Pre-built test scenarios
  /scripts
    /generate-peer.ts  # 🤖 Auto-generation script
```

### What Goes in `/shared/core`?

**Core P2P primitives** (environment-agnostic):
```typescript
// Message protocol
export interface P2PMessage {
    type: 'handshake' | 'replicate' | 'ping' | 'disconnect';
    payload: unknown;
    senderId: string;
    timestamp: string;
}

// Connection lifecycle
export interface P2PConnection {
    peerId: string;
    connect(): Promise<void>;
    send(message: P2PMessage): void;
    disconnect(): void;
    on(event: string, handler: Function): void;
}

// Protocol handler
export class WhatNextProtocol {
    static parseConnectUrl(url: string): { peerId: string; metadata?: unknown };
    static createConnectUrl(peerId: string): string;
}
```

**Replication logic**:
```typescript
// RxDB replication primitives
export class P2PReplicationEngine {
    constructor(
        private db: RxDatabase,
        private connection: P2PConnection
    ) {}

    async startReplication(collectionName: string): Promise<void>;
    async stopReplication(): Promise<void>;
}
```

### Auto-Generation: The Key to Staying in Sync

**Problem**: When we update the client's P2P code, test peers become outdated.

**Solution**: Generate test peer code from shared primitives.

#### Auto-Generation Script: `/test-peer/scripts/generate-peer.ts`

```typescript
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Auto-generates a test peer from the shared P2P core.
 * Runs on:
 * 1. Pre-commit hook (ensures test peers match latest code)
 * 2. CI/CD pipeline (validates test peer compilation)
 * 3. Manual trigger: npm run generate-test-peer
 */
async function generateTestPeer() {
    console.log('[Generate] Creating test peer from shared core...');

    // 1. Read schemas from /app/src/renderer/db/schemas.ts
    const schemas = await importSchemas();

    // 2. Read P2P protocol from /app/src/shared/core
    const p2pCore = await importP2PCore();

    // 3. Generate test peer index.ts
    const testPeerCode = `
// 🤖 AUTO-GENERATED by /test-peer/scripts/generate-peer.ts
// Do not edit manually - changes will be overwritten
// Last generated: ${new Date().toISOString()}

import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { P2PReplicationEngine, WhatNextProtocol } from '@shared/core';
import { userSchema, trackSchema, playlistSchema, trackInteractionSchema } from '@app/renderer/db/schemas';

export class TestPeer {
    private db: RxDatabase;
    private replication: P2PReplicationEngine;

    constructor(public peerId: string) {}

    async init(): Promise<void> {
        // Initialize RxDB with same schemas as production client
        this.db = await createRxDatabase({
            name: \`test_peer_\${this.peerId}\`,
            storage: getRxStorageDexie(),
            multiInstance: true,
        });

        await this.db.addCollections({
            users: { schema: userSchema },
            tracks: { schema: trackSchema },
            playlists: { schema: playlistSchema },
            trackInteractions: { schema: trackInteractionSchema },
        });
    }

    async connect(targetPeerId: string): Promise<void> {
        const connectUrl = WhatNextProtocol.createConnectUrl(targetPeerId);
        // ... WebRTC connection logic (from shared core)
    }

    async addTrack(trackData: any): Promise<void> {
        await this.db.tracks.insert(trackData);
        // Replication happens automatically via P2PReplicationEngine
    }

    async destroy(): Promise<void> {
        await this.db.remove();
    }
}
`;

    await fs.writeFile(
        path.join(__dirname, '../src/generated-peer.ts'),
        testPeerCode
    );

    console.log('[Generate] ✅ Test peer generated successfully');
}

// Import helpers (parse AST, extract exports, etc.)
async function importSchemas() { /* ... */ }
async function importP2PCore() { /* ... */ }

generateTestPeer().catch(console.error);
```

#### Integration with Build Process

**package.json** scripts:
```json
{
  "scripts": {
    "generate:test-peer": "tsx test-peer/scripts/generate-peer.ts",
    "test:p2p": "npm run generate:test-peer && vitest run test-peer/tests",
    "precommit": "npm run generate:test-peer && npm run typecheck"
  }
}
```

**Husky pre-commit hook** (`.husky/pre-commit`):
```bash
#!/bin/sh
npm run generate:test-peer
git add test-peer/src/generated-peer.ts
```

This ensures **test peers always reflect latest client code**.

---

## 4. Test Scenarios: Pre-Built Automation

### Example: Two-Peer Handshake Test

```typescript
// /test-peer/tests/handshake.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestPeer } from '../src/generated-peer';

describe('P2P Protocol: Handshake', () => {
    let peerA: TestPeer;
    let peerB: TestPeer;

    beforeEach(async () => {
        peerA = new TestPeer('peer-alice');
        peerB = new TestPeer('peer-bob');
        await peerA.init();
        await peerB.init();
    });

    afterEach(async () => {
        await peerA.destroy();
        await peerB.destroy();
    });

    it('should establish connection via whtnxt://connect URL', async () => {
        // Peer A generates connection URL
        const connectUrl = peerA.getConnectUrl(); // whtnxt://connect?with=peer-alice

        // Peer B parses URL and initiates connection
        await peerB.connect(connectUrl);

        // Assert connection established
        expect(peerA.isConnected(peerB.peerId)).toBe(true);
        expect(peerB.isConnected(peerA.peerId)).toBe(true);
    });

    it('should replicate playlist creation from A to B', async () => {
        await peerA.connect(peerB.getConnectUrl());

        // Peer A creates playlist
        const playlist = await peerA.addPlaylist({
            playlistName: 'Test Playlist',
            trackIds: [],
            ownerId: 'peer-alice',
        });

        // Wait for replication
        await new Promise(resolve => setTimeout(resolve, 100));

        // Peer B should have the playlist
        const replicatedPlaylist = await peerB.db.playlists
            .findOne(playlist.id)
            .exec();

        expect(replicatedPlaylist).toBeTruthy();
        expect(replicatedPlaylist.playlistName).toBe('Test Playlist');
    });

    it('should handle disconnect gracefully', async () => {
        await peerA.connect(peerB.getConnectUrl());

        await peerA.disconnect();

        expect(peerA.isConnected(peerB.peerId)).toBe(false);
        expect(peerB.isConnected(peerA.peerId)).toBe(false);
    });
});
```

### Example: Load Test with 10 Peers

```typescript
// /test-peer/tests/load.test.ts
import { describe, it, expect } from 'vitest';
import { TestPeer } from '../src/generated-peer';

describe('P2P Protocol: Load Testing', () => {
    it('should handle 10 simultaneous peer connections', async () => {
        const hostPeer = new TestPeer('host');
        await hostPeer.init();

        // Spawn 10 test peers
        const peers = await Promise.all(
            Array.from({ length: 10 }, async (_, i) => {
                const peer = new TestPeer(`guest-${i}`);
                await peer.init();
                await peer.connect(hostPeer.getConnectUrl());
                return peer;
            })
        );

        // Host creates playlist
        const playlist = await hostPeer.addPlaylist({
        
            playlistName: 'Shared Playlist',
            trackIds: [],
            ownerId: 'host',
        });

        // Wait for replication to all peers
        await new Promise(resolve => setTimeout(resolve, 500));

        // All peers should have the playlist
        for (const peer of peers) {
            const replicatedPlaylist = await peer.db.playlists
                .findOne(playlist.id)
                .exec();
            expect(replicatedPlaylist).toBeTruthy();
        }

        // Cleanup
        await hostPeer.destroy();
        await Promise.all(peers.map(p => p.destroy()));
    });
});
```

---

## 5. Implementation Roadmap

### Phase 1: Extract P2P Core (Week 1)
- [ ] Create `/app/src/shared/core` directory
- [ ] Extract protocol types (`P2PMessage`, `P2PConnection`)
- [ ] Extract `WhatNextProtocol` class (URL parsing)
- [ ] Update client imports to use shared core

### Phase 2: Build Headless Test Peer (Week 1-2)
- [ ] Create `/test-peer` directory structure
- [ ] Implement `TestPeer` class (manually, first iteration)
- [ ] Write basic handshake test
- [ ] Write replication test
- [ ] Verify tests pass in CI

### Phase 3: Auto-Generation (Week 2-3)
- [ ] Build AST parser for schema extraction
- [ ] Implement `generate-peer.ts` script
- [ ] Add pre-commit hook integration
- [ ] Document generation process in README
- [ ] Validate generated code compiles and tests pass

### Phase 4: Advanced Test Scenarios (Week 3-4)
- [ ] Multi-peer collaboration tests
- [ ] Conflict resolution tests
- [ ] Network partition simulation
- [ ] Load testing (50+ peers)
- [ ] Protocol version compatibility tests

### Phase 5: Minimal Electron Test Client (Week 5+)
- [ ] Scaffold minimal Electron app
- [ ] Reuse shared P2P core
- [ ] Build minimal UI (connection debugger)
- [ ] Test protocol handler registration across platforms

---

## 6. Benefits of This Approach

### For Development
✅ **Instant feedback**: Test P2P changes without opening multiple Electron instances
✅ **Regression prevention**: Automated tests catch protocol breaks immediately
✅ **Faster iteration**: Change protocol → run tests → see results in seconds

### For Quality
✅ **Protocol correctness**: Verify handshake, replication, disconnect flows automatically
✅ **Edge case coverage**: Test race conditions, network failures, peer churn
✅ **Cross-platform validation**: CI runs tests on Linux, Mac, Windows

### For Maintenance
✅ **Single source of truth**: P2P logic lives in `/shared/core`
✅ **Auto-sync**: Generated test peers always match production code
✅ **Documentation**: Test scenarios serve as living protocol documentation

---

## 7. Example: Full E2E Test Flow

```typescript
// /test-peer/tests/e2e-collaboration.test.ts
describe('E2E: Collaborative Playlist Editing', () => {
    it('should sync playlist edits between 3 peers', async () => {
        // Setup
        const alice = new TestPeer('alice');
        const bob = new TestPeer('bob');
        const charlie = new TestPeer('charlie');

        await alice.init();
        await bob.init();
        await charlie.init();

        // Alice creates playlist and shares with Bob & Charlie
        const playlist = await alice.addPlaylist({
            playlistName: 'Road Trip Mix',
            trackIds: [],
            isCollaborative: true,
            ownerId: 'alice',
            collaboratorIds: ['bob', 'charlie'],
        });

        await bob.connect(alice.getConnectUrl());
        await charlie.connect(alice.getConnectUrl());

        // Bob adds a track
        const track1 = await bob.addTrack({
            title: 'Highway to Hell',
            artists: ['AC/DC'],
            album: 'Highway to Hell',
            durationMs: 208000,
            addedBy: 'bob',
        });

        await bob.addTrackToPlaylist(playlist.id, track1.id);

        // Charlie adds a track
        const track2 = await charlie.addTrack({
            title: 'Life is a Highway',
            artists: ['Tom Cochrane'],
            album: 'Mad Mad World',
            durationMs: 263000,
            addedBy: 'charlie',
        });

        await charlie.addTrackToPlaylist(playlist.id, track2.id);

        // Wait for replication
        await new Promise(resolve => setTimeout(resolve, 200));

        // All peers should have both tracks in the playlist
        const alicePlaylist = await alice.db.playlists.findOne(playlist.id).exec();
        const bobPlaylist = await bob.db.playlists.findOne(playlist.id).exec();
        const charliePlaylist = await charlie.db.playlists.findOne(playlist.id).exec();

        expect(alicePlaylist.trackIds).toHaveLength(2);
        expect(bobPlaylist.trackIds).toHaveLength(2);
        expect(charliePlaylist.trackIds).toHaveLength(2);

        expect(alicePlaylist.trackIds).toContain(track1.id);
        expect(alicePlaylist.trackIds).toContain(track2.id);

        // Cleanup
        await alice.destroy();
        await bob.destroy();
        await charlie.destroy();
    });
});
```

---

## 8. Automation Checklist

To make this "as procedural / automatable as possible":

- [x] **Shared core library**: Extract P2P logic into `/shared/core`
- [x] **Code generation**: Auto-generate test peer from schemas + protocol
- [x] **Pre-commit hooks**: Regenerate test peer on every commit
- [x] **CI/CD integration**: Run P2P tests on every push
- [x] **Vitest integration**: Fast, modern test runner with watch mode
- [x] **Test scenarios**: Pre-built handshake, replication, load tests
- [x] **Documentation**: Tests serve as protocol documentation
- [ ] **Visual regression**: Screenshot diffs for Electron test client (Phase 5)
- [ ] **Performance benchmarks**: Track replication latency over time

---

## 9. Next Steps

### Immediate (Issue #10 Implementation)
1. **Implement protocol handler** in Electron main process (`protocol.registerStringProtocol('whtnxt', handler)`)
2. **Extract protocol parsing** to `/shared/core/protocol.ts`
3. **Write first test** using manual `TestPeer` implementation
4. **Validate end-to-end** with 2 Electron instances (manual)

### Short-term (Post-Issue #10)
5. **Build auto-generation script** for test peer
6. **Integrate with CI/CD** (GitHub Actions)
7. **Add load tests** (10, 50, 100 peers)

### Long-term (Phase 2+)
8. **Build minimal Electron test client** for visual debugging
9. **Add protocol versioning** tests
10. **Simulate network conditions** (latency, packet loss)

---

## 10. Conclusion

**Yes, absolutely create a barebones test peer.**

**Yes, it should be auto-generated.**

The strategy is:
1. **Extract P2P logic** into shared library (`/shared/core`)
2. **Generate test peer** from shared primitives (AST parsing + code generation)
3. **Automate regeneration** via pre-commit hooks
4. **Write comprehensive tests** (handshake, replication, load)
5. **Integrate with CI/CD** for continuous validation

This gives you:
- **Fast iteration** during P2P development
- **Confidence** that protocol changes don't break existing behavior
- **Documentation** via living test scenarios
- **Future-proof** architecture as protocol evolves

**The test peer isn't just a nice-to-have — it's foundational infrastructure for building reliable P2P networking.**

---

## References

- Issue #10: Handle `whtnxt://connect` Custom Protocol
- Spec §2.3: Backend & Network Architecture (WebRTC P2P)
- Spec §4.3: Collaborative & Social Features (Connection flow)
- `/app/src/renderer/db/schemas.ts` - Data models to replicate

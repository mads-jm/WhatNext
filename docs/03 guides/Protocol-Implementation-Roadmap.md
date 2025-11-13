---
tags:
  - guides/roadmap
  - net/protocols
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Thursday, November 13th 2025, 5:22:32 am
---

# Protocol Implementation Roadmap

__Date__: 2025-11-12
__Status__: 📋 Planning Document
__Purpose__: Step-by-step guide for implementing WhatNext P2P protocols

## Overview

This document provides a detailed roadmap for implementing custom libp2p protocols in WhatNext. Each protocol builds on the previous one, teaching progressively more complex patterns.

## Protocol 1: Handshake (`/whatnext/handshake/1.0.0`)

### Purpose

Establish peer identity and capabilities when connection is made.

### What You'll Learn

- How to register a protocol handler in libp2p
- Stream-based communication (read/write)
- Message framing (length-prefix or newline-delimited)
- Request/response pattern
- Error handling in streams

### Implementation Steps

1. __Define Protocol in Config__

   ```typescript
   // app/src/shared/p2p-config.ts
   PROTOCOLS: {
       HANDSHAKE: '/whatnext/handshake/1.0.0',
   }
   ```

2. __Create Protocol Handler Module__

   ```typescript
   // app/src/utility/protocols/handshake.ts
   export async function handshakeProtocolHandler(stream) {
       // Read incoming handshake
       // Send our handshake
       // Return peer metadata
   }
   ```

3. __Register Handler in P2P Service__

   ```typescript
   // app/src/utility/p2p-service.ts (in startNode)
   await this.libp2pNode.handle(
       P2P_CONFIG.PROTOCOLS.HANDSHAKE,
       handshakeProtocolHandler
   );
   ```

4. __Initiate Handshake on Connection__

   ```typescript
   // In peer:connect event handler
   const stream = await this.libp2pNode.dialProtocol(
       peerId,
       P2P_CONFIG.PROTOCOLS.HANDSHAKE
   );
   // Send our handshake, receive theirs
   ```

5. __Update UI to Show Metadata__
   - Display peer's app version
   - Display peer's display name (from handshake, not auto-generated)
   - Display peer's capabilities

### Success Criteria

- [ ] Handshake sent immediately after connection
- [ ] Peer display name shows real name (not "Peer 12D3…")
- [ ] App version visible in peer details
- [ ] Capabilities list populated
- [ ] Error handling for handshake timeout/failure

### Example Message Format

```json
{
  "type": "handshake",
  "payload": {
    "displayName": "Mads' WhatNext",
    "appVersion": "0.0.0",
    "protocolVersion": "1.0.0",
    "capabilities": ["playlist-sync", "file-transfer"]
  },
  "timestamp": "2025-11-12T10:30:00Z"
}
```

### Helpful Resources

- [libp2p Stream Muxing](https://docs.libp2p.io/concepts/multiplex/overview/)
- [Protocol Handlers](https://docs.libp2p.io/concepts/fundamentals/protocols-and-streams/)
- [it-length-prefixed](https://github.com/alanshaw/it-length-prefixed) - Message framing library

---

## Protocol 2: Data Test (`/whatnext/data-test/1.0.0`)

### Purpose

Send arbitrary data between peers to understand streaming and chunking.

### What You'll Learn

- Sending larger payloads (1KB - 10MB)
- Stream backpressure handling
- Progress callbacks
- Chunking strategies
- Performance measurement

### Implementation Steps

1. __Add Data Test UI Controls__

   ```typescript
   // In P2PStatus.tsx "Data Transfer Testing" section
   <button onClick={() => sendTestMessage(peer, size)}>
       Send {size} Test
   </button>
   ```

2. __Create Protocol Handler__

   ```typescript
   // app/src/utility/protocols/data-test.ts
   export async function dataTestHandler(stream) {
       // Read test data
       // Optionally echo back if requested
       // Track bytes received
   }
   ```

3. __Implement Send Logic__

   ```typescript
   async function sendTestData(peerId, dataSize, echo = false) {
       const stream = await libp2p.dialProtocol(
           peerId,
           '/whatnext/data-test/1.0.0'
       );

       // Generate test data
       // Send in chunks
       // If echo, wait for response
       // Measure time/throughput
   }
   ```

4. __Add Statistics Tracking__
   - Bytes sent/received per peer
   - Transfer time
   - Throughput (bytes/sec)
   - Display in UI

### Test Scenarios

- [ ] Send 1KB message (small, instant)
- [ ] Send 1MB message (medium, test chunking)
- [ ] Send 10MB message (large, test progress)
- [ ] Echo test (send, receive same data back)
- [ ] Concurrent sends (test backpressure)

### Success Criteria

- [ ] Small messages send instantly
- [ ] Large messages show progress
- [ ] Statistics accurate (match actual data size)
- [ ] Echo returns identical data
- [ ] No memory leaks on large transfers

### Example UI Addition

```typescript
const testSizes = [
    { label: '1 KB', bytes: 1024 },
    { label: '100 KB', bytes: 102400 },
    { label: '1 MB', bytes: 1048576 },
    { label: '10 MB', bytes: 10485760 },
];
```

---

## Protocol 3: File Transfer (`/whatnext/file-transfer/1.0.0`)

### Purpose

Transfer actual files between peers with progress and error recovery.

### What You'll Learn

- File reading/writing
- Chunked transfer with resume support
- Progress callbacks
- Error recovery patterns
- File metadata exchange

### Implementation Steps

1. __Add File Transfer UI__

   ```typescript
   <button onClick={selectFileToSend}>
       Select File to Send
   </button>
   ```

2. __File Metadata Exchange__

   ```typescript
   // First message: metadata
   {
       "fileName": "album-art.jpg",
       "fileSize": 1048576,
       "mimeType": "image/jpeg",
       "checksum": "sha256:abc123..."
   }

   // Then: chunks
   {
       "chunkIndex": 0,
       "totalChunks": 100,
       "data": "base64encodeddata..."
   }
   ```

3. __Implement Chunking Logic__

   ```typescript
   const CHUNK_SIZE = 64 * 1024; // 64KB chunks

   async function sendFile(peerId, filePath) {
       // Read file metadata
       // Send metadata first
       // Read file in chunks
       // Send each chunk with index
       // Wait for ack/completion
   }
   ```

4. __Progress Tracking__
   - Show file name, size
   - Progress bar (percent complete)
   - Transfer rate (MB/s)
   - ETA
   - Cancel button

### Test Scenarios

- [ ] Send small file (< 1MB)
- [ ] Send medium file (1-10 MB)
- [ ] Send large file (> 10 MB)
- [ ] Verify file integrity (checksum)
- [ ] Cancel mid-transfer
- [ ] Multiple concurrent transfers

### Success Criteria

- [ ] File arrives intact (checksums match)
- [ ] Progress updates smoothly
- [ ] Can handle large files (100MB+)
- [ ] Cancel works cleanly
- [ ] No corrupted transfers

### Error Handling

- Connection drops mid-transfer (resume or restart?)
- Disk full on receiver
- File permissions issues
- Invalid file path

---

## Protocol 4: Playlist Sync (`/whatnext/playlist-sync/1.0.0`)

### Purpose

Synchronize playlist changes between peers in real-time.

### What You'll Learn

- CRDT concepts (Conflict-Free Replicated Data Types)
- RxDB replication protocol
- Conflict resolution strategies
- Event-driven updates
- Operational transformation

### Implementation Steps

1. __Integrate RxDB Replication__

   ```typescript
   // Use RxDB's built-in P2P replication
   import { replicateRxCollection } from 'rxdb/plugins/replication';
   ```

2. __Create Sync Protocol Handler__

   ```typescript
   // This might be simpler - RxDB handles most of it
   // You provide:
   // - Connection/stream management
   // - Peer discovery
   // RxDB handles:
   // - Diff/patch generation
   // - Conflict resolution
   // - Eventual consistency
   ```

3. __Test Scenarios__
   - [ ] Create playlist on peer A, appears on peer B
   - [ ] Add track on peer A, appears on peer B
   - [ ] Concurrent adds (both peers add at same time)
   - [ ] Concurrent deletes (conflict resolution)
   - [ ] Rename playlist while other peer adds track

4. __Observe CRDT Behavior__
   - Add debug logging for sync events
   - Show "last synced" timestamp per peer
   - Display conflict resolution decisions

### Success Criteria

- [ ] Changes replicate within 1-2 seconds
- [ ] No data loss during conflicts
- [ ] Order preserved for sequential ops
- [ ] Convergence (all peers eventually agree)

### This is Complex

Playlist sync is the most sophisticated protocol. It builds on all previous learnings:
- Handshake → establishes peer identity
- Data test → proves large data works
- File transfer → proves chunking/progress works
- RxDB replication → puts it all together

Don't rush to this one. Master the simpler protocols first.

---

## General Implementation Pattern

Every protocol follows this structure:

### 1. Protocol Registration

```typescript
// In p2p-service.ts startNode()
await this.libp2pNode.handle(
    '/whatnext/my-protocol/1.0.0',
    myProtocolHandler
);
```

### 2. Protocol Handler

```typescript
async function myProtocolHandler({ stream, connection }) {
    try {
        // Read incoming data
        const data = await readFromStream(stream);

        // Process
        const response = processData(data);

        // Write response (optional)
        await writeToStream(stream, response);

        // Close stream
        await stream.close();
    } catch (error) {
        console.error('Protocol error:', error);
        stream.abort(error);
    }
}
```

### 3. Protocol Dialing

```typescript
async function initiateProtocol(peerId, data) {
    const stream = await this.libp2pNode.dialProtocol(
        peerId,
        '/whatnext/my-protocol/1.0.0'
    );

    // Write request
    await writeToStream(stream, data);

    // Read response
    const response = await readFromStream(stream);

    // Close
    await stream.close();

    return response;
}
```

### 4. Stream Helpers

You'll want to create utilities for:
- Reading length-prefixed messages
- Writing length-prefixed messages
- JSON serialization/deserialization
- Error handling/timeouts

Example:

```typescript
// app/src/utility/protocols/stream-utils.ts
export async function readJSON(stream) {
    const pipe = stream.source
        | lpDecode()  // length-prefix decode
        | toBuffer()
        | toString();

    for await (const data of pipe) {
        return JSON.parse(data);
    }
}

export async function writeJSON(stream, obj) {
    const data = JSON.stringify(obj);
    await stream.sink([
        lpEncode()(Buffer.from(data))
    ]);
}
```

---

## Tips for Success

### Start Simple

- Don't try to build all protocols at once
- Each one teaches something new
- Test thoroughly before moving on

### Use the Dev UI

- Add protocol-specific sections as you go
- Log every message sent/received
- Display statistics

### Handle Errors

- Streams can fail
- Connections can drop
- Timeouts are important

### Document Learnings

- Keep writing notes
- Capture "gotchas"
- Share insights

### Test with Multiple Peers

- Use test-peer CLI
- Start multiple WhatNext instances
- Test concurrent operations

---

## Estimated Timeline

__Realistic pace__ (assuming 2-4 hours per protocol):

- __Week 1__: Handshake protocol (simplest, learn foundations)
- __Week 2__: Data test protocol (build on handshake, learn performance)
- __Week 3__: File transfer protocol (chunking, progress, error handling)
- __Week 4-5__: Playlist sync (most complex, integrates everything)

__Aggressive pace__ (full-time work):
- Could complete all in 1-2 weeks

__No rush!__ The goal is understanding, not speed.

---

## Success Metrics

By the end of this roadmap, you should be able to:

- [ ] Explain how libp2p protocol handlers work
- [ ] Implement a custom protocol from scratch
- [ ] Debug stream-based communication issues
- [ ] Measure and optimize data transfer performance
- [ ] Integrate RxDB replication
- [ ] Confidently build new protocols for future features

## Next: Handshake Protocol

Start with `Protocol 1: Handshake` above. It's the simplest and most important. Everything else builds on it.

Good luck! 🚀

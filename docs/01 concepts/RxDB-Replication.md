# RxDB Replication Protocol

#data/rxdb/replication #p2p/protocols/replication

## What It Is

A custom P2P replication protocol (`/whatnext/rxdb-replication/1.0.0`) that synchronizes RxDB documents between WhatNext peers over libp2p streams. It uses checkpoint-based sync with Last-Write-Wins (LWW) conflict resolution.

## Why We Use It

WhatNext's collaborative playlist feature requires peers to share and synchronize playlist data in real-time. Rather than relying on a central server, we replicate RxDB collections directly between peers using libp2p streams.

## How It Works

### Data Flow

```
Renderer (RxDB)
    |
    | IPC invoke (replication:push / replication:pull)
    v
Main Process
    |
    | MessagePort postMessage
    v
Utility Process (P2P Service)
    |
    | libp2p stream (JSON-over-stream)
    v
Remote Peer's Utility Process
    |
    | MessagePort postMessage
    v
Remote Main Process
    |
    | webContents.send (replication:changes)
    v
Remote Renderer (RxDB)
```

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `pull-request` | Outbound | Request documents since a checkpoint |
| `pull-response` | Inbound | Response with documents and new checkpoint |
| `push` | Outbound | Send local changes to remote peer |
| `push-ack` | Inbound | Acknowledgment of received push |

### Checkpoint-Based Sync

Each peer tracks a checkpoint (ISO timestamp) per collection per remote peer. On pull:
1. Send `pull-request` with the last known checkpoint
2. Remote peer returns all documents modified after that checkpoint
3. Local peer updates its checkpoint to the returned value

### Conflict Resolution: LWW

Currently using Last-Write-Wins based on the `updatedAt` timestamp:
- When two peers modify the same document, the version with the later `updatedAt` wins
- This is simple but can lose data in rare concurrent-edit scenarios
- Future: migrate to CRDTs for true eventual consistency without data loss

## Key Patterns

### Document Format

```typescript
interface ReplicationDocument {
    id: string;
    data: Record<string, unknown>;
    updatedAt: string;  // ISO timestamp, used for LWW
    deleted?: boolean;  // Soft delete flag
}
```

### Push on Change

When the renderer's RxDB detects a local change, it pushes to all connected peers:

```typescript
window.electron.replication.pushChanges('playlists', [
    { id: 'pl-1', data: { name: 'Road Trip' }, updatedAt: new Date().toISOString() }
]);
```

### Listen for Remote Changes

```typescript
window.electron.replication.onReplicationChanges((data) => {
    // data.collection, data.documents, data.checkpoint
    // Merge into local RxDB
});
```

## Common Pitfalls

- **Data lives in renderer**: RxDB runs in the renderer process, but P2P runs in the utility process. All data must be relayed through IPC (renderer -> main -> utility and back).
- **Stream-per-message**: Each replication message opens a new stream. This is simple but may not scale well for high-frequency updates. Future optimization: use persistent streams.
- **Clock skew**: LWW depends on accurate timestamps. If peer clocks are significantly skewed, the wrong version may win.

## Related Concepts

- [[RxDB]]
- [[libp2p]]
- [[Electron-IPC]]
- [[Handshake-Protocol]]
- [[Circuit-Relay]]

## References

- Protocol implementation: `app/src/utility/protocols/replication.ts`
- IPC types: `app/src/shared/core/ipc-protocol.ts` (ReplicationPushPayload, etc.)
- Preload API: `app/src/main/preload.ts` (replication namespace)
- [RxDB Replication Protocol docs](https://rxdb.info/replication.html)

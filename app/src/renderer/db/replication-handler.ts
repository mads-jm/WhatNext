/**
 * Replication Event Handler
 *
 * Listens for IPC replication events from the P2P layer and applies incoming
 * changes to local RxDB with Last-Write-Wins (LWW) conflict resolution.
 *
 * BOUNDARY CONTRACT — read before touching either file:
 *
 *   replication-handler.ts  — THE SOLE owner of REPLICATION_CHANGES.
 *     setupReplicationListeners() is called once at app startup (App.tsx) and
 *     remains active for the entire lifetime of the renderer. It applies all
 *     incoming peer changes using LWW (newer updatedAt wins).
 *
 *   useSessionReplication.ts — handles OUTBOUND sync only during an active session.
 *     It subscribes to RxDB change streams and pushes local changes to peers.
 *     It also responds to REPLICATION_PULL_REQUEST events (peers pulling our data).
 *     It does NOT register its own REPLICATION_CHANGES listener — that is this
 *     file's exclusive responsibility. If both registered, the same documents
 *     would be written twice per event: once with LWW (correct) and once with a
 *     blind upsert (incorrect — would overwrite regardless of timestamp).
 *
 * If you need session-specific conflict logic in the future, add a flag or
 * subtype to ReplicationChangesPayload and handle it here, not in the hook.
 */

import { getDatabase } from './database';
import type { WhatNextCollections } from './schemas';
import { incomingWins, envelopeCandidate, storedCandidate } from './lww';

type CollectionName = keyof WhatNextCollections;

/**
 * Apply incoming replicated changes to local RxDB
 */
export async function applyReplicatedChanges(
    collection: string,
    documents: Array<{ id: string; data: Record<string, unknown>; updatedAt: string; deleted?: boolean }>
): Promise<void> {
    const db = await getDatabase();
    const col = db[collection as CollectionName];
    if (!col) {
        console.warn(`[Replication] Unknown collection: ${collection}`);
        return;
    }

    console.log(`[Replication] Applying ${documents.length} changes to ${collection}`);

    for (const doc of documents) {
        if (doc.deleted) {
            const existing = await col.findOne(doc.id).exec();
            if (existing) {
                await existing.remove();
            }
        } else {
            // LWW: only update if incoming wins. Comparison is skew-aware —
            // timestamps are parsed to epoch-ms (not string-compared) and ties
            // are broken deterministically by content so peers converge. The
            // projections come from lww.ts (shared with the test peer) so both
            // ends of a session derive the same candidate from the same doc.
            const existing = await col.findOne(doc.id).exec();
            if (existing) {
                const existingData = existing.toJSON() as Record<string, unknown>;
                const winner = incomingWins(
                    envelopeCandidate(doc),
                    storedCandidate(existingData)
                );
                if (winner) {
                    await existing.update({ $set: doc.data });
                }
            } else {
                try {
                    await col.insert({ id: doc.id, ...doc.data } as never);
                } catch (e) {
                    console.warn(`[Replication] Failed to insert ${doc.id}:`, e);
                }
            }
        }
    }
}

/**
 * Set up replication listeners. Call once on app startup.
 */
export function setupReplicationListeners(): () => void {
    const cleanup = window.electron?.replication?.onReplicationChanges?.(
        (data) => {
            applyReplicatedChanges(data.collection, data.documents);
        }
    );

    return cleanup || (() => {});
}

/**
 * Push local changes to remote peers via replication
 */
export async function pushLocalChanges(
    collection: string,
    documents: Array<{ id: string; data: Record<string, unknown>; updatedAt: string }>
): Promise<void> {
    if (!window.electron?.replication) {
        console.warn('[Replication] Replication API not available');
        return;
    }
    await window.electron.replication.pushChanges(collection, documents);
}

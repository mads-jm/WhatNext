/**
 * Replication Event Handler
 * Listens for IPC replication events from the P2P layer
 * and applies changes to local RxDB via upsert.
 * Also emits local changes outbound for replication.
 */

import { getDatabase } from './database';
import type { WhatNextCollections } from './schemas';

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
            // LWW: only update if incoming is newer
            const existing = await col.findOne(doc.id).exec();
            if (existing) {
                const existingTime = (existing as unknown as Record<string, unknown>).updatedAt as string
                    || (existing as unknown as Record<string, unknown>).addedAt as string
                    || '';
                if (doc.updatedAt > existingTime) {
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

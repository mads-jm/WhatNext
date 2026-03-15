/**
 * useSessionReplication
 *
 * Wires RxDB change streams to the P2P replication bridge while a session is active.
 *
 * Responsibilities:
 *  - Subscribe to RxDB change streams for session-relevant collections.
 *  - On local change: push updated documents to peers via IPC.
 *  - On REPLICATION_CHANGES event from main: upsert incoming docs into RxDB.
 *  - Respond to REPLICATION_PULL_REQUEST events with matching RxDB data.
 *  - Track last-seen checkpoint per collection (ephemeral — reset on page refresh).
 *
 * Design constraint: this hook does NOT touch replication-handler.ts (off-limits).
 * It talks to RxDB directly via the database() promise and to the P2P layer via
 * window.electron IPC.
 */

import { useEffect, useRef } from 'react';
import { getDatabase } from '../db/database';
import type {
    ReplicationChangesPayload,
    ReplicationPullRequestPayload,
} from '../../shared/core/ipc-protocol';

const SESSION_COLLECTIONS = ['playlists', 'tracks', 'trackInteractions', 'comments', 'users'] as const;
type SessionCollection = typeof SESSION_COLLECTIONS[number];

// Minimum gap between pushes of the same collection (debounce, ms)
const PUSH_DEBOUNCE_MS = 500;

export function useSessionReplication(enabled: boolean) {
    // Per-collection debounce timer refs
    const pushTimers = useRef<Partial<Record<SessionCollection, ReturnType<typeof setTimeout>>>>({});
    // Per-collection pending changed doc IDs, deduplicated
    const pendingChanges = useRef<Partial<Record<SessionCollection, Set<string>>>>({});

    useEffect(() => {
        if (!enabled) return;

        const cleanups: Array<() => void> = [];
        let alive = true;

        async function setup() {
            const db = await getDatabase();
            if (!alive) return;

            // ------------------------------------------------------------------
            // 1. Subscribe to local RxDB changes → push to peers
            // ------------------------------------------------------------------
            for (const col of SESSION_COLLECTIONS) {
                // RxDB collection change$ emits on any insert/update/delete
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const collection = (db as any)[col];
                if (!collection) continue;

                const sub = collection.$.subscribe((changeEvent: {
                    operation: string;
                    documentId: string;
                    documentData?: Record<string, unknown>;
                }) => {
                    if (!alive) return;

                    // Track which doc changed
                    if (!pendingChanges.current[col]) {
                        pendingChanges.current[col] = new Set();
                    }
                    pendingChanges.current[col]!.add(changeEvent.documentId);

                    // Debounce the push
                    clearTimeout(pushTimers.current[col]);
                    pushTimers.current[col] = setTimeout(async () => {
                        if (!alive) return;
                        const ids = [...(pendingChanges.current[col] ?? [])];
                        pendingChanges.current[col] = new Set();

                        if (ids.length === 0) return;

                        try {
                            const docs = await collection.findByIds(ids).exec();
                            const documents = ids.map((id) => {
                                const doc = docs.get(id);
                                if (!doc) {
                                    // Document was deleted
                                    return { id, data: {}, updatedAt: new Date().toISOString(), deleted: true };
                                }
                                const data = doc.toJSON();
                                return {
                                    id,
                                    data: data as Record<string, unknown>,
                                    updatedAt: (data as { updatedAt?: string }).updatedAt ?? new Date().toISOString(),
                                };
                            });

                            await window.electron?.replication.pushChanges(col, documents);
                        } catch (err) {
                            console.warn('[useSessionReplication] push error for', col, err);
                        }
                    }, PUSH_DEBOUNCE_MS);
                });

                cleanups.push(() => sub.unsubscribe());
            }

            // ------------------------------------------------------------------
            // 2. Listen for incoming changes from peers → upsert into RxDB
            // ------------------------------------------------------------------
            const removeChangesListener = window.electron?.replication.onReplicationChanges(
                async (payload: ReplicationChangesPayload) => {
                    if (!alive) return;
                    const { collection: col, documents } = payload;

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const collection = (db as any)[col];
                    if (!collection) return;

                    try {
                        for (const doc of documents) {
                            if (doc.deleted) {
                                await collection.findOne(doc.id).exec().then((d: { remove: () => Promise<void> } | null) => d?.remove());
                            } else {
                                await collection.upsert(doc.data);
                            }
                        }
                    } catch (err) {
                        console.warn('[useSessionReplication] upsert error for', col, err);
                    }
                }
            );

            if (removeChangesListener) cleanups.push(removeChangesListener);

            // ------------------------------------------------------------------
            // 3. Respond to pull requests from peers (via utility → main → renderer)
            //    The utility process needs our local data to send to a remote peer.
            // ------------------------------------------------------------------
            const removePullRequestListener = window.electron?.replication.onPullRequest(
                async (payload: ReplicationPullRequestPayload) => {
                    if (!alive) return;
                    const { requestId, collection: col, checkpoint, limit = 500 } = payload;

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const collection = (db as any)[col];
                    if (!collection) {
                        await window.electron?.replication.respondToPullRequest({
                            requestId,
                            collection: col,
                            documents: [],
                            checkpoint: new Date().toISOString(),
                        });
                        return;
                    }

                    try {
                        // Fetch documents updated after the checkpoint
                        const selector = checkpoint
                            ? { updatedAt: { $gt: checkpoint } }
                            : {};

                        const docs = await collection
                            .find({ selector, limit, sort: [{ updatedAt: 'asc' }] })
                            .exec();

                        const documents = docs.map((d: { toJSON: () => Record<string, unknown> }) => {
                            const data = d.toJSON();
                            return {
                                id: (data as { id: string }).id,
                                data: data as Record<string, unknown>,
                                updatedAt: (data as { updatedAt?: string }).updatedAt ?? new Date().toISOString(),
                            };
                        });

                        await window.electron?.replication.respondToPullRequest({
                            requestId,
                            collection: col,
                            documents,
                            checkpoint: new Date().toISOString(),
                        });
                    } catch (err) {
                        console.warn('[useSessionReplication] pull request error for', col, err);
                        // Respond with empty set so the utility promise resolves rather than timing out
                        await window.electron?.replication.respondToPullRequest({
                            requestId,
                            collection: col,
                            documents: [],
                            checkpoint: new Date().toISOString(),
                        });
                    }
                }
            );

            if (removePullRequestListener) cleanups.push(removePullRequestListener);
        }

        setup();

        return () => {
            alive = false;
            // Clear all debounce timers
            for (const timer of Object.values(pushTimers.current)) {
                clearTimeout(timer as ReturnType<typeof setTimeout>);
            }
            pushTimers.current = {};
            pendingChanges.current = {};
            cleanups.forEach((fn) => fn());
        };
    }, [enabled]);
}

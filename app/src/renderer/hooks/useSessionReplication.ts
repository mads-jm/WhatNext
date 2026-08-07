/**
 * useSessionReplication
 *
 * Wires RxDB change streams to the P2P replication bridge while a session is active.
 *
 * Responsibilities:
 *  - Subscribe to RxDB change streams for session-relevant collections.
 *  - On local change: push updated documents to peers via IPC.
 *  - Respond to REPLICATION_PULL_REQUEST events with matching RxDB data.
 *  - Track last-seen checkpoint per collection (ephemeral — reset on page refresh).
 *
 * BOUNDARY CONTRACT — what this hook does NOT do:
 *  - It does NOT listen on REPLICATION_CHANGES. Incoming peer changes are applied
 *    exclusively by replication-handler.ts (setupReplicationListeners), which runs
 *    for the full renderer lifetime and uses LWW conflict resolution. Registering a
 *    second REPLICATION_CHANGES listener here would cause double-writes and silently
 *    break LWW (blind upsert overriding the timestamp-guarded update). See
 *    replication-handler.ts for the full boundary contract.
 *
 * This hook talks to RxDB directly via the database() promise and to the P2P
 * layer via window.electron IPC.
 */

import { useEffect, useRef } from 'react';
import { getDatabase } from '../db/database';
import { DEVICE_LOCAL_FIELDS } from '../db/schemas';
import type { ReplicationPullRequestPayload } from '../../shared/core/ipc-protocol';

const SESSION_COLLECTIONS = [
    'playlists',
    'tracks',
    'trackInteractions',
    'comments',
    'users',
] as const;
type SessionCollection = (typeof SESSION_COLLECTIONS)[number];

// Minimum gap between pushes of the same collection (debounce, ms)
const PUSH_DEBOUNCE_MS = 500;

export function useSessionReplication(enabled: boolean) {
    // Per-collection debounce timer refs
    const pushTimers = useRef<
        Partial<Record<SessionCollection, ReturnType<typeof setTimeout>>>
    >({});
    // Per-collection pending changed doc IDs, deduplicated
    const pendingChanges = useRef<
        Partial<Record<SessionCollection, Set<string>>>
    >({});

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
                // RxDB collection change$ emits on any insert/update/delete.
                // Justification: `db[col]` does type-check (SESSION_COLLECTIONS
                // is `as const`), but it yields a *union* of RxCollection types
                // whose `.$.subscribe` overloads are mutually incompatible —
                // "This expression is not callable" (TS2349, verified). Making
                // it work needs a generic per-collection helper, i.e. a real
                // refactor of the replication path, not a lint fix.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const collection = (db as any)[col];
                if (!collection) continue;

                const sub = collection.$.subscribe(
                    (changeEvent: {
                        operation: string;
                        documentId: string;
                        documentData?: Record<string, unknown>;
                    }) => {
                        if (!alive) return;

                        // Track which doc changed
                        if (!pendingChanges.current[col]) {
                            pendingChanges.current[col] = new Set();
                        }
                        pendingChanges.current[col]!.add(
                            changeEvent.documentId,
                        );

                        // Debounce the push
                        clearTimeout(pushTimers.current[col]);
                        pushTimers.current[col] = setTimeout(async () => {
                            if (!alive) return;
                            const ids = [
                                ...(pendingChanges.current[col] ?? []),
                            ];
                            pendingChanges.current[col] = new Set();

                            if (ids.length === 0) return;

                            try {
                                const docs = await collection
                                    .findByIds(ids)
                                    .exec();
                                const documents = ids.map((id) => {
                                    const doc = docs.get(id);
                                    if (!doc) {
                                        // Document was deleted
                                        return {
                                            id,
                                            data: {},
                                            updatedAt: new Date().toISOString(),
                                            deleted: true,
                                        };
                                    }
                                    const data = { ...doc.toJSON() } as Record<
                                        string,
                                        unknown
                                    >;
                                    // Strip device-local fields before sending to peers.
                                    // Sourced from the shared DEVICE_LOCAL_FIELDS so this
                                    // strip and the LWW tiebreak strip (lww.contentKey)
                                    // can never drift apart. Field names are unique per
                                    // collection, so deleting the full set is safe here.
                                    for (const field of DEVICE_LOCAL_FIELDS) {
                                        delete data[field];
                                    }
                                    return {
                                        id,
                                        data,
                                        updatedAt:
                                            (data as { updatedAt?: string })
                                                .updatedAt ??
                                            new Date().toISOString(),
                                    };
                                });

                                await window.electron?.replication.pushChanges(
                                    col,
                                    documents,
                                );
                            } catch (err) {
                                console.warn(
                                    '[useSessionReplication] push error for',
                                    col,
                                    err,
                                );
                            }
                        }, PUSH_DEBOUNCE_MS);
                    },
                );

                cleanups.push(() => sub.unsubscribe());
            }

            // NOTE: Incoming REPLICATION_CHANGES events are intentionally NOT
            // handled here. replication-handler.ts owns that channel exclusively
            // and applies changes with LWW conflict resolution for the full
            // renderer lifetime. See the boundary contract in this file's header.

            // ------------------------------------------------------------------
            // 2. Respond to pull requests from peers (via utility → main → renderer).
            //    The utility process needs our local data to fulfill a remote peer pull.
            // ------------------------------------------------------------------
            const removePullRequestListener =
                window.electron?.replication.onPullRequest(
                    async (payload: ReplicationPullRequestPayload) => {
                        if (!alive) return;
                        const {
                            requestId,
                            collection: col,
                            checkpoint,
                            limit = 500,
                        } = payload;

                        // Justification: `col` arrives off the wire as a plain
                        // string, so no static index type applies — and the
                        // `if (!collection)` branch below is precisely the runtime
                        // check that makes an unknown name safe. Same union-of-
                        // signatures obstacle as the change$ subscription above.
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const collection = (db as any)[col];
                        if (!collection) {
                            await window.electron?.replication.respondToPullRequest(
                                {
                                    requestId,
                                    collection: col,
                                    documents: [],
                                    checkpoint: new Date().toISOString(),
                                },
                            );
                            return;
                        }

                        try {
                            // Fetch documents updated after the checkpoint
                            const selector = checkpoint
                                ? { updatedAt: { $gt: checkpoint } }
                                : {};

                            const docs = await collection
                                .find({
                                    selector,
                                    limit,
                                    sort: [{ updatedAt: 'asc' }],
                                })
                                .exec();

                            const documents = docs.map(
                                (d: {
                                    toJSON: () => Record<string, unknown>;
                                }) => {
                                    const data = { ...d.toJSON() } as Record<
                                        string,
                                        unknown
                                    >;
                                    // Strip device-local fields before sending to peers
                                    if (col === 'tracks') {
                                        delete data.localFilePath;
                                        delete data.localFileSize;
                                        delete data.albumArtLocalPath;
                                    }
                                    if (col === 'playlists') {
                                        delete data.coverArtLocalPath;
                                    }
                                    return {
                                        id: (data as { id: string }).id,
                                        data,
                                        updatedAt:
                                            (data as { updatedAt?: string })
                                                .updatedAt ??
                                            new Date().toISOString(),
                                    };
                                },
                            );

                            await window.electron?.replication.respondToPullRequest(
                                {
                                    requestId,
                                    collection: col,
                                    documents,
                                    checkpoint: new Date().toISOString(),
                                },
                            );
                        } catch (err) {
                            console.warn(
                                '[useSessionReplication] pull request error for',
                                col,
                                err,
                            );
                            // Respond with empty set so the utility promise resolves rather than timing out
                            await window.electron?.replication.respondToPullRequest(
                                {
                                    requestId,
                                    collection: col,
                                    documents: [],
                                    checkpoint: new Date().toISOString(),
                                },
                            );
                        }
                    },
                );

            if (removePullRequestListener)
                cleanups.push(removePullRequestListener);
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

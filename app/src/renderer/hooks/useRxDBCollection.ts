/**
 * Reactive RxDB Query Hook
 * Subscribes to RxDB query observables for real-time UI updates.
 * When data changes in RxDB (local or via replication), the UI re-renders automatically.
 */

import { useState, useEffect } from 'react';
import type { RxQuery, RxDocument } from 'rxdb';

/**
 * Subscribe to an RxDB query and get reactive results
 * @param queryFactory - Function that returns an RxQuery (called once)
 * @param deps - Dependencies that trigger re-subscription
 */
export function useRxDBQuery<T>(
    queryFactory: () => RxQuery<T, RxDocument<T>[]> | null,
    deps: unknown[] = [],
): { data: RxDocument<T>[]; loading: boolean; error: Error | null } {
    const [data, setData] = useState<RxDocument<T>[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);

        const query = queryFactory();
        if (!query) {
            setLoading(false);
            return;
        }

        const subscription = query.$.subscribe({
            next: (results: RxDocument<T>[]) => {
                setData(results);
                setLoading(false);
            },
            error: (err: Error) => {
                setError(err);
                setLoading(false);
            },
        });

        return () => subscription.unsubscribe();
    }, deps);

    return { data, loading, error };
}

/**
 * Subscribe to a single RxDB document by ID
 */
export function useRxDBDocument<T>(
    getDoc: () => Promise<RxDocument<T> | null> | null,
    deps: unknown[] = [],
): { doc: RxDocument<T> | null; loading: boolean } {
    const [doc, setDoc] = useState<RxDocument<T> | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        let sub: { unsubscribe: () => void } | null = null;
        let cancelled = false;

        const init = async () => {
            const docPromise = getDoc();
            if (!docPromise) {
                setLoading(false);
                return;
            }
            const document = await docPromise;
            if (cancelled) return;
            if (document) {
                sub = document.$.subscribe((latest: T) => {
                    if (!cancelled) {
                        setDoc(latest as unknown as RxDocument<T>);
                        setLoading(false);
                    }
                });
            } else {
                setLoading(false);
            }
        };

        init();
        return () => {
            cancelled = true;
            sub?.unsubscribe();
        };
    }, deps);

    return { doc, loading };
}

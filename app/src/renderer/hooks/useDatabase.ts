/**
 * Convenience hook for accessing the RxDB database instance.
 * Replaces the repeated useState/useEffect(initDatabase) pattern.
 */

import { useDatabaseStore } from '../stores/database-store';

export function useDatabase() {
    const db = useDatabaseStore((s) => s.db);
    const loading = useDatabaseStore((s) => s.loading);
    return { db, loading };
}

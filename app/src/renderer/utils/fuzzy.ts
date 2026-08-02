/**
 * Lightweight, dependency-free fuzzy matching for local library search.
 *
 * The library "search" used to be a title-only substring `$regex` against RxDB,
 * which missed on typos, word reordering, and artist/album matches. This scores
 * a query as a case-insensitive *subsequence* of a candidate string, rewarding
 * contiguous runs and word-boundary hits, so "drk sd" still finds "Darkside"
 * and "boc music" finds "Music Has the Right to Children — Boards of Canada".
 */

/**
 * Score how well `query` fuzzy-matches `text`.
 *
 * Returns `null` when `query` is not a subsequence of `text` at all (a hard
 * miss). Otherwise returns a score where higher is a better match. An empty
 * query scores 0 (matches everything equally).
 */
export function fuzzyScore(query: string, text: string): number | null {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (q.length === 0) return 0;
    if (t.length === 0) return null;

    let score = 0;
    let textIdx = 0;
    let run = 0;
    let prevMatchIdx = -1;

    for (const ch of q) {
        const found = t.indexOf(ch, textIdx);
        if (found === -1) return null; // not a subsequence → hard miss
        score += 1; // base point per matched char

        if (found === prevMatchIdx + 1) {
            // contiguous with the previous match — reward longer runs
            run += 1;
            score += run * 2;
        } else {
            run = 0;
        }

        // bonus for matching at a word boundary or the very start
        if (found === 0 || /[\s\-_/([]/.test(t[found - 1])) {
            score += 3;
        }

        prevMatchIdx = found;
        textIdx = found + 1;
    }

    // mild preference for tighter (shorter) matches on ties
    return score - t.length * 0.01;
}

/**
 * Rank `items` by the best fuzzy score of `query` across each item's `fields`.
 * Items where no field matches are dropped. Highest score first; an empty query
 * returns `items` unchanged (preserving the caller's incoming order).
 */
export function fuzzyRank<T>(
    query: string,
    items: readonly T[],
    fields: (item: T) => Array<string | null | undefined>
): T[] {
    const q = query.trim();
    if (!q) return [...items];

    const ranked: Array<{ item: T; score: number }> = [];
    for (const item of items) {
        let best: number | null = null;
        for (const field of fields(item)) {
            if (!field) continue;
            const s = fuzzyScore(q, field);
            if (s !== null && (best === null || s > best)) best = s;
        }
        if (best !== null) ranked.push({ item, score: best });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.map((r) => r.item);
}

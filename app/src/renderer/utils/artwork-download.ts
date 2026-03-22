/**
 * Artwork Download Coordination
 * Groups tracks by artwork URL and batches downloads.
 * Pure logic — I/O is injected via callbacks.
 */

interface TrackWithArtwork {
    albumArtUrl?: string;
    album: string;
    artists: string[];
}

export interface ArtworkMeta {
    albumName: string;
    artistName: string;
}

/**
 * Group track IDs by their shared albumArtUrl.
 * Pure function — no I/O.
 */
export function groupTracksByArtwork(
    tracks: TrackWithArtwork[],
    trackIds: string[],
): Map<string, { trackIds: string[]; meta: ArtworkMeta }> {
    const groups = new Map<string, { trackIds: string[]; meta: ArtworkMeta }>();

    tracks.forEach((t, i) => {
        if (t.albumArtUrl) {
            const existing = groups.get(t.albumArtUrl);
            if (existing) {
                existing.trackIds.push(trackIds[i]);
            } else {
                groups.set(t.albumArtUrl, {
                    trackIds: [trackIds[i]],
                    meta: { albumName: t.album, artistName: t.artists[0] },
                });
            }
        }
    });

    return groups;
}

/**
 * Download artwork for a batch of grouped tracks.
 * I/O is injected: `download` fetches a URL, `updateTrackPath` persists the local path.
 */
export async function downloadArtworkBatch(
    groups: Map<string, { trackIds: string[]; meta: ArtworkMeta }>,
    download: (url: string, meta?: ArtworkMeta) => Promise<{ success: boolean; localPath?: string }>,
    updateTrackPath: (trackId: string, localPath: string) => Promise<void>,
): Promise<void> {
    for (const [url, { trackIds, meta }] of groups) {
        try {
            const result = await download(url, meta);
            if (result?.success && result.localPath) {
                await Promise.all(trackIds.map((id) => updateTrackPath(id, result.localPath!)));
            }
        } catch (err) {
            console.warn('[Artwork] Download failed for', url, err);
        }
    }
}

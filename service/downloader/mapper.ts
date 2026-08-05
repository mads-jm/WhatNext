import type { ResolvedTrack, AudioFormatOption } from './types';

/**
 * Detect the source provider from yt-dlp's extractor field.
 */
export function detectProvider(
    extractor: string,
): ResolvedTrack['sourceProvider'] {
    const lower = extractor.toLowerCase();
    if (lower.includes('youtube')) return 'youtube';
    if (lower.includes('soundcloud')) return 'soundcloud';
    if (lower.includes('bandcamp')) return 'bandcamp';
    if (lower.includes('spotify')) return 'spotify';
    return 'youtube'; // Safe default — yt-dlp is primarily used for YouTube
}

/**
 * Map a single yt-dlp --dump-json entry to a ResolvedTrack.
 */
export function mapYtdlpEntry(raw: Record<string, unknown>): ResolvedTrack {
    const id = String(raw['id'] ?? '');
    const sourceUrl = String(raw['webpage_url'] ?? raw['url'] ?? '');
    const extractor = String(raw['extractor'] ?? raw['extractor_key'] ?? '');
    const title = String(raw['title'] ?? 'Unknown Title');
    const uploader = String(
        raw['uploader'] ?? raw['artist'] ?? 'Unknown Artist',
    );
    const artist = raw['artist'] ? String(raw['artist']) : uploader;
    const album = String(raw['album'] ?? '');
    const durationSec =
        typeof raw['duration'] === 'number' ? raw['duration'] : 0;
    const thumbnailUrl = raw['thumbnail']
        ? String(raw['thumbnail'])
        : undefined;

    const rawFormats = Array.isArray(raw['formats']) ? raw['formats'] : [];
    const availableFormats: AudioFormatOption[] = rawFormats
        .filter((f: unknown): f is Record<string, unknown> => {
            if (typeof f !== 'object' || f === null) return false;
            const fmt = f as Record<string, unknown>;
            // Keep audio-only formats (no video codec, or acodec is present and vcodec is 'none')
            const vcodec = fmt['vcodec'];
            const acodec = fmt['acodec'];
            return (
                (vcodec === 'none' || vcodec === undefined) &&
                acodec !== undefined &&
                acodec !== 'none'
            );
        })
        .map((f: Record<string, unknown>): AudioFormatOption => {
            const codec = String(f['acodec'] ?? 'unknown');
            const bitrateRaw = f['abr'] ?? f['tbr'];
            const filesizeRaw = f['filesize'] ?? f['filesize_approx'];
            return {
                formatId: String(f['format_id'] ?? ''),
                codec,
                bitrate:
                    typeof bitrateRaw === 'number'
                        ? Math.round(bitrateRaw)
                        : undefined,
                filesize:
                    typeof filesizeRaw === 'number' ? filesizeRaw : undefined,
            };
        });

    return {
        sourceId: id,
        sourceUrl,
        sourceProvider: detectProvider(extractor),
        title,
        artists: [artist],
        album,
        durationMs: Math.round(durationSec * 1000),
        thumbnailUrl,
        availableFormats,
    };
}

/**
 * Map an array of yt-dlp --dump-json entries to ResolvedTrack[].
 */
export function mapYtdlpEntries(
    raws: Record<string, unknown>[],
): ResolvedTrack[] {
    return raws.map(mapYtdlpEntry);
}

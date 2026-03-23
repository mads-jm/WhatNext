/**
 * Download and purchase link types for the Audio Acquisition Service.
 * Shared between renderer (schemas, types) and main process (media mapper).
 */

/**
 * A link to purchase or legitimately acquire a track.
 * Used to surface artist funding options alongside local/downloaded audio.
 */
export interface PurchaseLink {
    provider: string; // 'bandcamp' | 'beatport' | 'itunes' | 'amazon'
    url: string;
    label?: string;
    resolvedAt: string; // ISO timestamp
}

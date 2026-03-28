/**
 * PurchaseResolver — artist attribution pipeline.
 *
 * Resolution order (per track):
 *   1. Disk cache hit (no network call)
 *   2. MusicBrainz recording search + URL relations
 *   3. Bandcamp HTML search (fallback)
 *
 * Rate limits enforced:
 *   - MusicBrainz: 1 req/sec (per API policy)
 *   - Bandcamp: 1 req/2 sec (conservative)
 *
 * Cache persisted to Documents/WhatNext/cache/purchase-links.json.
 * Key: "{firstArtist}|{title}" (lowercase, trimmed).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { PurchaseResolveRequest, PurchaseLink } from './types';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_USER_AGENT = 'WhatNext/0.1 (https://github.com/mads-whatnext)';

// Provider detection by URL prefix
const PROVIDER_PATTERNS: Array<{ pattern: RegExp; provider: string; labelPrefix: string }> = [
    { pattern: /bandcamp\.com/, provider: 'bandcamp', labelPrefix: 'Buy on Bandcamp' },
    { pattern: /beatport\.com/, provider: 'beatport', labelPrefix: 'Buy on Beatport' },
    { pattern: /music\.apple\.com|itunes\.apple\.com/, provider: 'itunes', labelPrefix: 'Buy on iTunes' },
    { pattern: /amazon\.com|amazon\.co/, provider: 'amazon', labelPrefix: 'Buy on Amazon' },
];

type CacheStore = Record<string, PurchaseLink[]>;

export class PurchaseResolver {
    private readonly cachePath: string;
    private cache: CacheStore = {};
    private mbLastRequest = 0;
    private bcLastRequest = 0;

    constructor(cacheDir?: string) {
        const dir = cacheDir ?? path.join(os.homedir(), 'Documents', 'WhatNext', 'cache');
        this.cachePath = path.join(dir, 'purchase-links.json');
    }

    async init(): Promise<void> {
        const dir = path.dirname(this.cachePath);
        await fs.promises.mkdir(dir, { recursive: true });
        try {
            const raw = await fs.promises.readFile(this.cachePath, 'utf8');
            this.cache = JSON.parse(raw) as CacheStore;
        } catch {
            this.cache = {};
        }
    }

    async resolve(req: PurchaseResolveRequest): Promise<PurchaseLink[]> {
        const key = this._cacheKey(req);
        if (this.cache[key] !== undefined) return this.cache[key];

        let links: PurchaseLink[] = [];

        // 1. MusicBrainz
        try {
            links = await this._mbSearch(req);
        } catch {
            // Non-fatal — fall through to Bandcamp
        }

        // 2. Bandcamp fallback
        if (links.length === 0) {
            try {
                links = await this._bandcampSearch(req);
            } catch {
                // Non-fatal
            }
        }

        this.cache[key] = links;
        this._saveCache();
        return links;
    }

    async resolveBatch(reqs: PurchaseResolveRequest[]): Promise<PurchaseLink[][]> {
        const results: PurchaseLink[][] = [];
        for (const req of reqs) {
            results.push(await this.resolve(req));
        }
        return results;
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    private _cacheKey(req: PurchaseResolveRequest): string {
        const artist = (req.artists[0] ?? '').toLowerCase().trim();
        const title = req.title.toLowerCase().trim();
        return `${artist}|${title}`;
    }

    private async _mbSearch(req: PurchaseResolveRequest): Promise<PurchaseLink[]> {
        const artist = req.artists[0] ?? '';
        if (!artist || !req.title) return [];

        // Step 1: search for recording
        const query = encodeURIComponent(`recording:"${req.title}" AND artist:"${artist}"`);
        const searchUrl = `${MB_BASE}/recording/?query=${query}&fmt=json&limit=1`;

        await this._mbThrottle();
        const searchRes = await fetch(searchUrl, {
            headers: { 'User-Agent': MB_USER_AGENT },
        });
        if (!searchRes.ok) return [];

        const searchData = await searchRes.json() as { recordings?: Array<{ id: string }> };
        const mbid = searchData.recordings?.[0]?.id;
        if (!mbid) return [];

        // Step 2: fetch URL relations for the recording
        await this._mbThrottle();
        const relUrl = `${MB_BASE}/recording/${mbid}?inc=url-rels&fmt=json`;
        const relRes = await fetch(relUrl, {
            headers: { 'User-Agent': MB_USER_AGENT },
        });
        if (!relRes.ok) return [];

        const relData = await relRes.json() as {
            relations?: Array<{
                type: string;
                url?: { resource: string };
            }>;
        };

        const purchaseTypes = new Set(['purchase for download', 'download for free', 'free streaming']);
        const now = new Date().toISOString();
        const links: PurchaseLink[] = [];

        const relations = Array.isArray(relData.relations) ? relData.relations : [];
        for (const rel of relations) {
            if (!purchaseTypes.has(rel.type)) continue;
            const url = rel.url?.resource;
            if (!url) continue;

            const providerInfo = PROVIDER_PATTERNS.find((p) => p.pattern.test(url));
            if (!providerInfo) continue;

            links.push({
                provider: providerInfo.provider,
                url,
                label: rel.type === 'download for free'
                    ? `Free on ${providerInfo.labelPrefix.replace('Buy on ', '')}`
                    : providerInfo.labelPrefix,
                resolvedAt: now,
            });
        }

        return links;
    }

    private async _bandcampSearch(req: PurchaseResolveRequest): Promise<PurchaseLink[]> {
        const artist = req.artists[0] ?? '';
        if (!artist || !req.title) return [];

        const q = encodeURIComponent(`${artist} ${req.title}`);
        const searchUrl = `https://bandcamp.com/search?q=${q}&item_type=t`;

        await this._bcThrottle();
        const res = await fetch(searchUrl, {
            headers: { 'User-Agent': MB_USER_AGENT },
        });
        if (!res.ok) return [];

        const html = await res.text();

        // Extract track URLs from search results
        // Bandcamp search results contain links like: https://artist.bandcamp.com/track/track-slug
        const trackUrlPattern = /href="(https?:\/\/[a-z0-9-]+\.bandcamp\.com\/track\/[^"?#]+)"/gi;
        const matches = [...html.matchAll(trackUrlPattern)];

        // Take the first result whose Bandcamp subdomain contains the full artist slug.
        // Using full slug prevents short prefixes ("mac", "lcd") from matching unrelated artists.
        // If the artist name is very short (≤3 chars) skip the check to avoid false negatives.
        const artistSlug = artist.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const match of matches.slice(0, 5)) {
            const url = match[1];
            if (!url) continue;
            const urlLower = url.toLowerCase();
            const subdomain = urlLower.match(/https?:\/\/([^.]+)\.bandcamp/)?.[1] ?? '';
            if (artistSlug.length > 3 && !subdomain.includes(artistSlug)) continue;

            return [{
                provider: 'bandcamp',
                url,
                label: 'Buy on Bandcamp',
                resolvedAt: new Date().toISOString(),
            }];
        }

        return [];
    }

    private async _mbThrottle(): Promise<void> {
        const elapsed = Date.now() - this.mbLastRequest;
        if (elapsed < 1000) await sleep(1000 - elapsed);
        this.mbLastRequest = Date.now();
    }

    private async _bcThrottle(): Promise<void> {
        const elapsed = Date.now() - this.bcLastRequest;
        if (elapsed < 2000) await sleep(2000 - elapsed);
        this.bcLastRequest = Date.now();
    }

    // Serialised write chain — prevents concurrent writes from stomping each other.
    private _saveCacheChain: Promise<void> = Promise.resolve();

    private _saveCache(): void {
        this._saveCacheChain = this._saveCacheChain.then(async () => {
            try {
                await fs.promises.writeFile(
                    this.cachePath,
                    JSON.stringify(this.cache, null, 2),
                    'utf8',
                );
            } catch {
                // Non-fatal cache write failure
            }
        });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

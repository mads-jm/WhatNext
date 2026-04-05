# Audio Acquisition Service

#architecture/adapters #data/local-files #data/download #ethics/artist-funding

**Date**: 2026-03-22
**Status**: Spec — not yet implemented
**Supersedes**: [[local-file-import-adapter]] (absorbed into Phase A of this spec)

---

## Context

Two features share the same schema migration and architectural surface:
1. **Local File Import** — scan directories, parse filenames, import metadata for files already on disk
2. **Cloud Playlist Download** — download audio from YouTube/SoundCloud/Bandcamp via pluggable backends, enrich with purchase links

Both produce the same outcome: a track in RxDB with a `localFilePath` pointing to audio on disk. This spec merges them into a single schema migration, shared field conventions, and unified architecture.

**Architecture**: Hybrid — core download engine in `/service/downloader/` (reusable without Electron), thin IPC bridge in Electron main process. Local file scanner lives in `app/src/main/media/`.

**Ethical stance**: Artist funding is a first-class concern. Every downloaded track is enriched with Bandcamp/Beatport purchase links via MusicBrainz and direct search. Bandcamp is both a download source AND a purchase link target — downloading there IS purchasing.

**External tools**: WhatNext never bundles download tools. Users install yt-dlp, spotDL, or Spytify independently. WhatNext wraps them as a convenience, mirroring how Obsidian treats Pandoc.

---

## 1. Unified Schema Migration (track v1 → v2)

One migration covers both local import and download fields.

### 1.1 New Fields on TrackDocType

**File**: `app/src/renderer/db/schemas.ts`

```typescript
// Local file reference (shared by both features)
localFilePath?: string         // Absolute path to audio file on disk
localFileSize?: number         // File size in bytes

// Source tracking (unified discriminator)
source?: string                // 'spotify' | 'youtube' | 'soundcloud' | 'bandcamp' | 'local' | 'manual'
sourceUrl?: string             // Original URL (YouTube, SoundCloud, Bandcamp page)

// Audio metadata (populated by downloader or future ID3 reader)
audioFormat?: string           // 'opus' | 'aac' | 'mp3' | 'flac' | 'wav'
audioBitrate?: number          // kbps

// Artist support
purchaseLinks?: PurchaseLink[] // Bandcamp, Beatport, etc.
userPurchased?: boolean        // Self-reported "I bought this"
```

### 1.2 Migration Strategy

**File**: `app/src/renderer/db/database.ts`

```typescript
2(oldDoc: any) {
    return {
        ...oldDoc,
        localFilePath: undefined,
        localFileSize: undefined,
        source: oldDoc.spotifyId ? 'spotify' : 'manual',
        sourceUrl: undefined,
        audioFormat: undefined,
        audioBitrate: undefined,
        purchaseLinks: undefined,
        userPurchased: undefined,
    };
}
```

Backfills: Spotify tracks get `source: 'spotify'`, others get `source: 'manual'`.

### 1.3 PurchaseLink Type

**File**: `app/src/shared/core/download-types.ts`

```typescript
export interface PurchaseLink {
    provider: string    // 'bandcamp' | 'beatport' | 'itunes' | 'amazon'
    url: string
    label?: string      // e.g., "Buy on Bandcamp ($1+)"
    resolvedAt: string  // ISO timestamp
}
```

### 1.4 Type Extensions

**File**: `app/src/renderer/db/types.ts`

- `CreateTrackInput`: add all new optional fields
- `UpdateTrackInput`: add all new optional fields
- `TrackViewModel`: add `source?`, `localFilePath?`, `purchaseLinks?`, `userPurchased?`

---

## 2. Feature A: Local File Import

Originally spec'd in [[local-file-import-adapter]]. That spec's scanner, parser, and mapper are absorbed here as Phase A. See [[local-file-import-adapter]] for TapeC-specific porting details.

### 2.1 Scanner Module

**New file**: `app/src/main/media/scanner.ts`

Async directory traversal with audio extension filter. Ported from TapeC's `walkDir`.

```typescript
export interface ScannedFile {
    absPath: string
    filename: string
    ext: string          // lowercase, no dot
    sizeBytes: number
    mtimeMs: number
}

export interface ScanResult {
    files: ScannedFile[]
    scannedDirs: number
    skippedFiles: number
}

const AUDIO_EXTENSIONS = new Set([
    'mp3', 'mp4', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma'
])

export async function scanDirectory(rootPath: string): Promise<ScanResult>
```

### 2.2 Filename Parser

**New file**: `app/src/main/media/filename-parser.ts`

```typescript
export interface ParsedFilename {
    title: string
    artist?: string
    year?: number
}

export function parseFilename(filename: string): ParsedFilename
```

Logic: strip extension → extract year from last parenthesized group → split on ` - ` for artist/title → fallback: full filename as title.

### 2.3 Local Media Mapper

**New file**: `app/src/main/media/local-media-mapper.ts`

Maps `ScannedFile` → `MappedLocalTrack` following `spotify-mapper.ts` pattern.

```typescript
export interface MappedLocalTrack {
    id: string           // uuid
    title: string
    artists: string[]
    album: string        // Parent directory name as fallback
    durationMs: number   // 0 (unknown without ID3 reading)
    localFilePath: string
    localFileSize: number
    source: 'local'
    addedAt: string
}

export function mapLocalFile(file: ScannedFile): MappedLocalTrack
export function mapLocalFiles(files: ScannedFile[]): MappedLocalTrack[]
```

### 2.4 IPC

**Handler** (`app/src/main/main.ts`):
```typescript
ipcMain.handle('media:scan-directory', async (_event, dirPath: string) => {
    const result = await scanDirectory(dirPath);
    const mapped = mapLocalFiles(result.files);
    return { success: true, tracks: mapped, stats: { dirs: result.scannedDirs, skipped: result.skippedFiles } };
});
```

**Preload** (`app/src/main/preload.ts`):
```typescript
media: {
    scanDirectory: (dirPath: string) => ipcRenderer.invoke('media:scan-directory', dirPath),
}
```

### 2.5 Import Hook

**New file**: `app/src/renderer/hooks/useLocalMediaImport.ts`

State machine mirroring `useSpotifyImport.ts`:

```typescript
type LocalImportState = 'idle' | 'scanning' | 'selecting' | 'importing' | 'done' | 'error'
```

Flow: `dialog.openDirectory()` → `media.scanDirectory(path)` → user selects tracks → `bulkImportTracks()` with `source: 'local'` → optionally create playlist.

### 2.6 UI Updates

- **SourceBadge.tsx**: use `source` field with fallback to `spotifyId` check. Add variants for 'local', 'youtube', 'soundcloud', 'bandcamp'.
- **LibraryView.tsx**: filter tabs by `source` field.

---

## 3. Feature B: Cloud Playlist Download

### 3.1 Pluggable Backend Architecture

Three external tools, none bundled. User installs independently.

| | **yt-dlp** | **spotDL** | **Spytify** |
|---|---|---|---|
| **Input** | Any URL (YouTube, SoundCloud, Bandcamp, 1000+ sites) | Spotify URL or track ID | Spotify desktop app (records output) |
| **Speed** | Fast (direct download) | Fast (finds on YouTube, downloads with Spotify metadata) | Real-time (1x playback) |
| **Metadata quality** | Source-dependent (often sparse) | Rich — Spotify API metadata, lyrics, album art | Good — Spotify/Last.fm |
| **Audio quality** | Source-dependent (YouTube ≈128k Opus) | Source-dependent (YouTube under the hood) | Spotify tier (Free: 160k, Premium: 320k) |
| **Platform** | Cross-platform (Python) | Cross-platform (Python) | **Windows-only** (.NET, requires Spotify desktop) |
| **Key strength** | Universal URL source | **Bridges existing `spotifyId` to audio files** | Exact Spotify audio, zero matching errors |
| **Best for** | YouTube/SoundCloud/Bandcamp playlists | Bulk-downloading existing Spotify imports | Archival-quality Spotify capture |

### 3.2 The `DownloadBackend` Interface

**File**: `/service/downloader/backend.ts`

```typescript
export interface DownloadBackend {
    id: string                              // 'ytdlp' | 'spotdl' | 'spytify'
    name: string                            // Human-readable
    supportedInputs: InputType[]            // What this backend accepts

    checkInstalled(): Promise<BackendStatus>
    resolve(input: DownloadInput): Promise<ResolvedTrack[]>
    download(tracks: ResolvedTrack[], opts: DownloadOptions): AsyncGenerator<DownloadEvent>
    cancel(): Promise<void>
}

export type InputType = 'url' | 'spotify-id' | 'spotify-playback'

export interface BackendStatus {
    installed: boolean
    version?: string
    path?: string
    error?: string
}
```

### 3.3 Backend Implementations

**yt-dlp backend** (`/service/downloader/backends/ytdlp-backend.ts`):
- Resolve: `yt-dlp --flat-playlist --dump-json --no-download {url}`
- Download: `yt-dlp -x --audio-format {fmt} --audio-quality 0 --embed-thumbnail --embed-metadata --output "{audioDir}/{artist} - {title}.%(ext)s" --progress --newline --print-json {sourceUrl}`
- Progress parsed from stdout regex
- Bandcamp URLs get special treatment: noted as legitimate purchases in UI

**spotDL backend** (`/service/downloader/backends/spotdl-backend.ts`):
- Input: Spotify URL or track ID → `spotdl --output "{audioDir}" --format {fmt} {input}`
- **Key integration**: WhatNext already stores `spotifyId` on imported tracks. spotDL can take `https://open.spotify.com/track/{spotifyId}` and find+download matching audio with full Spotify metadata (album art, lyrics, correct ID3 tags)
- This enables the **Library Download flow**: select existing tracks → spotDL downloads audio for each using their stored `spotifyId`
- Metadata: rich — spotDL pulls from Spotify API (uses spotDL's default credentials or user-configured client ID/secret)

**Spytify backend** (`/service/downloader/backends/spytify-backend.ts`):
- Input: requires Spotify desktop app to be playing
- Mode: real-time recording — slower but guarantees exact Spotify audio
- **Windows-only**: backend reports `{ installed: false, error: 'Windows only' }` on other platforms
- Outputs WAV or MP3 at Spotify's output quality (Free: 160kbps, Premium: 320kbps)
- Deepest integration needed: may control Spotify playback to automate recording

### 3.4 Backend Selection Logic

- URL pasted → yt-dlp (or spotDL if it's a Spotify URL)
- "Download from library" (tracks with `spotifyId`, no `localFilePath`) → spotDL
- "Record from Spotify" → Spytify (Windows only)
- User can always override the suggestion

---

## 4. Service Layer

### 4.1 Download Service (`/service/downloader/`)

Standalone Node module. No Electron dependencies. Reusable outside the desktop app.

```
/service/downloader/
    index.ts                     — Public API: createBackend(), resolve, download, cancel
    backend.ts                   — DownloadBackend interface definition
    backends/
        ytdlp-backend.ts        — yt-dlp implementation
        spotdl-backend.ts       — spotDL implementation
        spytify-backend.ts      — Spytify implementation (Windows-only)
    subprocess.ts                — Shared child_process.spawn helpers, progress parsing
    mapper.ts                    — Backend output → canonical ResolvedTrack[] mapping
    purchase-resolver.ts         — MusicBrainz + Bandcamp + Beatport link lookup
    audio-store.ts               — File naming, dedup index, storage management
    types.ts                     — All shared types (ResolvedTrack, DownloadEvent, etc.)
```

### 4.2 Electron IPC Bridge

**New file**: `app/src/main/downloader/downloader-ipc.ts`

Thin wrapper calling into `/service/downloader`. Registers all `download:*` and `purchase:*` IPC handlers.

### 4.3 Audio Storage

Downloaded files: `Documents/WhatNext/audio/{artist} - {title}.{ext}`
Dedup index: `Documents/WhatNext/audio/index.json` (maps sourceUrl → filename)

Local imports: files stay in-place (referenced by `localFilePath`), NOT copied.

Both result in a track with `localFilePath` set. The rest of the app doesn't care how it got there.

---

## 5. IPC Surface

### 5.1 Channels

Add to `app/src/shared/core/ipc-protocol.ts`:

```
# Local file import
media:scan-directory             — Scan directory → MappedLocalTrack[]

# Download service
download:check-backends          — Check all backends → BackendStatus[]
download:resolve                 — Resolve URL or spotify IDs → ResolvedTrack[]
download:start                   — Start downloading with chosen backend
download:cancel                  — Kill active downloads
download:progress                — (main→renderer event) per-track progress
download:track-complete          — (main→renderer event) single track done
download:error                   — (main→renderer event) download error

# Purchase link resolution
purchase:resolve                 — Find purchase links for a track
purchase:resolve-batch           — Batch resolve for multiple tracks
```

### 5.2 Preload Bridge

Add to `app/src/main/preload.ts`:

```typescript
media: {
    scanDirectory(dirPath: string) → ScanResult
}

download: {
    checkBackends()                                → BackendStatus[]
    resolve(backend: string, input: DownloadInput) → ResolvedTrack[]
    start(request: DownloadStartRequest)           → void
    cancel()                                       → void
    onProgress(callback)    → unsubscribe function
    onTrackComplete(callback) → unsubscribe function
    onError(callback)       → unsubscribe function
}

purchase: {
    resolve(req: PurchaseResolveRequest)       → PurchaseLink[]
    resolveBatch(reqs: PurchaseResolveRequest[]) → PurchaseLink[][]
}
```

---

## 6. Download Flows

### 6.1 Flow A: URL Import + Download (yt-dlp, spotDL)

User provides a URL → resolve tracks → select → download → import to RxDB.

1. User pastes URL (YouTube playlist, SoundCloud set, Bandcamp album, or Spotify playlist)
2. Backend resolves URL → `ResolvedTrack[]`
3. User selects tracks + audio format preference
4. Backend downloads audio files to `Documents/WhatNext/audio/`
5. Tracks imported to RxDB via `bulkImportTracks` with `localFilePath`, `sourceUrl`, `source`
6. Background: purchase link enrichment + artwork download (fire-and-forget)

### 6.2 Flow B: Library Download (spotDL, Spytify)

**The killer Spotify departure feature.** Users already imported metadata via Spotify adapter; now they backfill audio.

1. User opens "Download from Library" tab
2. Tracks with `spotifyId` but no `localFilePath` are shown
3. User selects tracks + format
4. spotDL downloads via `https://open.spotify.com/track/{spotifyId}`
5. Track documents updated: `localFilePath`, `audioFormat`, `audioBitrate` (source stays `'spotify'`)
6. Background: purchase link enrichment

---

## 7. Artist Attribution Pipeline

Runs as background enrichment after any download completes. Fire-and-forget pattern, same as artwork download.

### 7.1 MusicBrainz (Primary Source)

MusicBrainz stores external purchase links as URL relationships on recordings.

1. Search: `GET /ws/2/recording/?query="{title}" AND artist:"{artist}"&fmt=json`
2. Fetch top match with URL relations: `GET /ws/2/recording/{mbid}?inc=url-rels&fmt=json`
3. Filter relation types: `purchase for download`, `download for free`
4. Extract Bandcamp, Beatport, iTunes, Amazon URLs → `PurchaseLink[]`
5. Rate limit: 1 request/second (MusicBrainz policy)

### 7.2 Bandcamp Search (Fallback)

1. `GET https://bandcamp.com/search?q={encodeURIComponent(artist + " " + title)}&item_type=t`
2. Parse HTML for `.result-info a` links
3. Fuzzy match on artist name
4. Rate limit: 1 request/2 seconds

### 7.3 Beatport Search (Fallback)

1. `GET https://www.beatport.com/search?q={encodeURIComponent(artist + " " + title)}`
2. Parse results, fuzzy match
3. Rate limit: 1 request/2 seconds

### 7.4 Caching

Local cache at `Documents/WhatNext/cache/purchase-links.json` maps `"{artist}|{title}"` → resolved links. Avoids redundant lookups across sessions and app restarts.

### 7.5 Storage

Results written to track documents: `updateTrack(id, { purchaseLinks: [...] })`

---

## 8. UI

### 8.1 Navigation

Add `'download'` to `ViewId` union in `navigation-store.ts`. Sidebar entry after Spotify Import.

The download view has three tabs:
- **URL Import** — paste a URL from any supported source
- **Library Download** — download audio for existing tracks (spotDL/Spytify)
- **Local Import** — scan a directory on disk

### 8.2 Download Components

```
app/src/renderer/components/Download/
    DownloadImport.tsx        — Top-level tabbed view
    BackendGate.tsx           — Install instructions for missing backends
    BackendPicker.tsx         — Backend selector when multiple are available
    DownloadTrackSelector.tsx — Track list with checkboxes + format picker (reusable for local import)
    DownloadProgress.tsx      — Per-track progress bars
    DownloadComplete.tsx      — Completion summary with purchase link badges
    LibraryDownload.tsx       — "Download audio for existing tracks" view (spotDL flow)
    PurchaseLinkBadge.tsx     — Reusable pill component ("Buy on Bandcamp", "Beatport", etc.)
```

### 8.3 Hooks

```
app/src/renderer/hooks/
    useLocalMediaImport.ts    — Local file import state machine
    usePlaylistDownload.ts    — URL-based download state machine
    useLibraryDownload.ts     — Library download state machine (spotDL path)
```

### 8.4 Purchase Link Display (Integrated but Subtle)

- **PurchaseLinkBadge**: Small pill on track rows throughout the app
- **DownloadComplete**: Summary shows count of tracks with available purchase options
- **Track context menu**: "Support Artist" submenu with purchase links when available
- **"I bought this"**: Optional self-reported flag, persisted on track document

### 8.5 Source Badge + Library Filter Updates

- `SourceBadge.tsx`: use `source` field with fallback to `spotifyId` check. Add variants for 'local', 'youtube', 'soundcloud', 'bandcamp'.
- `LibraryView.tsx`: filter tabs by `source` field.

### 8.6 Settings

Download Settings section:
- Backend paths (yt-dlp, spotDL, Spytify) — auto-detect + manual override
- Default audio format preference
- Audio storage directory (default: `Documents/WhatNext/audio/`)
- spotDL Spotify credentials (client ID/secret — optional, spotDL has defaults)
- Auto-resolve purchase links toggle (default: on)

---

## 9. Legal / Ethics

- **External tools only**: WhatNext never bundles yt-dlp, spotDL, or Spytify
- **First-time disclaimer**: one-time acknowledgment that user is responsible for content rights (stored in localStorage)
- **Bandcamp highlighted**: when a Bandcamp URL is detected, UI notes this is a legitimate purchase source
- **Purchase links prominent**: not hidden — badges on tracks, summary at completion
- **"I bought this"**: self-reported flag gives users a way to track their artist support

---

## 10. Key Types

**File**: `/service/downloader/types.ts`

```typescript
export interface ResolvedTrack {
    sourceId: string
    sourceUrl: string
    sourceProvider: 'youtube' | 'soundcloud' | 'bandcamp' | 'spotify'
    title: string
    artists: string[]
    album: string
    durationMs: number
    thumbnailUrl?: string
    availableFormats: AudioFormatOption[]
    spotifyId?: string           // Present when resolved from Spotify source
}

export interface AudioFormatOption {
    formatId: string
    codec: string                // 'opus' | 'aac' | 'mp3' | 'flac' | 'wav'
    bitrate?: number             // kbps
    filesize?: number            // bytes, estimated
}

export interface DownloadInput {
    type: 'url' | 'spotify-ids'
    url?: string                 // For URL-based input
    spotifyIds?: string[]        // For library download flow
}

export interface DownloadStartRequest {
    backend: string              // 'ytdlp' | 'spotdl' | 'spytify'
    tracks: Array<{
        sourceUrl: string
        sourceProvider: string
        preferredFormat: string  // 'best_audio' | 'opus' | 'mp3' | 'flac'
    }>
    outputDir?: string
}

export interface DownloadEvent {
    type: 'progress' | 'complete' | 'error'
    sourceUrl: string
    percent?: number
    speed?: string
    eta?: string
    localFilePath?: string
    audioFormat?: string
    audioBitrate?: number
    error?: string
}

export interface PurchaseResolveRequest {
    title: string
    artists: string[]
    album?: string
}
```

---

## 11. Implementation Phases

### Phase A: Schema + Local File Import

Delivers the [[local-file-import-adapter]] spec with the unified schema.

1. Schema v1→v2: add all new fields to `trackSchema`, write migration in `database.ts`
2. Type extensions in `types.ts` (`CreateTrackInput`, `UpdateTrackInput`, `TrackViewModel`)
3. `app/src/main/media/scanner.ts` — directory scanner (from TapeC)
4. `app/src/main/media/filename-parser.ts` — filename metadata parser
5. `app/src/main/media/local-media-mapper.ts` — ScannedFile → MappedLocalTrack mapper
6. `media:scan-directory` IPC handler in `main.ts` + preload bridge
7. `useLocalMediaImport.ts` hook
8. `SourceBadge.tsx` + `LibraryView.tsx` updates
9. Navigation: add local import entry point

### Phase B: Download Foundation + yt-dlp Backend

1. `/service/downloader/` — types, `DownloadBackend` interface, subprocess helpers
2. `backends/ytdlp-backend.ts` — yt-dlp implementation
3. `audio-store.ts` — file naming, dedup index
4. Download IPC channels in `ipc-protocol.ts`
5. `downloader-ipc.ts` — Electron IPC bridge
6. Preload additions for `download` namespace

### Phase C: Download UI + URL Flow

1. `usePlaylistDownload.ts` hook (state machine)
2. Download/ components: BackendGate, DownloadImport, TrackSelector, Progress, Complete
3. Navigation: add download view with tabs
4. Backend auto-detection + selection UI

### Phase D: spotDL Backend + Library Download

1. `backends/spotdl-backend.ts` implementation
2. `useLibraryDownload.ts` hook
3. `LibraryDownload.tsx` — select existing tracks → download via spotDL
4. Backend suggestion logic (Spotify URL → spotDL, other URLs → yt-dlp)

### Phase E: Artist Attribution

1. `purchase-resolver.ts` — MusicBrainz + Bandcamp + Beatport lookup
2. `PurchaseLinkBadge.tsx` reusable component
3. Background enrichment in both download hooks
4. Integration into existing track displays (context menu, track rows)

### Phase F: Spytify Backend + Polish

1. `backends/spytify-backend.ts` implementation (Windows-only)
2. Download settings UI (backend paths, formats, credentials)
3. Legal disclaimer modal
4. Error handling, retry, partial file cleanup
5. Tests (unit: mapper, resolver; integration: subprocess mocking)

---

## 12. Files to Modify

| File | Change |
|------|--------|
| `app/src/renderer/db/schemas.ts` | Add all new track fields, bump to v2 |
| `app/src/renderer/db/types.ts` | Extend input/view model types |
| `app/src/renderer/db/database.ts` | Add v1→v2 migration |
| `app/src/shared/core/ipc-protocol.ts` | Add media/download/purchase channels and types |
| `app/src/main/preload.ts` | Add media/download/purchase namespaces |
| `app/src/main/main.ts` | Register all new IPC handlers |
| `app/src/renderer/stores/navigation-store.ts` | Add 'download' ViewId |
| `app/src/renderer/components/Layout/Sidebar.tsx` | Add Download nav entry |
| `app/src/renderer/components/Layout/ViewRouter.tsx` | Route download view |
| `app/src/renderer/components/UI/SourceBadge.tsx` | Use `source` field, add variants |
| `app/src/renderer/components/Library/LibraryView.tsx` | Source filter tabs |

## 13. Files to Create

| File | Purpose |
|------|---------|
| `app/src/main/media/scanner.ts` | Directory scanner (from TapeC) |
| `app/src/main/media/filename-parser.ts` | Filename metadata parser |
| `app/src/main/media/local-media-mapper.ts` | ScannedFile → Track mapper |
| `app/src/renderer/hooks/useLocalMediaImport.ts` | Local import state machine |
| `/service/downloader/index.ts` | Download service public API |
| `/service/downloader/backend.ts` | DownloadBackend interface |
| `/service/downloader/backends/ytdlp-backend.ts` | yt-dlp implementation |
| `/service/downloader/backends/spotdl-backend.ts` | spotDL implementation |
| `/service/downloader/backends/spytify-backend.ts` | Spytify implementation |
| `/service/downloader/subprocess.ts` | Shared spawn/progress helpers |
| `/service/downloader/mapper.ts` | Backend output → ResolvedTrack |
| `/service/downloader/purchase-resolver.ts` | MusicBrainz/Bandcamp/Beatport |
| `/service/downloader/audio-store.ts` | File naming, dedup |
| `/service/downloader/types.ts` | Shared types |
| `app/src/main/downloader/downloader-ipc.ts` | Electron IPC bridge |
| `app/src/shared/core/download-types.ts` | PurchaseLink type for main/renderer |
| `app/src/renderer/hooks/usePlaylistDownload.ts` | URL download state machine |
| `app/src/renderer/hooks/useLibraryDownload.ts` | Library download state machine |
| `app/src/renderer/components/Download/DownloadImport.tsx` | Top-level tabbed view |
| `app/src/renderer/components/Download/BackendGate.tsx` | Backend install gate |
| `app/src/renderer/components/Download/BackendPicker.tsx` | Backend selector |
| `app/src/renderer/components/Download/DownloadTrackSelector.tsx` | Track selector + format |
| `app/src/renderer/components/Download/DownloadProgress.tsx` | Progress bars |
| `app/src/renderer/components/Download/DownloadComplete.tsx` | Completion summary |
| `app/src/renderer/components/Download/LibraryDownload.tsx` | Library download view |
| `app/src/renderer/components/Download/PurchaseLinkBadge.tsx` | Purchase link pill |

---

## 14. Verification

**Schema & Local Import (Phase A):**
- `cd app && npm run typecheck` passes
- Start app → existing tracks backfilled with `source: 'spotify'` or `'manual'`
- Scan directory with audio files → tracks listed correctly
- Import selected tracks → appear in Library with "Local" badge
- `localFilePath` does NOT leak via P2P replication

**Download (Phases B–D):**
- No backends installed → gate UI shown, feature gracefully degraded
- yt-dlp + YouTube playlist → resolve → select → download → tracks in RxDB
- yt-dlp + Bandcamp album → same flow, noted as legitimate purchase
- spotDL + Spotify URL → download with rich metadata
- spotDL + library tracks (spotifyId, no localFilePath) → audio downloaded → `localFilePath` set
- Cancel mid-download → process killed, partial files cleaned up
- Dedup → re-downloading same source URL skips via index.json

**Artist Attribution (Phase E):**
- MusicBrainz → purchase link badges appear on tracks
- Bandcamp search fallback → badges appear when MusicBrainz misses
- "I bought this" toggle persisted and visible

**Integration:**
- Both local-imported and downloaded tracks show consistent `source` badge
- Library filters work across all source types
- Purchase link badges render on any track that has them

---

## Future Enhancements (not in scope)

- **ID3 tag reading**: Add `music-metadata` package for proper metadata extraction (title, artist, album, duration, embedded artwork)
- **Local playback**: Register Electron `protocol.handle('media', ...)` for range-based local file streaming
- **Rescan / watch**: Auto-detect file changes in imported directories
- **TapeC companion adapter**: Connect to running TapeC instance via REST API for network-accessible media
- **Plugin backends**: Allow community-contributed download backends via plugin architecture

---

## Related Concepts

- [[local-file-import-adapter]] — Original local file import spec (absorbed into Phase A)
- [[tapec-integration-analysis]] — TapeC scanner/parser reference implementations
- [[architecture-whatnext]] — Import adapter pattern
- [[the-walled-garden-cracks]] — Coordinator model and source abstraction philosophy
- [[Spotify-Integration]] — Existing Spotify adapter (reference implementation)

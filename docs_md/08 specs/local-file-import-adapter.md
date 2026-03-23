# Local File Import Adapter

#architecture/adapters #data/local-files

**Date**: 2026-03-22
**Status**: Absorbed into [[audio-acquisition-service]] (Phase A)
**Origin**: [[tapec-integration-analysis]] (Approach 2: Cherry-Pick Scanner + Parser)

> **Note**: This spec has been merged into the broader [[audio-acquisition-service]] spec, which unifies local file import and cloud playlist downloading under a single schema migration (track v1→v2). The scanner, parser, and mapper defined here are delivered as Phase A of that spec. Refer to [[audio-acquisition-service]] for the current implementation plan.

---

## Context

WhatNext's import adapter architecture abstracts streaming services behind a translation layer. Spotify is the first adapter. This spec defines the **local file import adapter** — the same pattern applied to files on disk. Users can import tracks from their filesystem into the library, add them to collaborative playlists, and share metadata via P2P.

**Scope**: Metadata import only. No playback, no streaming, no markers, no ID3 tag reading (future enhancements).

**Origin**: TapeC's directory scanner and filename parser provide proven reference implementations (~200 lines) that bootstrap this feature.

---

## Schema Migration (track v1 → v2)

**File**: `app/src/renderer/db/schemas.ts`

Add to `TrackDocType`:
```typescript
localFilePath?: string;    // Absolute path to local audio file
localFileSize?: number;    // File size in bytes
source?: string;           // 'spotify' | 'local' | 'manual' (discriminator)
```

Bump `trackSchema.version` to `2`. Add properties to the JSON schema.

**File**: `app/src/renderer/db/database.ts`

Add migration strategy `2`:
```typescript
2(oldDoc: any) {
    return {
        ...oldDoc,
        localFilePath: undefined,
        localFileSize: undefined,
        source: oldDoc.spotifyId ? 'spotify' : 'manual',
    };
}
```

This backfills existing tracks: Spotify tracks get `source: 'spotify'`, others get `source: 'manual'`.

---

## Scanner Module (main process)

**New file**: `app/src/main/media/scanner.ts`

Port TapeC's `walkDir` (server.js:144-160) + extension filter logic. TypeScript, async, emits progress.

```typescript
export interface ScannedFile {
    absPath: string;
    filename: string;
    ext: string;       // lowercase, no dot
    sizeBytes: number;
    mtimeMs: number;
}

export interface ScanResult {
    files: ScannedFile[];
    scannedDirs: number;
    skippedFiles: number;
}

const AUDIO_EXTENSIONS = new Set(['mp3', 'mp4', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma']);

export async function scanDirectory(rootPath: string): Promise<ScanResult>
```

Key differences from TapeC:
- Async (`fs.promises.readdir` with `withFileTypes`) — non-blocking for Electron main process
- No SQLite, no stale cleanup — returns plain array
- Broader extension set (add FLAC, OGG, OPUS, AAC)
- No library naming (WhatNext doesn't have a multi-library concept yet)

---

## Filename Parser (main process)

**New file**: `app/src/main/media/filename-parser.ts`

Port TapeC's filename heuristic. Parse `Artist - Title (Year).ext` convention.

```typescript
export interface ParsedFilename {
    title: string;
    artist?: string;
    year?: number;
}

export function parseFilename(filename: string): ParsedFilename
```

Logic (from TapeC's `server.js`):
1. Strip extension
2. Extract 4-digit year from last parenthesized group
3. Split on ` - ` for artist/title
4. Fallback: full filename as title

---

## Local Media Mapper (main process)

**New file**: `app/src/main/media/local-media-mapper.ts`

Follows `app/src/main/spotify/spotify-mapper.ts` pattern exactly.

```typescript
export interface MappedLocalTrack {
    id: string;           // uuid
    title: string;
    artists: string[];
    album: string;        // directory name as fallback
    durationMs: number;   // 0 (unknown without ID3)
    localFilePath: string;
    localFileSize: number;
    source: 'local';
    addedAt: string;
}

export function mapLocalFile(file: ScannedFile): MappedLocalTrack
export function mapLocalFiles(files: ScannedFile[]): MappedLocalTrack[]
```

Album fallback: use the parent directory name (common convention for music folders).

Duration: set to `0` for now. Future enhancement: add `music-metadata` npm package for ID3 tag reading.

---

## IPC Handlers (main process)

**File**: `app/src/main/main.ts`

```typescript
ipcMain.handle('media:scan-directory', async (_event, dirPath: string) => {
    const result = await scanDirectory(dirPath);
    const mapped = mapLocalFiles(result.files);
    return { success: true, tracks: mapped, stats: { dirs: result.scannedDirs, skipped: result.skippedFiles } };
});
```

**File**: `app/src/main/preload.ts`

```typescript
media: {
    scanDirectory: (dirPath: string): Promise<ScanDirectoryResult> =>
        ipcRenderer.invoke('media:scan-directory', dirPath),
},
```

**File**: `app/src/shared/core/ipc-protocol.ts` — Add types for the IPC response.

---

## Import Hook (renderer)

**New file**: `app/src/renderer/hooks/useLocalMediaImport.ts`

State machine mirroring `app/src/renderer/hooks/useSpotifyImport.ts`:

```typescript
type LocalImportState = 'idle' | 'scanning' | 'selecting' | 'importing' | 'done' | 'error';
```

Flow:
1. User clicks "Import Local Files"
2. `dialog.openDirectory()` → get path
3. `media.scanDirectory(path)` → get `MappedLocalTrack[]`
4. State: `'selecting'` — user picks which tracks to import
5. `bulkImportTracks()` with `source: 'local'`, `localFilePath`, `localFileSize`
6. Optionally create playlist from imported tracks
7. State: `'done'`

---

## SourceBadge Update

**File**: `app/src/renderer/components/UI/SourceBadge.tsx`

Update to use the new `source` field with fallback to current `spotifyId` check:

```typescript
export function SourceBadge({ track }: { track: TrackDocType }) {
    const source = track.source ?? (track.spotifyId ? 'spotify' : 'manual');

    if (source === 'spotify') { /* existing Spotify badge */ }
    if (source === 'local') {
        return (
            <span className="..." title={track.localFilePath ?? 'Local file'}>
                <i className="fa-solid fa-folder-music" />
                Local
            </span>
        );
    }
    // fallback for 'manual'
    return (/* existing Local badge */);
}
```

---

## Library View Filter Update

**File**: `app/src/renderer/components/Library/LibraryView.tsx`

Update source filtering to use `source` field instead of `spotifyId` presence. Add "Local Files" as a distinct filter tab.

---

## Files Summary

### Modified

| File | Change |
|------|--------|
| `app/src/renderer/db/schemas.ts` | Add `localFilePath`, `localFileSize`, `source` to TrackDocType; bump version |
| `app/src/renderer/db/database.ts` | Add migration strategy v1→v2 |
| `app/src/main/main.ts` | Add `media:scan-directory` IPC handler |
| `app/src/main/preload.ts` | Add `media.scanDirectory` to bridge |
| `app/src/shared/core/ipc-protocol.ts` | Add scan result types |
| `app/src/renderer/components/UI/SourceBadge.tsx` | Use `source` field, add local-file variant |
| `app/src/renderer/components/Library/LibraryView.tsx` | Update source filter tabs |

### Created

| File | Purpose |
|------|---------|
| `app/src/main/media/scanner.ts` | Directory scanner (ported from TapeC) |
| `app/src/main/media/filename-parser.ts` | Filename metadata parser (ported from TapeC) |
| `app/src/main/media/local-media-mapper.ts` | ScannedFile → TrackDocType mapper |
| `app/src/renderer/hooks/useLocalMediaImport.ts` | Import state machine + business logic |

---

## Verification

1. **Typecheck**: `cd app && npm run typecheck` — must pass
2. **Schema migration**: Start app, verify existing tracks get `source: 'spotify'` or `'manual'` backfilled
3. **Scan flow**: Click import → pick a folder with audio files → verify scanned list appears
4. **Import flow**: Select tracks → import → verify they appear in Library with "Local" badge
5. **Source filtering**: Library view tabs correctly count and filter by source
6. **P2P safety**: Imported local tracks should replicate as metadata only (no file path shared to peers) — verify `localFilePath` doesn't leak via replication

---

## Future Enhancements (not in scope)

- **ID3 tag reading**: Add `music-metadata` package for proper metadata extraction (title, artist, album, duration, embedded artwork)
- **Playback**: Register Electron `protocol.handle('media', ...)` for range-based local file streaming
- **Rescan / watch**: Auto-detect file changes in imported directories
- **TapeC companion adapter**: Connect to running TapeC instance via REST API for network-accessible media (see [[tapec-integration-analysis]] Approach 3)

---

## Related Concepts

- [[tapec-integration-analysis]] — Full evaluation of TapeC integration approaches
- [[architecture-whatnext]] — WhatNext architecture (import adapter pattern)
- [[the-walled-garden-cracks]] — Coordinator model and source abstraction philosophy

---
tags:
  - architecture/adapters
  - data/local-files
---

# TapeC + WhatNext Integration Analysis

**Date**: 2026-03-22
**Status**: Evaluated — Approach 2 (Partial Integration) recommended

---

## Context

A buddy is building [TapeC](https://github.com/iBumpthis/tapec) — a lightweight self-hosted local media server (~1200 lines). WhatNext already has a well-defined import adapter architecture ([[Spotify-Integration|Spotify]] is the first adapter) and explicitly plans local file support in Phase 3. This analysis evaluates four integration approaches to determine what value TapeC brings and when/how to act on it.

---

## TapeC Summary

| Aspect | Details |
|--------|---------|
| **Stack** | Fastify + better-sqlite3 + vanilla HTML/CSS/JS |
| **Core** | Multi-library directory scanning, HTTP 206 range streaming, marker/cuepoint system |
| **Data** | SQLite `media` table + `markers` table + JSON sidecar metadata |
| **Formats** | MP3, MP4, M4A, WAV |
| **Metadata** | Filename parsing only (no ID3 tags, no MusicBrainz). Sidecars stored externally. |
| **Maturity** | v0.2.5, stable MVP, no auth, no transcoding |
| **Unique value** | Marker/cuepoint system for DJ mixes, read-only media folder support, sidecar metadata |

### Key TapeC Source Files

- `app/server.js` lines 144-160 — `walkDir` recursive scanner
- `app/server.js` lines 298-338 — `runScan` with extension filter + stale cleanup
- `app/server.js` lines 104-142 — HTTP 206 range streaming
- `app/server.js` lines 195-296 — marker/cuepoint parsing engine
- `app/server.js` lines 40-91 — JSON sidecar metadata read/write
- `app/db.js` — SQLite schema (media + markers tables)

---

## Approach 1: Full Integration (Embed TapeC into WhatNext)

**What**: Absorb TapeC's scanning, streaming, metadata, and markers into WhatNext's Electron main process.

| Dimension | Assessment |
|-----------|------------|
| **Value** | WhatNext becomes a complete local media manager — scans, indexes, streams, annotates |
| **Effort** | **Large**. Scanner + parser are portable (~200 lines). But: SQLite→RxDB rewrite, REST→IPC rewrite, HTTP streaming→Electron protocol handler, new marker schema + UI, playback engine |
| **Arch fit** | Excellent — local files are the ultimate user-sovereign data, sidecars align with plaintext-first |
| **Tech fit** | Moderate friction — storage layer incompatible, streaming model different, markers are entirely new |
| **UX** | Transformative but increases surface area significantly |
| **Risks** | Scope explosion (this is Phase 3 work), schema migration affects P2P replication, playback complexity |

**Verdict**: Right approach **when Phase 3 arrives**. Too early now.

---

## Approach 2: Partial Integration (Cherry-Pick Scanner + Parser)

**What**: Port TapeC's directory scanner and filename parser into WhatNext as a new "local file" import adapter. Tracks become metadata in the library — no playback, no streaming, no markers.

| Dimension | Assessment |
|-----------|------------|
| **Value** | Users can import local files as tracks, add them to collaborative playlists, share via P2P |
| **Effort** | **Small-Medium** (~1-2 days). Follows existing adapter patterns exactly |
| **Arch fit** | Strong — pure Node.js, no new external deps, mirrors Spotify adapter structure |
| **Tech fit** | Excellent — scanner runs in main process, mapper follows `spotify-mapper.ts` pattern, import hook follows `useSpotifyImport` pattern |
| **UX** | Good incremental — tracks appear in library but can't be played within WhatNext |
| **Risks** | Filename parsing is unreliable without ID3 tags. "Import without playback" may feel half-baked. |

**What gets ported from TapeC**:
- Directory scanner (`walkDir` + extension filter) → `app/src/main/media/scanner.ts`
- Filename parser (artist/title/year regex) → `app/src/main/media/filename-parser.ts`

**What's new (follows existing WhatNext patterns)**:
- Local media mapper → `app/src/main/media/local-media-mapper.ts`
- IPC handler `media:scan-directory` in main.ts
- `useLocalMediaImport` hook mirroring `useSpotifyImport`
- Track schema v1→v2 migration: add `localFilePath`, `localFileSize`, `source`
- `SourceBadge` update for local file source

**Verdict**: **Best bang-for-buck**. Right for Phase 2 or late Phase 1. See [[local-file-import-adapter]] for full spec.

---

## Approach 3: Companion App (TapeC as External Source)

**What**: TapeC runs as a separate service. WhatNext connects to it via REST API as another source adapter (like Spotify). TapeC users get browsing + streaming inside WhatNext.

| Dimension | Assessment |
|-----------|------------|
| **Value** | TapeC users get seamless bridge. Playback advantage — TapeC's `/stream/:id` gives local file playback without WhatNext implementing streaming |
| **Effort** | **Medium** (~2-3 days). New TapeC client module, mapper, import hook, connection settings UI |
| **Arch fit** | Good with caveats — fits adapter pattern, but requiring a running service conflicts with offline-first |
| **Tech fit** | Clean — TapeC's REST API is simple, data model mapping is direct |
| **UX** | Niche — only useful for users who specifically run TapeC. Invisible to everyone else |
| **Risks** | Two apps to run = friction. P2P sharing problem: peers can't stream from host's TapeC. API coupling. |

**Deliverables if pursued**:
- `app/src/main/tapec/tapec-client.ts` — HTTP client for TapeC's REST API
- `app/src/main/tapec/tapec-mapper.ts` — converts TapeC media to `CreateTrackInput`
- IPC handlers: `tapec:connect`, `tapec:get-libraries`, `tapec:search`, `tapec:get-media`
- `useTapeCImport` hook
- TapeC connection settings in Settings panel
- `TrackSourceConfig` addition: `{ type: 'tapec'; serverUrl: string }`

**Verdict**: Nice **Phase 2 bonus** alongside native local file import (Approach 2). Not a standalone solution.

---

## Approach 4: Full Merge (Single Product)

**What**: Combine both codebases into one product that is both a media server and a collaborative playlist manager.

| Dimension | Assessment |
|-----------|------------|
| **Value** | Vision: "Plex meets P2P collaborative playlists" |
| **Effort** | **Very Large** (3-6 months). Two databases, two deployment targets, native deps |
| **Arch fit** | Mixed — desktop portion aligns, headless server portion contradicts desktop-first philosophy |
| **Tech fit** | Poor — almost nothing shared at runtime level (Fastify vs Electron, SQLite vs RxDB, vanilla JS vs React) |
| **UX** | Identity crisis — too complex for either audience |
| **Risks** | Scope, maintenance burden, user base mismatch, kills TapeC's simplicity advantage |

**Verdict**: **Not recommended.** The products are complementary, not convergent. Let them coexist.

---

## Overall Recommendation

| Timeframe | Action |
|-----------|--------|
| **Now (Phase 1 MVP)** | Do nothing. Ship the MVP. |
| **Phase 2** | **Approach 2** — cherry-pick scanner + parser as a local file import adapter (~1-2 days). Optionally add **Approach 3** as a TapeC companion adapter (~2-3 days extra) for the buddy's users. |
| **Phase 3** | **Approach 1 elements** — revisit TapeC's streaming as reference for Electron `protocol.handle`. Consider markers/cuepoints for music-focused users. |
| **Never** | **Approach 4** — full merge. |

The shared code surface between TapeC and WhatNext is small (~200 lines of scanner + parser), but those ~200 lines are exactly the bootstrapping code WhatNext needs for its local file story. TapeC's real value to WhatNext is as a **proven reference implementation** for local media handling patterns, and potentially as a **companion service** for users who want network-accessible local media streaming.

---

## Related Concepts

- [[local-file-import-adapter]] — Implementation spec for Approach 2
- [[architecture-whatnext]] — WhatNext architecture (import adapter pattern)
- [[the-walled-garden-cracks]] — Coordinator model and source abstraction philosophy

## References

- TapeC repo: https://github.com/iBumpthis/tapec
- WhatNext adapter pattern: `app/src/main/spotify/spotify-mapper.ts`, `app/src/renderer/hooks/useSpotifyImport.ts`
- TrackSourceConfig: `app/src/shared/session-interfaces.ts`

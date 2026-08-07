---
tags:
  - pr
  - spotify
  - mvp
  - wave-1
pr: 52
title: "fix(spotify): error taxonomy, resilient fetch, degraded-mode handling"
date merged: 2026-08-02
base: mvp
head: fix/spotify-resilience
merge commit: c91d3c1
author: mads-jm
reviewers:
  - mads-jm
review-result: APPROVE
---

# PR #52 — fix(spotify): error taxonomy, resilient fetch, degraded-mode handling

**Merged:** 2026-08-02 · **Base:** `mvp` ← **Head:** `fix/spotify-resilience` · **Merge commit:** `c91d3c1`

## What merged

Hardened the Spotify client from happy-path-only to typed and resilient: `spotify-errors.ts` (taxonomy discriminating 403/Premium, 429/rate-limit, timeout, transport), `spotify-resilience.ts` (`resilientFetch` with retry/backoff, request timeout, and a provably loop-free single-refresh-on-401), and a main→renderer event bridge emitting `spotify:playback-degraded` with a preload `onPlaybackDegraded` consumer. Added the previously missing OAuth/refresh/playback integration tests (59 passing).

## Why

Every non-200 previously threw a generic error — no way to tell a Premium wall from a rate limit from a dead token. Spotify's Feb-2026 lockdown makes 403/Premium a first-class runtime state, so the client names it and the app can degrade instead of throwing. Renderer-side degraded-mode UI (`playbackProvider:'none'`) was intentionally out of scope; this PR makes the wire reachable.

## Scope & files

8 files — `app/src` Spotify modules + preload/main wiring, plus a vault index entry. Closes #44, #33.

## Review

Wave-1 lane, inspected via a Governor→Architect→Inspector cycle — Inspector verdict APPROVE after a fix-pass (verdict archived locally); AI-assisted review, merged by mads-jm. Independent pre-merge review in [[report-260801-mvp-premerge-review]]. Carry-forwards: refresh-succeeds-then-retry-401 gap; `fetchWithTimeout` discards a caller `AbortSignal`.

## References

- Epic: [[epic-spotify-resilience]]
- Vision context: [[the-walled-garden-cracks]]

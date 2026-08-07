---
tags:
  - pr
  - sessions
  - mvp
  - wave-1
pr: 51
title: "feat(sessions): un-stub Manual TrackSource via shared write sink"
date merged: 2026-08-02
base: mvp
head: feat/track-sourcing-manual
merge commit: a6f24e5
author: mads-jm
reviewers:
  - mads-jm
review-result: APPROVE
---

# PR #51 — feat(sessions): un-stub Manual TrackSource via shared write sink

**Merged:** 2026-08-02 · **Base:** `mvp` ← **Head:** `feat/track-sourcing-manual` · **Merge commit:** `a6f24e5`

## What merged

Un-stubbed the Manual TrackSource (previously a silent no-op) by routing it through a new shared normalize→write sink, `track-sink.ts`: normalize → `createTrack` → `addTrackToPlaylist` with attribution (`addedBy`) and source provenance, Spotify-only `externalId`→`spotifyId` mapping, and deterministic create-then-append ordering. Added the `AddTrackPanel` affordance in `SessionView`, sink input types, and 5 sink unit tests. The P2P TrackSource deliberately remains a no-op (#38, a separate P2P-gated lane).

## Why

Renderer-cluster predecessor for later waves (#43 turn coordination, #50 SessionView extraction, #26 CRUD tests): the sink fixes the contract for how any source's track lands in a playlist, so downstream lanes build on a tested API instead of negotiating one live. No schema change — track records stay v3-compatible.

## Scope & files

8 files, all in `app/src` (renderer sessions/hooks/components). Closes #37.

## Review

Wave-1 lane, inspected via a Governor→Architect→Inspector cycle — Inspector verdict APPROVE on the first pass (verdict archived locally); AI-assisted review, merged by mads-jm. Independent pre-merge review of the integrated wave in [[report-260801-mvp-premerge-review]]. Carry-forwards noted at merge: silent library-search error swallowing; `AddTrackPanel`/hook wrapper untested pending a React test harness.

## References

- Epic: [[epic-track-sourcing]]

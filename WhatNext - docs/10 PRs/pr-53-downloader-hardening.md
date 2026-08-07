---
tags:
  - pr
  - downloader
  - mvp
  - wave-1
pr: 53
title: "feat(downloader): backend-execution tests + per-backend executable paths"
date merged: 2026-08-02
base: mvp
head: feat/audio-acquisition-hardening
merge commit: 3a8794a
author: mads-jm
reviewers:
  - mads-jm
review-result: APPROVE
---

# PR #53 — feat(downloader): backend-execution tests + per-backend executable paths

**Merged:** 2026-08-02 · **Base:** `mvp` ← **Head:** `feat/audio-acquisition-hardening` · **Merge commit:** `3a8794a`

## What merged

Brought the download backends from "parsers tested, execution not" up to covered: a `fixture-process` mock-subprocess harness replaying captured CLI output, execution-path suites for yt-dlp/spotDL/Spytify plus subprocess kill/timeout (42 new cases), and per-backend custom executable-path config with cache-invalidating presence checks (`downloader-config-store.ts`, IPC surface, `BackendGate`/`DownloadSettings` UX). Two notable deltas: yt-dlp completion detection moved to a `WHATNEXT_FILEPATH=` sentinel instead of the spec's stdout heuristic, and a latent spotDL bug was fixed — `supportedInputs` declared `'spotify-id'` where the capability check expected `'spotify-ids'`, leaving that path dead.

## Why

The downloader was the most mature pillar but its subprocess lifecycle and argv/stdout/stderr handling were unverified, and binaries were assumed-in-PATH. Suite went 239→241 passing overall with the execution paths now deterministic under test.

## Scope & files

29 files — `service/downloader` (20: backends, harness, fixtures, tests) + `app/src` (9: config store, IPC, settings UI). Closes #45, #46.

## Review

Wave-1 lane, inspected via a Governor→Architect→Inspector cycle — Inspector verdict APPROVE after a fix-pass (verdict archived locally); AI-assisted review, merged by mads-jm. Independent pre-merge review in [[report-260801-mvp-premerge-review]]. Carry-forwards: Spytify `cancel()` untested; `createBackend(id, execPath?)` arg not yet consumed by IPC wiring; JSX shells need manual QA (no component harness).

## References

- Epic: [[epic-audio-acquisition-hardening]]
- Spec: [[audio-acquisition-service]]

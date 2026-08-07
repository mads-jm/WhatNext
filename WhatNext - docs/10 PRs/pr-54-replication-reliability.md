---
tags:
  - pr
  - core/net/p2p
  - data/rxdb/replication
  - mvp
  - wave-1
pr: 54
title: "fix(p2p): replication reliability — durable checkpoints, reconnection, convergent LWW"
date merged: 2026-08-02
base: mvp
head: fix/replication-reliability
merge commit: cafc6ab
author: mads-jm
reviewers:
  - mads-jm
review-result: APPROVE
---

# PR #54 — fix(p2p): replication reliability — durable checkpoints, reconnection, convergent LWW

**Merged:** 2026-08-02 · **Base:** `mvp` ← **Head:** `fix/replication-reliability` · **Merge commit:** `cafc6ab`

## What merged

Hardened RxDB-over-libp2p replication across all five fragile surfaces the state-of-the-union flagged: durable per-collection/peer checkpoints (`checkpoint-store.ts` — no more full resync per launch), pull timeout/backoff plus relay reconnection and a connection heartbeat, skew-aware LWW with a **convergent** tie-break, backpressure-safe file-chunk sends, and the previously absent P2P test suites (replication, handshake, relay-manager, backoff, checkpoint-store, file-transfer; 254 passing). The headline fix: on an exact-millisecond LWW tie, sender and receiver hashed *different field sets* (the receiver kept device-local fields the sender stripped), so ties oscillated instead of converging — fixed by a single shared `DEVICE_LOCAL_FIELDS` constant consumed by both sides.

P2P protocol change built under explicit human approval per the agentic-work policy; **wire format, message types, and version id byte-unchanged** — behavior/semantics only, independently verified, and documented in [[RxDB-Replication]].

## Why

The replication layer was architecturally sound but operationally brittle with zero tests — a direct violation of "identical on both peers" hiding in the tie-break. LWW remains the MVP strategy (CRDT is Phase 2).

## Scope & files

20 files — `app/src` (19: p2p service, protocols behavior, lww, checkpoint/backoff modules, tests) + the [[RxDB-Replication]] concept page. Closes #40, #41, #42, #47, #32.

## Review

Wave-1 lane, inspected via a Governor→Architect→Inspector cycle — Inspector verdict APPROVE after a fix-pass (verdict archived locally); AI-assisted review, merged by mads-jm with the required human P2P review (`needs-p2p-review`). Independent pre-merge review in [[report-260801-mvp-premerge-review]] called this lane the strongest code in the repo. Carry-forwards: app-level dead-peer detection (active ping keepalive) and checkpoint path derivation for renamed packaged apps.

## References

- Epic: [[epic-replication-reliability]]
- Concept: [[RxDB-Replication]]

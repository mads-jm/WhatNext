# Documentation Consolidation Plan

**Date**: 2025-11-12
**Status**: 🔄 Ready for Execution

## Overview

Consolidate existing timestamped notes in `/docs/notes/` into concept-based documentation following the new Obsidian-first knowledge management approach defined in `CLAUDE.md`.

## Proposed Structure

### Concepts to Create

#### `/docs/concepts/`

1. **libp2p.md** - P2P networking library
   - Consolidates: libp2p-learning-roadmap, libp2p-first-implementation-learnings, webrtc-node-js-compatibility-resolved, added-tcp-websocket-transports
   - Tags: `#p2p/libp2p`, `#networking`

2. **RxDB.md** - Reactive local database
   - Consolidates: rxdb-spike-findings.md, rxdb-dev-mode, rxdb-schema-validation-dexie-constraints, database-location-architecture
   - Tags: `#data/rxdb`, `#local-first`

3. **Electron-IPC.md** - Inter-process communication patterns
   - Consolidates: Relevant sections from p2p-utility-process-architecture
   - Tags: `#architecture/patterns/ipc`, `#electron`

4. **Tailwind-v4.md** - Tailwind CSS v4 migration and usage
   - Consolidates: tailwind-v4-migration
   - Tags: `#frontend/styling`, `#build-tools`

5. **P2P-Discovery.md** - Peer discovery mechanisms (mDNS, DHT)
   - Consolidates: Relevant sections from libp2p notes, test-peer documentation
   - Tags: `#p2p/discovery/mdns`, `#networking`

6. **WebRTC.md** - WebRTC transport and connections
   - Consolidates: webrtc-node-js-compatibility-resolved, custom-protocol-barebones-peer
   - Tags: `#p2p/webrtc`, `#networking`

7. **Electron-Security.md** - Security patterns in Electron
   - Consolidates: Security-related content from various architecture notes
   - Tags: `#architecture/security`, `#electron`

8. **React-Patterns.md** - React patterns and best practices in WhatNext
   - Consolidates: UI-related patterns from implementation notes
   - Tags: `#frontend/react`, `#patterns`

#### `/docs/architecture/`

1. **adr-251110-libp2p-vs-simple-peer.md** - KEEP AS IS (already an ADR)
   - Move from `/docs/notes/` to `/docs/architecture/`
   - Add tags: `#architecture/decisions`, `#p2p`

2. **adr-electron-process-model.md** - NEW (consolidate from p2p-utility-process-architecture, simplified-p2p-connection-architecture)
   - Tags: `#architecture/decisions`, `#electron`, `#p2p`

3. **adr-database-storage-location.md** - NEW (from database-location-architecture)
   - Tags: `#architecture/decisions`, `#data`

#### `/docs/reports/`

Critical issues, bugs, and technology assessments that required significant troubleshooting:

1. **webrtc-node-compatibility.md** - WebRTC in Node.js compatibility investigation
   - Move from `/docs/notes/note-251110-webrtc-node-js-compatibility-resolved.md`
   - Tags: `#reports/compatibility`, `#p2p/webrtc`, `#node-js`

2. **rxdb-schema-constraints.md** - RxDB + Dexie storage constraints discovered
   - Consolidate: rxdb-schema-validation-dexie-constraints, rxdb-dev-mode
   - Tags: `#reports/bugs`, `#data/rxdb`, `#dexie`

3. **tailwind-v4-vite-integration.md** - Tailwind v4 + Vite 7 integration issues
   - Move from `/docs/notes/note-251109-tailwind-v4-migration.md`
   - Tags: `#reports/stack-modification`, `#build-tools`

#### `/docs/guides/`

1. **P2P-Testing.md** - Consolidate TESTING.md + barebones-test-peer-created + quick-start-guide
   - Tags: `#guides/testing`, `#p2p`, `#development`

2. **Development-Setup.md** - Consolidate setup information from various sources
   - Tags: `#guides/setup`, `#development`

3. **UI-Development.md** - Patterns for UI development
   - Consolidates: modern-sidebar-navigation, scrolling-fix, navigation-quick-reference
   - Tags: `#guides/ui`, `#frontend`

#### `/docs/milestones/`

1. **v0.0.0-release.md** - KEEP (already a milestone)
   - Consolidates: v0.0.0-release-summary, ui-modernization-complete, p2p-development-interface-complete
   - Move from `/docs/notes/`
   - Tags: `#milestones/v0.0.0`, `#releases`

2. **issue-10-libp2p-integration.md** - KEEP (landmark learning moment)
   - Consolidates: issue-10-complete, issue-10-session-summary
   - Move from `/docs/notes/`
   - Tags: `#milestones/issues`, `#p2p/libp2p`

3. **issues-2-6-foundation.md** - KEEP (landmark milestone)
   - Already exists as `/docs/issues-2-6-summary.md`
   - Move to `/docs/milestones/`
   - Tags: `#milestones/issues`, `#foundation`

### Protocol Implementation Roadmap

**Decision**: Keep `note-251112-protocol-implementation-roadmap.md` as a living document
- It's forward-looking, not historical
- Rename to `/docs/guides/Protocol-Implementation-Roadmap.md`
- Tags: `#guides/roadmap`, `#p2p/protocols`

## Consolidation Mapping

### Notes to Archive/Delete After Consolidation

| Original Note | Consolidate Into | Action |
|--------------|------------------|--------|
| `note-251109-rxdb-dev-mode.md` | `concepts/RxDB.md` | Archive |
| `note-251109-rxdb-schema-validation-dexie-constraints.md` | `concepts/RxDB.md` | Archive |
| `note-251109-database-location-architecture.md` | `architecture/adr-database-storage-location.md` | Archive |
| `note-251109-tailwind-v4-migration.md` | `concepts/Tailwind-v4.md` | Archive |
| `note-251109-custom-protocol-barebones-peer.md` | `concepts/WebRTC.md` + `guides/P2P-Testing.md` | Archive |
| `note-251110-added-tcp-websocket-transports.md` | `concepts/libp2p.md` | Archive |
| `note-251110-barebones-test-peer-created.md` | `guides/P2P-Testing.md` | Archive |
| `note-251110-libp2p-first-implementation-learnings.md` | `concepts/libp2p.md` | Archive |
| `note-251110-webrtc-node-js-compatibility-resolved.md` | `concepts/WebRTC.md` | Archive |
| `note-251110-p2p-utility-process-architecture.md` | `architecture/adr-electron-process-model.md` | Archive |
| `note-251110-simplified-p2p-connection-architecture.md` | `architecture/adr-electron-process-model.md` | Archive |
| `note-251112-modern-sidebar-navigation.md` | `guides/UI-Development.md` | Archive |
| `note-251112-navigation-quick-reference.md` | `guides/UI-Development.md` | Archive |
| `note-251112-scrolling-fix.md` | `guides/UI-Development.md` | Archive |
| `note-251112-p2p-development-interface-complete.md` | `milestones/v0.0.0-release.md` | Archive |
| `note-251112-ui-modernization-complete.md` | `milestones/v0.0.0-release.md` | Archive |

### Notes to Keep (Landmark Moments)

| Original Note | New Location | Reason |
|--------------|-------------|---------|
| `adr-251110-libp2p-vs-simple-peer-analysis.md` | `architecture/adr-251110-libp2p-vs-simple-peer.md` | Major decision, well-documented |
| `note-251110-libp2p-learning-roadmap.md` | `milestones/libp2p-learning-roadmap.md` | Landmark learning framework |
| `note-251110-issue-10-complete.md` | `milestones/issue-10-libp2p-integration.md` | Critical integration milestone |
| `note-251110-issue-10-session-summary.md` | Consolidate into above | Same milestone |
| `note-251112-v0.0.0-release-summary.md` | `milestones/v0.0.0-release.md` | Release milestone |
| `note-251112-protocol-implementation-roadmap.md` | `guides/Protocol-Implementation-Roadmap.md` | Forward-looking guide |
| `note-251112-quick-start-guide.md` | `guides/Quick-Start.md` | User-facing guide |

## Execution Order

### Phase 1: Create Concept Pages (Priority)
1. ✅ Create directory structure
2. ✅ Create `concepts/libp2p.md`
3. ✅ Create `concepts/RxDB.md`
4. ✅ Create `concepts/WebRTC.md`
5. ✅ Create `concepts/Tailwind-v4.md`
6. ✅ Create `concepts/Electron-IPC.md`

### Phase 2: Create Architecture Docs
1. ⏳ Move `adr-251110-libp2p-vs-simple-peer-analysis.md` → `architecture/`
2. ⏳ Create `architecture/adr-electron-process-model.md`
3. ⏳ Create `architecture/adr-database-storage-location.md`

### Phase 3: Create Guides
1. ⏳ Consolidate into `guides/P2P-Testing.md`
2. ⏳ Create `guides/UI-Development.md`
3. ⏳ Move `note-251112-quick-start-guide.md` → `guides/Quick-Start.md`
4. ⏳ Move `note-251112-protocol-implementation-roadmap.md` → `guides/Protocol-Implementation-Roadmap.md`

### Phase 4: Preserve Milestones
1. ⏳ Move `issues-2-6-summary.md` → `milestones/issues-2-6-foundation.md`
2. ⏳ Consolidate issue #10 notes → `milestones/issue-10-libp2p-integration.md`
3. ⏳ Consolidate v0.0.0 notes → `milestones/v0.0.0-release.md`
4. ⏳ Move `note-251110-libp2p-learning-roadmap.md` → `milestones/libp2p-learning-roadmap.md`

### Phase 5: Archive & Update Index
1. ⏳ Move consolidated notes to `/docs/archive/` (or delete if fully consolidated)
2. ⏳ Update `/docs/INDEX.md` with new structure
3. ⏳ Add WikiLinks throughout new documentation
4. ⏳ Verify all tags are applied correctly

## Success Criteria

- ✅ All concept pages created with proper tags
- ✅ ADRs moved to `/docs/architecture/`
- ✅ Guides consolidated and practical
- ✅ Milestones preserved with historical context
- ✅ INDEX.md updated to reflect new structure
- ✅ WikiLinks connect related concepts
- ✅ No orphaned information (everything consolidated or archived)
- ✅ `/docs/notes/` can be archived/removed

## Notes

- Keep original timestamped notes in `/docs/archive/` initially for safety
- After 1-2 sprints, if no one references archive, can be deleted
- This is a one-time migration; future documentation follows new structure from the start

---

**Ready to Execute**: Awaiting approval to proceed with Phase 1

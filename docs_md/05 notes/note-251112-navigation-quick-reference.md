---
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Sunday, February 15th 2026, 8:37:14 pm
---

# Navigation Quick Reference

__Last Updated__: 2025-11-12

Quick reference for the WhatNext sidebar navigation structure.

## View IDs & Paths

### Workspace Section

```ts
playlists           → My Playlists
library             → Music Library (soon)
sessions            → Collaborative Sessions (soon)
```

### P2P Network Section

```ts
p2p-status          → P2P Network Status (comprehensive dev UI)
p2p-peers           → Peer Management (soon)
p2p-protocols       → Protocol Development (placeholder with roadmap)
```

### Development Section

```ts
rxdb-spike          → RxDB Evaluation (Issue #4)
protocol-testing    → Protocol Testing Suite (soon)
debug-console       → Debug Console (soon)
```

### Settings Section

```ts
settings-general    → General Settings (soon)
settings-p2p        → P2P Configuration (soon)
settings-storage    → Storage Settings (soon)
```

## Badge Legend

| Badge | Color | Meaning |
|-------|-------|---------|
| `Soon` | Gray | Planned feature, not yet implemented |
| `Dev` | Orange | Active development area |
| `#4`, `#10` | Blue | Links to GitHub issue number |

## Active Views

Currently functional:
- ✅ __playlists__ - Playlist management with RxDB
- ✅ __p2p-status__ - Comprehensive P2P development interface
- ✅ __rxdb-spike__ - RxDB evaluation and testing
- ✅ __p2p-protocols__ - Detailed placeholder for protocol development

## Keyboard Shortcuts

(Coming soon)
- `Cmd/Ctrl + 1-9` - Quick section navigation
- `Cmd/Ctrl + K` - Command palette
- `Cmd/Ctrl + Shift + P` - Quick switcher

## Section Behavior

### Collapsible Sections

Click section header to collapse/expand:
- __Default__: Workspace, P2P Network, Development are expanded
- __Collapsed__: Settings can be collapsed to save space

### Active State Highlighting

- __Child active__: Blue background on active child item
- __Parent context__: Parent section shows active child is selected

## Quick Actions Footer

- __GitHub Link__: Opens project repository in browser
- __Status Indicator__: Shows "Local-First Mode" with animated pulse
- __Database Icon__: Reminds of local-first architecture

## Navigation Tips

1. __Focus Mode__: Collapse unused sections to reduce visual noise
2. __Context Awareness__: Parent sections indicate where you are
3. __Badge Scanning__: Quick glance shows what's ready vs coming
4. __Protocol Roadmap__: P2P > Protocols shows development priorities

## File Locations

__Component__: `app/src/renderer/components/Layout/Sidebar.tsx`
__Routing__: `app/src/renderer/App.tsx` (renderView switch statement)

## Adding New Views

1. Add to `navigationItems` array in Sidebar.tsx
2. Add ViewId type in App.tsx
3. Add case in renderView() switch
4. Add title in viewTitles mapping

Example:

```typescript
// Sidebar.tsx
{ id: 'my-view', label: 'My View', icon: 'fa-solid fa-star', badge: 'Dev' }

// App.tsx
type ViewId = ... | 'my-view';

case 'my-view':
    return <MyViewComponent />;

const viewTitles = {
    ...
    'my-view': 'My View Title',
};
```

## Design Patterns

__Section Headers__: UPPERCASE, small font, gray
__Child Items__: Normal case, medium font, full highlight when active
__Badges__: Tiny font, colored background, rounded
__Icons__: FontAwesome solid icons, consistent sizing

## Related Docs

- `note-251112-modern-sidebar-navigation.md` - Full design documentation
- `note-251112-ui-modernization-complete.md` - Complete changes summary

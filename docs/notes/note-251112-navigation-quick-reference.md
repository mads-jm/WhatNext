# Navigation Quick Reference

**Last Updated**: 2025-11-12

Quick reference for the WhatNext sidebar navigation structure.

## View IDs & Paths

### Workspace Section
```
playlists           → My Playlists
library             → Music Library (soon)
sessions            → Collaborative Sessions (soon)
```

### P2P Network Section
```
p2p-status          → P2P Network Status (comprehensive dev UI)
p2p-peers           → Peer Management (soon)
p2p-protocols       → Protocol Development (placeholder with roadmap)
```

### Development Section
```
rxdb-spike          → RxDB Evaluation (Issue #4)
protocol-testing    → Protocol Testing Suite (soon)
debug-console       → Debug Console (soon)
```

### Settings Section
```
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
- ✅ **playlists** - Playlist management with RxDB
- ✅ **p2p-status** - Comprehensive P2P development interface
- ✅ **rxdb-spike** - RxDB evaluation and testing
- ✅ **p2p-protocols** - Detailed placeholder for protocol development

## Keyboard Shortcuts

(Coming soon)
- `Cmd/Ctrl + 1-9` - Quick section navigation
- `Cmd/Ctrl + K` - Command palette
- `Cmd/Ctrl + Shift + P` - Quick switcher

## Section Behavior

### Collapsible Sections
Click section header to collapse/expand:
- **Default**: Workspace, P2P Network, Development are expanded
- **Collapsed**: Settings can be collapsed to save space

### Active State Highlighting
- **Child active**: Blue background on active child item
- **Parent context**: Parent section shows active child is selected

## Quick Actions Footer

- **GitHub Link**: Opens project repository in browser
- **Status Indicator**: Shows "Local-First Mode" with animated pulse
- **Database Icon**: Reminds of local-first architecture

## Navigation Tips

1. **Focus Mode**: Collapse unused sections to reduce visual noise
2. **Context Awareness**: Parent sections indicate where you are
3. **Badge Scanning**: Quick glance shows what's ready vs coming
4. **Protocol Roadmap**: P2P > Protocols shows development priorities

## File Locations

**Component**: `app/src/renderer/components/Layout/Sidebar.tsx`
**Routing**: `app/src/renderer/App.tsx` (renderView switch statement)

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

**Section Headers**: UPPERCASE, small font, gray
**Child Items**: Normal case, medium font, full highlight when active
**Badges**: Tiny font, colored background, rounded
**Icons**: FontAwesome solid icons, consistent sizing

## Related Docs

- `note-251112-modern-sidebar-navigation.md` - Full design documentation
- `note-251112-ui-modernization-complete.md` - Complete changes summary

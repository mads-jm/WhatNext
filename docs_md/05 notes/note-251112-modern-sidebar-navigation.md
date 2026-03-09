---
tags:
  - ux/ui/navigation
  - ux/react
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Monday, March 9th 2026, 12:20:32 am
---

# Modern Sidebar Navigation - Obsidian-Inspired

__Date__: 2025-11-12
__Status__: ✅ Complete
__Type__: UI/UX Enhancement

## Overview

Redesigned the sidebar navigation with a modern, hierarchical structure inspired by Obsidian's local-first, developer-friendly philosophy. The new design features collapsible sections, visual badges, and organized workflows.

## Design Philosophy

__Inspired by Obsidian:__
- __Collapsible Sections__: Organize features into logical groups
- __Visual Hierarchy__: Clear parent/child relationships with indentation
- __Information Density__: Compact yet readable with smart use of badges
- __Developer-First__: Emphasizes tools and workflows for P2P development
- __Local-First Indicators__: Status footer reinforces the local-first architecture

## New Navigation Structure

### 1. Workspace Section

__Purpose__: Core user-facing features

- __Playlists__ - Active playlist management
- __Library__ - Local music library (coming soon)
- __Sessions__ - Collaborative sessions (coming soon)

### 2. P2P Network Section

__Purpose__: P2P networking and protocol development

- __Network Status__ - Current P2P interface (comprehensive dev UI)
- __Peer Management__ - Advanced peer features (coming soon)
  - Friend lists
  - Peer reputation
  - Connection history
- __Protocols__ - Protocol development workspace (active placeholder)
  - Handshake, Data Test, File Transfer, Playlist Sync protocols
  - Protocol handler registry
  - Stream inspector
  - Message logger
  - Protocol tester

### 3. Development Section

__Purpose__: Developer tools and testing

- __RxDB Evaluation__ - Issue spike test (active)
- __Protocol Testing__ - Automated protocol tests (coming soon)
- __Debug Console__ - Unified logging interface (coming soon)

### 4. Settings Section

__Purpose__: Application configuration

- __General__ - App-wide settings (coming soon)
- __P2P Config__ - P2P networking settings (coming soon)
- __Storage__ - Database and storage config (coming soon)

## Visual Improvements

### Header

- __Gradient App Icon__: Blue-purple gradient with music note
- __Version Badge__: "v0.0.0 Alpha" clearly visible
- __Brand Identity__: Clean, modern presentation

### Navigation Items

__Section Headers:__
- Uppercase, tracked text
- Collapsible with chevron indicators
- Subtle hover states

__Child Items:__
- Indented with left border for hierarchy
- Larger touch targets
- Clear active state (blue highlight)

### Badges

Three badge types with distinct styling:

1. __"Soon"__ - Gray badge for planned features
2. __"Dev"__ - Orange badge for active development areas
3. __"#4"__, __"#10"__ - Blue badges for issue tracking

### Footer

__Status Indicator:__
- Animated green pulse dot
- "Local-First Mode" label
- Database icon for emphasis

__Quick Actions:__
- GitHub link button
- Future: documentation, community links

## Key Features

### 1. Collapsible Sections

```typescript
const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['workspace', 'p2p', 'development'])
);
```

Sections start expanded for immediate access, but can be collapsed for focus.

### 2. Smart Active State

```typescript
const isActive = (itemId: string) => {
    if (activeView === itemId) return true;

    // Highlight parent if child is active
    const item = navigationItems.find(i => i.id === itemId);
    if (item?.children) {
        return item.children.some(child => activeView === child.id);
    }
    return false;
};
```

Parent sections show when their children are active, providing context.

### 3. Protocol Development Workspace

The "Protocols" view now shows a comprehensive placeholder with:
- Alert banner explaining the workspace purpose
- List of planned protocols with their paths
- Grid of upcoming tools (handler registry, stream inspector, etc.)
- Developer-focused layout

This sets clear expectations for upcoming work while providing visual structure.

## Files Modified

- `app/src/renderer/components/Layout/Sidebar.tsx` - Complete redesign
- `app/src/renderer/App.tsx` - New view IDs and placeholder views

## Breaking Changes

__View ID Changes:__
- `'spike'` → `'rxdb-spike'`
- `'p2p'` → `'p2p-status'`

These are more explicit and align with the hierarchical structure.

## User Experience Improvements

### Before

- Flat list of 6 items
- No visual hierarchy
- Limited context about upcoming features
- Static, dated feel

### After

- 13 distinct views organized into 4 sections
- Clear hierarchy with parent/child relationships
- Visual badges indicate feature status
- Modern, Obsidian-like aesthetic
- Collapsible sections for focus
- Animated status indicators

## Developer Benefits

1. __Clear Roadmap__: Badges and placeholders show what's coming
2. __Organized Workflow__: Related features grouped logically
3. __Focus Mode__: Collapse sections to reduce visual noise
4. __Context Awareness__: Active states show where you are in the hierarchy
5. __Protocol Focus__: Dedicated section for P2P development work

## Future Enhancements

### Planned Additions

- __Keyboard Shortcuts__: Cmd/Ctrl+1-9 for quick navigation
- __Search/Command Palette__: Obsidian-style quick switcher
- __Custom Sections__: User-defined navigation groups
- __Pinned Items__: Pin frequently used views to top
- __Recent Items__: Quick access to recently viewed sections

### Protocol Workspace Evolution

As protocols are implemented:
1. "Dev" badges change to "Active"
2. Placeholder grids become functional tools
3. Protocol handler registry shows live protocol list
4. Stream inspector displays active connections
5. Message logger captures real protocol traffic

## Design Patterns Used

### Visual Hierarchy

```ts
SECTION HEADER (uppercase, small)
├─ Child Item 1 (normal case, larger)
├─ Child Item 2 [Badge]
└─ Child Item 3 [Badge]
```

### Color Semantics

- __Blue__: Active/selected state
- __Green__: Online/active status
- __Orange__: Development/warning state
- __Gray__: Inactive/coming soon

### Spacing

- Compact vertical spacing for density
- Generous padding for touch targets
- Clear indentation for hierarchy

## Accessibility

- __Keyboard Navigation__: All items focusable and activatable
- __Color Contrast__: WCAG AA compliant text colors
- __Clear Labels__: Descriptive, unambiguous text
- __Visual Feedback__: Hover and active states clearly indicated

## Related Documentation

- `note-251112-p2p-development-interface-complete.md` - The comprehensive P2P UI this navigation serves
- `note-251112-protocol-implementation-roadmap.md` - Protocols referenced in navigation
- `CLAUDE.md` - Obsidian inspiration for local-first philosophy

## Conclusion

This navigation redesign transforms WhatNext from a simple app into a comprehensive development workspace. The hierarchical structure accommodates current features while clearly signposting future capabilities. The Obsidian-inspired aesthetic reinforces the local-first, user-sovereign philosophy at the core of the project.

__Ready for exploration and protocol development.__ 🎯

---

## Related Concepts

[[React-Patterns]] [[Electron]]



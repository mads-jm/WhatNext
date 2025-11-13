# UI Development Guide

#guides/ui #frontend #tailwind #react

## Overview

Guide for developing UI components in WhatNext following established patterns, design philosophy, and common pitfalls. The UI is built with React 19, Tailwind CSS v4, and follows an Obsidian-inspired, developer-focused aesthetic.

## Design Philosophy

### Obsidian-Inspired Principles

1. **Local-First Indicators**: UI constantly reinforces local-first architecture
2. **Information Density**: Compact yet readable, maximizing screen real estate
3. **Visual Hierarchy**: Clear parent/child relationships via indentation and borders
4. **Developer-Focused**: Tools and workflows prominently featured
5. **Progressive Disclosure**: Collapse sections to focus, expand for detail

### Visual Identity

**Color Palette:**
- **Primary Blue** (#3B82F6): Active states, highlights
- **Purple Accent** (#9333EA): Brand gradient, special features
- **Gray Scale**: Dark sidebar (900), subtle borders (800), muted text (400-600)
- **Semantic Colors**:
  - Green: Online/active status
  - Orange: Development/in-progress
  - Gray: Coming soon/inactive

**Typography:**
- Section headers: Uppercase, tracked, small (`text-xs`)
- Nav items: Normal case, medium (`text-sm`)
- Badges: Tiny, bold (`text-[10px]`)
- Clear size hierarchy for readability

## Component Patterns

### Pattern 1: Hierarchical Navigation

**Example:** Sidebar with collapsible sections

```tsx
const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['workspace', 'p2p-network', 'development'])
);

const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
        const next = new Set(prev);
        if (next.has(sectionId)) {
            next.delete(sectionId);
        } else {
            next.add(sectionId);
        }
        return next;
    });
};

// Section header
<button
    onClick={() => toggleSection('workspace')}
    className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 hover:text-gray-300"
>
    <span>WORKSPACE</span>
    <ChevronIcon className={expandedSections.has('workspace') ? 'rotate-90' : ''} />
</button>

// Child items (only if expanded)
{expandedSections.has('workspace') && (
    <div className="space-y-1">
        {/* Nav items */}
    </div>
)}
```

**Key Features:**
- Set-based state for O(1) lookup
- Smooth rotation animation on chevron
- Clear visual hierarchy with indentation

### Pattern 2: Status Badges

**Three badge types:**

```tsx
// "Soon" badge (gray)
<span className="text-[10px] font-bold px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">
    Soon
</span>

// "Dev" badge (orange)
<span className="text-[10px] font-bold px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">
    Dev
</span>

// "Issue #X" badge (blue)
<span className="text-[10px] font-bold px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
    #4
</span>
```

**Usage:**
- **Soon**: Planned features not yet implemented
- **Dev**: Development/debug tools
- **Issue #X**: Linked to GitHub issue tracking

### Pattern 3: Active State Highlighting

```tsx
<button
    className={clsx(
        'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md transition-colors',
        activeView === 'playlists'
            ? 'bg-blue-600 text-white'  // Active
            : 'text-gray-300 hover:bg-gray-800'  // Inactive
    )}
    onClick={() => setActiveView('playlists')}
>
    <PlaylistIcon />
    <span>Playlists</span>
</button>
```

**Parent highlighting:** When child is active, highlight parent section too.

### Pattern 4: Scrolling Container Pattern

**Main content area is the scroll container:**

```tsx
// App.tsx - Main layout
<div className="flex h-screen bg-gray-900 text-white">
    <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
        {/* Sidebar - fixed, no scroll */}
    </aside>

    <main className="flex-1 overflow-y-auto p-6">
        {/* Content scrolls here */}
        {renderView()}
    </main>
</div>
```

**Component pattern:**

```tsx
// Individual components - no height constraints
function MyComponent() {
    return (
        <div className="space-y-4">
            {/* Content flows naturally, parent handles scrolling */}
        </div>
    );
}
```

**❌ Avoid:**
```tsx
// Don't set heights on components in scrollable containers
<div className="h-full overflow-y-auto">  // ❌ Conflicts with parent scrolling
<div className="min-h-screen">            // ❌ Forces tall content
```

**✅ Use:**
```tsx
<div className="min-h-[400px]">  // ✅ Minimum height for centering
<div className="space-y-4">       // ✅ Natural flow
```

### Pattern 5: Placeholder Views

For "coming soon" features:

```tsx
function PlaceholderView({ icon: Icon, title, description, features }) {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center max-w-md">
                <Icon className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                <h2 className="text-2xl font-semibold mb-2">{title}</h2>
                <p className="text-gray-400 mb-4">{description}</p>
                <ul className="text-left text-sm text-gray-500 space-y-1">
                    {features.map(feature => (
                        <li key={feature}>• {feature}</li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
```

## Common Pitfalls

### Pitfall 1: Conflicting Heights in Scroll Containers

**Problem:** Setting `h-full` or `min-h-screen` on components inside scrollable containers prevents scrolling.

```tsx
// ❌ Wrong
<main className="flex-1 overflow-y-auto p-6">
    <div className="min-h-screen">  {/* Forces parent to be full viewport height */}
        {content}
    </div>
</main>
```

**Solution:** Remove height constraints from children, let parent handle scrolling.

```tsx
// ✅ Correct
<main className="flex-1 overflow-y-auto p-6">
    <div className="space-y-4">  {/* Natural flow */}
        {content}
    </div>
</main>
```

### Pitfall 2: Multiple Scroll Containers

**Problem:** Nested scroll containers create confusing scroll behavior.

```tsx
// ❌ Avoid nested scrolling
<main className="overflow-y-auto">
    <div className="overflow-y-auto h-full">  {/* Nested scroller */}
        {content}
    </div>
</main>
```

**Solution:** Single scroll container at parent level.

```tsx
// ✅ Single scroller
<main className="overflow-y-auto">
    <div>
        {content}  {/* Parent scrolls */}
    </div>
</main>
```

### Pitfall 3: Lost Padding in Components

**Problem:** Removing component padding after parent already provides it.

**Rule:** Main content area (`<main>`) provides `p-6`. Components shouldn't add more.

```tsx
// App.tsx provides padding
<main className="flex-1 overflow-y-auto p-6">

// ❌ Component adds duplicate padding
<div className="p-4">  {/* Now has 6 + 4 = 10 units of padding */}

// ✅ Component inherits parent padding
<div className="space-y-4">
```

### Pitfall 4: Forgetting Active Parent Highlighting

**Problem:** Parent section doesn't highlight when child is active.

**Solution:** Check if any child is active when determining parent state.

```tsx
const sections = [
    {
        id: 'workspace',
        children: ['playlists', 'library', 'sessions']
    }
];

// Check if any child is active
const isParentActive = (section) => {
    return section.children.some(childId => activeView === childId);
};

<button
    className={clsx(
        'section-header',
        (expandedSections.has('workspace') || isParentActive(workspaceSection))
            && 'bg-gray-800'
    )}
>
```

### Pitfall 5: Hardcoded Colors Instead of Semantic Classes

**Problem:** Using arbitrary color values instead of Tailwind's semantic classes.

```tsx
// ❌ Hardcoded
<div style={{ backgroundColor: '#1F2937' }}>

// ✅ Semantic
<div className="bg-gray-800">
```

**Benefits:**
- Consistent with design system
- Responsive to theme changes
- Better IntelliSense support

## Testing Checklist

When adding/modifying UI components:

- [ ] Scrolling works for tall content
- [ ] Active states highlight correctly
- [ ] Hover states are visible
- [ ] Badges display with correct colors
- [ ] Parent sections highlight when child is active
- [ ] Collapsible sections expand/collapse smoothly
- [ ] Placeholder views are centered
- [ ] No conflicting height constraints
- [ ] Typography follows hierarchy (xs/sm/base/lg)
- [ ] Colors use semantic Tailwind classes

## File Locations

### Key UI Components
- Sidebar: `app/src/renderer/components/Layout/Sidebar.tsx`
- Toolbar: `app/src/renderer/components/Layout/Toolbar.tsx`
- App layout: `app/src/renderer/App.tsx`

### P2P Components
- P2P Status: `app/src/renderer/components/P2P/P2PStatus.tsx`

### Playlist Components
- Playlist List: `app/src/renderer/components/Playlist/PlaylistList.tsx`
- Playlist View: `app/src/renderer/components/Playlist/PlaylistView.tsx`

### Styles
- Main CSS: `app/src/styles/main.css`
- Tailwind config: `app/tailwind.config.js`

## Related Concepts

- [[Tailwind-v4]] - Styling framework and patterns
- [[React-Patterns]] - React-specific patterns
- [[Electron-IPC]] - Renderer ↔ Main communication

## References

### Design Inspiration
- Obsidian: Local-first, developer-focused aesthetics
- VS Code: Sidebar navigation patterns
- Linear: Badge and status indicator design

### Implementation
- React 19 documentation
- Tailwind CSS v4 documentation
- clsx for conditional classes

---

**Status**: ✅ Patterns established in v0.0.0
**Design System**: Obsidian-inspired, local-first aesthetic
**Last Updated**: 2025-11-12

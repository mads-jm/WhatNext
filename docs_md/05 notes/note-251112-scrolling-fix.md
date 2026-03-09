---
tags:
  - ux/react
  - ux/ui/layout
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Monday, March 9th 2026, 12:20:33 am
---

# Fix: Add Vertical Scrolling to All Main Window Tabs

__Date__: 2025-11-12
__Status__: ✅ Complete
__Type__: UI/UX Bug Fix

## Issue

Content in tabs (especially P2P Network and RxDB Spike Test) was overflowing vertically without scrolling, making it impossible to access content below the viewport.

## Root Cause

The main content area in `App.tsx` had `overflow-hidden` which prevented scrolling:

```tsx
<main className="flex-1 overflow-hidden p-6">
    {renderView()}
</main>
```

Additionally, the P2PStatus component was setting its own full-height background (`min-h-screen`) which conflicted with the parent container's layout.

## Solution

### 1. Enable Scrolling on Main Content Area

Changed `overflow-hidden` to `overflow-y-auto` in `App.tsx`:

```tsx
<main className="flex-1 overflow-y-auto p-6">
    {renderView()}
</main>
```

This allows the main content area to scroll when content overflows.

### 2. Remove Conflicting Styles from P2PStatus

Removed `min-h-screen` and padding from the P2PStatus component:

__Before:__

```tsx
<div className="p-4 space-y-4 bg-gray-50 min-h-screen font-mono text-sm">
```

__After:__

```tsx
<div className="space-y-4 font-mono text-sm">
```

The parent `<main>` already provides padding, so the component doesn't need its own.

### 3. Fix Placeholder View Heights

Changed placeholder views (Library, Sessions, Settings) from `h-full` to `min-h-[400px]`:

__Before:__

```tsx
<div className="flex items-center justify-center h-full">
```

__After:__

```tsx
<div className="flex items-center justify-center min-h-[400px]">
```

This ensures centered content works properly with parent scrolling.

### 4. Simplify Playlists Grid Layout

Removed nested `overflow-y-auto` and `h-full` from the playlists grid, allowing parent scrolling to handle it:

__Before:__

```tsx
<div className="grid grid-cols-5 gap-6 h-full">
    <div className="col-span-2 overflow-y-auto">
```

__After:__

```tsx
<div className="grid grid-cols-5 gap-6">
    <div className="col-span-2">
```

## Files Modified

- `app/src/renderer/App.tsx` - Main scrolling container + placeholder view heights
- `app/src/renderer/components/P2P/P2PStatus.tsx` - Removed conflicting height/padding

## Testing

After this fix, all tabs should:
- [x] Scroll vertically when content overflows
- [x] Show all content (no hidden sections)
- [x] Maintain proper spacing and padding
- [x] Work with any amount of content

### Test Scenarios

1. __P2P Network tab__: Long peer lists, expanded sections, debug logs should all be accessible
2. __RxDB Spike Test__: All CRUD operations and logs visible
3. __Playlists__: Long playlist lists and track lists scroll independently (if needed in future)
4. __Empty tabs__: Placeholder content still centered

## Design Pattern

__Scrolling Strategy:__
- Main content area (`<main>`) is the scroll container
- Individual components don't set their own heights
- Parent padding/spacing is inherited
- Use `min-h-*` for minimum heights, never `h-full` for fixed heights in scrollable containers

## Why This Matters

The P2P development interface has many collapsible sections that can create very tall content. Without scrolling, much of the debug information would be inaccessible, defeating the purpose of the comprehensive developer UI.

## Related Concepts

[[React-Patterns]] [[Tailwind-v4]]

## Related Notes

- `note-251112-p2p-development-interface-complete.md` - The comprehensive UI that needed scrolling


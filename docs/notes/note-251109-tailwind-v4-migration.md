# Tailwind CSS v4 Migration

**Date**: 2025-11-09
**Issue**: Build failures after upgrading to Tailwind v4
**Status**: ✅ Resolved

## Problem

Build failed with error:
```
Cannot apply unknown utility class `text-gray-200`
Cannot apply unknown utility class `btn`
```

## Root Cause

Tailwind v4 introduces breaking changes to how custom components and utilities are defined:

1. **`@layer components` is deprecated** - The old pattern of defining custom classes in `@layer components` no longer works
2. **New `@utility` directive** - Custom utilities must use `@utility` instead of `@layer utilities`
3. **`@apply` scoping changes** - In scoped contexts, need `@reference` directive to access theme
4. **CSS-first configuration** - Theme customization now happens in CSS via `@theme`, not `tailwind.config.js`

## Key Learnings

### V3 Pattern (Old)
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer components {
  .btn {
    @apply px-4 py-2 rounded;
  }
}
```

### V4 Pattern (New)
```css
@import "tailwindcss";

@utility btn {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  /* ... */
}
```

**OR** for reusable components, define them in regular CSS without @utility, and apply utility classes directly in JSX/TSX.

## Solution Applied

For WhatNext, we opted to:
1. **Remove custom component CSS** - Delete `@layer components` entirely
2. **Use Tailwind utilities directly in JSX** - Apply utility classes in React components instead of creating intermediate `.btn`, `.card`, etc. classes
3. **Keep theme configuration in `tailwind.config.js`** - v4 still supports JS config (on roadmap for stable)

### Why This Approach?

- **Simpler**: No CSS abstraction layer to maintain
- **More flexible**: Easier to see exactly what styles are applied
- **Better DX**: IntelliSense works better with direct utility usage
- **Aligned with v4 philosophy**: Tailwind v4 encourages utility-first approach

## Changes Made

1. Updated `@import "tailwindcss"` syntax
2. Removed `@layer` usage from component styles
3. Updated `postcss.config.js` to use `@tailwindcss/postcss`
4. Components will use utility classes directly (e.g., `className="btn-primary"` becomes `className="px-3 py-2 bg-primary-600 hover:bg-primary-500..."`)

## References

- [Tailwind v4 Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide)
- [Tailwind v4 Alpha Announcement](https://tailwindcss.com/blog/tailwindcss-v4-alpha)

## Solution Found! ✅

The issue wasn't Vite 7 compatibility - it was using the **wrong plugin**!

### The Problem
We were using `@tailwindcss/postcss` which had the "Missing field `negated`" error. Additionally:
- Multiple CSS files were importing Tailwind (fonts.css + components.css)
- `@import` statements were in wrong order

### The Solution

1. **Use `@tailwindcss/vite` plugin** instead of PostCSS plugin:
   ```bash
   npm install @tailwindcss/vite --save-dev --legacy-peer-deps
   ```

2. **Update `vite.config.ts`**:
   ```typescript
   import tailwindcss from '@tailwindcss/vite';

   export default defineConfig({
       plugins: [react(), tailwindcss()],
   });
   ```

3. **Single CSS entry point** (`src/styles/main.css`):
   ```css
   /* Font imports FIRST */
   @import url('...');

   /* Then Tailwind */
   @import "tailwindcss";

   /* Then custom utilities */
   @utility btn { ... }
   ```

4. **Use `@utility` directive** for custom components (not `@layer components`)

### Build Result
```
✓ 663 modules transformed.
✓ built in 11.19s
```

**Status**: ✅ **Tailwind v4 working perfectly with Vite 7!**

## Key Learnings

1. **Plugin Choice Matters**: `@tailwindcss/vite` > `@tailwindcss/postcss` for Vite projects
2. **Import Order**: External `@import` → `@import "tailwindcss"` → everything else
3. **Single Entry Point**: Only import Tailwind once in your main CSS file
4. **`@utility` Syntax**: Define base styles, variants handled automatically via `&:pseudo-selector`
5. **Persistence Pays Off**: The official docs were right - v4 DOES work with Vite 7!

## Next Steps

- [x] Document compatibility solution
- [x] Get build working with Tailwind v4
- [x] Learn `@utility` directive properly
- [ ] Consider v4 theme configuration with `@theme` directive for colors

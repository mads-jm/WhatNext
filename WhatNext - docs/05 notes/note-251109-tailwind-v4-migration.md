---
tags:
  - ux/styling/tailwind
  - core/build-tools
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Monday, March 9th 2026, 12:20:34 am
---

# Tailwind CSS V4 Migration

__Date__: 2025-11-09
__Issue__: Build failures after upgrading to Tailwind v4
__Status__: ✅ Resolved

## Problem

Build failed with error:

```ts
Cannot apply unknown utility class `text-gray-200`
Cannot apply unknown utility class `btn`
```

## Root Cause

Tailwind v4 introduces breaking changes to how custom components and utilities are defined:

1. __`@layer components` is deprecated__ - The old pattern of defining custom classes in `@layer components` no longer works
2. __New `@utility` directive__ - Custom utilities must use `@utility` instead of `@layer utilities`
3. __`@apply` scoping changes__ - In scoped contexts, need `@reference` directive to access theme
4. __CSS-first configuration__ - Theme customization now happens in CSS via `@theme`, not `tailwind.config.js`

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

__OR__ for reusable components, define them in regular CSS without @utility, and apply utility classes directly in JSX/TSX.

## Solution Applied

For WhatNext, we opted to:
1. __Remove custom component CSS__ - Delete `@layer components` entirely
2. __Use Tailwind utilities directly in JSX__ - Apply utility classes in React components instead of creating intermediate `.btn`, `.card`, etc. classes
3. __Keep theme configuration in `tailwind.config.js`__ - v4 still supports JS config (on roadmap for stable)

### Why This Approach?

- __Simpler__: No CSS abstraction layer to maintain
- __More flexible__: Easier to see exactly what styles are applied
- __Better DX__: IntelliSense works better with direct utility usage
- __Aligned with v4 philosophy__: Tailwind v4 encourages utility-first approach

## Changes Made

1. Updated `@import "tailwindcss"` syntax
2. Removed `@layer` usage from component styles
3. Updated `postcss.config.js` to use `@tailwindcss/postcss`
4. Components will use utility classes directly (e.g., `className="btn-primary"` becomes `className="px-3 py-2 bg-primary-600 hover:bg-primary-500…"`)

## References

- [Tailwind v4 Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide)
- [Tailwind v4 Alpha Announcement](https://tailwindcss.com/blog/tailwindcss-v4-alpha)

## Solution Found! ✅

The issue wasn't Vite 7 compatibility - it was using the __wrong plugin__!

### The Problem

We were using `@tailwindcss/postcss` which had the "Missing field `negated`" error. Additionally:
- Multiple CSS files were importing Tailwind (fonts.css + components.css)
- `@import` statements were in wrong order

### The Solution

1. __Use `@tailwindcss/vite` plugin__ instead of PostCSS plugin:

   ```bash
   npm install @tailwindcss/vite --save-dev --legacy-peer-deps
   ```

2. __Update `vite.config.ts`__:

   ```typescript
   import tailwindcss from '@tailwindcss/vite';

   export default defineConfig({
       plugins: [react(), tailwindcss()],
   });
   ```

3. __Single CSS entry point__ (`src/styles/main.css`):

   ```css
   /* Font imports FIRST */
   @import url('...');

   /* Then Tailwind */
   @import "tailwindcss";

   /* Then custom utilities */
   @utility btn { ... }
   ```

4. __Use `@utility` directive__ for custom components (not `@layer components`)

### Build Result

```ts
✓ 663 modules transformed.
✓ built in 11.19s
```

__Status__: ✅ __Tailwind v4 working perfectly with Vite 7!__

## Key Learnings

1. __Plugin Choice Matters__: `@tailwindcss/vite` > `@tailwindcss/postcss` for Vite projects
2. __Import Order__: External `@import` → `@import "tailwindcss"` → everything else
3. __Single Entry Point__: Only import Tailwind once in your main CSS file
4. __`@utility` Syntax__: Define base styles, variants handled automatically via `&:pseudo-selector`
5. __Persistence Pays Off__: The official docs were right - v4 DOES work with Vite 7!

## Next Steps

- [x] Document compatibility solution
- [x] Get build working with Tailwind v4
- [x] Learn `@utility` directive properly
- [ ] Consider v4 theme configuration with `@theme` directive for colors

---

## Related Concepts

[[Tailwind-v4]]


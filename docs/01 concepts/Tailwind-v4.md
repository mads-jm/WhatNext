---
tags:
  - ux/styling
  - core/build-tools
  - ux/styling/tailwind
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Thursday, November 13th 2025, 5:22:00 am
---

# Tailwind CSS V4

## What It Is

Tailwind CSS v4 is a major rewrite of the popular utility-first CSS framework, introducing a new engine, CSS-first configuration, and improved performance. It moves away from JavaScript config files in favor of native CSS with `@import`, `@theme`, and `@utility` directives.

In WhatNext, Tailwind v4 provides the styling foundation with utility classes applied directly in React components, following a utility-first approach with minimal custom CSS.

## Why We Use It

- __Utility-first__: Rapid UI development without context-switching to CSS files
- __Performance__: New Rust-based engine (Oxide) dramatically faster than v3
- __Type safety__: IntelliSense works better with direct utility usage
- __Vite integration__: First-class `@tailwindcss/vite` plugin
- __Modern approach__: CSS-first configuration aligns with web standards

__Migration from v3__: Breaking changes required updates to build config and custom utility patterns, but v4's philosophy aligns better with WhatNext's approach (no abstraction layers, direct utilities in JSX).

## How It Works

### Build Integration

Tailwind v4 integrates via Vite plugin, not PostCSS:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        react(),
        tailwindcss()  // ← Vite plugin, not PostCSS
    ]
});
```

__Why Vite plugin__: Direct integration is faster and more reliable than PostCSS processing chain.

### CSS Entry Point

Single CSS file imports Tailwind:

```css
/* src/styles/main.css */

/* Font imports FIRST */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* Then Tailwind */
@import "tailwindcss";

/* Then custom utilities (if needed) */
@utility btn {
    display: inline-flex;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-weight: 500;
    transition: all 0.2s;
}
```

__Import order matters__: External `@import` → `@import "tailwindcss"` → custom CSS

### Usage in Components

Apply utilities directly in JSX:

```tsx
// ✅ Preferred (v4 philosophy)
<button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium">
    Save Playlist
</button>

// ❌ Avoid creating intermediate classes
<button className="btn btn-primary">
    Save Playlist
</button>
```

## Key Patterns

### Pattern 1: Installation with Legacy Peer Deps

Tailwind v4 is in alpha and may have peer dependency conflicts:

```bash
npm install @tailwindcss/vite --save-dev --legacy-peer-deps
```

__Why `--legacy-peer-deps`__: Allows installation despite version mismatches with Vite 7.

### Pattern 2: Custom Utilities with @utility

For reusable component patterns:

```css
@utility card {
    background-color: white;
    border-radius: 0.5rem;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

@utility card-hover {
    &:hover {
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
}
```

__Usage__:

```tsx
<div className="card card-hover">
    {/* Content */}
</div>
```

__Variants handled automatically__: Pseudo-selectors like `&:hover` work without manual variant definitions.

### Pattern 3: Theme Configuration (Future)

v4 supports CSS-based theme configuration:

```css
@theme {
    --color-primary-50: #eff6ff;
    --color-primary-100: #dbeafe;
    --color-primary-600: #2563eb;
    --color-primary-700: #1d4ed8;
}
```

__Current approach__: WhatNext uses default Tailwind colors, custom theme planned for future.

### Pattern 4: Conditional Classes

```tsx
import clsx from 'clsx';

<div className={clsx(
    'px-4 py-2 rounded-lg',
    isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700',
    isDisabled && 'opacity-50 cursor-not-allowed'
)}>
    {children}
</div>
```

## Common Pitfalls

### Pitfall 1: Using Wrong Plugin

__Problem__: Using `@tailwindcss/postcss` instead of `@tailwindcss/vite`.

__Error__:

```ts
Missing field `negated` in query
Cannot apply unknown utility class
```

__Solution__: Use Vite plugin:

```bash
# ❌ Wrong
npm install @tailwindcss/postcss

# ✅ Correct
npm install @tailwindcss/vite
```

### Pitfall 2: Multiple Tailwind Imports

__Problem__: Importing `@import "tailwindcss"` in multiple CSS files.

__Error__: Build fails or duplicate CSS generated.

__Solution__: Import Tailwind once in main CSS file only:

```css
/* ✅ src/styles/main.css - single import */
@import "tailwindcss";

/* ❌ Don't import in other CSS files */
```

### Pitfall 3: Wrong Import Order

__Problem__: External `@import` after `@import "tailwindcss"`.

__Error__: External styles don't load or are overridden.

__Solution__: External imports FIRST:

```css
/* ✅ Correct order */
@import url('https://fonts.googleapis.com/...');
@import "tailwindcss";

/* ❌ Wrong order */
@import "tailwindcss";
@import url('https://fonts.googleapis.com/...');
```

### Pitfall 4: Using @layer Components

__Problem__: v3 pattern no longer works in v4.

```css
/* ❌ v3 pattern (deprecated in v4) */
@layer components {
    .btn {
        @apply px-4 py-2 rounded;
    }
}
```

__Solution__: Use `@utility` directive:

```css
/* ✅ v4 pattern */
@utility btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
}
```

__Or better__: Apply utilities directly in JSX (no custom CSS needed).

### Pitfall 5: Missing PostCSS Config

__Problem__: Old `postcss.config.js` with Tailwind PostCSS plugin conflicts with Vite plugin.

__Solution__: Remove PostCSS Tailwind plugin (Vite plugin handles everything):

```javascript
// postcss.config.js - remove Tailwind
export default {
    plugins: {
        autoprefixer: {}  // Keep autoprefixer only
    }
};
```

## Related Concepts

- [[React-Patterns]] - Using Tailwind utilities in React components
- [[Electron-IPC]] - No impact on IPC, purely renderer concern
- Vite documentation - Build tool integration

## References

### Official Documentation

- [Tailwind v4 Docs](https://tailwindcss.com/docs)
- [Tailwind v4 Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide)
- [Tailwind v4 Alpha Announcement](https://tailwindcss.com/blog/tailwindcss-v4-alpha)
- [@tailwindcss/vite Plugin](https://www.npmjs.com/package/@tailwindcss/vite)

### WhatNext Implementation

- Vite config: `app/vite.config.ts`
- Main CSS: `app/src/styles/main.css`
- Components: `app/src/renderer/components/`

### Related Issues

- Build failures during v4 migration
- Resolution: Use Vite plugin, not PostCSS

---

__Status__: ✅ Production-ready, running in WhatNext v0.0.0
__Version__: v4.0.0-alpha.x (with Vite 7)
__Last Updated__: 2025-11-12

# Tailwind CSS v4

#frontend/styling #build-tools

## What It Is

Tailwind CSS v4 is a major rewrite of the popular utility-first CSS framework, introducing a new engine, CSS-first configuration, and improved performance. It moves away from JavaScript config files in favor of native CSS with `@import`, `@theme`, and `@utility` directives.

In WhatNext, Tailwind v4 provides the styling foundation with utility classes applied directly in React components, following a utility-first approach with minimal custom CSS.

## Why We Use It

- **Utility-first**: Rapid UI development without context-switching to CSS files
- **Performance**: New Rust-based engine (Oxide) dramatically faster than v3
- **Type safety**: IntelliSense works better with direct utility usage
- **Vite integration**: First-class `@tailwindcss/vite` plugin
- **Modern approach**: CSS-first configuration aligns with web standards

**Migration from v3**: Breaking changes required updates to build config and custom utility patterns, but v4's philosophy aligns better with WhatNext's approach (no abstraction layers, direct utilities in JSX).

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

**Why Vite plugin**: Direct integration is faster and more reliable than PostCSS processing chain.

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

**Import order matters**: External `@import` → `@import "tailwindcss"` → custom CSS

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

**Why `--legacy-peer-deps`**: Allows installation despite version mismatches with Vite 7.

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

**Usage**:
```tsx
<div className="card card-hover">
    {/* Content */}
</div>
```

**Variants handled automatically**: Pseudo-selectors like `&:hover` work without manual variant definitions.

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

**Current approach**: WhatNext uses default Tailwind colors, custom theme planned for future.

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

**Problem**: Using `@tailwindcss/postcss` instead of `@tailwindcss/vite`.

**Error**:
```
Missing field `negated` in query
Cannot apply unknown utility class
```

**Solution**: Use Vite plugin:

```bash
# ❌ Wrong
npm install @tailwindcss/postcss

# ✅ Correct
npm install @tailwindcss/vite
```

### Pitfall 2: Multiple Tailwind Imports

**Problem**: Importing `@import "tailwindcss"` in multiple CSS files.

**Error**: Build fails or duplicate CSS generated.

**Solution**: Import Tailwind once in main CSS file only:

```css
/* ✅ src/styles/main.css - single import */
@import "tailwindcss";

/* ❌ Don't import in other CSS files */
```

### Pitfall 3: Wrong Import Order

**Problem**: External `@import` after `@import "tailwindcss"`.

**Error**: External styles don't load or are overridden.

**Solution**: External imports FIRST:

```css
/* ✅ Correct order */
@import url('https://fonts.googleapis.com/...');
@import "tailwindcss";

/* ❌ Wrong order */
@import "tailwindcss";
@import url('https://fonts.googleapis.com/...');
```

### Pitfall 4: Using @layer components

**Problem**: v3 pattern no longer works in v4.

```css
/* ❌ v3 pattern (deprecated in v4) */
@layer components {
    .btn {
        @apply px-4 py-2 rounded;
    }
}
```

**Solution**: Use `@utility` directive:

```css
/* ✅ v4 pattern */
@utility btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
}
```

**Or better**: Apply utilities directly in JSX (no custom CSS needed).

### Pitfall 5: Missing PostCSS Config

**Problem**: Old `postcss.config.js` with Tailwind PostCSS plugin conflicts with Vite plugin.

**Solution**: Remove PostCSS Tailwind plugin (Vite plugin handles everything):

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

**Status**: ✅ Production-ready, running in WhatNext v0.0.0
**Version**: v4.0.0-alpha.x (with Vite 7)
**Last Updated**: 2025-11-12

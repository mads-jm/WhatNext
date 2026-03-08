---
tags:
  - ux/styling/tailwind
  - ux/styling
  - core/build-tools
date created: Thursday, November 13th 2025, 4:59:13 am
date modified: Saturday, March 7th 2026
---

# Tailwind CSS

WhatNext uses **Tailwind CSS v4** with the `@tailwindcss/vite` plugin (not PostCSS). See [[Tailwind-v4]] for the full concept page covering installation, build integration, custom utilities, v3→v4 migration pitfalls, and the `@utility` directive.

## Quick Reference

```css
/* app/src/styles/main.css */
@import url('https://fonts.googleapis.com/...');  /* external imports FIRST */
@import "tailwindcss";
```

```typescript
// vite.config.ts
import tailwindcss from '@tailwindcss/vite';
plugins: [react(), tailwindcss()]
```

Custom component classes use `@utility`, not `@layer components`. The project's custom utilities (`card`, `btn-primary`, `btn-ghost`, etc.) are defined in `app/src/styles/main.css`.

## Related

- [[Tailwind-v4]] — Full documentation
- [[React-Patterns]] — Applying utilities in JSX
- [Tailwind CSS v4 Docs](https://tailwindcss.com/docs)

# Theme System: CSS Variable Bridge Pattern

#guides/ui #ux/styling/tailwind #ux/theming #architecture/patterns

> A portable, runtime-switchable theme system using CSS custom properties as the single source of truth. Designed for Tailwind CSS v4 but applicable to any CSS-based stack. No framework lock-in — works with React, Svelte, vanilla JS, or a future Rust/WASM shell.

---

## The Pattern in 30 Seconds

```
ThemeDefinition (JSON/TS object)
    → applyTheme() sets --wn-* CSS custom properties on :root
        → @theme block (or equivalent) maps --wn-* → framework token names
            → Existing utility classes resolve automatically — zero component changes
```

Switching themes = updating ~25 CSS variables on `<html>`. The browser repaints instantly. No re-render, no class swapping, no build step.

---

## 1. Why CSS Variables as the Bridge

### The Problem

Most theming approaches fall into one of two traps:

1. **Class-swapping** (`dark:bg-gray-900`) — requires every component to know about every theme. Adding a third theme means touching every file.
2. **CSS-in-JS** (styled-components, Emotion) — runtime overhead, framework lock-in, breaks SSR, incompatible with utility-first CSS.

### The Solution

CSS custom properties are:
- **Native** — zero runtime overhead, hardware-accelerated repaints
- **Cascading** — set once on `:root`, inherited everywhere
- **Framework-agnostic** — works with Tailwind, plain CSS, PostCSS, or any preprocessor
- **Serializable** — a theme is just `{ "primary": "#ba9eff", ... }` → trivially exportable, importable, sharable

### Tailwind v4 Specific Advantage

Tailwind v4 introduced `@theme` blocks in CSS that define design tokens. When those tokens reference CSS variables, every utility class (`bg-primary`, `text-on-surface`, etc.) becomes dynamically themeable without any Tailwind rebuild.

```css
@theme {
    --color-primary: var(--wn-primary);
}
```

Now `bg-primary` resolves to whatever `--wn-primary` is set to at runtime.

---

## 2. Theme Token Schema

### TypeScript Interface

```typescript
interface ThemeDefinition {
    id: string;              // Unique slug: 'dark', 'oled', 'my-custom-theme'
    name: string;            // Human-readable: 'Resilient Nocturne'
    description: string;
    builtIn: boolean;        // true = shipped with app, not deletable
    mode: 'dark' | 'light';  // Controls system-level behaviors (scrollbar, meta-theme-color)
    version: 1;              // Schema version for forward-compat

    colors: ThemeColors;
    typography: ThemeTypography;
    radii: ThemeRadii;
    effects: ThemeEffects;
}
```

### Color Tokens

These are the **minimum viable set** for a music/media app. Adapt for your domain.

| Token | Role | Dark Example | Light Example |
|-------|------|-------------|---------------|
| `surface` | Main canvas background | `#0e0e10` | `#fbf8fa` |
| `surface-lowest` | Deepest layer (sidebar, nav) | `#000000` | `#ffffff` |
| `surface-high` | Elevated surfaces (cards, inputs) | `#1f1f22` | `#f6f3f5` |
| `surface-highest` | Modals, popovers, tooltips | `#262528` | `#e4e2e4` |
| `primary` | Brand accent, CTAs, active states | `#ba9eff` | `#4800b2` |
| `primary-dim` | Hover/pressed, gradients | `#8455ef` | `#6200ee` |
| `on-primary` | Text on primary-colored surfaces | `#39008c` | `#ffffff` |
| `secondary` | Secondary accent (status, sync) | `#53ddfc` | `#006a6a` |
| `tertiary` | Tertiary accent (social, reactions) | `#ff97b8` | `#504f79` |
| `on-surface` | Primary text | `#f6f3f5` | `#1b1b1d` |
| `on-surface-variant` | Secondary/muted text | `#acaaad` | `#48474a` |
| `outline-variant` | Borders, dividers (used at opacity) | `#48474a` | `#c8c5ca` |
| `error` | Error/destructive states | `#d73357` | `#ba1a1a` |

### Non-Color Tokens

```typescript
interface ThemeTypography {
    fontBody: string;      // "'Inter', sans-serif" or "'Manrope', sans-serif"
    fontHeadline: string;  // "'Manrope', sans-serif"
    fontMono: string;      // "'JetBrains Mono', monospace"
}

interface ThemeRadii {
    sm: string;       // Badges, small elements
    DEFAULT: string;  // General purpose
    lg: string;       // Cards, buttons
    xl: string;       // Panels
    '2xl': string;    // Large containers
}

interface ThemeEffects {
    useBorders: boolean;   // OLED themes may prefer borderless
    cardShadow: string;    // Box-shadow for elevated surfaces
    toolbarBlur: string;   // Backdrop-filter for glass panels
}
```

---

## 3. CSS Architecture

### The @theme Block (Tailwind v4)

```css
@import "tailwindcss";

@theme {
    --color-primary: var(--wn-primary);
    --color-primary-dim: var(--wn-primary-dim);
    --color-on-primary: var(--wn-on-primary);
    --color-secondary: var(--wn-secondary);
    --color-tertiary: var(--wn-tertiary);
    --color-surface: var(--wn-surface);
    --color-surface-lowest: var(--wn-surface-lowest);
    --color-surface-high: var(--wn-surface-high);
    --color-surface-highest: var(--wn-surface-highest);
    --color-on-surface: var(--wn-on-surface);
    --color-on-surface-variant: var(--wn-on-surface-variant);
    --color-outline-variant: var(--wn-outline-variant);
    --color-error: var(--wn-error);

    --font-headline: var(--wn-font-headline);
    --font-body: var(--wn-font-body);
    --font-mono: var(--wn-font-mono);

    --radius-sm: var(--wn-radius-sm);
    --radius-lg: var(--wn-radius-lg);
    --radius-xl: var(--wn-radius-xl);
    --radius-2xl: var(--wn-radius-2xl);
}
```

### Fallback Defaults

Always provide `:root` defaults so the page renders correctly before JavaScript loads:

```css
:root {
    --wn-primary: #ba9eff;
    --wn-surface: #0e0e10;
    --wn-on-surface: #f6f3f5;
    /* ... all tokens with your default theme values ... */
}
```

This prevents flash-of-unstyled-content (FOUC). The theme store overwrites these on initialization.

### Migrating @utility Directives

Replace every hardcoded hex in custom utilities with `var()`:

```css
/* Before */
@utility btn-primary {
    background-color: #ba9eff;
    color: #0e0e10;
    &:hover { background-color: #8455ef; }
}

/* After */
@utility btn-primary {
    background-color: var(--wn-primary);
    color: var(--wn-surface);
    &:hover { background-color: var(--wn-primary-dim); }
}
```

### Opacity with CSS Variables

For patterns like `border: 1px solid rgba(72, 71, 74, 0.2)`, use `color-mix()`:

```css
border: 1px solid color-mix(in srgb, var(--wn-outline-variant) 20%, transparent);
```

`color-mix()` is supported in all modern browsers (Chrome 111+, Firefox 113+, Safari 16.4+). For Electron apps, this is safe as of Electron 25+.

**Alternative** — Tailwind opacity modifiers like `bg-primary/10` work natively with CSS variable colors in Tailwind v4 via internal `color-mix()` transforms.

### For Non-Tailwind Projects

If you're not using Tailwind, the same pattern works with plain CSS:

```css
:root {
    --wn-primary: #ba9eff;
}

.btn-primary {
    background-color: var(--wn-primary);
}
```

No framework needed. The `@theme` block is Tailwind-specific sugar — the underlying mechanism is pure CSS custom properties.

---

## 4. JavaScript Runtime

### Theme Applicator

The single function that makes themes visible to the browser:

```typescript
function applyTheme(theme: ThemeDefinition): void {
    const root = document.documentElement;

    // Colors
    for (const [token, value] of Object.entries(theme.colors)) {
        root.style.setProperty(`--wn-${token}`, value);
    }

    // Typography
    root.style.setProperty('--wn-font-body', theme.typography.fontBody);
    root.style.setProperty('--wn-font-headline', theme.typography.fontHeadline);
    root.style.setProperty('--wn-font-mono', theme.typography.fontMono);

    // Radii
    root.style.setProperty('--wn-radius-sm', theme.radii.sm);
    root.style.setProperty('--wn-radius-default', theme.radii.DEFAULT);
    root.style.setProperty('--wn-radius-lg', theme.radii.lg);
    root.style.setProperty('--wn-radius-xl', theme.radii.xl);
    root.style.setProperty('--wn-radius-2xl', theme.radii['2xl']);

    // Effects
    root.style.setProperty('--wn-card-shadow', theme.effects.cardShadow);
    root.style.setProperty('--wn-toolbar-blur', theme.effects.toolbarBlur);

    // Mode class (dark/light)
    root.classList.toggle('dark', theme.mode === 'dark');
    root.classList.toggle('light', theme.mode === 'light');

    document.body.style.fontFamily = theme.typography.fontBody;
}
```

This function is **framework-agnostic**. It works with React, Svelte, Vue, vanilla JS, or a Rust/WASM frontend.

### State Management (Zustand Example)

```typescript
const useThemeStore = create<ThemeStore>((set, get) => ({
    activeThemeId: 'dark',
    themes: [...builtInThemes],

    initialize: () => {
        const customThemes = loadFromStorage();
        const allThemes = [...builtInThemes, ...customThemes];
        const savedId = localStorage.getItem('whatnext:activeThemeId') || 'dark';
        const activeId = allThemes.find(t => t.id === savedId) ? savedId : 'dark';

        set({ themes: allThemes, activeThemeId: activeId });
        applyTheme(allThemes.find(t => t.id === activeId)!);
    },

    setTheme: (themeId) => {
        const theme = get().themes.find(t => t.id === themeId);
        if (!theme) return;
        localStorage.setItem('whatnext:activeThemeId', themeId);
        set({ activeThemeId: themeId });
        applyTheme(theme);
    },
}));
```

**For other frameworks:**
- **Svelte**: Use a writable store + `$effect` to call `applyTheme()`
- **Vue**: Use Pinia store with a watcher
- **Vanilla JS**: Global object + `addEventListener('storage', ...)` for cross-tab sync
- **Rust/WASM**: Call `applyTheme()` via JS interop (`wasm-bindgen`)

### Initialization Timing

Call `initialize()` **synchronously before first render** to prevent flash:

```typescript
// React
useEffect(() => {
    useThemeStore.getState().initialize(); // sync — reads localStorage
    // ... then database, user, etc.
}, []);

// Svelte
onMount(() => themeStore.initialize());

// Vanilla
document.addEventListener('DOMContentLoaded', () => themeStore.initialize());
```

---

## 5. Export/Import Format

Themes are plain JSON, suitable for file sharing, P2P transmission, or REST APIs:

```json
{
    "$schema": "whatnext-theme-v1",
    "theme": {
        "id": "midnight-aurora",
        "name": "Midnight Aurora",
        "description": "Deep blue with aurora green accents",
        "mode": "dark",
        "version": 1,
        "colors": {
            "surface": "#0a0a1a",
            "primary": "#7dd3fc",
            ...
        },
        "typography": { ... },
        "radii": { ... },
        "effects": { ... }
    },
    "exportedAt": "2026-03-22T12:00:00Z",
    "exportedBy": "username"
}
```

The `$schema` field enables version detection for forward compatibility. Import logic should validate required fields and deduplicate IDs.

---

## 6. Platform Adaptation Notes

### Electron

- **Chromium version**: Electron 25+ supports `color-mix()`. Electron 37+ supports `rgba(from var() r g b / alpha)` relative color syntax.
- **System theme detection**: Use `nativeTheme.shouldUseDarkColors` in main process, or `window.matchMedia('(prefers-color-scheme: dark)')` in renderer.
- **Title bar**: If using custom window chrome, theme the close/minimize/maximize buttons via the same CSS vars.

### Tauri

- Same pattern works. Tauri uses a webview (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux).
- `color-mix()` support depends on the platform's webview version. WebView2 (Chromium-based) is safe. WebKitGTK may lag — test on target Linux distros.

### Progressive Web Apps (PWAs)

- Set `<meta name="theme-color">` dynamically when switching themes:
  ```typescript
  document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme.colors.surface);
  ```
- Use `prefers-color-scheme` media query as the initial theme hint before JS loads.

### React Native (Web)

- CSS custom properties work in React Native Web. Native iOS/Android would need a parallel `StyleSheet`-based theme provider.

### Server-Side Rendering (Next.js, Remix)

- The `:root` defaults in CSS handle the initial render.
- Persist the user's theme preference in a cookie (not just localStorage) so the server can set the correct `class="dark"` on `<html>` before hydration.
- This prevents the "flash of wrong theme" that localStorage-only solutions suffer from.

---

## 7. Migration Checklist

When adding this pattern to an existing project:

- [ ] **Audit current colors**: Grep for hardcoded hex values in CSS and component files
- [ ] **Define token schema**: Map every color to a semantic role (surface, primary, on-surface, etc.)
- [ ] **Create `:root` defaults**: Use your current/default theme values
- [ ] **Add `@theme` block** (Tailwind v4) or equivalent CSS variable declarations
- [ ] **Replace hardcoded hex in utilities/components** with `var(--wn-*)` references
- [ ] **Strip framework config** (tailwind.config.js colors) — tokens now live in CSS
- [ ] **Create theme definitions** as TypeScript/JSON objects
- [ ] **Write `applyTheme()` function** — ~30 lines, framework-agnostic
- [ ] **Create state management** (store, context, global) with localStorage persistence
- [ ] **Initialize before first render** — prevents flash
- [ ] **Build theme picker UI** — swatch cards, import/export buttons
- [ ] **Test all three themes** — dark, light, and one extreme (OLED/high-contrast)
- [ ] **Grep for stale colors** — search for raw hex values that escaped migration

---

## 8. File Organization (WhatNext Reference)

```
app/src/renderer/
    themes/
        theme-types.ts          -- ThemeDefinition interfaces
        theme-oled.ts           -- Built-in: Pure Void (OLED)
        theme-dark.ts           -- Built-in: Resilient Nocturne (Dark)
        theme-light.ts          -- Built-in: Solar Resignation (Light)
        built-in-themes.ts      -- Re-exports all built-ins
        theme-applicator.ts     -- applyTheme() → sets CSS vars
        index.ts                -- Barrel export
    stores/
        theme-store.ts          -- Zustand store with persistence + CRUD
    components/
        Settings/
            ThemeSettings.tsx    -- Theme picker UI
app/src/styles/
    main.css                    -- @theme block + :root defaults + var()-based utilities
```

---

## Related Concepts

- [[UI-Development]] — Component patterns and layout conventions
- [[coding-standards]] — Portable core vs. replaceable shell architecture

## References

- [Tailwind CSS v4 — Theme Configuration](https://tailwindcss.com/docs/theme)
- [CSS `color-mix()` — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix)
- [CSS Custom Properties — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties)
- Material Design 3 — Color system and semantic token naming conventions

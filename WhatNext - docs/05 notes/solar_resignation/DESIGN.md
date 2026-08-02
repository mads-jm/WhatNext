---
tags:
  - ux/theming
  - ux/ui/design-system
---

# Design System Document: Solar Resignation

## 1. Overview & Creative North Star: "The Ethereal Archivist"
This design system marks a transition from the heavy, shielded aesthetic of [[05 notes/resilient_nocturne/DESIGN|"Sonic Vault"]] into a high-visibility, light-drenched environment. Our Creative North Star is **The Ethereal Archivist**—an interface that feels like a clean, sunlit gallery where data is treated with the reverence of a physical artifact. 

By moving away from standard "app" layouts, we embrace **Editorial Asymmetry**. We break the grid by using oversized headlines (`display-lg`), intentional negative space (leveraging the `20` and `24` spacing tokens), and overlapping surfaces. The goal is "Solar Resignation": a state of calm, high-contrast clarity that feels technical yet deeply human.

---

## 2. Colors: Tonal Depth & Vibrancy
We move beyond flat UI by utilizing a sophisticated off-white palette layered with high-energy accents.

### The Palette
*   **Base:** `surface` (#fbf8fa) provides a crisp, warm-white foundation.
*   **The Accents:** `primary` (#4800b2) and `secondary` (#006a6a) serve as our "ink." Use them sparingly but boldly to guide the eye.
*   **The Vibrant Core:** `primary_container` (#6200ee) and `secondary_container` (#8cf3f3) are used for high-impact visual interest.

### Core Rules
*   **The "No-Line" Rule:** 1px solid borders are strictly prohibited for sectioning. Definition must be achieved through background shifts. For example, a `surface_container_low` (#f6f3f5) card sitting on a `surface` (#fbf8fa) background. 
*   **Surface Hierarchy & Nesting:** Treat the UI as stacked sheets of fine paper. An inner content area should shift from `surface` to `surface_container` to indicate a deeper level of information nesting.
*   **The "Glass & Gradient" Rule:** To avoid a clinical look, floating elements (like navigation bars or modals) must use `surface_container_lowest` at 80% opacity with a `backdrop-blur` of 20px. 
*   **Signature Textures:** For primary CTAs, use a subtle linear gradient from `primary` (#4800b2) to `primary_container` (#6200ee) at a 135-degree angle to provide a sense of "liquid depth."

---

## 3. Typography: Technical Elegance
We use **Manrope** exclusively. Its geometric construction provides the "technical" feel, while its open apertures maintain "elegance."

*   **Display (lg/md/sm):** These are your editorial anchors. Use `display-lg` (3.5rem) with `-0.02em` letter spacing for hero headers. It should feel authoritative.
*   **Headline & Title:** Used for content labeling. `headline-sm` (1.5rem) should be used for section starts to create a clear entry point.
*   **Body (lg/md/sm):** Standardized for readability. Use `body-lg` (1rem) for long-form descriptions to maintain the "Solar" high-visibility goal.
*   **Labels:** `label-md` and `label-sm` are for metadata and micro-copy. Use `secondary` (#006a6a) for labels to provide a "technical tag" aesthetic.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are too "standard." We achieve depth through atmospheric light and surface physics.

*   **The Layering Principle:** Place a `surface_container_lowest` (#ffffff) element on top of `surface_container_low` (#f6f3f5) to create a "lifted" effect. This is our primary method of hierarchy.
*   **Ambient Shadows:** For floating components, use a shadow with a 40px blur, 0px offset, and 6% opacity of `on_surface` (#1b1b1d). This mimics soft, natural daylight.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility (e.g., in high-density data tables), use the `outline_variant` token at 15% opacity. Never use 100% opaque lines.
*   **Glassmorphism:** Use `surface_bright` with a 0.7 alpha and a background blur for top-level navigation to ensure the "Sonic Vault" heritage—a sense of transparency and speed—is preserved.

---

## 5. Components

### Buttons
*   **Primary:** A gradient of `primary` to `primary_container`. Border radius: `md` (0.375rem). Type: `title-sm` (white).
*   **Secondary:** `secondary_fixed` (#8cf3f3) background with `on_secondary_fixed` (#002020) text. Ghost-like, high-visibility.
*   **Tertiary:** No background. `primary` text. Focus state uses a `surface_container_highest` soft rectangular background.

### Cards & Lists
*   **Rule:** Forbid divider lines.
*   **Implementation:** Use a `12` (3rem) spacing gap between list items. For cards, use `surface_container_low` and a `lg` (0.5rem) corner radius. Content inside should be padded with `6` (1.5rem).

### Input Fields
*   **Structure:** Minimalist. No bottom line. Use `surface_container_highest` (#e4e2e4) as a solid background block with `sm` (0.125rem) rounding. 
*   **State:** On focus, the background remains, but a `primary` "Ghost Border" (20% opacity) appears.

### The "Archive" Chip
*   A custom component for this system. A `full` (9999px) rounded chip using `tertiary_container` (#504f79) with `tertiary_fixed` (#e2dfff) text. Used for technical metadata.

---

## 6. Do's and Don'ts

### Do
*   **Use Asymmetry:** Align text to the left but place supporting imagery or data visualizations slightly offset to the right to create an editorial flow.
*   **Embrace "Solar" White Space:** If a screen feels "busy," increase the spacing between containers using the `16` (4rem) or `20` (5rem) tokens.
*   **Layer Surfaces:** Always ask, "Can I define this area with a background color shift instead of a line?"

### Don't
*   **No Pure Black:** Never use #000000. Use `on_surface` (#1b1b1d) for maximum readability without the "vibration" of pure black on white.
*   **No Sharp Corners:** Avoid `none` or `sm` rounding for large containers. Use `lg` or `xl` to maintain the "calm" daytime feel.
*   **No High-Contrast Borders:** Avoid the `outline` token at 100% opacity; it breaks the "Ethereal" aesthetic.

---

## Related Concepts

- [[Theme-System]] — the live theming implementation
- [[05 notes/pure_void/DESIGN|pure_void theme design]]
- [[05 notes/resilient_nocturne/DESIGN|resilient_nocturne theme design]]
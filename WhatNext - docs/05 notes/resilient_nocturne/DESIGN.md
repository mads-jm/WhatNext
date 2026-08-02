---
tags:
  - ux/theming
  - ux/ui/design-system
---

# Design System Specification: Resilient Desktop Audio

## 1. Overview & Creative North Star: "The Sonic Vault"
The Creative North Star for this design system is **The Sonic Vault**. Unlike standard web-based music players that feel ephemeral and thin, this system is built to feel like a high-end, heavy-duty desktop workstation. It communicates "Resilience" through deep tonal density and "User-Centricity" through surgical typographic precision.

To move beyond a "template" look, we reject the standard flat grid. Instead, we utilize **Intentional Asymmetry**—where the sidebar acts as a heavy anchor (Surface Container Lowest) against a fluid, layered content area (Surface Container). Elements should feel "machined" into the interface, using light and depth rather than lines to define the workspace.

---

## 2. Colors & Surface Philosophy
The palette is rooted in deep charcoals with "Electric Violet" and "Modern Indigo" accents to provide a pulse of energy against the dark substrate.

### The "No-Line" Rule
**Explicit Instruction:** Traditional 1px solid borders are prohibited for sectioning. Boundaries must be defined solely through background color shifts. For example, a track list sitting on `surface` should be contained within a `surface-container-low` zone. 

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the following tiers to create "nested" depth:
- **Base Layer:** `surface` (#0e0e10) - The primary application background.
- **Navigation Anchor:** `surface-container-lowest` (#000000) - Used for the sidebar to "ground" the app.
- **Content Cards:** `surface-container-high` (#1f1f22) - For interactive modules or music tables.
- **Floating Overlays:** `surface-container-highest` (#262528) - For context menus and tooltips.

### The "Glass & Gradient" Rule
To elevate the "high-end tool" aesthetic, use Glassmorphism for floating elements (like the music player bar). Use a 20px `backdrop-blur` with a semi-transparent `surface-container-highest`. 
**Signature Textures:** Main CTAs (like "Start Session") must use a linear gradient from `primary` (#ba9eff) to `primary-dim` (#8455ef) at a 135-degree angle.

---

## 3. Typography: The Editorial Edge
We pair **Manrope** (Display/Headlines) for an authoritative, geometric feel with **Inter** (Body/Labels) for maximum legibility in data-rich environments.

- **Display (Manrope):** Use `display-md` for artist names in hero sections. The tight kerning conveys a premium, "poster-like" quality.
- **Headlines (Manrope):** `headline-sm` is used for section headers (e.g., "Connected Peers").
- **Data (Inter):** All music tables and track metadata use `body-sm` or `label-md`. 
- **Hierarchy Logic:** Use `on-surface-variant` (#acaaad) for secondary metadata (Duration, Album Name) to ensure the primary track title (`on-surface`) commands the most attention.

---

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering**—the "stacking" of colors—rather than drop shadows.

- **The Layering Principle:** Place a `surface-container-low` track row on a `surface` background to create a soft, natural lift.
- **Ambient Shadows:** For floating modals, use an extra-diffused shadow: `offset: 0 12px, blur: 40px, color: rgba(0, 0, 0, 0.4)`. Never use pure black shadows; they should feel like a dark glow.
- **The "Ghost Border" Fallback:** If a separation is strictly required for accessibility, use the `outline-variant` token at **15% opacity**. 100% opaque borders are strictly forbidden as they clutter the "Resilient" aesthetic.

---

## 5. Components & UI Patterns

### Music Tables (Data-Rich)
*   **Structure:** No vertical or horizontal lines. Use `spacing-4` (0.9rem) for row padding. 
*   **State:** On hover, the row background shifts from `surface` to `surface-container-high`.
*   **Typography:** Track numbers use `label-sm` in `outline` color for a technical, "instrument" feel.

### Sidebar (The Anchor)
*   **Color:** `surface-container-lowest` (#000000).
*   **Active State:** The active nav item uses a `primary` glow—a 2px vertical pill on the far left and the text color shifting to `primary`.

### P2P Status Indicators
*   **Connected Peers:** Use a small circular avatar with a 2px `secondary` (Electric Violet) "ring" to indicate an active sync.
*   **Sync Status:** A micro-progress bar using `secondary-container` as the track and `secondary` as the fill. No borders.

### Collaborative Threads & Reactions
*   **Comment Bubbles:** Use `surface-container-low`. Overlapping avatars in a thread should have a 2px `surface` "stroke" to separate them, creating a layered, physical look.
*   **Reactions:** Use `surface-variant` chips with `rounded-full`. When active, the background becomes `primary-container` with `on-primary-container` text.

### Form Elements (Session Config)
*   **Inputs:** Forgo the 4-sided box. Use a `surface-container-high` background with a `rounded-md` (0.375rem) and a 2px bottom-only highlight in `outline-variant` that transforms to `primary` on focus.
*   **Checkboxes:** Custom square with `rounded-sm`. Checked state: `primary` background with `on-primary` icon.

---

## 6. Do’s and Don’ts

### Do
*   **DO** use whitespace (`spacing-8` and `spacing-10`) to separate major functional blocks.
*   **DO** use `secondary` (#53ddfc) for "system-level" feedback like sync status and peer connectivity.
*   **DO** ensure all text on `primary` surfaces uses `on-primary` (#39008c) for high-contrast accessibility.
*   **DO** use `rounded-xl` (0.75rem) for main content containers to soften the "industrial" feel.

### Don't
*   **DON'T** use 1px dividers to separate songs in a list. Use vertical rhythm and background tints.
*   **DON'T** use pure white (#ffffff). Use `on-surface` (#f6f3f5) for a sophisticated, slightly "off-white" look that is easier on the eyes in dark mode.
*   **DON'T** use standard system scrolls. Use a custom, thin scrollbar in `surface-variant` to maintain the "high-end tool" aesthetic.
*   **DON'T** use high-saturation reds for errors. Use the sophisticated `error_dim` (#d73357) to keep the palette grounded.

---

## Related Concepts

- [[Theme-System]] — the live theming implementation
- [[05 notes/pure_void/DESIGN|pure_void theme design]]
- [[05 notes/solar_resignation/DESIGN|solar_resignation theme design]]
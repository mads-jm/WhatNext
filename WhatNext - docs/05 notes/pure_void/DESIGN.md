---
tags:
  - ux/theming
  - ux/ui/design-system
---

# Design System Strategy: Pure Void OLED

## 1. Overview & Creative North Star
The Creative North Star for this system is **"The Luminous Void."** 

Moving beyond a standard "Dark Mode," this system treats the screen not as a backlit canvas, but as an infinite, empty space where information is manifested through light and energy. By utilizing `#000000` (Surface Lowest), we achieve absolute black, allowing the OLED hardware to physically power off pixels. This creates a signature "floating" aesthetic where high-intensity neon accents—Primary (#BA9EFF) and Secondary (#53DDFC)—pierce the darkness with clinical precision.

The design breaks the "template" look by avoiding rigid grids in favor of **intentional asymmetry**. Layouts should feel like a high-end editorial spread: generous use of `spacing-20` (5rem) for breathing room, overlapping typography, and components that bleed into the "void" rather than being trapped in boxes.

---

## 2. Colors & Surface Philosophy
The palette is built on extreme contrast. The goal is maximum energy efficiency without sacrificing the "soul" of the interface.

*   **Primary (Neon Purple - #BA9EFF):** Reserved for high-priority actions and brand moments.
*   **Secondary (Cyan - #53DDFC):** Used for utility, data visualization, and secondary interactions.
*   **The "No-Line" Rule:** 1px solid borders are strictly prohibited for sectioning. Boundaries must be defined solely through background shifts. For example, a `surface-container-low` (#131313) card sits directly on the `surface-container-lowest` (#000000) background. 
*   **Surface Hierarchy & Nesting:**
    *   **Base:** `surface-container-lowest` (#000000) for the primary viewport.
    *   **Elevated Tier 1:** `surface-container` (#191919) for persistent sidebars or navigation.
    *   **Elevated Tier 2:** `surface-container-high` (#1f1f1f) for modal content or cards.
*   **The "Glass & Gradient" Rule:** To avoid a flat, "cheap" feel, use Glassmorphism on floating elements. Apply a 12px-20px `backdrop-blur` with `surface-variant` at 40% opacity. For CTAs, use a subtle linear gradient from `primary` (#BA9EFF) to `primary-container` (#AC91F1) to add depth.

---

## 3. Typography: Editorial Manrope
Manrope is treated as a structural element. In the "Void," typography must be authoritative and legible.

*   **Display (3.5rem - 2.25rem):** Use `display-lg` for impactful messaging. Tighten letter-spacing by -2% to create a dense, premium "editorial" feel.
*   **Headlines & Titles (2rem - 1rem):** Used for section headers. Ensure `on-surface` (#FFFFFF) is used to maintain a 21:1 contrast ratio against the black background.
*   **Body & Labels (1rem - 0.6875rem):** For long-form text, use `body-md` with `on-surface-variant` (#ABABAB) to reduce eye strain during deep-night sessions. 
*   **Hierarchy Note:** Use `title-sm` in all-caps with 0.1rem tracking for "Label" status to differentiate from standard body text.

---

## 4. Elevation & Depth: Tonal Layering
In a true black environment, shadows are invisible. We define depth through light and opacity, not darkness.

*   **The Layering Principle:** Stacking is the primary tool for hierarchy. A `surface-container-highest` (#262626) element should feel "closest" to the user, while `#000000` feels infinite and distant.
*   **Ambient Glow:** When a "floating" effect is required for a CTA, replace the shadow with an **Ambient Glow**. Use a 20px blur of the `primary` color at 15% opacity behind the element.
*   **The "Ghost Border" Fallback:** For accessibility in complex forms, use the `outline-variant` (#484848) at 20% opacity. Never use 100% opaque lines.
*   **Interactive Glass:** For high-end surfaces, use a 1px inner stroke (the "Light Wrap") using `on-surface` at 10% opacity to define the edge of a container without creating a hard border.

---

## 5. Components

### Buttons
*   **Primary:** Filled with `primary` (#BA9EFF), text in `on-primary` (#371975). Rounded to `DEFAULT` (1rem).
*   **Secondary:** Ghost style. No fill, `Ghost Border` (outline-variant @ 20%), text in `secondary` (#53DDFC).
*   **State:** On hover, primary buttons should "glow"—add a soft outer glow using the `primary` token.

### Input Fields
*   **Container:** Use `surface-container-low` (#131313) with a `DEFAULT` (1rem) corner radius.
*   **Interaction:** On focus, the border-less container transitions to a 1px "Ghost Border" of `primary` and the label shifts to `primary` color.
*   **Error:** Use `error` (#FF6E84) text only. No red boxes.

### Cards & Lists
*   **Rule:** Forbid divider lines.
*   **Implementation:** Separate list items using `spacing-4` (1rem) of vertical white space. For cards, use a background shift to `surface-container` (#191919) against the `surface-container-lowest` (#000000) backdrop.

### Progress Indicators
*   Use a dual-tone gradient from `secondary` (#53DDFC) to `primary` (#BA9EFF). This creates a "charging neon" effect that feels alive against the black.

---

## 6. Do's and Don'ts

### Do:
*   **DO** use true black (#000000) for at least 80% of the screen real estate to maximize OLED battery savings.
*   **DO** use `spacing-16` (4rem) and `spacing-20` (5rem) to create asymmetric compositions that feel custom-designed.
*   **DO** use `secondary` (#53DDFC) for interactive elements that are not the main call to action.

### Don't:
*   **DON'T** use 1px solid dividers (hex #484848 or #757575) to separate content. Use space or tonal shifts.
*   **DON'T** use pure white text for long-form body copy; use `on-surface-variant` (#ABABAB) to prevent "haloing" or visual fatigue.
*   **DON'T** use sharp 90-degree corners. Everything must adhere to the `ROUND_FOUR` scale to soften the high-contrast intensity.

---

### Director's Closing Note
This system is about the **energy of light**. Every element should feel like it was placed with surgical intent into a digital void. If the layout feels cluttered, delete a container and let the typography breathe. The void is your most powerful asset—don't fill it unless you have to.

---

## Related Concepts

- [[Theme-System]] — the live theming implementation
- [[05 notes/resilient_nocturne/DESIGN|resilient_nocturne theme design]]
- [[05 notes/solar_resignation/DESIGN|solar_resignation theme design]]
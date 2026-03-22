import type { ThemeDefinition } from './theme-types';

/**
 * Applies a ThemeDefinition to the document by setting CSS custom properties on :root.
 * Tailwind's @theme block references these --wn-* vars, so every utility class
 * (bg-primary, text-on-surface, etc.) updates instantly.
 */
export function applyTheme(theme: ThemeDefinition): void {
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

    // Dark/light mode class
    root.classList.toggle('dark', theme.mode === 'dark');
    root.classList.toggle('light', theme.mode === 'light');

    // Body font
    document.body.style.fontFamily = theme.typography.fontBody;
}

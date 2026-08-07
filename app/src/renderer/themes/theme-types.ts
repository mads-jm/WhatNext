/**
 * Theme system type definitions.
 * Every ThemeDefinition is a complete, self-contained set of design tokens
 * that can be applied at runtime via CSS custom properties.
 */

export interface ThemeColors {
    surface: string;
    'surface-lowest': string;
    'surface-high': string;
    'surface-highest': string;
    primary: string;
    'primary-dim': string;
    'on-primary': string;
    secondary: string;
    tertiary: string;
    'on-surface': string;
    'on-surface-variant': string;
    'outline-variant': string;
    error: string;
}

export interface ThemeTypography {
    fontBody: string;
    fontHeadline: string;
    fontMono: string;
}

export interface ThemeRadii {
    sm: string;
    DEFAULT: string;
    lg: string;
    xl: string;
    '2xl': string;
}

export interface ThemeEffects {
    useBorders: boolean;
    cardShadow: string;
    toolbarBlur: string;
}

export interface ThemeDefinition {
    id: string;
    name: string;
    description: string;
    builtIn: boolean;
    mode: 'dark' | 'light';
    version: 1;
    colors: ThemeColors;
    typography: ThemeTypography;
    radii: ThemeRadii;
    effects: ThemeEffects;
}

/** Serializable format for export/import/P2P sharing */
export interface ThemeExport {
    $schema: 'whatnext-theme-v1';
    theme: Omit<ThemeDefinition, 'builtIn'>;
    exportedAt: string;
    exportedBy?: string;
}

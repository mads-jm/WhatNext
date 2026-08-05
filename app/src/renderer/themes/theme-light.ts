import type { ThemeDefinition } from './theme-types';

export const lightTheme: ThemeDefinition = {
    id: 'light',
    name: 'Solar Resignation',
    description: 'Warm light theme for bright environments',
    builtIn: true,
    mode: 'light',
    version: 1,
    colors: {
        surface: '#fbf8fa',
        'surface-lowest': '#ffffff',
        'surface-high': '#f6f3f5',
        'surface-highest': '#e4e2e4',
        primary: '#4800b2',
        'primary-dim': '#6200ee',
        'on-primary': '#ffffff',
        secondary: '#006a6a',
        tertiary: '#504f79',
        'on-surface': '#1b1b1d',
        'on-surface-variant': '#48474a',
        'outline-variant': '#c8c5ca',
        error: '#ba1a1a',
    },
    typography: {
        fontBody: "'Manrope', sans-serif",
        fontHeadline: "'Manrope', sans-serif",
        fontMono: "'JetBrains Mono', monospace",
    },
    radii: {
        sm: '0.125rem',
        DEFAULT: '0.1875rem',
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.75rem',
    },
    effects: {
        useBorders: true,
        cardShadow: '0 1px 40px rgba(0, 0, 0, 0.06)',
        toolbarBlur: 'blur(8px)',
    },
};

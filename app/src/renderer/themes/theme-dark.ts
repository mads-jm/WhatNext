import type { ThemeDefinition } from './theme-types';

export const darkTheme: ThemeDefinition = {
    id: 'dark',
    name: 'Resilient Nocturne',
    description: 'Warm dark theme with balanced contrast',
    builtIn: true,
    mode: 'dark',
    version: 1,
    colors: {
        'surface': '#0e0e10',
        'surface-lowest': '#000000',
        'surface-high': '#1f1f22',
        'surface-highest': '#262528',
        'primary': '#ba9eff',
        'primary-dim': '#8455ef',
        'on-primary': '#39008c',
        'secondary': '#53ddfc',
        'tertiary': '#ff97b8',
        'on-surface': '#f6f3f5',
        'on-surface-variant': '#acaaad',
        'outline-variant': '#48474a',
        'error': '#d73357',
    },
    typography: {
        fontBody: "'Inter', sans-serif",
        fontHeadline: "'Manrope', sans-serif",
        fontMono: "'JetBrains Mono', monospace",
    },
    radii: {
        'sm': '0.125rem',
        'DEFAULT': '0.25rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        '2xl': '1rem',
    },
    effects: {
        useBorders: false,
        cardShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        toolbarBlur: 'blur(8px)',
    },
};

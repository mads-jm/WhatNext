import type { ThemeDefinition } from './theme-types';

export const oledTheme: ThemeDefinition = {
    id: 'oled',
    name: 'Pure Void',
    description: 'OLED-optimized true black theme',
    builtIn: true,
    mode: 'dark',
    version: 1,
    colors: {
        surface: '#000000',
        'surface-lowest': '#000000',
        'surface-high': '#191919',
        'surface-highest': '#262626',
        primary: '#ba9eff',
        'primary-dim': '#ac91f1',
        'on-primary': '#371975',
        secondary: '#53ddfc',
        tertiary: '#ff97b8',
        'on-surface': '#ffffff',
        'on-surface-variant': '#ababab',
        'outline-variant': '#484848',
        error: '#ff6e84',
    },
    typography: {
        fontBody: "'Manrope', sans-serif",
        fontHeadline: "'Manrope', sans-serif",
        fontMono: "'JetBrains Mono', monospace",
    },
    radii: {
        sm: '0.25rem',
        DEFAULT: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem',
    },
    effects: {
        useBorders: false,
        cardShadow: '0 0 20px rgba(186, 158, 255, 0.04)',
        toolbarBlur: 'blur(12px)',
    },
};

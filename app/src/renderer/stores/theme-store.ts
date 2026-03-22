import { create } from 'zustand';
import type { ThemeDefinition, ThemeExport } from '../themes/theme-types';
import { builtInThemes } from '../themes/built-in-themes';
import { applyTheme } from '../themes/theme-applicator';

const ACTIVE_THEME_KEY = 'whatnext:activeThemeId';
const CUSTOM_THEMES_KEY = 'whatnext:customThemes';

function loadCustomThemes(): ThemeDefinition[] {
    try {
        const stored = localStorage.getItem(CUSTOM_THEMES_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function saveCustomThemes(themes: ThemeDefinition[]): void {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
}

interface ThemeStore {
    activeThemeId: string;
    themes: ThemeDefinition[];

    initialize: () => void;
    setTheme: (themeId: string) => void;
    getActiveTheme: () => ThemeDefinition;

    addCustomTheme: (theme: ThemeDefinition) => void;
    updateCustomTheme: (themeId: string, updates: Partial<ThemeDefinition>) => void;
    deleteCustomTheme: (themeId: string) => void;

    exportTheme: (themeId: string) => string;
    importTheme: (json: string) => { success: boolean; error?: string };
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
    activeThemeId: 'dark',
    themes: [...builtInThemes],

    initialize: () => {
        const customThemes = loadCustomThemes();
        const allThemes: ThemeDefinition[] = [...builtInThemes, ...customThemes];
        const savedId = localStorage.getItem(ACTIVE_THEME_KEY) || 'dark';
        const activeId = allThemes.find((t) => t.id === savedId) ? savedId : 'dark';

        set({ themes: allThemes, activeThemeId: activeId });

        const theme = allThemes.find((t) => t.id === activeId)!;
        applyTheme(theme);
    },

    setTheme: (themeId) => {
        const theme = get().themes.find((t) => t.id === themeId);
        if (!theme) return;

        localStorage.setItem(ACTIVE_THEME_KEY, themeId);
        set({ activeThemeId: themeId });
        applyTheme(theme);
    },

    getActiveTheme: () => {
        const { themes, activeThemeId } = get();
        return themes.find((t) => t.id === activeThemeId) ?? builtInThemes[1]; // fallback: dark
    },

    addCustomTheme: (theme) => {
        const customs = get().themes.filter((t) => !t.builtIn);
        const updated = [...customs, { ...theme, builtIn: false }];
        saveCustomThemes(updated);
        set({ themes: [...builtInThemes, ...updated] });
    },

    updateCustomTheme: (themeId, updates) => {
        const allThemes = get().themes.map((t) =>
            t.id === themeId && !t.builtIn ? { ...t, ...updates } : t,
        );
        saveCustomThemes(allThemes.filter((t) => !t.builtIn));
        set({ themes: allThemes });

        if (get().activeThemeId === themeId) {
            applyTheme(allThemes.find((t) => t.id === themeId)!);
        }
    },

    deleteCustomTheme: (themeId) => {
        const allThemes = get().themes.filter((t) => t.id !== themeId || t.builtIn);
        saveCustomThemes(allThemes.filter((t) => !t.builtIn));
        set({ themes: allThemes });

        if (get().activeThemeId === themeId) {
            get().setTheme('dark');
        }
    },

    exportTheme: (themeId) => {
        const theme = get().themes.find((t) => t.id === themeId);
        if (!theme) return '';
        const { builtIn: _, ...exportable } = theme;
        const exportObj: ThemeExport = {
            $schema: 'whatnext-theme-v1',
            theme: exportable,
            exportedAt: new Date().toISOString(),
        };
        return JSON.stringify(exportObj, null, 2);
    },

    importTheme: (json) => {
        try {
            const parsed = JSON.parse(json);
            if (parsed.$schema !== 'whatnext-theme-v1') {
                return { success: false, error: 'Invalid theme format' };
            }
            const theme: ThemeDefinition = { ...parsed.theme, builtIn: false };
            if (get().themes.some((t) => t.id === theme.id)) {
                theme.id = `${theme.id}-${Date.now()}`;
                theme.name = `${theme.name} (imported)`;
            }
            get().addCustomTheme(theme);
            return { success: true };
        } catch {
            return { success: false, error: 'Invalid JSON' };
        }
    },
}));

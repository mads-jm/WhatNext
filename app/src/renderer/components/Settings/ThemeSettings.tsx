/**
 * ThemeSettings — theme picker with color swatch previews.
 * Allows switching between built-in and custom themes, plus import/export.
 */

import { useState } from 'react';
import { useThemeStore } from '../../stores/theme-store';
import type { ThemeDefinition } from '../../themes/theme-types';

function ThemeCard({
    theme,
    isActive,
    onSelect,
    onExport,
    onDelete,
}: {
    theme: ThemeDefinition;
    isActive: boolean;
    onSelect: () => void;
    onExport: () => void;
    onDelete?: () => void;
}) {
    const colors = theme.colors;
    const swatches = [
        colors.surface,
        colors.primary,
        colors.secondary,
        colors['on-surface'],
        colors['surface-high'],
        colors.error,
    ];

    return (
        <button
            onClick={onSelect}
            className={`card text-left p-4 transition-colors ${
                isActive
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-outline-variant'
            }`}
        >
            {/* Color swatches */}
            <div className="flex gap-1.5 mb-3">
                {swatches.map((color) => (
                    <div
                        key={color}
                        className="w-6 h-6 rounded-full border border-outline-variant/20"
                        style={{ backgroundColor: color }}
                    />
                ))}
            </div>

            {/* Theme name + description */}
            <div className="font-headline font-bold text-on-surface text-sm">
                {theme.name}
            </div>
            <div className="text-xs text-on-surface-variant mt-0.5">
                {theme.description}
            </div>
            <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-high text-on-surface-variant">
                    {theme.mode}
                </span>
                {isActive && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                        Active
                    </span>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-outline-variant/10">
                <button
                    onClick={(e) => { e.stopPropagation(); onExport(); }}
                    className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
                    title="Export theme"
                >
                    <i className="fa-solid fa-download mr-1" />
                    Export
                </button>
                {onDelete && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="text-xs text-on-surface-variant hover:text-error transition-colors ml-auto"
                        title="Delete theme"
                    >
                        <i className="fa-solid fa-trash mr-1" />
                        Delete
                    </button>
                )}
            </div>
        </button>
    );
}

export function ThemeSettings() {
    const themes = useThemeStore((s) => s.themes);
    const activeThemeId = useThemeStore((s) => s.activeThemeId);
    const setTheme = useThemeStore((s) => s.setTheme);
    const exportTheme = useThemeStore((s) => s.exportTheme);
    const importTheme = useThemeStore((s) => s.importTheme);
    const deleteCustomTheme = useThemeStore((s) => s.deleteCustomTheme);

    const [importError, setImportError] = useState<string | null>(null);

    const handleExport = async (themeId: string) => {
        const json = exportTheme(themeId);
        if (!json) return;

        const theme = themes.find((t) => t.id === themeId);
        const filename = `whatnext-theme-${theme?.id ?? 'custom'}.json`;

        const result = await window.electron?.dialog.saveFile({
            title: 'Export Theme',
            defaultPath: filename,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result?.filePath) {
            await window.electron?.file.write(result.filePath, json);
        }
    };

    const handleImport = async () => {
        setImportError(null);
        const result = await window.electron?.dialog.openFile({
            title: 'Import Theme',
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!result?.filePaths?.[0]) return;

        try {
            const response = await fetch(`file://${result.filePaths[0]}`);
            const json = await response.text();
            const importResult = importTheme(json);
            if (!importResult.success) {
                setImportError(importResult.error ?? 'Import failed');
            }
        } catch {
            setImportError('Could not read file');
        }
    };

    const builtIn = themes.filter((t) => t.builtIn);
    const custom = themes.filter((t) => !t.builtIn);

    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h2 className="text-lg font-headline font-bold text-on-surface mb-1">
                    Appearance
                </h2>
                <p className="text-sm text-on-surface-variant">
                    Choose a theme or import a custom one. Themes can be exported and shared with peers.
                </p>
            </div>

            {/* Built-in themes */}
            <div>
                <h3 className="text-sm font-medium text-on-surface-variant mb-3">
                    Built-in Themes
                </h3>
                <div className="grid grid-cols-3 gap-3">
                    {builtIn.map((theme) => (
                        <ThemeCard
                            key={theme.id}
                            theme={theme}
                            isActive={theme.id === activeThemeId}
                            onSelect={() => setTheme(theme.id)}
                            onExport={() => handleExport(theme.id)}
                        />
                    ))}
                </div>
            </div>

            {/* Custom themes */}
            {custom.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-on-surface-variant mb-3">
                        Custom Themes
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                        {custom.map((theme) => (
                            <ThemeCard
                                key={theme.id}
                                theme={theme}
                                isActive={theme.id === activeThemeId}
                                onSelect={() => setTheme(theme.id)}
                                onExport={() => handleExport(theme.id)}
                                onDelete={() => deleteCustomTheme(theme.id)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Import */}
            <div className="flex items-center gap-3">
                <button onClick={handleImport} className="btn-ghost">
                    <i className="fa-solid fa-file-import mr-1" />
                    Import Theme
                </button>
                {importError && (
                    <span className="text-xs text-error">{importError}</span>
                )}
            </div>
        </div>
    );
}

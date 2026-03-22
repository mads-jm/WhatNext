/**
 * StorageSettings — Shows current storage paths with "Open in Explorer" buttons.
 * Allows setting a default export directory.
 */

import { useState, useEffect } from 'react';

const EXPORT_DIR_KEY = 'whatnext:defaultExportDir';

export function StorageSettings() {
    const [userDataPath, setUserDataPath] = useState<string>('');
    const [artworkPath, setArtworkPath] = useState<string>('');
    const [defaultExportDir, setDefaultExportDir] = useState<string>(
        () => localStorage.getItem(EXPORT_DIR_KEY) || ''
    );

    useEffect(() => {
        window.electron?.app?.getPath('userData').then((p: string) => {
            setUserDataPath(p);
        });
        window.electron?.app?.getPath('documents').then((p: string) => {
            setArtworkPath(`${p}\\WhatNext\\artwork`);
        });
    }, []);

    const openPath = async (dirPath: string) => {
        if (dirPath) {
            await window.electron?.shell.openPath(dirPath);
        }
    };

    const pickExportDir = async () => {
        const result = await window.electron?.dialog.openDirectory?.();
        if (result && !result.canceled && result.filePaths?.[0]) {
            localStorage.setItem(EXPORT_DIR_KEY, result.filePaths[0]);
            setDefaultExportDir(result.filePaths[0]);
        }
    };

    const clearExportDir = () => {
        localStorage.removeItem(EXPORT_DIR_KEY);
        setDefaultExportDir('');
    };

    return (
        <div className="p-6 max-w-2xl space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-on-surface mb-1">Storage</h2>
                <p className="text-sm text-on-surface-variant">
                    Where WhatNext stores your data. All data stays on your machine.
                </p>
            </div>

            {/* Database */}
            <div className="bg-surface-high rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-medium text-on-surface">Database</h3>
                        <p className="text-xs text-on-surface-variant">RxDB / IndexedDB data and app configuration</p>
                    </div>
                    <button
                        onClick={() => openPath(userDataPath)}
                        disabled={!userDataPath}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-high hover:bg-outline-variant disabled:opacity-50 text-on-surface text-xs rounded-md transition-colors"
                    >
                        <i className="fa-solid fa-folder-open" />
                        Open in Explorer
                    </button>
                </div>
                <div className="bg-surface rounded px-3 py-2 text-xs font-mono text-on-surface-variant break-all">
                    {userDataPath || 'Loading...'}
                </div>
            </div>

            {/* Artwork Cache */}
            <div className="bg-surface-high rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-medium text-on-surface">Artwork Cache</h3>
                        <p className="text-xs text-on-surface-variant">Locally cached album and playlist artwork</p>
                    </div>
                    <button
                        onClick={() => openPath(artworkPath)}
                        disabled={!artworkPath}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-high hover:bg-outline-variant disabled:opacity-50 text-on-surface text-xs rounded-md transition-colors"
                    >
                        <i className="fa-solid fa-folder-open" />
                        Open in Explorer
                    </button>
                </div>
                <div className="bg-surface rounded px-3 py-2 text-xs font-mono text-on-surface-variant break-all">
                    {artworkPath || 'Loading...'}
                </div>
            </div>

            {/* Default Export Directory */}
            <div className="bg-surface-high rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-medium text-on-surface">Default Export Directory</h3>
                        <p className="text-xs text-on-surface-variant">
                            {defaultExportDir
                                ? 'Save dialogs will open to this directory'
                                : 'Not set — save dialogs use system default'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {defaultExportDir && (
                            <>
                                <button
                                    onClick={() => openPath(defaultExportDir)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-high hover:bg-outline-variant text-on-surface text-xs rounded-md transition-colors"
                                >
                                    <i className="fa-solid fa-folder-open" />
                                    Open
                                </button>
                                <button
                                    onClick={clearExportDir}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-high hover:bg-error/10 text-on-surface hover:text-error text-xs rounded-md transition-colors"
                                >
                                    <i className="fa-solid fa-xmark" />
                                    Clear
                                </button>
                            </>
                        )}
                        <button
                            onClick={pickExportDir}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-dim text-surface text-xs rounded-md transition-colors"
                        >
                            <i className="fa-solid fa-folder-plus" />
                            {defaultExportDir ? 'Change' : 'Set Directory'}
                        </button>
                    </div>
                </div>
                {defaultExportDir && (
                    <div className="bg-surface rounded px-3 py-2 text-xs font-mono text-on-surface-variant break-all">
                        {defaultExportDir}
                    </div>
                )}
            </div>
        </div>
    );
}

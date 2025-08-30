/*
This is our frontend, running in a sandboxed Chromium environment.
Use the preload API (window.electron) to communicate with main.
*/

import { useEffect, useState } from 'react';

function App() {
    const [version, setVersion] = useState('');

    useEffect(() => {
        // Uses ipcMain.handle('app:get-version') from main process
        window.electron?.ipcRenderer
            .invoke<string>('app:get-version')
            .then(setVersion)
            .catch(() => {
                setVersion('unknown');
            });
    }, []);

    return (
        <div>
            <h1>WhatNext</h1>
            <p>Version: {version}</p>
        </div>
    );
}

export default App;

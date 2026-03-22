/**
 * Shared debug log store — ring buffer of 50 entries.
 * Used by P2P status, Dev Dashboard debug console, and any future debug UI.
 */

import { create } from 'zustand';

export interface LogEntry {
    id: number;
    time: string;
    level: string;
    message: string;
}

let logIdCounter = 0;

interface DebugLogStore {
    logs: LogEntry[];
    addLog: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
}

export const useDebugLogStore = create<DebugLogStore>((set) => ({
    logs: [],
    addLog: (level, message) => {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const id = ++logIdCounter;
        set((state) => ({
            logs: [...state.logs.slice(-49), { id, time, level, message }],
        }));
        console.log(`[P2P UI ${time}] [${level.toUpperCase()}] ${message}`);
    },
}));

import { app } from 'electron';

/**
 * Environment switches for main process.
 * - isDev: Prefer NODE_ENV plus Electron's packaging flag.
 *   This makes dev/prod detection resilient across scripts and packaging.
 */
export const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
export const isTest = process.env.NODE_ENV === 'test';

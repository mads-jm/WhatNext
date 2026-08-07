/**
 * Download disclaimer acknowledgment state.
 *
 * Lives outside DownloadDisclaimerModal.tsx so that module exports a component
 * and nothing else — mixing value exports with component exports breaks Vite's
 * Fast Refresh for the whole module (react-refresh/only-export-components).
 *
 * Persisted to localStorage, so the modal appears once per installation.
 */

const DISCLAIMER_KEY = 'whatnext:download-disclaimer-v1';

export function hasAcceptedDisclaimer(): boolean {
    return localStorage.getItem(DISCLAIMER_KEY) === 'accepted';
}

export function acceptDisclaimer(): void {
    localStorage.setItem(DISCLAIMER_KEY, 'accepted');
}

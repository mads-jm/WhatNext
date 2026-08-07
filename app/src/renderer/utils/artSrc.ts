/**
 * Build a renderer-safe src URL for local artwork files.
 * Electron's sandbox blocks file:// in the renderer — wn-art:// is a custom
 * protocol registered in main that reads the file directly via fs.
 * Path is passed as a query param to avoid Chromium mangling Windows paths in URL segments.
 */
export function artSrc(
    localPath?: string,
    remoteUrl?: string,
): string | undefined {
    if (localPath) {
        return `wn-art://local?path=${encodeURIComponent(localPath)}`;
    }
    return remoteUrl;
}

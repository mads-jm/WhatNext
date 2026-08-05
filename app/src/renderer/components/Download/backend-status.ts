/**
 * Pure interpretation of a backend's install status for the Download UI.
 *
 * Extracted so the "not installed" vs "installed at a custom path" vs
 * "configured path is wrong" distinction (#46) can be unit-tested without a DOM —
 * the renderer test environment is `node`, with no jsdom.
 */
import type { BackendStatusResult } from '../../../shared/core/ipc-protocol';

export type BackendState =
    /** Found via PATH, no custom path configured. */
    | 'installed-default'
    /** Found at a user-configured custom path. */
    | 'installed-custom'
    /** A custom path is configured but the binary there did not run. */
    | 'misconfigured'
    /** Not found and no custom path configured. */
    | 'missing';

export interface BackendStatusView {
    state: BackendState;
    installed: boolean;
    /** The configured custom path, if any. */
    path?: string;
    version?: string;
    error?: string;
}

export function describeBackendStatus(
    status: BackendStatusResult,
): BackendStatusView {
    const hasPath =
        typeof status.path === 'string' && status.path.trim().length > 0;
    let state: BackendState;
    if (status.installed) {
        state = hasPath ? 'installed-custom' : 'installed-default';
    } else {
        state = hasPath ? 'misconfigured' : 'missing';
    }
    return {
        state,
        installed: status.installed,
        path: hasPath ? status.path : undefined,
        version: status.version,
        error: status.error,
    };
}

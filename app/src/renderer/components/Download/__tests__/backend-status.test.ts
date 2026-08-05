import { describe, it, expect } from 'vitest';
import { describeBackendStatus } from '../backend-status';
import type { BackendStatusResult } from '../../../../shared/core/ipc-protocol';

function status(p: Partial<BackendStatusResult>): BackendStatusResult {
    return { id: 'ytdlp', name: 'yt-dlp', installed: false, ...p };
}

describe('describeBackendStatus', () => {
    it('installed via PATH (no custom path) -> installed-default', () => {
        const v = describeBackendStatus(
            status({ installed: true, version: '2024.08.06' }),
        );
        expect(v.state).toBe('installed-default');
        expect(v.path).toBeUndefined();
        expect(v.version).toBe('2024.08.06');
    });

    it('installed at a configured path -> installed-custom', () => {
        const v = describeBackendStatus(
            status({ installed: true, path: '/opt/bin/yt-dlp' }),
        );
        expect(v.state).toBe('installed-custom');
        expect(v.path).toBe('/opt/bin/yt-dlp');
    });

    it('not installed with a configured path -> misconfigured', () => {
        const v = describeBackendStatus(
            status({ installed: false, path: '/bad/path', error: 'ENOENT' }),
        );
        expect(v.state).toBe('misconfigured');
        expect(v.path).toBe('/bad/path');
        expect(v.error).toBe('ENOENT');
    });

    it('not installed, no path -> missing', () => {
        expect(describeBackendStatus(status({ installed: false })).state).toBe(
            'missing',
        );
    });

    it('treats a blank/whitespace path as no path', () => {
        expect(
            describeBackendStatus(status({ installed: false, path: '   ' }))
                .state,
        ).toBe('missing');
        expect(
            describeBackendStatus(status({ installed: true, path: '' })).state,
        ).toBe('installed-default');
    });
});

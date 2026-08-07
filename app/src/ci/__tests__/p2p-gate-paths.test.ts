import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
    extractWorkflowPaths,
    globToRegExp,
    findUnmatchedGlobs,
    readWorkflowPaths,
} from '../../../../scripts/check-p2p-gate-paths.mjs';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/p2p-gate.yml');

/**
 * Tracked files, not files on disk: the gate governs what a PR can change, and
 * an untracked scratch file is not something a PR can change.
 */
const trackedFiles = execFileSync('git', ['ls-files'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
})
    .split('\n')
    .filter(Boolean);

describe('globToRegExp', () => {
    it('lets ** cross directory separators', () => {
        const pattern = globToRegExp('app/src/utility/**');
        expect(pattern.test('app/src/utility/p2p-service.ts')).toBe(true);
        expect(pattern.test('app/src/utility/protocols/handshake.ts')).toBe(
            true,
        );
        expect(pattern.test('app/src/renderer/index.tsx')).toBe(false);
    });

    it('stops a single * at the directory separator', () => {
        const pattern = globToRegExp('app/src/renderer/db/replication*.ts');
        expect(pattern.test('app/src/renderer/db/replication-handler.ts')).toBe(
            true,
        );
        expect(pattern.test('app/src/renderer/db/nested/replication.ts')).toBe(
            false,
        );
    });

    it('treats dots literally rather than as any-char', () => {
        const pattern = globToRegExp('app/src/shared/p2p-config.ts');
        expect(pattern.test('app/src/shared/p2p-config.ts')).toBe(true);
        expect(pattern.test('app/src/shared/p2p-configXts')).toBe(false);
    });
});

describe('extractWorkflowPaths', () => {
    it('reads the quoted list under a pull_request paths filter', () => {
        const yaml = [
            'on:',
            '  pull_request:',
            '    types: [opened]',
            '    paths:',
            "      - 'a/**'",
            '      - "b.ts"',
            '',
            'jobs:',
            '  warn:',
            '    runs-on: ubuntu-latest',
        ].join('\n');

        expect(extractWorkflowPaths(yaml)).toEqual(['a/**', 'b.ts']);
    });

    it('finds the real gate a non-empty list', () => {
        // A silently-empty parse would make the guard below vacuously true —
        // the same failure mode the guard exists to catch.
        expect(readWorkflowPaths(WORKFLOW).length).toBeGreaterThan(0);
    });
});

describe('the P2P protocol gate', () => {
    it('watches only paths that match at least one tracked file', () => {
        const globs = readWorkflowPaths(WORKFLOW);
        expect(findUnmatchedGlobs(globs, trackedFiles)).toEqual([]);
    });

    it('covers the protocol surface the Agentic Work Policy names', () => {
        expect(readWorkflowPaths(WORKFLOW)).toEqual([
            'app/src/utility/**',
            'app/src/renderer/db/replication*.ts',
            'app/src/shared/core/ipc-protocol.ts',
            'app/src/shared/lww/**',
            'app/src/shared/p2p-config.ts',
        ]);
    });

    it('would have failed on the stale paths it used to watch', () => {
        // Regression proof: these two are what the gate listed before, and they
        // are exactly what the check above must reject.
        expect(
            findUnmatchedGlobs(
                ['app/src/main/p2p/**', 'app/src/main/handshake.ts'],
                trackedFiles,
            ),
        ).toEqual(['app/src/main/p2p/**', 'app/src/main/handshake.ts']);
    });
});

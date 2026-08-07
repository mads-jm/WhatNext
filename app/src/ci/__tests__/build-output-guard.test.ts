import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    extractProductionLoadTarget,
    extractAssetRefs,
    checkBuildOutput,
} from '../../../../scripts/check-build-output.mjs';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MAIN_TS = path.join(REPO_ROOT, 'app/src/main/main.ts');
const mainTsSource = fs.readFileSync(MAIN_TS, 'utf8');

/**
 * The pre-fix source, verbatim, as the regression fixture. The bug was that
 * main.ts named a file the build has never emitted since the ERB->Vite move.
 */
const STALE_MAIN_TS = `
    if (isDev) {
        mainWindow.loadURL('http://localhost:1313');
    } else {
        mainWindow.loadFile(path.join(__dirname, 'index.ejs'));
    }
`;

let fixtureDir: string;

/** Build a throwaway dist/ so the checker can be pointed at real files. */
function makeDist(name: string, files: Record<string, string>) {
    const dir = path.join(fixtureDir, name);
    for (const [relative, contents] of Object.entries(files)) {
        const target = path.join(dir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents);
    }
    return dir;
}

const RELATIVE_HTML =
    '<html><head><script type="module" crossorigin src="./assets/index-abc.js"></script>' +
    '<link rel="stylesheet" crossorigin href="./assets/index-def.css"></head>' +
    '<body><div id="root"></div></body></html>';

const ABSOLUTE_HTML = RELATIVE_HTML.replace(/\.\/assets\//g, '/assets/');

beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-build-guard-'));
});

afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('extractProductionLoadTarget', () => {
    it('reads the live load target out of the real main.ts', () => {
        expect(extractProductionLoadTarget(mainTsSource)).toBe('index.html');
    });

    it('reads the stale target out of the pre-fix source', () => {
        expect(extractProductionLoadTarget(STALE_MAIN_TS)).toBe('index.ejs');
    });

    it('throws rather than passing when the call disappears', () => {
        // A guard that silently finds nothing is the defect class this repairs.
        expect(() =>
            extractProductionLoadTarget("mainWindow.loadURL('http://x')"),
        ).toThrow(/No `loadFile/);
    });

    it('throws when there is more than one candidate', () => {
        expect(() =>
            extractProductionLoadTarget(
                `${STALE_MAIN_TS}\nmainWindow.loadFile(path.join(__dirname, 'other.html'));`,
            ),
        ).toThrow(/found 2/);
    });
});

describe('extractAssetRefs', () => {
    it('collects local script and stylesheet refs', () => {
        expect(extractAssetRefs(RELATIVE_HTML)).toEqual([
            './assets/index-abc.js',
            './assets/index-def.css',
        ]);
    });

    it('skips refs that never touch the output directory', () => {
        const html =
            '<a href="#top">t</a><img src="data:image/png;base64,AA">' +
            '<script src="https://cdn.example/x.js"></script>' +
            '<script src="//cdn.example/y.js"></script>' +
            '<script src="./local.js"></script>';

        expect(extractAssetRefs(html)).toEqual(['./local.js']);
    });
});

describe('checkBuildOutput', () => {
    it('passes a build whose refs are relative and present', () => {
        const dist = makeDist('good', {
            'index.html': RELATIVE_HTML,
            'assets/index-abc.js': '// bundle',
            'assets/index-def.css': '/* styles */',
        });

        expect(
            checkBuildOutput({ mainTsSource, distDir: dist }).problems,
        ).toEqual([]);
    });

    it('fails when the load target is absent from the build output', () => {
        // #70 exactly: main.ts says index.ejs, vite emits index.html.
        const dist = makeDist('stale-target', {
            'index.html': RELATIVE_HTML,
            'assets/index-abc.js': '// bundle',
            'assets/index-def.css': '/* styles */',
        });

        const { problems } = checkBuildOutput({
            mainTsSource: STALE_MAIN_TS,
            distDir: dist,
        });

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/index\.ejs.*does not exist/s);
    });

    it('fails on root-absolute refs, which file:// resolves off the disk root', () => {
        const dist = makeDist('absolute', {
            'index.html': ABSOLUTE_HTML,
            'assets/index-abc.js': '// bundle',
            'assets/index-def.css': '/* styles */',
        });

        const { problems } = checkBuildOutput({ mainTsSource, distDir: dist });

        expect(problems).toHaveLength(2);
        expect(problems.every((p: string) => /root-absolute/.test(p))).toBe(
            true,
        );
    });

    it('fails when a relative ref points at nothing', () => {
        const dist = makeDist('dangling', {
            'index.html': RELATIVE_HTML,
            'assets/index-abc.js': '// bundle',
        });

        const { problems } = checkBuildOutput({ mainTsSource, distDir: dist });

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/index-def\.css.*does not exist/s);
    });

    it('fails when the entry references no bundle at all', () => {
        const dist = makeDist('empty', {
            'index.html': '<html><body><div id="root"></div></body></html>',
        });

        const { problems } = checkBuildOutput({ mainTsSource, distDir: dist });

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/references no local assets/);
    });
});

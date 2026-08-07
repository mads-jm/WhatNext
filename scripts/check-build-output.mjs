#!/usr/bin/env node
/**
 * Guard: the renderer entry that `main.ts` loads in production must exist in
 * the build output, and its asset references must resolve next to it.
 *
 * This exists because both halves of that statement were false at once: main.ts
 * loaded `index.ejs` (deleted in the ERB->Vite migration) and vite's default
 * base emitted root-absolute `/assets/...` refs, which resolve against the
 * filesystem root under `file://` rather than against `dist/`. Nothing in CI
 * built the app, so neither showed up until launch.
 *
 * Run after `npm run build` (see the "Build" job in .github/workflows/ci.yml):
 *
 *     node scripts/check-build-output.mjs [mainTsPath] [distDir]
 *
 * The pure helpers are exported and covered by
 * app/src/ci/__tests__/build-output-guard.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pull the production load target out of main.ts source.
 *
 * Matches the `mainWindow.loadFile(path.join(__dirname, '<file>'))` call in the
 * non-dev branch of createMainWindow. Throws unless there is exactly one — zero
 * means the call was renamed or restructured and this guard has gone blind;
 * more than one means "the" load target is no longer a single thing and the
 * guard needs a real decision rather than a guess.
 */
export function extractProductionLoadTarget(mainTsSource) {
    const pattern =
        /loadFile\(\s*path\.join\(\s*__dirname\s*,\s*['"`]([^'"`]+)['"`]\s*\)\s*\)/g;
    const targets = [...mainTsSource.matchAll(pattern)].map((m) => m[1]);

    if (targets.length === 0) {
        throw new Error(
            'No `loadFile(path.join(__dirname, ...))` call found in main.ts — ' +
                'the production load target moved, so this guard can no longer see it.',
        );
    }
    if (targets.length > 1) {
        throw new Error(
            `Expected exactly one production load target in main.ts, found ${targets.length}: ${targets.join(', ')}`,
        );
    }
    return targets[0];
}

/**
 * Collect the local asset references from an HTML document.
 *
 * Only same-document-relative candidates matter here: absolute URLs, protocol-
 * relative URLs, data URIs and fragments all resolve without touching the
 * output directory, so they are not this guard's business.
 */
export function extractAssetRefs(html) {
    const pattern =
        /(?:src|href)\s*=\s*"([^"]+)"|(?:src|href)\s*=\s*'([^']+)'/g;
    const refs = [...html.matchAll(pattern)].map((m) => m[1] ?? m[2]);

    return refs.filter(
        (ref) =>
            ref.length > 0 &&
            !ref.startsWith('#') &&
            !ref.startsWith('data:') &&
            !ref.startsWith('//') &&
            !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref),
    );
}

/**
 * Verify a build output directory against main.ts's production load target.
 *
 * Returns the list of problems; empty means the packaged window has something
 * real to render. Takes source text and a directory rather than reading either
 * itself, so the tests can drive it with fixtures.
 */
export function checkBuildOutput({ mainTsSource, distDir }) {
    const problems = [];
    const target = extractProductionLoadTarget(mainTsSource);
    const targetPath = path.join(distDir, target);

    if (!fs.existsSync(targetPath)) {
        problems.push(
            `main.ts loads "${target}" in production, but ${targetPath} does not exist in the build output.`,
        );
        return { target, refs: [], problems };
    }

    const html = fs.readFileSync(targetPath, 'utf8');
    const refs = extractAssetRefs(html);

    if (refs.length === 0) {
        problems.push(
            `"${target}" references no local assets — the renderer bundle is not wired into it.`,
        );
    }

    for (const ref of refs) {
        // Strip query/hash before touching the filesystem; vite does not emit
        // them today, but a ref like "./assets/x.js?v=1" is still a real file.
        const relative = ref.split(/[?#]/)[0];

        if (relative.startsWith('/')) {
            problems.push(
                `"${ref}" is root-absolute. Loaded over file://, it resolves against the ` +
                    'filesystem root instead of the build output — the window renders blank. ' +
                    "Set vite's `base` to './'.",
            );
            continue;
        }

        const resolved = path.resolve(path.dirname(targetPath), relative);
        if (!fs.existsSync(resolved)) {
            problems.push(
                `"${ref}" (referenced by ${target}) resolves to ${resolved}, which does not exist.`,
            );
        }
    }

    return { target, refs, problems };
}

function main() {
    const repoRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
    );
    const mainTsPath =
        process.argv[2] ?? path.join(repoRoot, 'app/src/main/main.ts');
    const distDir = process.argv[3] ?? path.join(repoRoot, 'app/dist');

    const { target, refs, problems } = checkBuildOutput({
        mainTsSource: fs.readFileSync(mainTsPath, 'utf8'),
        distDir,
    });

    if (problems.length > 0) {
        console.error('Build output check FAILED:\n');
        for (const problem of problems) console.error(`  - ${problem}`);
        process.exit(1);
    }

    console.log(
        `Build output OK: ${distDir}/${target} exists and all ${refs.length} asset ref(s) resolve relative to it.`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

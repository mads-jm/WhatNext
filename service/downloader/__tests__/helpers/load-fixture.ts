/**
 * Load recorded CLI-output fixtures from `../fixtures/`.
 * Uses `import.meta.url` so it resolves correctly under Vitest's ESM transform.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

function fixturePath(name: string): string {
    return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/** Read a fixture file as raw text. */
export function loadFixtureText(name: string): string {
    return readFileSync(fixturePath(name), 'utf8');
}

/**
 * Read a fixture file and split into lines exactly as the subprocess line
 * generator would emit them (trailing newline dropped, no empty final entry).
 */
export function loadFixtureLines(name: string): string[] {
    const text = loadFixtureText(name).replace(/\n$/, '');
    return text.split('\n');
}

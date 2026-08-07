#!/usr/bin/env node
/**
 * Guard: every path filter in the P2P protocol gate must still match something.
 *
 * The gate spent months watching `app/src/main/p2p/**` and
 * `app/src/main/handshake.ts`, neither of which exists — so the workflow never
 * fired and the governance control it implements was inert. A path filter that
 * matches zero tracked files is indistinguishable from no gate at all, so this
 * turns that state into a test failure.
 *
 * The pure helpers are exported and covered by
 * app/src/ci/__tests__/p2p-gate-paths.test.ts, which is what actually runs this
 * against the tree (in the existing "Test" CI job).
 */
import fs from 'node:fs';

/**
 * Extract the `paths:` list from a workflow's `pull_request:` trigger.
 *
 * Deliberately not a YAML parser: the root package pins prettier and nothing
 * else, and CI runs this with no install step. The workflows this reads are a
 * handful of hand-written files with a fixed shape, so an indentation-scoped
 * scan is enough — and it fails loudly (empty list) rather than silently
 * mis-parsing if that shape changes.
 */
export function extractWorkflowPaths(yamlText) {
    const lines = yamlText.split('\n');
    const paths = [];
    let listIndent = null;

    for (const line of lines) {
        if (listIndent === null) {
            const header = line.match(/^(\s*)paths:\s*$/);
            if (header) listIndent = header[1].length;
            continue;
        }

        if (line.trim() === '') continue;

        const indent = line.match(/^\s*/)[0].length;
        // Dedent (or a sibling key) ends the list.
        if (indent <= listIndent) break;

        const item = line.match(/^\s*-\s*(.+?)\s*$/);
        if (!item) break;
        paths.push(item[1].replace(/^['"]|['"]$/g, ''));
    }

    return paths;
}

/**
 * Translate a GitHub Actions path filter into a RegExp.
 *
 * Follows the filter-pattern rules that this repo's gates actually use:
 * `**` crosses directory separators, `*` and `?` do not.
 */
export function globToRegExp(glob) {
    let source = '';

    for (let i = 0; i < glob.length; i++) {
        const char = glob[i];
        if (char === '*') {
            if (glob[i + 1] === '*') {
                source += '.*';
                i++;
            } else {
                source += '[^/]*';
            }
        } else if (char === '?') {
            source += '[^/]';
        } else {
            source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }

    return new RegExp(`^${source}$`);
}

/** Path filters that match none of `files`. */
export function findUnmatchedGlobs(globs, files) {
    return globs.filter((glob) => {
        const pattern = globToRegExp(glob);
        return !files.some((file) => pattern.test(file));
    });
}

export function readWorkflowPaths(workflowPath) {
    return extractWorkflowPaths(fs.readFileSync(workflowPath, 'utf8'));
}

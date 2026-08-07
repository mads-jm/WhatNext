#!/usr/bin/env node
/**
 * Guard: an RxDB schema version bump must ship the migration strategies that
 * carry existing data across it, or RxDB refuses to open the database.
 *
 * The previous implementation was two greps deep in false confidence. It
 * collected `version:` numbers with `sort -u` across the whole file — collapsing
 * five independent collections into one set, so bumping users 1 -> 3 while
 * tracks already sat at 3 produced no "new" version at all — and then looked for
 * a migration with `grep -q "$VERSION:"`, which the doc comment
 * `// v0 -> v1: Added avatarSource` satisfies just as well as a real strategy
 * (the real ones are ES shorthand methods: `1(oldDoc) {`).
 *
 * Both fixes are the same idea: compare per collection, and read the actual
 * `migrationStrategies` object rather than the file's prose.
 *
 *     node scripts/check-schema-migrations.mjs <base-schemas.ts> <head-schemas.ts> <database.ts>
 *
 * Exits 1 when a bump is missing a migration. The workflow treats that as a
 * warning-with-comment (`continue-on-error`), matching the gate's prior posture.
 *
 * The pure helpers are exported and covered by
 * app/src/ci/__tests__/schema-migration-guard.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Read the span of `source` starting at the `{` at or after `openIndex`,
 * returning the text between the braces. Brace-counting rather than regex
 * because migration bodies contain nested object literals.
 */
function readBracedBlock(source, openIndex) {
    const start = source.indexOf('{', openIndex);
    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start + 1, i);
        }
    }
    return null;
}

/**
 * Scan a braced block line by line, yielding each line together with the brace
 * depth it *starts* at. Callers use depth 0 to mean "a key of this object",
 * which is what keeps nested literals (and, for migrations, strategy bodies)
 * from being read as top-level entries. Brace counting is naive about braces
 * inside string literals; neither schemas.ts nor database.ts has any.
 */
function* topLevelLines(block) {
    let depth = 0;
    for (const line of block.split('\n')) {
        if (depth === 0) yield line;
        for (const char of line) {
            if (char === '{') depth++;
            else if (char === '}') depth--;
        }
    }
}

/**
 * Map each exported schema constant in schemas.ts to its declared version.
 * e.g. `export const userSchema: RxJsonSchema<UserDocType> = { version: 1, ... }`
 * -> { userSchema: 1 }
 */
export function parseSchemaVersions(schemasSource) {
    const versions = new Map();
    const declaration = /export\s+const\s+(\w+Schema)\b/g;

    for (const match of schemasSource.matchAll(declaration)) {
        const body = readBracedBlock(schemasSource, match.index);
        if (body === null) continue;

        for (const line of topLevelLines(body)) {
            // Top level only: a `version` property nested under `properties`
            // describes a document field, not the schema.
            const version = line.match(/^\s*version:\s*(\d+)/);
            if (version) {
                versions.set(match[1], Number(version[1]));
                break;
            }
        }
    }

    return versions;
}

/**
 * Migration strategy keys declared at the top level of a `migrationStrategies`
 * object. Accepts the three forms that are actually valid JS object keys here —
 * shorthand method (`1(oldDoc) {`), property (`1: (oldDoc) =>`) and quoted
 * (`'1': ...`) — and, crucially, nothing else: a `// v0 -> v1:` comment starts
 * with a slash, and a `1:` nested inside a strategy body sits at depth > 0.
 */
export function parseMigrationKeys(block) {
    const keys = new Set();

    for (const line of topLevelLines(block)) {
        const entry = line.match(/^\s*(?:['"])?(\d+)(?:['"])?\s*[:(]/);
        if (entry) keys.add(Number(entry[1]));
    }

    return keys;
}

/**
 * Map each collection registered in database.ts to the schema constant it uses
 * and the migration versions it declares.
 * e.g. `users: { schema: userSchema, migrationStrategies: { 1(oldDoc) {...} } }`
 * -> { users: { schemaVar: 'userSchema', migrations: Set{1} } }
 */
export function parseCollectionMigrations(databaseSource) {
    const collections = new Map();
    const registration = /(\w+):\s*\{\s*schema:\s*(\w+)\s*,?/g;

    for (const match of databaseSource.matchAll(registration)) {
        const [, collection, schemaVar] = match;
        const body = readBracedBlock(
            databaseSource,
            match.index + collection.length,
        );
        if (body === null) continue;

        const strategiesIndex = body.search(/\bmigrationStrategies\s*:/);
        const migrations =
            strategiesIndex === -1
                ? new Set()
                : parseMigrationKeys(
                      readBracedBlock(body, strategiesIndex) ?? '',
                  );

        collections.set(collection, { schemaVar, migrations });
    }

    return collections;
}

/**
 * Per collection: every version between the base version (exclusive) and the
 * head version (inclusive) needs a migration strategy.
 *
 * A collection whose schema is absent from the base is brand new — there is no
 * existing data to carry forward, so it needs no migrations.
 */
export function findMissingMigrations({
    baseSchemasSource,
    headSchemasSource,
    databaseSource,
}) {
    const baseVersions = parseSchemaVersions(baseSchemasSource);
    const headVersions = parseSchemaVersions(headSchemasSource);
    const collections = parseCollectionMigrations(databaseSource);
    const missing = [];

    for (const [collection, { schemaVar, migrations }] of collections) {
        const head = headVersions.get(schemaVar);
        const base = baseVersions.get(schemaVar);
        if (head === undefined || base === undefined) continue;

        for (let version = base + 1; version <= head; version++) {
            if (!migrations.has(version)) {
                missing.push({ collection, schemaVar, version });
            }
        }
    }

    return missing;
}

function main() {
    const repoRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
    );
    const [baseSchemas, headSchemas, database] = [
        process.argv[2],
        process.argv[3] ??
            path.join(repoRoot, 'app/src/renderer/db/schemas.ts'),
        process.argv[4] ??
            path.join(repoRoot, 'app/src/renderer/db/database.ts'),
    ];

    if (!baseSchemas) {
        console.error(
            'usage: node scripts/check-schema-migrations.mjs <base-schemas.ts> [head-schemas.ts] [database.ts]',
        );
        process.exit(2);
    }

    const missing = findMissingMigrations({
        baseSchemasSource: fs.readFileSync(baseSchemas, 'utf8'),
        headSchemasSource: fs.readFileSync(headSchemas, 'utf8'),
        databaseSource: fs.readFileSync(database, 'utf8'),
    });

    if (missing.length === 0) {
        console.log(
            'Schema migration guard OK: no version bump is missing a migration strategy.',
        );
        return;
    }

    console.error('Schema version bump(s) without a migration strategy:\n');
    for (const { collection, version } of missing) {
        console.error(`  - ${collection}: no migrationStrategies[${version}]`);
    }

    if (process.env.GITHUB_OUTPUT) {
        const summary = missing
            .map(({ collection, version }) => `${collection}:${version}`)
            .join(' ');
        fs.appendFileSync(
            process.env.GITHUB_OUTPUT,
            `has_missing=true\nmissing=${summary}\n`,
        );
    }

    process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

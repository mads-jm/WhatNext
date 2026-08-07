import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    parseSchemaVersions,
    parseMigrationKeys,
    parseCollectionMigrations,
    findMissingMigrations,
} from '../../../../scripts/check-schema-migrations.mjs';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SCHEMAS_PATH = path.join(REPO_ROOT, 'app/src/renderer/db/schemas.ts');
const DATABASE_PATH = path.join(REPO_ROOT, 'app/src/renderer/db/database.ts');

const schemasSource = fs.readFileSync(SCHEMAS_PATH, 'utf8');
const databaseSource = fs.readFileSync(DATABASE_PATH, 'utf8');

/** Rewrite one schema constant's declared version, as a version bump would. */
function withVersion(source: string, schemaVar: string, version: number) {
    const declaration = source.indexOf(`export const ${schemaVar}`);
    expect(declaration, `${schemaVar} not found in schemas.ts`).toBeGreaterThan(
        -1,
    );

    const head = source.slice(0, declaration);
    const tail = source
        .slice(declaration)
        .replace(/version:\s*\d+/, `version: ${version}`);
    return head + tail;
}

describe('parseSchemaVersions', () => {
    it('reads the real per-collection versions out of schemas.ts', () => {
        // The five collections and their versions at the time of writing. If a
        // bump lands, this list moves with it — that is the point.
        expect(Object.fromEntries(parseSchemaVersions(schemasSource))).toEqual({
            userSchema: 1,
            trackSchema: 3,
            trackInteractionSchema: 0,
            playlistSchema: 5,
            commentSchema: 1,
        });
    });

    it('ignores a "version" property nested inside the document schema', () => {
        const source = [
            'export const thingSchema: RxJsonSchema<Thing> = {',
            '    version: 2,',
            '    properties: {',
            '        version: { type: 9 },',
            '    },',
            '};',
        ].join('\n');

        expect(parseSchemaVersions(source).get('thingSchema')).toBe(2);
    });
});

describe('parseMigrationKeys', () => {
    it('reads ES shorthand method entries — the form actually used', () => {
        const block = [
            '    1(oldDoc) {',
            '        return { ...oldDoc };',
            '    },',
            '    2(oldDoc) {',
            '        return { ...oldDoc };',
            '    },',
        ].join('\n');

        expect([...parseMigrationKeys(block)]).toEqual([1, 2]);
    });

    it('does not count a doc comment as a migration', () => {
        // The exact false positive the old `grep -q "$VERSION:"` fell for.
        const block = [
            '    // v0 → v1: Added avatarSource, linkedAccounts',
            '    // 2: not written yet',
            '    1(oldDoc) {',
            '        return { ...oldDoc };',
            '    },',
        ].join('\n');

        expect([...parseMigrationKeys(block)]).toEqual([1]);
    });

    it('does not count numeric keys nested inside a strategy body', () => {
        const block = [
            '    1(oldDoc) {',
            '        return { ...oldDoc, ranks: {',
            '            2: "silver",',
            '        } };',
            '    },',
        ].join('\n');

        expect([...parseMigrationKeys(block)]).toEqual([1]);
    });

    it('accepts property and quoted forms too', () => {
        const block = [
            "    '1': (oldDoc) => oldDoc,",
            '    2: (oldDoc) => oldDoc,',
        ].join('\n');

        expect([...parseMigrationKeys(block)]).toEqual([1, 2]);
    });
});

describe('parseCollectionMigrations', () => {
    it('maps every real collection to its schema constant and migrations', () => {
        const collections = parseCollectionMigrations(databaseSource);
        const summary = Object.fromEntries(
            [...collections].map(([name, { schemaVar, migrations }]) => [
                name,
                { schemaVar, migrations: [...migrations] },
            ]),
        );

        expect(summary).toEqual({
            users: { schemaVar: 'userSchema', migrations: [1] },
            tracks: { schemaVar: 'trackSchema', migrations: [1, 2, 3] },
            // No migrationStrategies block at all — still at version 0.
            trackInteractions: {
                schemaVar: 'trackInteractionSchema',
                migrations: [],
            },
            playlists: {
                schemaVar: 'playlistSchema',
                migrations: [1, 2, 3, 4, 5],
            },
            comments: { schemaVar: 'commentSchema', migrations: [1] },
        });
    });
});

describe('findMissingMigrations', () => {
    // (a) The current tree against itself: nothing bumped, nothing missing.
    it('reports nothing when no version moved', () => {
        expect(
            findMissingMigrations({
                baseSchemasSource: schemasSource,
                headSchemasSource: schemasSource,
                databaseSource,
            }),
        ).toEqual([]);
    });

    // (b) A bump with no matching strategy.
    it('reports a bump that ships no migration', () => {
        expect(
            findMissingMigrations({
                baseSchemasSource: schemasSource,
                headSchemasSource: withVersion(
                    schemasSource,
                    'commentSchema',
                    2,
                ),
                databaseSource,
            }),
        ).toEqual([
            { collection: 'comments', schemaVar: 'commentSchema', version: 2 },
        ]);
    });

    // (c) The case `sort -u` provably missed: users 1 -> 3 while tracks already
    // sits at 3, so the deduped repo-wide set {0,1,3,5} is unchanged and the old
    // guard stayed silent. Per-collection comparison sees both gaps.
    it('reports a per-collection bump onto a version another collection already has', () => {
        const base = parseSchemaVersions(schemasSource);
        expect(base.get('userSchema')).toBe(1);
        expect(base.get('trackSchema')).toBe(3);

        expect(
            findMissingMigrations({
                baseSchemasSource: schemasSource,
                headSchemasSource: withVersion(schemasSource, 'userSchema', 3),
                databaseSource,
            }),
        ).toEqual([
            { collection: 'users', schemaVar: 'userSchema', version: 2 },
            { collection: 'users', schemaVar: 'userSchema', version: 3 },
        ]);
    });

    it('stays quiet when the bump does ship its migration', () => {
        // Pretend tracks was at 2 on the base branch: the jump to 3 is covered
        // by the existing migrationStrategies[3].
        expect(
            findMissingMigrations({
                baseSchemasSource: withVersion(schemasSource, 'trackSchema', 2),
                headSchemasSource: schemasSource,
                databaseSource,
            }),
        ).toEqual([]);
    });

    it('needs no migration for a collection that is new on this branch', () => {
        const baseWithoutComments = schemasSource.replace(
            'export const commentSchema',
            'const removedCommentSchema',
        );

        expect(
            findMissingMigrations({
                baseSchemasSource: baseWithoutComments,
                headSchemasSource: schemasSource,
                databaseSource,
            }),
        ).toEqual([]);
    });
});

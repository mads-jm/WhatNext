/**
 * Companion web parity — the two hand-maintained copies of the phone UI.
 *
 * `app/src/companion-web/` (LAN) and `relay/companion-web/` (relay) are
 * duplicates with no sync mechanism, so every phone-UI change must land twice.
 * This is a checksum diff, not parity automation: it says *whether* they drifted
 * and nothing more. The fix is always `cp` in whichever direction is correct —
 * or, better, the de-duplication re-ticket that retires this file.
 *
 * Manual equivalent: `diff -ru app/src/companion-web relay/companion-web`.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const relayDir = fileURLToPath(new URL('..', import.meta.url));
const APP_WEB_DIR = join(relayDir, '..', 'app', 'src', 'companion-web');
const RELAY_WEB_DIR = join(relayDir, 'companion-web');

function checksums(dir) {
    const entries = readdirSync(dir).sort();
    return Object.fromEntries(
        entries.map((name) => [
            name,
            createHash('sha256').update(readFileSync(join(dir, name))).digest('hex'),
        ]),
    );
}

describe('companion-web copies', () => {
    it('are byte-identical in app/ and relay/', () => {
        expect(checksums(RELAY_WEB_DIR)).toEqual(checksums(APP_WEB_DIR));
    });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0037 — `adminium_manifests.package_integrity`, the fingerprint of the
 * copy held in the storage destination.
 *
 * Run on all three engines because the column is `str(120)`, which is
 * `varchar(120)` on PostgreSQL and MySQL and plain `text` on SQLite. A value
 * too long for the bound is accepted on SQLite and rejected on the two engines
 * a real install is most likely to use, so a SQLite-only suite would prove
 * nothing about the width (0032 is the wave that learned this the hard way).
 * The real value is 95 characters and the bound is 120; the case below writes
 * the full width so a later narrowing fails where it can be seen.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, manifestsRepo } from '../src/index.js';
import { PACKAGE_INTEGRITY_MAX } from '../src/migrations/0037_manifest_package_integrity.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const crypto = {
  encrypt: (plaintext: string) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token: string) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

/** The real shape: `sha512-` plus 88 base64 characters. */
const INTEGRITY = `sha512-${'A'.repeat(87)}=`;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`manifest package integrity [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
    });
    afterEach(async () => {
      await t.destroy();
    });

    const repo = () => manifestsRepo(t.meta, crypto);
    const install = () =>
      repo().install({
        manifestKey: 'clinic',
        version: '1.0.0',
        kind: 'app',
        source: 'file',
        document: { kind: 'app', manifestVersion: 1, key: 'clinic', name: 'Clinic', version: '1.0.0' },
        attachTo: [],
      });

    it('starts null, because no copy is held until one is uploaded', async () => {
      const installed = await install();
      expect(installed.row.packageIntegrity).toBeNull();
      const [listed] = await repo().list('app');
      expect(listed?.row.packageIntegrity).toBeNull();
    });

    it('stores the fingerprint and reads it back unchanged', async () => {
      const installed = await install();
      await repo().setPackageIntegrity(installed.row.id, INTEGRITY);
      const [listed] = await repo().list('app');
      expect(listed?.row.packageIntegrity).toBe(INTEGRITY);
    });

    it('accepts the full column width on every engine', async () => {
      // `varchar(120)` on two engines, `text` on SQLite: a value at the bound
      // must be storable everywhere, or the bound is wrong.
      const installed = await install();
      const atBound = `sha512-${'B'.repeat(PACKAGE_INTEGRITY_MAX - 'sha512-'.length)}`;
      expect(atBound).toHaveLength(PACKAGE_INTEGRITY_MAX);
      await repo().setPackageIntegrity(installed.row.id, atBound);
      expect((await repo().list('app'))[0]?.row.packageIntegrity).toBe(atBound);
    });

    it('clears it, because a cleared copy must not read as a held one', async () => {
      const installed = await install();
      await repo().setPackageIntegrity(installed.row.id, INTEGRITY);
      await repo().setPackageIntegrity(installed.row.id, null);
      expect((await repo().list('app'))[0]?.row.packageIntegrity).toBeNull();
    });

    it('drops it when the version moves, so a copy never describes other bytes', async () => {
      const installed = await install();
      await repo().setPackageIntegrity(installed.row.id, INTEGRITY);
      await repo().setVersion(installed.row.id, {
        version: '1.1.0',
        document: { kind: 'app', manifestVersion: 1, key: 'clinic', name: 'Clinic', version: '1.1.0' },
      });
      const [listed] = await repo().list('app');
      expect(listed?.row.version).toBe('1.1.0');
      // The held bytes are 1.0.0's. Keeping the fingerprint would advertise a
      // copy that restores the wrong package.
      expect(listed?.row.packageIntegrity).toBeNull();
    });
  });
}

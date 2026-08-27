// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0018 — provenance for `adminium_connections.timezone`.
 *
 * The behaviour under test is one distinction: a zone the SERVER guessed must
 * not read back the same as a zone a PERSON chose. Everything else here is the
 * consequences of that — what an update does to the label, and what an
 * unrecognised value degrades to.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, connectionsRepo, type DsnCrypto } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`connection timezone provenance [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
    });
    afterEach(async () => {
      await t.destroy();
    });

    const repo = () => connectionsRepo(t.meta, testCrypto);
    const base = {
      name: 'src',
      engine: 'postgres' as const,
      // `create` refuses a `dsn` source with no DSN; irrelevant here beyond
      // getting past that guard.
      introspectDsn: 'postgres://ro:s@db/prod',
    };

    it('labels an omitted zone as the host guess it is', async () => {
      const created = await repo().create({ ...base });
      // The value itself is whatever machine ran this — asserting the label,
      // not the zone, is the whole point of the column.
      expect(created.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
      expect(created.timezoneSource).toBe('host');
    });

    it('labels a zone passed at create as the operator\'s', async () => {
      const created = await repo().create({ ...base, timezone: 'Europe/Lisbon' });
      expect(created.timezone).toBe('Europe/Lisbon');
      expect(created.timezoneSource).toBe('operator');
    });

    it('attributes nothing when the zone is deliberately absent', async () => {
      // `null` is a choice about the zone, not a choice OF one: there is
      // nothing to attribute, and `timezone` already records "none".
      const created = await repo().create({ ...base, timezone: null });
      expect(created.timezone).toBeNull();
      expect(created.timezoneSource).toBeNull();
    });

    it('stops calling it a guess once an operator sets one', async () => {
      const created = await repo().create({ ...base });
      expect(created.timezoneSource).toBe('host');

      const patched = await repo().update(created.id, { timezone: 'Asia/Tokyo' });
      expect(patched?.timezone).toBe('Asia/Tokyo');
      // The label has to move with the value. Left at `host`, Studio would go
      // on telling an operator their own choice was guessed — which is how a
      // badge stops being read at all.
      expect(patched?.timezoneSource).toBe('operator');
    });

    it('drops the label when an operator clears the zone', async () => {
      const created = await repo().create({ ...base, timezone: 'Europe/Lisbon' });
      const patched = await repo().update(created.id, { timezone: null });
      expect(patched?.timezone).toBeNull();
      expect(patched?.timezoneSource).toBeNull();
    });

    it('leaves the label alone when an update does not mention the zone', async () => {
      const created = await repo().create({ ...base, timezone: 'Europe/Lisbon' });
      const patched = await repo().update(created.id, { name: 'renamed' });
      expect(patched?.name).toBe('renamed');
      expect(patched?.timezoneSource).toBe('operator');
    });

    it('reads an unrecognised stored source as no claim at all', async () => {
      /*
       * A hand-edited row, or one written by a newer version and rolled back.
       * Degrading to `null` is the safe direction: silence costs a badge,
       * while guessing `host` accuses a real decision of being a guess.
       */
      const created = await repo().create({ ...base, timezone: 'Europe/Lisbon' });
      await t.meta.db
        .updateTable('adminium_connections')
        .set({ timezoneSource: 'probed' } as never)
        .where('id', '=', created.id)
        .execute();

      const read = await repo().findById(created.id);
      expect(read?.timezone).toBe('Europe/Lisbon');
      expect(read?.timezoneSource).toBeNull();
    });
  });
}

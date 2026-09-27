// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0046 (`public_sessions_ended`) and the repo around it, on every
 * available dialect: a session made before the wave is live and not ended;
 * ending a person's sessions keeps each row, marked with when and why, so a
 * device presenting one can be told; an ended session opens nothing, is
 * never raised or slid, keeps its first reason, and goes at its own expiry.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  connectionsRepo,
  publicKeysRepo,
  publicScopesRepo,
  publicSessionsRepo,
  type DsnCrypto,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const T0 = 1_750_000_000_000;
const MIN = 60_000;
const PRE_0046 = ALL_MIGRATIONS.filter((m) => m.name < '0046_public_sessions_ended');

async function keyOf(meta: MetaDb): Promise<string> {
  const conn = await connectionsRepo(meta, crypto).create({ name: 'src', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/x', dataDsn: 'postgres://rw:s@db/x' });
  const scope = await publicScopesRepo(meta).create(
    { connectionId: conn.id, side: 'customer', name: 'shop', timezone: 'Europe/London', document: '{"version":1,"resources":[]}' },
    T0,
  );
  const key = await publicKeysRepo(meta).create(
    { name: 'web', prefix: 'adm_pub_ended001', tokenHash: 'h'.repeat(64), tokenEncrypted: 'sealed', scopeId: scope.id, side: 'customer', appKey: 'shop' },
    T0,
  );
  return key.id;
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0046_public_sessions_ended [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('reads a session made before the wave as live and not ended', async () => {
      const m = t.meta;
      expect(PRE_0046.length).toBeGreaterThan(40);
      await applyMigrations(m.db, { dialect: m.dialect, migrations: PRE_0046 });
      const keyId = await keyOf(m);
      // Raw insert: today's repo writes the columns this schema does not have yet.
      await m.db
        .insertInto('adminium_public_sessions')
        .values({ id: 'pss_pre0046', keyId, tokenHash: 't'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, createdAt: T0, lastSeenAt: null, level: 'verified', kind: 'link', subject: 'row:a' } as never)
        .execute();
      await applyMigrations(m.db, { dialect: m.dialect });
      const sessions = publicSessionsRepo(m);
      expect(await sessions.findValid('t'.repeat(64), T0)).toMatchObject({ id: 'pss_pre0046', endedAt: null, endedReason: null });
      expect(await sessions.findByTokenHash('t'.repeat(64))).toMatchObject({ endedAt: null, endedReason: null });
    });

    it('ends a person\'s sessions and keeps them, marked, until they would have lapsed', async () => {
      const m = t.meta;
      await applyMigrations(m.db, { dialect: m.dialect });
      const keyId = await keyOf(m);
      const sessions = publicSessionsRepo(m);
      const subject = `row:${'s'.repeat(60)}`;
      const a = await sessions.create({ keyId, tokenHash: 'a'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, subject, level: 'verified', kind: 'link' }, T0);
      const b = await sessions.create({ keyId, tokenHash: 'b'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, subject, level: 'verified', kind: 'link' }, T0);
      const other = await sessions.create({ keyId, tokenHash: 'c'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, subject: 'row:other' }, T0);
      const lapsed = await sessions.create({ keyId, tokenHash: 'd'.repeat(64), grants: '{}', expiresAt: T0 + MIN, subject }, T0);

      expect(await sessions.endBySubject(subject, 'elsewhere', T0 + 2 * MIN)).toBe(2);
      // Ended: opens nothing, found by its hash with its reason, never raised or slid again.
      expect(await sessions.findValid(a.tokenHash, T0 + 3 * MIN)).toBeNull();
      expect(await sessions.findById(a.id, T0 + 3 * MIN)).toBeNull();
      const ended = await sessions.findByTokenHash(b.tokenHash);
      expect(ended).toMatchObject({ endedReason: 'elsewhere' });
      expect(Number(ended!.endedAt)).toBe(T0 + 2 * MIN);
      expect(await sessions.raise(a.id, 'verified', T0 + 60 * MIN, T0 + 3 * MIN)).toBe(false);
      expect(await sessions.slide(b.id, T0 + 60 * MIN, T0 + 3 * MIN)).toBe(false);
      // Another person's session, and one that had already lapsed, are untouched.
      expect(await sessions.findValid(other.tokenHash, T0 + 3 * MIN)).toMatchObject({ id: other.id });
      expect(await sessions.findByTokenHash(lapsed.tokenHash)).toMatchObject({ endedAt: null });
      // Ending again keeps the first reason.
      expect(await sessions.endBySubject(subject, 'forgotten', T0 + 4 * MIN)).toBe(0);
      expect(await sessions.findByTokenHash(a.tokenHash)).toMatchObject({ endedReason: 'elsewhere' });
      // Housekeeping takes an ended row at its own expiry.
      expect(await sessions.purgeExpired(T0 + 30 * MIN)).toBe(4);
      expect(await sessions.findByTokenHash(a.tokenHash)).toBeNull();
    });

    it('holds a reason at its full width', async () => {
      const m = t.meta;
      await applyMigrations(m.db, { dialect: m.dialect });
      const keyId = await keyOf(m);
      const sessions = publicSessionsRepo(m);
      await sessions.create({ keyId, tokenHash: 'e'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, subject: 'row:w' }, T0);
      await m.db.updateTable('adminium_public_sessions').set({ endedReason: 'x'.repeat(16), endedAt: T0 }).where('subject', '=', 'row:w').execute();
      expect((await sessions.findByTokenHash('e'.repeat(64)))?.endedReason).toBe('x'.repeat(16));
    });

    it('tells an ended session once: the row goes as it is told, and a live one is never taken', async () => {
      const m = t.meta;
      await applyMigrations(m.db, { dialect: m.dialect });
      const keyId = await keyOf(m);
      const sessions = publicSessionsRepo(m);
      const live = await sessions.create({ keyId, tokenHash: 'f'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, subject: 'row:t' }, T0);
      expect(await sessions.takeEnded(live.id)).toBe(false);
      await sessions.endBySubject('row:t', 'elsewhere', T0);
      expect(await sessions.takeEnded(live.id)).toBe(true);
      expect(await sessions.takeEnded(live.id)).toBe(false);
      expect(await sessions.findByTokenHash('f'.repeat(64))).toBeNull();
    });

    it("moves a page's session back only while it still points where the failed write put it", async () => {
      const m = t.meta;
      await applyMigrations(m.db, { dialect: m.dialect });
      const keyId = await keyOf(m);
      const sessions = publicSessionsRepo(m);
      const page = await sessions.create({ keyId, tokenHash: 'g'.repeat(64), grants: '{"value":1}', expiresAt: Date.now() + 30 * MIN, subject: 'row:1' });
      const back = { grants: '{"value":1}', subject: 'row:1', expiresAt: Date.now() + 30 * MIN };
      // One write moved it to its hold 2, then another to its hold 3: the first's failure leaves it at 3.
      expect(await sessions.rebind(page.id, { grants: '{"value":2}', subject: 'row:2', expiresAt: back.expiresAt })).toBe(true);
      expect(await sessions.rebind(page.id, { grants: '{"value":3}', subject: 'row:3', expiresAt: back.expiresAt })).toBe(true);
      expect(await sessions.rebindFrom(page.id, 'row:2', back)).toBe(false);
      expect((await sessions.findByTokenHash('g'.repeat(64)))?.subject).toBe('row:3');
      // The second's failure, with nothing after it, puts it back.
      expect(await sessions.rebindFrom(page.id, 'row:3', back)).toBe(true);
      expect((await sessions.findByTokenHash('g'.repeat(64)))?.subject).toBe('row:1');
    });
  });
}

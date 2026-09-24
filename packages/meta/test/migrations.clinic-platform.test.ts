// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0042 (`clinic_platform`) and its repos, on every available dialect.
 *
 * What predates the wave reads as what it always was: a session is a lookup
 * claim, a key is the public side's, a challenge is a verify code. Then the
 * behaviours the repos are for: a second key never shadows the public side's,
 * a session is raised only while it lives, a new code kills the old one, the
 * per-person caps count across sessions, a proof is spent once, an app's
 * outbox is replaced in place and goes with its install, and an app's
 * templates are found by their owner. Bounded columns are written at their
 * full width, since only postgres and mysql enforce one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  appOutboxesRepo,
  connectionsRepo,
  emailTemplatesRepo,
  keyEnabledBy,
  keyStaffBinding,
  manifestsRepo,
  publicChallengesRepo,
  publicKeysRepo,
  publicProofsRepo,
  publicScopesRepo,
  publicSessionsRepo,
  type DsnCrypto,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb, type TestDb } from './helpers/db.js';

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const T0 = 1_750_000_000_000;
const MIN = 60_000;
const PRE_0042 = ALL_MIGRATIONS.filter((m) => m.name < '0042_clinic_platform');

async function connection(meta: MetaDb): Promise<string> {
  const conn = await connectionsRepo(meta, crypto).create({
    name: 'src',
    engine: 'postgres',
    introspectDsn: 'postgres://ro:s@db/clinic',
    dataDsn: 'postgres://rw:s@db/clinic',
  });
  return conn.id;
}

async function scope(meta: MetaDb, connectionId: string): Promise<string> {
  const row = await publicScopesRepo(meta).create(
    { connectionId, side: 'customer', name: 'clinic', timezone: 'Europe/London', document: '{"version":1,"resources":[]}' },
    T0,
  );
  return row.id;
}

const keyInput = (scopeId: string, prefix: string) => ({
  name: prefix,
  prefix,
  tokenHash: 'h'.repeat(64),
  tokenEncrypted: 'sealed',
  scopeId,
  side: 'customer',
  appKey: 'clinic',
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0042_clinic_platform [${dialect.name}]`, () => {
    describe('before and after the wave', () => {
      let t: TestDb;
      beforeEach(async () => {
        t = await dialect.make();
      });
      afterEach(async () => {
        await t.destroy();
      });

      it('reads every older row as what it was', async () => {
        const m = t.meta;
        expect(PRE_0042.at(-1)?.name).toBe('0041_session_persistent');
        await applyMigrations(m.db, { dialect: m.dialect, migrations: PRE_0042 });
        const scopeId = await scope(m, await connection(m));
        // Raw inserts: today's repos write columns this schema does not have yet.
        await m.db
          .insertInto('adminium_public_keys')
          .values({
            id: 'pbk_pre0042',
            name: 'web',
            prefix: 'adm_pub_pre00042',
            tokenHash: 'h'.repeat(64),
            tokenEncrypted: 'sealed',
            scopeId,
            side: 'customer',
            appKey: 'clinic',
            origins: '[]',
            access: null,
            kind: 'browser',
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
            createdBy: null,
            createdAt: T0,
            updatedAt: T0,
            managedBy: 'clinic',
          } as never)
          .execute();
        await m.db
          .insertInto('adminium_public_sessions')
          .values({ id: 'pss_pre0042', keyId: 'pbk_pre0042', tokenHash: 't'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, createdAt: T0, lastSeenAt: null } as never)
          .execute();
        await m.db
          .insertInto('adminium_public_challenges')
          .values({ id: 'pch_pre0042', keyId: 'pbk_pre0042', ref: 'patients', destinationHash: 'd', codeHash: 'c', attempts: 0, consumedAt: null, expiresAt: T0 + 10 * MIN, createdAt: T0 } as never)
          .execute();

        await applyMigrations(m.db, { dialect: m.dialect });

        const key = await publicKeysRepo(m).findById('pbk_pre0042');
        expect(key).toMatchObject({ purpose: 'customer', requiresStaff: null, enabledBy: null });
        expect(await publicKeysRepo(m).newestLiveByApp('clinic', 'customer', T0)).toMatchObject({ id: 'pbk_pre0042' });
        expect(await publicSessionsRepo(m).findById('pss_pre0042', T0)).toMatchObject({ level: 'lookup', kind: 'claim', subject: null });
        expect(await publicChallengesRepo(m).findById('pch_pre0042')).toMatchObject({
          purpose: 'verify',
          sessionId: null,
          subject: null,
          newDestinationEnc: null,
          clearedAt: null,
        });
      });
    });

    describe('the repos', () => {
      const meta = useMetaDb(dialect, migrateOnly);

      it('never hands the public side a second key made after it', async () => {
        const m = meta();
        const scopeId = await scope(m, await connection(m));
        const keys = publicKeysRepo(m);
        const customer = await keys.create(keyInput(scopeId, 'adm_pub_customer'), T0);
        const kiosk = await keys.create(
          {
            ...keyInput(scopeId, 'adm_pub_kiosk001'),
            purpose: 'kiosk',
            requiresStaff: { appKey: 'clinic', roleSlug: 'clinic-kiosk' },
            enabledBy: { table: 'clinic_settings', column: 'kiosk_on' },
          },
          T0 + 1,
        );
        const connectionId = (await publicScopesRepo(m).findById(scopeId))!.connectionId;
        expect((await keys.newestLiveByApp('clinic', 'customer', T0 + 2))?.id).toBe(customer.id);
        expect((await keys.newestLiveByAppAndConnection('clinic', 'customer', connectionId, T0 + 2))?.id).toBe(customer.id);
        expect((await keys.newestLiveByApp('clinic', 'customer', T0 + 2, 'kiosk'))?.id).toBe(kiosk.id);

        const read = (await keys.findById(kiosk.id))!;
        expect(keyStaffBinding(read)).toEqual({ appKey: 'clinic', roleSlug: 'clinic-kiosk' });
        expect(keyEnabledBy(read)).toEqual({ table: 'clinic_settings', column: 'kiosk_on' });
        expect(keyStaffBinding(customer)).toBeNull();
        expect(keyEnabledBy({ enabledBy: 'not json' })).toBeNull();
      });

      it('raises a live session to verified with a fresh expiry, and ends a person\'s sessions together', async () => {
        const m = meta();
        const scopeId = await scope(m, await connection(m));
        const key = await publicKeysRepo(m).create(keyInput(scopeId, 'adm_pub_sessions'), T0);
        const sessions = publicSessionsRepo(m);
        const subject = `${'p'.repeat(188)}:41`; // the full 191
        const a = await sessions.create({ keyId: key.id, tokenHash: 'a'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, subject }, T0);
        const b = await sessions.create({ keyId: key.id, tokenHash: 'b'.repeat(64), grants: '{}', expiresAt: T0 + MIN, subject }, T0);
        expect(a).toMatchObject({ level: 'lookup', kind: 'claim', subject });

        expect(await sessions.raise(a.id, 'verified', T0 + 60 * MIN, T0 + 5 * MIN)).toBe(true);
        expect(await sessions.findValid('a'.repeat(64), T0 + 45 * MIN)).toMatchObject({ level: 'verified', subject });
        // A code confirmed after the session lapsed brings nothing back.
        expect(await sessions.raise(b.id, 'verified', T0 + 60 * MIN, T0 + 2 * MIN)).toBe(false);

        expect(await sessions.removeBySubject(subject)).toBe(2);
        expect(await sessions.findById(a.id, T0)).toBeNull();
      });

      it('keeps one open code per session and purpose, bounds guesses on the row, and caps per person', async () => {
        const m = meta();
        const scopeId = await scope(m, await connection(m));
        const key = await publicKeysRepo(m).create(keyInput(scopeId, 'adm_pub_codes001'), T0);
        const sessions = publicSessionsRepo(m);
        const subject = 'patients:41';
        const s1 = await sessions.create({ keyId: key.id, tokenHash: 'c'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, subject }, T0);
        const s2 = await sessions.create({ keyId: key.id, tokenHash: 'd'.repeat(64), grants: '{}', expiresAt: T0 + 30 * MIN, subject }, T0);
        const challenges = publicChallengesRepo(m);
        const code = (sessionId: string, at: number, purpose = 'verify') =>
          challenges.create(
            { keyId: key.id, ref: 'patients_claimed', destinationHash: 'x'.repeat(64), codeHash: 'y'.repeat(64), expiresAt: at + 10 * MIN, sessionId, purpose, subject },
            at,
          );

        const first = await code(s1.id, T0);
        const second = await code(s1.id, T0 + MIN);
        // The newer code killed the older one.
        expect((await challenges.findById(first.id))?.consumedAt).toBe(T0 + MIN);
        expect((await challenges.findOpen(s1.id, 'verify', T0 + MIN))?.id).toBe(second.id);
        expect((await challenges.newestFor(s1.id, 'verify'))?.id).toBe(second.id);
        expect(await challenges.findOpen(s1.id, 'email-change', T0 + MIN)).toBeNull();
        expect(await challenges.findOpen(s1.id, 'verify', T0 + 12 * MIN)).toBeNull();

        // Guesses count atomically; a used code takes no more.
        expect(await challenges.recordFailure(second.id)).toBe(1);
        expect(await challenges.recordFailure(second.id)).toBe(2);
        expect(await challenges.consume(second.id, T0 + 2 * MIN)).toBe(true);
        expect(await challenges.consume(second.id, T0 + 2 * MIN)).toBe(false);
        expect(await challenges.recordFailure(second.id)).toBeNull();

        // Across sessions: what one person was sent, and got wrong.
        const other = await code(s2.id, T0 + 3 * MIN);
        await challenges.recordFailure(other.id);
        await code(s2.id, T0 + 4 * MIN, 'email-change');
        expect(await challenges.countForSession(s1.id)).toBe(2);
        expect(await challenges.sentSince(subject, T0)).toBe(4);
        expect(await challenges.sentSince(subject, T0 + 2 * MIN)).toBe(2);
        expect(await challenges.sentSince(subject, T0, 'email-change')).toBe(1);
        expect(await challenges.failuresSince(subject, T0)).toBe(3);

        // The desk lifts the lock: what was wrong so far stops counting.
        expect(await challenges.clearSubject(subject, T0 + 5 * MIN)).toBe(4);
        expect(await challenges.failuresSince(subject, T0)).toBe(0);
        const later = await code(s2.id, T0 + 6 * MIN);
        await challenges.recordFailure(later.id);
        expect(await challenges.failuresSince(subject, T0)).toBe(1);

        expect(await challenges.purgeBefore(T0 + 2 * MIN)).toBe(2);
        expect(await challenges.findById(first.id)).toBeNull();
      });

      it('spends a proof once', async () => {
        const proofs = publicProofsRepo(meta());
        const proof = { id: `prf_${'z'.repeat(60)}`, keyId: 'pbk_any', purpose: 'claim', expiresAt: T0 + 5 * MIN };
        expect(await proofs.spend(proof, T0)).toBe(true);
        expect(await proofs.spend(proof, T0 + 1)).toBe(false);
        expect(await proofs.spend({ ...proof, id: 'prf_other' }, T0)).toBe(true);
        expect(await proofs.purgeExpired(T0 + 5 * MIN)).toBe(2);
        expect(await proofs.spend(proof, T0 + 6 * MIN)).toBe(true);
      });

      it('replaces an app\'s outbox in place, keeps when it last scanned, and drops it with the install', async () => {
        const m = meta();
        const connectionId = await connection(m);
        const install = await manifestsRepo(m, crypto).install({ manifestKey: 'clinic', version: '0.2.0', kind: 'app', source: 'file', document: {}, connectionId });
        const outboxes = appOutboxesRepo(m);
        const definition = JSON.stringify({ table: 'clinic_messages', kinds: { reminder: 'clinic-reminder' } });
        const made = await outboxes.put({ appKey: 'clinic', manifestId: install.row.id, connectionId, definition }, T0);
        await outboxes.markScanned('clinic', T0 + MIN);
        const next = JSON.stringify({ table: 'clinic_messages', kinds: { reminder: 'clinic-reminder', missed: 'clinic-missed' } });
        const updated = await outboxes.put({ appKey: 'clinic', manifestId: install.row.id, connectionId, definition: next }, T0 + 2 * MIN);
        expect(updated).toMatchObject({ id: made.id, definition: next, scannedAt: T0 + MIN, createdAt: T0, updatedAt: T0 + 2 * MIN });
        expect((await outboxes.list()).map((row) => row.appKey)).toEqual(['clinic']);

        await manifestsRepo(m, crypto).uninstall(install.row.id);
        expect(await outboxes.findByApp('clinic')).toBeNull();
        expect(await outboxes.remove('clinic')).toBe(false);
      });

      it('finds an app\'s templates by their owner, with what it shipped', async () => {
        const templates = emailTemplatesRepo(meta());
        const owner = 'a'.repeat(80);
        const hash = 'f'.repeat(64);
        const base = { name: 'Reminder', subject: 'See you soon', blocks: [], enabled: true };
        await templates.upsert('clinic-reminder', 'de_DE', { ...base, managedBy: owner, contentHash: hash }, T0);
        await templates.upsert('clinic-reminder', 'en_US', { ...base, managedBy: owner, contentHash: hash }, T0);
        await templates.upsert('password-reset', 'en_US', base, T0);

        const shipped = await templates.listManagedBy(owner);
        expect(shipped.map((t) => `${t.key}/${t.locale}`)).toEqual(['clinic-reminder/de_DE', 'clinic-reminder/en_US']);
        expect(shipped[0]).toMatchObject({ managedBy: owner, contentHash: hash });
        expect((await templates.findByKeyLocale('password-reset', 'en_US'))).toMatchObject({ managedBy: null, contentHash: null });

        // An upsert that says nothing of the owner leaves it alone.
        await templates.upsert('clinic-reminder', 'en_US', { ...base, subject: 'Edited' }, T0 + 1);
        expect(await templates.findByKeyLocale('clinic-reminder', 'en_US')).toMatchObject({ subject: 'Edited', managedBy: owner });
      });
    });
  });
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A campaign run to the people of a table (wave 0069), on every available
 * dialect: the table audience reads back as it was written at the full width
 * of each of its bounded fields, a run's click switch is off unless asked for
 * and reads back as a boolean on every engine, and the owner's "existing
 * customers" switch is refused without their tick and keeps who and when.
 */
import { describe, expect, it } from 'vitest';

import { connectionsRepo, emailAudienceSchema, emailRunsRepo, emailTemplatesRepo, overridesRepo, usersRepo, type DsnCrypto, type MetaDb } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const crypto: DsnCrypto = { encrypt: (plain) => `enc:test:${plain}`, decrypt: (token) => token.slice('enc:test:'.length) };

async function campaign(meta: MetaDb) {
  return await emailTemplatesRepo(meta).create({ kind: 'campaign', key: 'july-news', locale: 'en_US', name: 'July news', subject: 'Hello {{first_name}}', blocks: [] }, 1_000);
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`a campaign run to a table's people [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('keeps a table audience at the full width of its fields, and its click switch', async () => {
      const doc = await campaign(meta());
      const runs = emailRunsRepo(meta());
      const audience = {
        kind: 'table' as const,
        connectionId: 'c'.repeat(64),
        table: `public.${'t'.repeat(193)}`,
        viewId: 'v'.repeat(64),
        purpose: 'surveys' as const,
        existingCustomers: true,
      };
      expect(audience.table).toHaveLength(200);
      const run = await runs.create({ templateId: doc.id, audience, scheduledAt: 2_000, mailClass: 'marketing', basis: 'existing-customers', trackClicks: true }, 2_000);
      expect(run).toMatchObject({ audience, mailClass: 'marketing', basis: 'existing-customers', trackClicks: true });
      expect((await runs.findById(run.id))?.trackClicks).toBe(true);
      // Off unless asked for, and so on every run made before the switch.
      const plain = await runs.create({ templateId: doc.id, audience: { kind: 'users' }, scheduledAt: 2_000 }, 2_000);
      expect(plain.trackClicks).toBe(false);
    });

    it('refuses a table audience with a field past its width, a purpose it does not know, or a word it does not know', () => {
      const ok = { kind: 'table', connectionId: 'conn_1', table: 'public.contacts', purpose: 'newsletter' };
      expect(emailAudienceSchema.safeParse(ok).success).toBe(true);
      expect(emailAudienceSchema.safeParse({ ...ok, table: 't'.repeat(201) }).success).toBe(false);
      expect(emailAudienceSchema.safeParse({ ...ok, connectionId: 'c'.repeat(65) }).success).toBe(false);
      expect(emailAudienceSchema.safeParse({ ...ok, purpose: 'offers' }).success).toBe(false);
      expect(emailAudienceSchema.safeParse({ ...ok, roleIds: [] }).success).toBe(false);
    });

    it('keeps the existing-customers switch with who and when, and refuses it on without the tick', async () => {
      const owner = await usersRepo(meta()).create({ email: 'owner@desk.test', name: 'Owner', passwordHash: 'x' });
      const connectionId = (await connectionsRepo(meta(), crypto).create({ name: 'crm', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/crm' })).id;
      const overrides = overridesRepo(meta());
      await expect(overrides.create({ connectionId, op: 'table.existingCustomers', tableName: 'public.contacts', value: { on: true, optOutOffered: false }, createdBy: owner.id })).rejects.toThrow();
      const on = await overrides.create({ connectionId, op: 'table.existingCustomers', tableName: 'public.contacts', value: { on: true, optOutOffered: true }, createdBy: owner.id }, 5_000);
      expect(on).toMatchObject({ op: 'table.existingCustomers', value: { on: true, optOutOffered: true }, createdBy: owner.id, createdAt: 5_000, columnName: null });
      // Off needs no tick.
      const off = await overrides.create({ connectionId, op: 'table.existingCustomers', tableName: 'public.contacts', value: { on: false, optOutOffered: false }, createdBy: owner.id }, 6_000);
      expect((await overrides.findById(off.id))?.value).toEqual({ on: false, optOutOffered: false });
    });
  });
}

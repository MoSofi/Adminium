// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0026 (email documents): `adminium_email_templates` gains the envelope
 * the comp needs, and the two new tables land (39-email-templates-and-
 * campaigns.md).
 *
 * Runs the real migration list split at 0025/0026 on every available dialect:
 * the `created_by` FK on the ALTER is spelled per engine (inline REFERENCES on
 * SQLite, a named constraint elsewhere), and a legacy row written BEFORE the
 * wave must read back with its footer lifted and every new column at its
 * default — which is the whole upgrade story for the 24 seeded rows every
 * install already holds.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  emailBlocksRepo,
  emailRunsRepo,
  emailTemplatesRepo,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0026 = ALL_MIGRATIONS.filter((m) => m.name < '0026_email_documents');

const LEGACY_BLOCKS = [
  { block: 'email.heading', id: 'heading', data: { text: 'Reset your password', level: 1 } },
  { block: 'email.text', id: 'intro', data: { text: 'Hi {{name}}.' } },
  { block: 'email.divider', id: 'rule' },
  { block: 'email.footer', id: 'footer', data: { text: 'Paste this link: {{resetUrl}}' } },
];

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0026_email_documents [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades a pre-wave row: footer lifted on read, every new column at its default', async () => {
      // Ends exactly where 0026 begins — not "0026 is last", which every later
      // wave would invalidate.
      expect(PRE_0026.at(-1)?.name).toBe('0025_schema_change_acknowledged_rows');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0026 });

      await t.meta.db
        .insertInto('adminium_email_templates')
        .values({
          id: 'tpl_PRE0026',
          key: 'password-reset',
          locale: 'en_US',
          name: 'Password reset',
          subject: 'Reset your {{appName}} password',
          blocks: JSON.stringify(LEGACY_BLOCKS),
          enabled: t.meta.dialect === 'postgres' ? true : 1,
          isBuiltinCopy: t.meta.dialect === 'postgres' ? true : 1,
          updatedBy: null,
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

      const row = await emailTemplatesRepo(t.meta).findById('tpl_PRE0026');
      expect(row).not.toBeNull();
      // The trailing footer BLOCK is the envelope's footer now, and gone from
      // the blocks the caller sees; the row itself is untouched.
      expect(row?.footer).toBe('Paste this link: {{resetUrl}}');
      expect(row?.blocks.map((b) => b['block'])).toEqual(['email.heading', 'email.text', 'email.divider']);
      expect(row).toMatchObject({
        kind: 'template',
        category: 'transactional',
        starter: null,
        needsTranslation: false,
        archivedAt: null,
        preheader: '',
        brand: null,
        attachments: [],
        createdBy: null,
        isBuiltinCopy: true,
        enabled: true,
      });
    });

    it('creates the saved-blocks and runs tables, with the run cascading on delete', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const templates = emailTemplatesRepo(t.meta);
      const campaign = await templates.create(
        {
          kind: 'campaign',
          key: 'weekly-digest',
          locale: 'en_US',
          name: 'Weekly digest',
          subject: 'Your week',
          blocks: [],
        },
        T0,
      );

      const block = await emailBlocksRepo(t.meta).create(
        { name: 'Signature', block: { id: 'x', block: 'email.text', data: { paras: ['— The team'] } } },
        T0,
      );
      expect((await emailBlocksRepo(t.meta).list()).map((b) => b.id)).toEqual([block.id]);

      const runs = emailRunsRepo(t.meta);
      const run = await runs.create(
        { templateId: campaign.id, audience: { kind: 'users' }, scheduledAt: T0 + 1_000 },
        T0,
      );
      expect(run.status).toBe('scheduled');
      expect(await runs.active(campaign.id)).toMatchObject({ id: run.id });

      // Delete for good takes the history with it (FK cascade), on every dialect.
      expect(await templates.removeById(campaign.id)).toBe(true);
      expect(await runs.findById(run.id)).toBeNull();
    });
  });
}

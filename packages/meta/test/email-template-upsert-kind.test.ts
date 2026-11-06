// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's install writes its mails with the store's `upsert`: a campaign it
 * ships is kept as a campaign, with its purpose, its brand and its files, on
 * every dialect; a row written without a kind is a template, and an existing
 * row written again without one keeps the kind it has.
 */
import { describe, expect, it } from 'vitest';

import { emailTemplatesRepo } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const BRAND = { name: 'Shop', mark: 'leaf' as const, accent: '#1f7a4d', fromName: 'The shop', fromEmail: 'hello@shop.test' };
const text = { subject: 'News', blocks: [{ id: 'text-1', block: 'email.text', data: { text: 'Hello' } }], enabled: true };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`an app's mail written by upsert [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('keeps a campaign as one, with its purpose, brand and files', async () => {
      const repo = emailTemplatesRepo(meta());
      const attachments = [{ id: 'app-0123456789abcdef0123456789abcdef', kind: 'file' as const, fileId: 'file_01' }];
      const row = await repo.upsert('shop-news', 'en_US', { ...text, name: 'News', kind: 'campaign', category: 'marketing', brand: BRAND, attachments, managedBy: 'shop' }, 1_000);
      expect(row).toMatchObject({ kind: 'campaign', category: 'marketing', brand: BRAND, attachments, managedBy: 'shop' });
      // Written again without a kind: the row stays a campaign.
      const again = await repo.upsert('shop-news', 'en_US', { ...text, name: 'News, again' }, 2_000);
      expect(again).toMatchObject({ kind: 'campaign', name: 'News, again' });
      // And with one: it becomes what it is given.
      expect((await repo.upsert('shop-news', 'en_US', { ...text, name: 'News', kind: 'template', brand: null, attachments: [] }, 3_000))).toMatchObject({ kind: 'template', brand: null, attachments: [] });
    });

    it('makes a template of a row written without a kind', async () => {
      const row = await emailTemplatesRepo(meta()).upsert('shop-receipt', 'en_US', { ...text, name: 'Receipt' }, 1_000);
      expect(row).toMatchObject({ kind: 'template', category: 'transactional', brand: null, attachments: [] });
    });
  });
}

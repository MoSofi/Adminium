// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DATABASE'S MAILS, SAVED AS AN APP AND INSTALLED AGAIN.
 *
 * A campaign the person chose travels under the key the install gives it,
 * in each of its languages, with its kind, category, brand and the files it
 * carries (as files of the package, read from the Files library). The address
 * it is sent from never travels: the file holds an empty sender, a file made
 * on an Adminium is installed with an empty sender whatever it says, and the
 * owner's "after you install" list names it. A built-in mail never travels;
 * an edited one is said. On every engine the machine runs.
 */
import { emailTemplatesRepo, filesRepo, newId, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { emailTarget } from '../src/apps/save/email.js';
import { ENGINES, type Harness } from './app-install-harness.js';
import { afterInstallOf, APP_KEY, expectValid, installFile, leaked, save, sourceDatabase, standIns, target, type Doc, type Source } from './app-save-rules.helpers.js';

const PDF = '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n';
const SENDER = 'hello@shop.test';
const BRAND = { name: 'Corner shop', mark: 'leaf' as const, accent: '#1f7a4d', fromName: 'The corner shop', fromEmail: SENDER };

/** A file of the library, with its bytes. */
async function libraryFile(source: Source, filename: string, body: string): Promise<string> {
  const id = newId('file');
  const bytes = Buffer.from(body);
  const stored = await source.library.write({ id, kind: 'upload', filename, mime: 'application/pdf', bytes });
  await filesRepo(source.h.meta).create({ id, filename, mime: 'application/pdf', sizeBytes: bytes.length, sha256: stored.sha256, storageKey: stored.storageKey, storage: 'memory', destinationId: null, kind: 'upload', attachedAt: Date.now() });
  return id;
}

async function mails(source: Source) {
  const templates = emailTemplatesRepo(source.h.meta);
  const fileId = await libraryFile(source, 'terms.pdf', PDF);
  const attachments = [{ id: 'att-terms', kind: 'file' as const, fileId }];
  const envelope = { kind: 'campaign' as const, category: 'marketing' as const, brand: BRAND, attachments };
  await templates.upsert('news', 'en_US', { name: 'News', subject: 'News from the shop', blocks: [{ id: 'text-1', block: 'email.text', data: { text: 'Hello' }, style: {} }], enabled: true, footer: 'The corner shop', ...envelope });
  await templates.upsert('news', 'de_DE', { name: 'Neuigkeiten', subject: 'Neues vom Laden', blocks: [{ id: 'text-1', block: 'email.text', data: { text: 'Hallo' }, style: {} }], enabled: true, footer: 'Der Laden', ...envelope });
  // A campaign in German alone, and an edited built-in mail.
  await templates.upsert('angebot', 'de_DE', { name: 'Angebot', subject: 'Ein Angebot', blocks: [{ id: 'text-1', block: 'email.text', data: { text: 'Hallo' }, style: {} }], enabled: true, kind: 'campaign', category: 'marketing' });
  await templates.upsert('password-reset', 'en_US', { name: 'Reset your password', subject: 'Reset it', blocks: [{ id: 'text-1', block: 'email.text', data: { text: 'Here' }, style: {} }], enabled: true, isBuiltinCopy: false });
  return { fileId };
}

const templateRows = (meta: MetaDb, key: string) => emailTemplatesRepo(meta).list().then((rows) => rows.filter((row) => row.key === key));

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a database's mails, saved and installed [${dialect}]`, () => {
    let source: Source | null = null;
    let other: (Harness & { library: { kept: Map<string, Buffer> } }) | null = null;
    afterEach(async () => {
      await source?.h.close();
      await other?.close();
      source = null;
      other = null;
    });

    it('writes a chosen campaign in its two languages with its file and brand, never its sender, and installs it so', async () => {
      source = await sourceDatabase(dialect);
      const { fileId } = await mails(source);

      // A campaign with no US English waits for an answer.
      const first = await save(source, { emailTemplates: ['news', 'angebot'] });
      expect(first.check).toContainEqual(expect.objectContaining({ group: 'choice', code: 'EMAIL_NO_ENGLISH', item: 'Angebot', answer: { choices: ['leave-out'], target: emailTarget('angebot') } }));
      const { manifest, check, files } = await save(source, { emailTemplates: ['news', 'angebot'], leaveOut: [emailTarget('angebot')] });
      expect(check.filter((item) => item.group === 'choice' && item.code !== 'NO_PAGE')).toEqual([]);
      const doc = manifest as unknown as Doc;

      expect(doc['emailTemplates']).toEqual([
        {
          key: `${APP_KEY}-news`,
          name: { 'en-US': 'News', 'de-DE': 'Neuigkeiten' },
          kind: 'campaign',
          category: 'marketing',
          brand: { ...BRAND, fromEmail: '' },
          attachments: [{ file: 'emails/terms.pdf' }],
          locales: {
            'en-US': { subject: 'News from the shop', blocks: [{ block: 'email.text', id: 'text-1', data: { text: 'Hello' } }], footer: 'The corner shop' },
            'de-DE': { subject: 'Neues vom Laden', blocks: [{ block: 'email.text', id: 'text-1', data: { text: 'Hallo' } }], footer: 'Der Laden' },
          },
        },
      ]);
      expect(Buffer.from(files.get('emails/terms.pdf')!).toString()).toBe(PDF);
      expect(check).toContainEqual(expect.objectContaining({ group: 'after', code: 'SENDER', kind: 'email', item: 'News', field: 'brand.fromEmail', afterKind: 'sender' }));
      expect(check).toContainEqual(expect.objectContaining({ group: 'info', code: 'BUILTIN_EMAIL_EDITED', item: 'Reset your password' }));
      // No sender, no library id, no source id.
      expect(leaked(doc, [SENDER, fileId, 'att-terms', source.h.connectionId])).toEqual([]);

      const file = standIns(doc);
      expectValid(file);
      other = await target(dialect);
      await installFile(other, file, files);

      const rows = await templateRows(other.meta, `${APP_KEY}-news`);
      expect(rows.map((row) => row.locale).sort()).toEqual(['de_DE', 'en_US']);
      const english = rows.find((row) => row.locale === 'en_US')!;
      expect(english).toMatchObject({ kind: 'campaign', category: 'marketing', name: 'News', subject: 'News from the shop', footer: 'The corner shop', brand: { ...BRAND, fromEmail: '' } });
      const [attached] = english.attachments as { kind: 'file'; fileId: string }[];
      expect(other.library.kept.get(attached!.fileId)?.toString()).toBe(PDF);
      expect(await afterInstallOf(other)).toEqual([['sender', `${APP_KEY}-news`, 'brand.fromEmail']]);
    });

    it('names the table a block lists rows of by its ref, and leaves out a block of a table that does not travel', async () => {
      source = await sourceDatabase(dialect);
      const rowsOf = (table: string) => ({ id: `rows-${table}`, block: 'email.rows', data: { from: { link: 'order', table: source!.tableId(table), via: 'customer_id' }, row: { title: '{{row.status}}' } }, style: { pad: 'l' } });
      await emailTemplatesRepo(source.h.meta).upsert('digest', 'en_US', { name: 'Digest', subject: 'Your orders', blocks: [rowsOf('orders'), rowsOf('customers'), { id: 'raw', block: 'email.html', data: { html: '<b>hi</b>' } }], enabled: true, kind: 'campaign' });
      const { manifest, check } = await save(source, { emailTemplates: ['digest'], tables: [source.tableId('orders')] });
      const [written] = (manifest as unknown as Doc)['emailTemplates'] as Doc[];
      expect(written!['locales']['en-US'].blocks).toEqual([{ block: 'email.rows', id: 'rows-orders', data: { from: { link: 'order', table: 'orders', via: 'customer_id' }, row: { title: '{{row.status}}' } } }]);
      expect(check.filter((item) => item.kind === 'email').map((item) => item.code).sort()).toEqual(['EMAIL_BLOCK_STYLE', 'EMAIL_HTML_BLOCK', 'EMAIL_ROWS_TABLE']);
    });
  });
}

describe('a sender in a file', () => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.close();
    h = null;
  });

  const app = (publisher: { id: string; name: string }, saved = true): Doc =>
    standIns({
      ...(saved ? { provenance: { lineage: 'lin-test-0002', savedAt: '2026-11-06T09:00:00Z', adminiumVersion: '0.3.49', label: 'Corner shop, Leith' } } : {}),
      kind: 'app',
      manifestVersion: 1,
      key: APP_KEY,
      name: 'Corner shop',
      version: '1.0.0',
      publisher,
      license: 'UNLICENSED',
      description: { key: `${APP_KEY}.description`, fallback: 'A shop.' },
      categories: ['operations'],
      compatibility: { minAdminiumVersion: '0.3.49' },
      requiredSchema: { tables: [] },
      pages: [],
      frontends: [{ side: 'staff', kind: 'none' }],
      emailTemplates: [{ key: `${APP_KEY}-news`, name: 'News', kind: 'campaign', brand: BRAND, locales: { 'en-US': { subject: 'News', blocks: [{ block: 'email.text', data: { text: 'Hello' } }] } } }],
    });

  it('saved from a database: installed empty whatever it says, and listed in the review and after installing', async () => {
    h = await target('sqlite');
    const doc = app({ id: 'local', name: 'Corner shop, Leith' });
    expectValid(doc);
    await h.stage(doc);
    const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: APP_KEY, version: '1.0.0', connectionId: h.connectionId } });
    expect(planned.statusCode, planned.body).toBe(200);
    const plan = (JSON.parse(planned.body) as { plan: { afterInstall?: Doc[] } }).plan;
    expect((plan.afterInstall ?? []).map((item) => [item['kind'], item['item'], item['field']])).toEqual([['sender', `${APP_KEY}-news`, 'brand.fromEmail']]);
    await installFile(h, doc);
    const [row] = await templateRows(h.meta, `${APP_KEY}-news`);
    expect(row!.brand).toEqual({ ...BRAND, fromEmail: '' });
    expect(await afterInstallOf(h)).toEqual([['sender', `${APP_KEY}-news`, 'brand.fromEmail']]);
  });

  it('from a publisher, or a project\'s own app: kept as its author wrote it', async () => {
    h = await target('sqlite');
    await installFile(h, app({ id: 'adminium', name: 'Adminium' }, false));
    const [row] = await templateRows(h.meta, `${APP_KEY}-news`);
    expect(row!.brand).toEqual(BRAND);
    expect(await afterInstallOf(h)).toEqual([]);
  });
});

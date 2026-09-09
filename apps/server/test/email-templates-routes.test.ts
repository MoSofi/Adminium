// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email-documents routes (39-email-templates-and-campaigns.md §3.1;
 * 39-T03) — driven through a bare Fastify app with the real rbac plugin and
 * an `x-test-user-id` header, the way `email-send.test.ts` mounts them.
 *
 * The assertions that carry the wave: a test send queues the REQUEST's
 * document, never the stored row (39 D1); a save with mirror ops changes
 * every sibling and nothing else; a built-in is reset rather than deleted
 * (D4); an export re-imports byte-identical (D14); and every write is a
 * `settings.manage` power while every read is a session's.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteMetaDb,
  emailTemplatesRepo,
  filesRepo,
  firstRun,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';


import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey, resetEmailRuntime } from '../src/email/send.js';
import type { FileStore } from '../src/files/store.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { emailTemplatesRoutes } from '../src/routes/email-templates/index.js';
import type { EmailDocumentDetailView } from '../src/routes/email-templates/schema.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { TEST_SECRET } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4 sample bytes for the attachment test');
const PDF_SHA = createHash('sha256').update(PDF).digest('hex');

/**
 * The starter's name as the CATALOGUE spells it, read straight from the locale
 * bundle on disk.
 *
 * This used to call `createServerI18n` + `renderStarter` — the very path the
 * assertions exercise — so both sides moved together and the test could not
 * fail. That mattered: `email` is a deferred namespace, and until
 * `createServerI18n` learned to load the deferred set, the server rendered
 * English for every non-English recipient while this oracle cheerfully
 * expected English too. An oracle has to be able to disagree with the code.
 */
function starterName(key: 'welcome', locale: string): string {
  const tag = locale.replaceAll('_', '-');
  const bundle = JSON.parse(
    readFileSync(new URL(`../../../packages/i18n/locales/${tag}/email.json`, import.meta.url), 'utf8'),
  ) as { starters: Record<string, { name: string }> };
  return bundle.starters[key]!.name;
}

/** A file store that serves one buffer per storage key — no disk, no spool. */
function fakeStorage(bytes: Map<string, Buffer>): FileStore {
  return {
    async open(file: { storageKey: string }) {
      const content = bytes.get(file.storageKey);
      if (content === undefined) throw new Error(`no bytes for ${file.storageKey}`);
      return { stream: Readable.from([content]), sizeBytes: content.length };
    },
    async write(input: { id: string; bytes: Buffer | string }) {
      const content = typeof input.bytes === 'string' ? Buffer.from(input.bytes) : input.bytes;
      bytes.set(input.id, content);
      return {
        storageKey: input.id,
        sizeBytes: content.length,
        sha256: 'b'.repeat(64),
        destinationId: null,
        storage: 'local',
      };
    },
  } as unknown as FileStore;
}

async function configureSmtp(meta: MetaDb): Promise<void> {
  await settingsRepo(meta).set(
    'email.smtp',
    {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('relay-password', emailSecretKey(TEST_SECRET)),
      from: 'Adminium <no-reply@adminium.test>',
      secure: false,
    },
    { updatedBy: null },
  );
}

async function jobRows(meta: MetaDb) {
  return await meta.db.selectFrom('adminium_jobs').selectAll().orderBy('id', 'asc').execute();
}

describe('email document routes (39-T03)', () => {
  let meta: MetaDb;
  let app: BareApp;
  let manager: User;
  let viewer: User;
  const bytes = new Map<string, Buffer>();

  async function role(slug: string): Promise<Role> {
    const found = await rolesRepo(meta).findBySlug(slug);
    if (found === null) throw new Error(`missing built-in role ${slug}`);
    return found;
  }

  beforeEach(async () => {
    resetEmailRuntime();
    bytes.clear();
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await seedBuiltinEmailTemplates(meta, 1_000);
    const users = usersRepo(meta);
    manager = await users.create({ email: 'ava@adminium.test', name: 'Ava', status: 'active' });
    viewer = await users.create({ email: 'liam@adminium.test', name: 'Liam', status: 'active' });
    await rolesRepo(meta).assignToUser(manager.id, (await role('super-admin')).id);
    await rolesRepo(meta).assignToUser(viewer.id, (await role('viewer')).id);

    app = buildBareApp();
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string' && id.length > 0) {
        (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
      }
    });
    await app.register(rbacPlugin, { meta });
    await app.register(emailTemplatesRoutes({ meta, secret: TEST_SECRET, storage: fakeStorage(bytes) }));
    await app.ready();
  });

  afterEach(async () => {
    resetEmailRuntime();
    await app.close();
    await meta.db.destroy();
  });

  function as(user: User) {
    return { 'x-test-user-id': user.id };
  }

  async function create(body: Record<string, unknown>, user: User = manager): Promise<EmailDocumentDetailView> {
    const res = await app.inject({ method: 'POST', url: '/email-templates', headers: as(user), payload: body });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as EmailDocumentDetailView;
  }

  async function detail(id: string): Promise<EmailDocumentDetailView> {
    const res = await app.inject({ method: 'GET', url: `/email-templates/${id}`, headers: as(viewer) });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as EmailDocumentDetailView;
  }

  it('lists the seeded built-ins with counts, topic labels and the read alias', async () => {
    const res = await app.inject({ method: 'GET', url: '/email-templates?kind=template', headers: as(viewer) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { key: string; locale: string; isBuiltin: boolean; topicLabel: string }[]; counts: { template: number; campaign: number; archived: number } };
    expect(body.counts).toEqual({ template: 24, campaign: 0, archived: 0 });
    const reset = body.items.filter((i) => i.key === 'password-reset');
    expect(reset).toHaveLength(8);
    expect(reset[0]?.locale).toBe('en_US');
    expect(reset.every((i) => i.isBuiltin && i.topicLabel === 'Password reset')).toBe(true);

    const alias = await app.inject({ method: 'GET', url: '/email-templates/password-reset/de_DE', headers: as(viewer) });
    expect(alias.statusCode).toBe(200);
    expect((alias.json() as EmailDocumentDetailView).vars).toEqual(['appName', 'name', 'email', 'resetUrl', 'expiresInMinutes']);
    expect((alias.json() as EmailDocumentDetailView).languages).toHaveLength(8);
  });

  it('creates from a starter in the requested locale, mints the key, and adds a translated language', async () => {
    const doc = await create({ kind: 'template', starter: 'welcome', locale: 'de_DE' });
    const deName = starterName('welcome', 'de_DE');
    expect(doc.name).toBe(deName);
    expect(doc.key).toBe(deName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, ''));
    expect(doc.locale).toBe('de_DE');
    expect(doc.starter).toBe('welcome');
    expect(doc.enabled).toBe(false);
    expect(doc.document.blocks.map((b) => b.block)).toEqual([
      'email.heading',
      'email.text',
      'email.image',
      'email.list',
      'email.divider',
      'email.social',
      'email.button',
    ]);
    expect(doc.vars).toEqual(['appName', 'name', 'first_name', 'email']);

    // The same name twice mints `-2`.
    const again = await create({ kind: 'template', starter: 'welcome', locale: 'de_DE' });
    expect(again.key).toBe(`${doc.key}-2`);

    const add = await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/languages`, headers: as(manager), payload: { locale: 'fr_FR' } });
    expect(add.statusCode, add.body).toBe(201);
    const fr = add.json() as EmailDocumentDetailView;
    expect(fr.key).toBe(doc.key);
    expect(fr.locale).toBe('fr_FR');
    expect(fr.needsTranslation).toBe(false);
    expect(fr.name).toBe(starterName('welcome', 'fr_FR'));
    expect(fr.languages.map((l) => l.locale)).toEqual(['de_DE', 'fr_FR']);

    const dup = await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/languages`, headers: as(manager), payload: { locale: 'fr_FR' } });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { error: { details: { existingId: string } } }).error.details.existingId).toBe(fr.id);

    const bogus = await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/languages`, headers: as(manager), payload: { locale: 'xx_XX' } });
    expect(bogus.statusCode).toBe(422);
  });

  it('a blank document names itself, and its added language is a copy that needs translation', async () => {
    const blank = await create({ kind: 'campaign' });
    expect(blank.name).toBe('Untitled campaign');
    expect(blank.key).toBe('untitled-campaign');
    expect(blank.document.blocks.map((b) => b.block)).toEqual(['email.heading', 'email.text', 'email.button']);
    const add = await app.inject({ method: 'POST', url: `/email-templates/${blank.id}/languages`, headers: as(manager), payload: { locale: 'ar_EG' } });
    expect(add.statusCode).toBe(201);
    const ar = add.json() as EmailDocumentDetailView;
    expect(ar.needsTranslation).toBe(true);
    expect(ar.name).toBe('Untitled campaign · العربية (مصر)');
    expect(ar.document.subject).toBe(blank.document.subject);
  });

  it('PUT saves the document, clears needs-translation, and mirrors ops to every sibling and none other', async () => {
    const en = await create({ kind: 'template', name: 'Welcome email', starter: 'welcome' });
    const de = (await app.inject({ method: 'POST', url: `/email-templates/${en.id}/languages`, headers: as(manager), payload: { locale: 'de_DE' } })).json() as EmailDocumentDetailView;
    const other = await create({ kind: 'template', name: 'Other', starter: 'digest' });
    const before = await detail(de.id);

    const divider = { id: 'new-divider', block: 'email.divider', data: { height: 22, line: true }, style: {} };
    const put = await app.inject({
      method: 'PUT',
      url: `/email-templates/${en.id}`,
      headers: as(manager),
      payload: {
        name: 'Welcome email v2',
        category: 'marketing',
        enabled: true,
        document: { ...en.document, subject: 'Hello {{first_name}}', blocks: [en.document.blocks[0], divider, ...en.document.blocks.slice(1)] },
        mirrorOps: [{ kind: 'insert', index: 1, block: divider }],
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    const saved = put.json() as EmailDocumentDetailView;
    expect(saved).toMatchObject({ name: 'Welcome email v2', category: 'marketing', enabled: true, needsTranslation: false, isBuiltinCopy: false });
    expect(saved.document.subject).toBe('Hello {{first_name}}');
    expect(saved.document.blocks[1]?.id).toBe('new-divider');

    const mirrored = await detail(de.id);
    expect(mirrored.document.blocks).toHaveLength(before.document.blocks.length + 1);
    expect(mirrored.document.blocks[1]?.block).toBe('email.divider');
    expect(mirrored.document.blocks[1]?.id).not.toBe('new-divider');
    // The German subject is untouched — only structure mirrors (39 D1).
    expect(mirrored.document.subject).toBe(before.document.subject);
    expect((await detail(other.id)).document.blocks).toHaveLength(other.document.blocks.length);
  });

  it('PUT refuses an unconfigured sender and an over-cap attachment set, naming the reason', async () => {
    const doc = await create({ kind: 'template', name: 'Senders' });
    await settingsRepo(meta).set('email.senders', [{ name: 'News', address: 'news@adminium.test' }], { updatedBy: null });
    const body = (brand: Record<string, unknown>) => ({
      name: doc.name,
      category: doc.category,
      enabled: false,
      document: { ...doc.document, brand },
    });
    const bad = await app.inject({ method: 'PUT', url: `/email-templates/${doc.id}`, headers: as(manager), payload: body({ name: 'X', mark: 'zap', accent: '#0d9488', fromName: 'X', fromEmail: 'nope@adminium.test' }) });
    expect(bad.statusCode).toBe(422);
    expect((bad.json() as { error: { details: { code: string } } }).error.details.code).toBe('SENDER_NOT_CONFIGURED');
    const ok = await app.inject({ method: 'PUT', url: `/email-templates/${doc.id}`, headers: as(manager), payload: body({ name: 'X', mark: 'zap', accent: '#0d9488', fromName: 'News', fromEmail: 'news@adminium.test' }) });
    expect(ok.statusCode, ok.body).toBe(200);

    const big = await filesRepo(meta).create({ filename: 'big.pdf', mime: 'application/pdf', sizeBytes: 11 * 1024 * 1024, sha256: 'c'.repeat(64), kind: 'upload', attachedAt: 1 });
    const over = await app.inject({
      method: 'PUT',
      url: `/email-templates/${doc.id}`,
      headers: as(manager),
      payload: { name: doc.name, category: doc.category, enabled: false, document: { ...doc.document, attachments: [{ id: 'a1', kind: 'file', fileId: big.id }] } },
    });
    expect(over.statusCode).toBe(422);
    expect((over.json() as { error: { details: { code: string; cap: number } } }).error.details).toMatchObject({ code: 'ATTACHMENTS_OVER_CAP', cap: 10_485_760 });
  });

  it('PATCH renames, flips Draft/Live, archives with restore, and DELETE removes a user document', async () => {
    const doc = await create({ kind: 'template', name: 'Patch me' });
    const renamed = await app.inject({ method: 'PATCH', url: `/email-templates/${doc.id}`, headers: as(manager), payload: { name: 'Renamed', enabled: true } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'Renamed', enabled: true, topicLabel: 'Renamed' });

    const archived = await app.inject({ method: 'PATCH', url: `/email-templates/${doc.id}`, headers: as(manager), payload: { archived: true } });
    expect((archived.json() as { archivedAt: number | null }).archivedAt).not.toBeNull();
    const live = (await app.inject({ method: 'GET', url: '/email-templates?kind=template', headers: as(viewer) })).json() as { items: { id: string }[]; counts: { archived: number } };
    expect(live.items.some((i) => i.id === doc.id)).toBe(false);
    expect(live.counts.archived).toBe(1);
    const shelf = (await app.inject({ method: 'GET', url: '/email-templates?archived=true', headers: as(viewer) })).json() as { items: { id: string }[] };
    expect(shelf.items.map((i) => i.id)).toEqual([doc.id]);

    const restored = await app.inject({ method: 'PATCH', url: `/email-templates/${doc.id}`, headers: as(manager), payload: { archived: false } });
    expect((restored.json() as { archivedAt: number | null }).archivedAt).toBeNull();

    const gone = await app.inject({ method: 'DELETE', url: `/email-templates/${doc.id}`, headers: as(manager) });
    expect(gone.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/email-templates/${doc.id}`, headers: as(viewer) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/email-templates/${doc.id}`, headers: as(manager), payload: {} })).statusCode).toBe(422);
  });

  it('DELETE on a built-in resets it to the shipped copy instead of removing it (39 D4)', async () => {
    const seeded = await emailTemplatesRepo(meta).findByKeyLocale('password-reset', 'en_US');
    if (seeded === null) throw new Error('seed missing');
    const edited = await app.inject({
      method: 'PUT',
      url: `/email-templates/${seeded.id}`,
      headers: as(manager),
      payload: { name: 'Our reset', category: 'lifecycle', enabled: false, document: { subject: 'Custom', blocks: [] } },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect((edited.json() as EmailDocumentDetailView).isBuiltinCopy).toBe(false);
    await app.inject({ method: 'PATCH', url: `/email-templates/${seeded.id}`, headers: as(manager), payload: { archived: true } });

    const reset = await app.inject({ method: 'DELETE', url: `/email-templates/${seeded.id}`, headers: as(manager) });
    expect(reset.statusCode).toBe(200);
    const row = reset.json() as EmailDocumentDetailView;
    expect(row).toMatchObject({ id: seeded.id, isBuiltinCopy: true, isBuiltin: true, enabled: true, archivedAt: null, name: 'Password reset' });
    expect(row.document.subject).toBe('Reset your {{appName}} password');
    expect(row.document.blocks.map((b) => b.id)).toEqual(['heading', 'intro', 'action', 'notice']);
    expect(row.document.footer).toContain('{{resetUrl}}');
  });

  it('test-send queues one job per address carrying the REQUEST document, with its parts (39 D1, D8)', async () => {
    const doc = await create({ kind: 'template', name: 'Test me', starter: 'welcome' });
    const unset = await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/test-send`, headers: as(manager), payload: { to: ['ops@adminium.test'], document: doc.document } });
    expect(unset.statusCode).toBe(409);

    await configureSmtp(meta);
    const pdf = await filesRepo(meta).create({ filename: 'onboarding.pdf', mime: 'application/pdf', sizeBytes: PDF.length, sha256: PDF_SHA, kind: 'upload', attachedAt: 1 });
    bytes.set(pdf.storageKey, PDF);
    const onScreen = {
      ...doc.document,
      subject: 'UNSAVED subject {{first_name}}',
      attachments: [{ id: 'a1', kind: 'file', fileId: pdf.id }],
    };
    const res = await app.inject({
      method: 'POST',
      url: `/email-templates/${doc.id}/test-send`,
      headers: as(manager),
      payload: { to: ['a@adminium.test', 'b@adminium.test', 'c@adminium.test'], document: onScreen },
    });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toEqual({ queued: 3, locale: 'en_US' });

    const rows = await jobRows(meta);
    expect(rows).toHaveLength(3);
    const payload = JSON.parse(String(rows[0]?.payload)) as { v: number; envelope: string; attachments: { fileId: string; filename: string }[]; inline: { cid: string; kind: string }[] };
    expect(payload.v).toBe(2);
    expect(payload.attachments).toEqual([{ fileId: pdf.id, filename: 'onboarding.pdf' }]);
    expect(payload.inline).toEqual([{ cid: 'mark', kind: 'mark', mark: 'hexagon' }]);
    const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { subject: string; html: string; to: string };
    expect(envelope.subject).toBe('UNSAVED subject Sample');
    expect(envelope.html).toContain('cid:mark');
    // The stored row was never touched by the test send.
    expect((await detail(doc.id)).document.subject).toBe(doc.document.subject);
  });

  it('export → import round-trips documents byte-identically in Replace mode and creates none in Skip mode', async () => {
    const a = await create({ kind: 'template', name: 'Alpha', starter: 'welcome' });
    const b = await create({ kind: 'campaign', name: 'Beta', starter: 'digest' });
    const pdf = await filesRepo(meta).create({ filename: 'terms.pdf', mime: 'application/pdf', sizeBytes: PDF.length, sha256: PDF_SHA, kind: 'upload', attachedAt: 1 });
    bytes.set(pdf.storageKey, PDF);
    await app.inject({
      method: 'PUT',
      url: `/email-templates/${a.id}`,
      headers: as(manager),
      payload: { name: a.name, category: a.category, enabled: true, document: { ...a.document, attachments: [{ id: 'at1', kind: 'file', fileId: pdf.id }] } },
    });

    const exported = await app.inject({ method: 'GET', url: `/email-templates/export?ids=${a.id},${b.id}`, headers: as(manager) });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers['content-disposition']).toMatch(/^attachment; filename="adminium-email-templates-\d{4}-\d{2}-\d{2}\.json"$/);
    const bundle = exported.json() as { adminium: { kind: string; version: number }; documents: { key: string; files: { attachmentId: string; base64: string }[] }[] };
    expect(bundle.adminium).toEqual({ kind: 'email-templates', version: 1 });
    expect(bundle.documents.map((d) => d.key).sort()).toEqual(['alpha', 'beta']);
    expect(bundle.documents.find((d) => d.key === 'alpha')?.files).toEqual([expect.objectContaining({ attachmentId: 'at1', base64: PDF.toString('base64') })]);

    const skip = await app.inject({ method: 'POST', url: '/email-templates/import', headers: as(manager), payload: { bundle, mode: 'skip' } });
    expect(skip.statusCode, skip.body).toBe(200);
    expect(skip.json()).toEqual({ created: 0, replaced: 0, skipped: 2, errors: [] });

    const beforeA = await detail(a.id);
    const replace = await app.inject({ method: 'POST', url: '/email-templates/import', headers: as(manager), payload: { bundle, mode: 'replace' } });
    expect(replace.json()).toEqual({ created: 0, replaced: 2, skipped: 0, errors: [] });
    const afterA = await detail(a.id);
    expect(afterA.document).toEqual(beforeA.document);
    expect(afterA.name).toBe('Alpha');

    // Deleting both and importing again creates them, re-using the deduped file.
    await app.inject({ method: 'DELETE', url: `/email-templates/${a.id}`, headers: as(manager) });
    await app.inject({ method: 'DELETE', url: `/email-templates/${b.id}`, headers: as(manager) });
    const fresh = await app.inject({ method: 'POST', url: '/email-templates/import', headers: as(manager), payload: { bundle, mode: 'skip' } });
    expect(fresh.json()).toEqual({ created: 2, replaced: 0, skipped: 0, errors: [] });
    const rows = await emailTemplatesRepo(meta).list({ kind: 'template' });
    const alpha = rows.find((r) => r.key === 'alpha');
    expect(alpha?.attachments).toEqual([{ id: 'at1', kind: 'file', fileId: expect.any(String) }]);
  });

  it('import refuses a bundle whose senders are not configured, naming them, before writing anything', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/email-templates/import',
      headers: as(manager),
      payload: {
        bundle: {
          adminium: { kind: 'email-templates', version: 1 },
          documents: [
            {
              kind: 'template', key: 'from-elsewhere', locale: 'en_US', name: 'Elsewhere', category: 'marketing', starter: null,
              subject: 'S', preheader: '', blocks: [], footer: '', attachments: [], files: [],
              brand: { name: 'Else', mark: 'star', accent: '#111111', fromName: 'Else', fromEmail: 'else@other.test' },
            },
          ],
        },
        mode: 'skip',
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { details: { addresses: string[] } } }).error.details.addresses).toEqual(['else@other.test']);
    expect(await emailTemplatesRepo(meta).findByKeyLocale('from-elsewhere', 'en_US')).toBeNull();
  });

  it('duplicate, from-template, starters and saved blocks', async () => {
    const tpl = await create({ kind: 'template', name: 'Source', starter: 'feedback' });
    const dup = await app.inject({ method: 'POST', url: `/email-templates/${tpl.id}/duplicate`, headers: as(manager) });
    expect(dup.statusCode).toBe(201);
    expect(dup.json()).toMatchObject({ name: 'Source (copy)', key: 'source-copy', enabled: false, kind: 'template' });

    const campaign = await app.inject({ method: 'POST', url: `/email-templates/${tpl.id}/from-template`, headers: as(manager), payload: {} });
    expect(campaign.statusCode, campaign.body).toBe(201);
    const c = campaign.json() as EmailDocumentDetailView;
    expect(c).toMatchObject({ kind: 'campaign', name: 'Source', key: 'source-2', starter: 'feedback' });
    expect(c.document.blocks.map((b) => b.block)).toEqual(tpl.document.blocks.map((b) => b.block));
    expect((await app.inject({ method: 'POST', url: `/email-templates/${c.id}/from-template`, headers: as(manager), payload: {} })).statusCode).toBe(409);

    const starters = await app.inject({ method: 'GET', url: '/email-templates/starters', headers: as(viewer) });
    expect((starters.json() as { starters: { key: string }[] }).starters).toHaveLength(12);

    const saved = await app.inject({ method: 'POST', url: '/email-blocks', headers: as(manager), payload: { name: 'Sig', block: { id: 'x', block: 'email.text', data: { paras: ['— Us'] } } } });
    expect(saved.statusCode).toBe(201);
    const id = (saved.json() as { block: { id: string } }).block.id;
    expect(((await app.inject({ method: 'GET', url: '/email-blocks', headers: as(viewer) })).json() as { blocks: { id: string }[] }).blocks.map((b) => b.id)).toEqual([id]);
    expect((await app.inject({ method: 'DELETE', url: `/email-blocks/${id}`, headers: as(manager) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/email-blocks/${id}`, headers: as(manager) })).statusCode).toBe(404);
  });

  it('reads need a session; every write is a settings.manage power that names the permission', async () => {
    const tpl = await create({ kind: 'template', name: 'Guarded' });
    expect((await app.inject({ method: 'GET', url: '/email-templates' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/email-templates/${tpl.id}`, headers: as(viewer) })).statusCode).toBe(200);
    const writes = [
      app.inject({ method: 'POST', url: '/email-templates', headers: as(viewer), payload: { kind: 'template' } }),
      app.inject({ method: 'PUT', url: `/email-templates/${tpl.id}`, headers: as(viewer), payload: { name: 'x', category: 'lifecycle', enabled: false, document: { subject: 's', blocks: [] } } }),
      app.inject({ method: 'PATCH', url: `/email-templates/${tpl.id}`, headers: as(viewer), payload: { name: 'x' } }),
      app.inject({ method: 'DELETE', url: `/email-templates/${tpl.id}`, headers: as(viewer) }),
      app.inject({ method: 'POST', url: `/email-templates/${tpl.id}/duplicate`, headers: as(viewer) }),
      app.inject({ method: 'POST', url: `/email-templates/${tpl.id}/test-send`, headers: as(viewer), payload: { to: ['x@y.test'], document: { subject: 's', blocks: [] } } }),
      app.inject({ method: 'GET', url: '/email-templates/export', headers: as(viewer) }),
      app.inject({ method: 'POST', url: '/email-blocks', headers: as(viewer), payload: { name: 'n', block: { block: 'email.text' } } }),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.statusCode, res.body).toBe(403);
      expect((res.json() as { error: { details: { permission: string } } }).error.details.permission).toBe('system:settings:manage');
    }
  });
});

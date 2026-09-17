// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page files: what a stored page becomes as `pages/<slug>.json`, and back.
 *
 * The pages are real generated ones (dashboards, CRUD pages, boards and
 * calendars, with widget bindings), and a second install stands for another
 * machine: its connection has a different id, so anything install-specific
 * left in a file would show up there.
 */
import { hashEnvelope } from '@adminium/engine';
import { connectionsRepo, newId, pagesRepo, type Page } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { applyPageFile } from '../src/project/apply-files.js';
import { memoryFileStore } from '../src/project/file-store.js';
import { findInstanceIds } from '../src/project/instance-ids.js';
import { contentHash } from '../src/project/json.js';
import { readPageFile, toLocalPage, toPageFile, type ProjectRefs } from '../src/project/page-files.js';
import {
  checkProjectFile,
  databasesWithPageFiles,
  exportProjectFiles,
  fileHash,
  loadInstallRefs,
  offlineRefs,
  type InstallRefs,
} from '../src/project/project-files.js';
import { INSTALL_SECRET, makeInstall, type Install } from './project-fixtures.js';

let one: Install;
let refs: InstallRefs;
let pages: Page[];

beforeEach(async () => {
  one = await makeInstall();
  refs = await loadInstallRefs(one.meta);
  pages = await pagesRepo(one.meta).listDocuments();
});
afterEach(async () => {
  await one.close();
});

function fileOf(page: Page, withRefs: ProjectRefs = refs): Record<string, unknown> {
  const result = toPageFile(page, withRefs);
  if (!result.ok) throw new Error(`${page.slug} stayed out: ${result.reason}`);
  return result.file;
}

function bodyOf(envelope: unknown): Record<string, unknown> {
  return (envelope as { config: Record<string, unknown> }).config;
}

/** Stable comparison of two JSON documents. */
function same(a: unknown, b: unknown): boolean {
  return contentHash(a) === contentHash(b);
}

describe('writing a stored page as a file', () => {
  it('generates several kinds of page to test with, some with widget bindings', () => {
    expect(new Set(pages.map((page) => page.type)).size).toBeGreaterThanOrEqual(3);
    expect(pages.some((page) => JSON.stringify(page.config).includes('"binding"'))).toBe(true);
  });

  it('leaves no install-specific value in any file', () => {
    for (const page of pages) {
      const file = fileOf(page);
      expect(findInstanceIds(file), page.slug).toEqual([]);
      expect(file['id']).toBeUndefined();
      expect((file['source'] as { database: unknown }).database).toBe('main');
      expect(file['origin']).toBe('generated');
      expect(JSON.stringify(file)).not.toContain(one.mainId);
    }
  });

  it('names the database of every widget binding by key', () => {
    const bound = pages.flatMap((page) => {
      const layout = bodyOf(fileOf(page))['layout'] as { items?: { config: { binding?: Record<string, unknown> } }[] } | undefined;
      return (layout?.items ?? []).flatMap((item) => (item.config.binding === undefined ? [] : [item.config.binding]));
    });
    expect(bound.length).toBeGreaterThan(0);
    for (const binding of bound) {
      expect(binding['database']).toBe('main');
      expect(binding).not.toHaveProperty('connectionId');
    }
  });

  it('moves the generated hash out of the document and keeps it meaningful', () => {
    for (const page of pages) {
      const file = fileOf(page);
      expect(bodyOf(file)).not.toHaveProperty('generatedHash');
      const portable = { ...file };
      for (const key of ['$schema', 'origin', 'enabled', 'generated']) delete portable[key];
      expect((file['generated'] as { hash: string }).hash).toBe(hashEnvelope(portable));
    }
  });

  it('keeps out pages a project cannot hold, and says why', async () => {
    const repo = pagesRepo(one.meta);
    const addOn = await repo.create({ slug: 'addon-page', type: 'page-dashboard', title: 'Add-on', config: {}, origin: 'manifest' });
    const broken = await repo.create({ slug: 'broken', type: 'page-crud', title: 'Broken', config: { v: 1 } });
    expect(toPageFile(addOn, refs)).toEqual({ ok: false, reason: 'it belongs to an installed add-on or app' });
    expect(toPageFile(broken, refs)).toEqual({ ok: false, reason: 'its stored document is not a complete page' });
    const elsewhere: ProjectRefs = { ...refs, keyOf: () => null };
    expect(toPageFile(pages[0] as Page, elsewhere)).toEqual({ ok: false, reason: 'its database is not in adminium.config.ts' });
  });

  it('writes a disabled or hand-made page with the keys that say so', async () => {
    const page = { ...(pages[0] as Page), origin: 'user', isEnabled: false };
    const file = fileOf(page);
    expect(file['origin']).toBeUndefined();
    expect(file['enabled']).toBe(false);
  });
});

describe('reading a page file back', () => {
  it('gives back the stored document, hash included, on the same install', () => {
    for (const page of pages) {
      const read = readPageFile(fileOf(page), page.slug, refs);
      if (!read.ok) throw new Error(`${page.slug}: ${read.problems.join('; ')}`);
      const local = toLocalPage(read.doc, page.id, refs);
      expect(same(local.envelope, page.config), page.slug).toBe(true);
      expect(local).toMatchObject({ type: page.type, title: page.title, icon: page.icon, navGroup: page.navGroup, navOrder: page.navOrder });
    }
  });

  it('passes the offline check `adminium check` runs, with no database', () => {
    for (const page of pages) {
      expect(readPageFile(fileOf(page), page.slug, offlineRefs(['main'])).ok, page.slug).toBe(true);
    }
  });

  it('applies on another install as an untouched generated page with that install\'s ids', async () => {
    const two = await makeInstall();
    try {
      const refsTwo = await loadInstallRefs(two.meta);
      const repoTwo = pagesRepo(two.meta);
      for (const page of pages) {
        await repoTwo.delete((await repoTwo.findBySlug(two.mainId, page.slug))?.id ?? 'none');
      }
      for (const page of pages) {
        const read = readPageFile(fileOf(page), page.slug, refsTwo);
        if (!read.ok) throw new Error(read.problems.join('; '));
        await applyPageFile(two.meta, read.doc, refsTwo, 1, () => true);
        const stored = await repoTwo.findBySlug(two.mainId, page.slug);
        expect(stored?.id).not.toBe(page.id);
        const envelope = stored?.config as Record<string, unknown>;
        expect(envelope['id']).toBe(stored?.id);
        expect((envelope['source'] as { connectionId: string }).connectionId).toBe(two.mainId);
        // Untouched: regeneration on that install may still update it.
        expect(bodyOf(envelope)['generatedHash']).toBe(hashEnvelope(envelope));
        // And it writes the same file there.
        const again = toPageFile(stored as Page, refsTwo);
        expect(again.ok && fileHash(`pages/${page.slug}.json`, again.file)).toBe(fileHash(`pages/${page.slug}.json`, fileOf(page)));
      }
    } finally {
      await two.close();
    }
  });

  it('keeps an edited page edited on the other install', async () => {
    const page = pages.find((candidate) => candidate.type === 'page-crud') as Page;
    const edited = await pagesRepo(one.meta).updateMeta(page.id, { title: 'Clients' });
    if (typeof edited === 'string') throw new Error(edited);
    const file = fileOf(edited);
    expect((file['generated'] as { hash: string }).hash).toBe(bodyOf(edited.config)['generatedHash']);

    const read = readPageFile(file, page.slug, refs);
    if (!read.ok) throw new Error(read.problems.join('; '));
    const local = toLocalPage(read.doc, 'page_0123abcd_other', refs);
    expect(bodyOf(local.envelope)['generatedHash']).not.toBe(hashEnvelope(local.envelope));
    expect(local.title).toBe('Clients');
  });

  it('gives a renamed generated page the id regeneration knows it by', async () => {
    const page = pages.find((candidate) => candidate.type === 'page-crud') as Page;
    const renamed = await pagesRepo(one.meta).updateMeta(page.id, { slug: 'clients' });
    if (typeof renamed === 'string') throw new Error(renamed);
    const file = fileOf(renamed);
    const key = page.id.slice(page.id.indexOf('_', 5) + 1);
    expect(file['generated']).toMatchObject({ key });

    const two = await makeInstall();
    try {
      const refsTwo = await loadInstallRefs(two.meta);
      const read = readPageFile(file, 'clients', refsTwo);
      if (!read.ok) throw new Error(read.problems.join('; '));
      const holder = await pagesRepo(two.meta).findBySlug(two.mainId, page.slug);
      // The folder no longer has the old address, so this is that page, renamed.
      const applied = await applyPageFile(two.meta, read.doc, refsTwo, 1, (slug) => slug === 'clients');
      expect(applied.pageId).toBe(holder?.id);
      expect((await pagesRepo(two.meta).findById(applied.pageId))?.slug).toBe('clients');
    } finally {
      await two.close();
    }
  });

  it('turns a destination id into its name, and drops a name this install lacks', async () => {
    const at = Date.now();
    await one.meta.db
      .insertInto('adminium_storage_destinations')
      .values({ id: 'dest_01J8ME7Q2RZX4V9T6W3YB0KD5N', name: 'photos', driver: 'local', config: '{}', secretEncrypted: null, isDefault: 0, status: 'ok', lastTestedAt: null, lastError: null, disabledAt: null, createdBy: null, createdAt: at, updatedAt: at })
      .execute();
    const withDestination = await loadInstallRefs(one.meta);
    const page = pages.find((candidate) => candidate.type === 'page-crud') as Page;
    const envelope = page.config as Record<string, unknown>;
    const config = { ...bodyOf(envelope), attachments: { enabled: true, destinationId: 'dest_01J8ME7Q2RZX4V9T6W3YB0KD5N' } };
    const file = fileOf({ ...page, config: { ...envelope, config } }, withDestination);
    expect(bodyOf(file)['attachments']).toEqual({ enabled: true, destination: 'photos' });

    const read = readPageFile(file, page.slug, refs);
    if (!read.ok) throw new Error(read.problems.join('; '));
    const back = toLocalPage(read.doc, page.id, withDestination);
    expect(bodyOf(back.envelope)['attachments']).toEqual({ enabled: true, destinationId: 'dest_01J8ME7Q2RZX4V9T6W3YB0KD5N' });
    const missing = toLocalPage(read.doc, page.id, refs);
    expect(bodyOf(missing.envelope)['attachments']).toEqual({ enabled: true });
    expect(missing.warnings).toEqual(['config.attachments.destination: there is no storage destination "photos"; the default one is used']);
  });
});

describe('a page file with problems', () => {
  const problemsOf = (mutate: (file: Record<string, unknown>) => void, slug?: string): string[] => {
    const page = pages.find((candidate) => candidate.type === 'page-dashboard') as Page;
    const file = structuredClone(fileOf(page));
    mutate(file);
    const read = readPageFile(file, slug ?? page.slug, refs);
    return read.ok ? [] : read.problems;
  };

  it('names the field for each mistake', () => {
    expect(problemsOf((file) => (file['id'] = 'page_x'))).toContain('id: remove it; a page file is known by its file name');
    expect(problemsOf((file) => (file['origin'] = 'system'))).toContain('origin: must be one of generated, user, llm');
    expect(problemsOf((file) => (file['enabled'] = 'no'))).toContain('enabled: must be true or false');
    expect(problemsOf((file) => (file['generated'] = { hash: 'nope' }))).toContain('generated.hash: must be a 64-character hex hash');
    expect(problemsOf((file) => (file['generated'] = { note: 1 }))).toContain('generated.note: is not a known key');
    expect(problemsOf(() => undefined, 'other-name')).toContain('nav.slug: must be "other-name", the file name');
    expect(problemsOf((file) => ((file['title'] as Record<string, unknown>)['fallback'] = ''))[0]).toMatch(/^title\.fallback: /);
  });

  it('refuses ids and connection ids from an install', () => {
    const connectionProblems = problemsOf((file) => {
      (file['source'] as Record<string, unknown>)['connectionId'] = 'conn_01J8ME7Q2RZX4V9T6W3YB0KD5N';
    });
    expect(connectionProblems).toEqual([
      'source.connectionId: name the database with "database" and its key from adminium.config.ts',
    ]);
    expect(problemsOf((file) => (bodyOf(file)['owner'] = newId('usr')))[0]).toMatch(/^config\.owner: "usr_/);
  });

  it('refuses a database the config does not list, wherever it is named', () => {
    expect(problemsOf((file) => ((file['source'] as Record<string, unknown>)['database'] = 'billing'))).toEqual([
      'source.database: "billing" is not a database in adminium.config.ts, or it has no connection yet',
    ]);
    const problems = problemsOf((file) => {
      const layout = bodyOf(file)['layout'] as { items: { config: { binding?: Record<string, unknown> } }[] };
      const item = layout.items.find((candidate) => candidate.config.binding !== undefined);
      if (item?.config.binding !== undefined) item.config.binding['database'] = 'billing';
    });
    expect(problems[0]).toMatch(/^config\.layout\.items\[\d+\]\.config\.binding\.database: "billing" is not a database/);
  });

  it('refuses something that is not an object at all', () => {
    expect(readPageFile([], 'x', refs)).toEqual({ ok: false, problems: ['(the file): must be a JSON object'] });
  });
});

describe('the files a folder holds', () => {
  it('compares page files by meaning: restated defaults and the key an address implies do not count', () => {
    const page = pages.find((candidate) => candidate.type === 'page-crud') as Page;
    const path = `pages/${page.slug}.json`;
    const file = fileOf(page);
    const generated = file['generated'] as Record<string, unknown>;
    const restated = { ...file, enabled: true, generated: { ...generated, key: page.slug } };
    expect(fileHash(path, restated)).toBe(fileHash(path, file));
    // The origin is not a default for a generated page.
    expect(file['origin']).toBe('generated');
    expect(fileHash(path, { ...file, origin: 'user' })).not.toBe(fileHash(path, file));
    // Another key is a renamed generated page, which is a different file.
    expect(fileHash(path, { ...file, generated: { ...generated, key: 'orders-old' } })).not.toBe(fileHash(path, file));
    // Nothing left in `generated` is the same as no `generated` at all.
    const { generated: _dropped, ...bare } = file;
    expect(fileHash(path, { ...bare, generated: { key: page.slug } })).toBe(fileHash(path, bare));
  });

  it('gives an address two project databases use to the key that sorts first, and says so for the other', async () => {
    const billing = await connectionsRepo(one.meta, dsnCryptoFromSecret(INSTALL_SECRET)).create({
      name: 'billing',
      engine: 'sqlite',
      introspectDsn: 'sqlite:./billing.db',
      projectKey: 'billing',
    });
    const orders = pages.find((candidate) => candidate.slug === 'orders') as Page;
    const copy = JSON.parse(JSON.stringify(orders.config).replaceAll(one.mainId, billing.id)) as Record<string, unknown>;
    const billingOrders = await pagesRepo(one.meta).create({
      connectionId: billing.id,
      slug: 'orders',
      type: orders.type,
      title: 'Billing orders',
      config: copy,
      origin: 'generated',
    });
    await pagesRepo(one.meta).create({ connectionId: one.mainId, slug: 'broken', type: 'page-crud', title: 'Broken', config: { v: 1 } });

    const exported = await exportProjectFiles(one.meta, await loadInstallRefs(one.meta));
    expect(exported.files.get('pages/orders.json')?.pageId).toBe(billingOrders.id);
    expect(exported.files.has('schema/billing.json')).toBe(true);
    expect(exported.outside).toEqual(
      expect.arrayContaining([
        { pageId: orders.id, slug: 'orders', connectionId: one.mainId, reason: 'another page already uses the address "orders"' },
        expect.objectContaining({ slug: 'broken', reason: 'its stored document is not a complete page' }),
      ]),
    );
    expect(exported.outside).toHaveLength(2);
  });

  it('checks each kind of file by its name first', () => {
    const offline = offlineRefs(['main']);
    expect(checkProjectFile('schema/Main.json', '{}', offline)).toMatchObject({
      valid: false,
      problems: ['the file name must be a database key from adminium.config.ts'],
    });
    expect(checkProjectFile('schema/billing.json', '{"overrides":[]}', offline)).toMatchObject({
      valid: false,
      problems: ['"billing" is not a database in adminium.config.ts, or it has no connection yet'],
    });
    expect(checkProjectFile('schema/main.json', '{"overrides":[', offline)).toMatchObject({
      valid: false,
      problems: [expect.stringMatching(/^not valid JSON: /)],
    });
    expect(checkProjectFile('schema/main.json', '{"overrides":[{"table":"orders"}]}', offline)).toMatchObject({ valid: false });
    expect(checkProjectFile('schema/main.json', '{"overrides":[]}', offline)).toMatchObject({ valid: true, kind: 'schema', key: 'main' });
    expect(checkProjectFile('notes/main.json', '{}', offline)).toMatchObject({ valid: false, problems: ['not a page or schema file'] });
  });

  it('finds the databases the page files name, skipping what it cannot read', async () => {
    const store = memoryFileStore({
      'pages/orders.json': JSON.stringify({ source: { database: 'main' } }),
      'pages/invoices.json': JSON.stringify({ source: { database: 'billing' } }),
      'pages/notes.json': JSON.stringify({ title: 'no source' }),
      'pages/broken.json': '{"source":',
      'schema/archive.json': JSON.stringify({ source: { database: 'archive' } }),
    });
    expect([...(await databasesWithPageFiles(store))].sort()).toEqual(['billing', 'main']);
  });
});

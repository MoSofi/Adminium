// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeping a project's files and its database in step: every rule of the sync
 * table, in `dev` (the folder is the master copy) and on a `server` (files
 * change only through a deploy).
 */
import { overridesRepo, pagesRepo, projectFilesRepo, type ProjectFileRow } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { memoryFileStore } from '../src/project/file-store.js';
import { parseJsonText, stableStringify } from '../src/project/json.js';
import type { DatabaseFile, FolderFile } from '../src/project/project-files.js';
import { decide, reconcileProject, snapshotProject, statusOf, type PathState } from '../src/project/reconcile.js';
import { makeInstall, type Install } from './project-fixtures.js';

const PATH = 'pages/orders.json';

function file(hash: string): FolderFile {
  return { path: PATH, hash, valid: true, kind: 'page', doc: {} as never };
}
function db(hash: string): DatabaseFile {
  return { value: {}, hash, pageId: 'page_1' };
}
function row(hash: string, serverHash: string | null = null): ProjectFileRow {
  return { path: PATH, hash, appliedAt: 1, serverEditedAt: serverHash === null ? null : 1, serverHash };
}
function state(f: string | null, d: string | null, r: ProjectFileRow | null): PathState {
  return { path: PATH, file: f === null ? null : file(f), db: d === null ? null : db(d), row: r };
}
const invalid: FolderFile = { path: PATH, hash: 'x', valid: false, problems: ['title: required'] };

describe('the sync table in dev', () => {
  const dev = (s: PathState) => decide('dev', s);

  it('applies a new or changed file, and a file that changed with the page', () => {
    expect(dev(state('A', null, null))).toEqual({ kind: 'apply-file', bothChanged: false });
    expect(dev(state('B', 'A', row('A')))).toEqual({ kind: 'apply-file', bothChanged: false });
    expect(dev(state('B', 'C', row('A')))).toEqual({ kind: 'apply-file', bothChanged: true });
    expect(dev(state('B', 'C', null))).toEqual({ kind: 'apply-file', bothChanged: true });
  });

  it('writes what Studio changed or created into the folder', () => {
    expect(dev(state('A', 'B', row('A')))).toEqual({ kind: 'write-file' });
    expect(dev(state(null, 'A', null))).toEqual({ kind: 'write-file' });
    expect(dev(state('A', null, row('A')))).toEqual({ kind: 'delete-file' });
  });

  it('removes the page of a deleted file, even one the database changed', () => {
    expect(dev(state(null, 'A', row('A')))).toEqual({ kind: 'delete-page', bothChanged: false });
    expect(dev(state(null, 'B', row('A')))).toEqual({ kind: 'delete-page', bothChanged: true });
  });

  it('does nothing when both agree, and tidies the record', () => {
    expect(dev(state('A', 'A', row('A')))).toEqual({ kind: 'none' });
    expect(dev(state('A', 'A', null))).toEqual({ kind: 'record', hash: 'A' });
    expect(dev(state('B', 'B', row('A')))).toEqual({ kind: 'record', hash: 'B' });
    expect(dev(state(null, null, row('A')))).toEqual({ kind: 'drop-row' });
    expect(dev(state(null, null, null))).toEqual({ kind: 'none' });
  });

  it('never applies or overwrites an invalid file', () => {
    expect(dev({ ...state(null, 'B', row('A')), file: invalid })).toEqual({ kind: 'invalid', problems: ['title: required'] });
  });
});

describe('the sync table on a server', () => {
  const server = (s: PathState) => decide('server', s);

  it('applies a deployed change only while the page is untouched here', () => {
    expect(server(state('B', 'A', row('A')))).toEqual({ kind: 'apply-file', bothChanged: false });
    expect(server(state('A', null, null))).toEqual({ kind: 'apply-file', bothChanged: false });
    expect(server(state(null, 'A', row('A')))).toEqual({ kind: 'delete-page', bothChanged: false });
  });

  it('keeps and flags a page changed here, deleted here, or changed on both sides', () => {
    expect(server(state('A', 'B', row('A')))).toEqual({ kind: 'flag', serverHash: 'B' });
    expect(server(state('A', null, row('A')))).toEqual({ kind: 'flag', serverHash: 'deleted' });
    expect(server(state('B', 'C', row('A')))).toEqual({ kind: 'flag', serverHash: 'C' });
    expect(server(state(null, 'B', row('A')))).toEqual({ kind: 'flag', serverHash: 'B' });
    expect(server(state('A', 'B', null))).toEqual({ kind: 'flag', serverHash: 'B' });
  });

  it('flags once, and again only when the server copy moves on', () => {
    expect(server(state('A', 'B', row('A', 'B')))).toEqual({ kind: 'none' });
    expect(server(state('A', 'C', row('A', 'B')))).toEqual({ kind: 'flag', serverHash: 'C' });
  });

  it('clears the flag once the deploy brings the server copy', () => {
    expect(server(state('B', 'B', row('A', 'B')))).toEqual({ kind: 'record', hash: 'B' });
    expect(server(state('A', 'A', row('A', 'B')))).toEqual({ kind: 'record', hash: 'A' });
  });

  it('never writes files, and leaves a page that exists only here alone', () => {
    expect(server(state(null, 'A', null))).toEqual({ kind: 'none' });
  });

  it('keeps the last good copy of an invalid file, and still notices a server edit', () => {
    expect(server({ ...state(null, 'A', row('A')), file: invalid })).toEqual({ kind: 'invalid', problems: ['title: required'] });
    expect(server({ ...state(null, 'B', row('A')), file: invalid })).toEqual({ kind: 'flag', serverHash: 'B' });
  });
});

describe('what a path looks like to Studio', () => {
  it('tells the states apart', () => {
    expect(statusOf(state('A', 'A', row('A')))).toBe('in-sync');
    expect(statusOf(state('A', 'B', row('A')))).toBe('changed-on-server');
    expect(statusOf(state('A', null, row('A')))).toBe('changed-on-server');
    expect(statusOf(state('B', 'C', row('A')))).toBe('conflict');
    expect(statusOf(state('B', 'C', null))).toBe('conflict');
    expect(statusOf(state(null, 'A', null))).toBe('not-in-project');
    expect(statusOf(state('B', 'A', row('A')))).toBe('pending');
    expect(statusOf(state('A', null, null))).toBe('pending');
    expect(statusOf({ ...state('A', 'A', null), file: invalid })).toBe('invalid');
  });
});

describe('a project in dev', () => {
  let one: Install;
  let store: ReturnType<typeof memoryFileStore>;
  const run = () => reconcileProject({ meta: one.meta, store, mode: 'dev' });

  beforeEach(async () => {
    one = await makeInstall();
    store = memoryFileStore();
  });
  afterEach(async () => {
    await one.close();
  });

  const readJson = (path: string): Record<string, unknown> => {
    const parsed = parseJsonText(store.files.get(path) ?? '');
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.value as Record<string, unknown>;
  };

  it('writes every page and the schema file on the first start, then has nothing to do', async () => {
    const first = await run();
    const pages = await pagesRepo(one.meta).listDocuments();
    expect(first.written.sort()).toEqual([...pages.map((page) => `pages/${page.slug}.json`), 'schema/main.json'].sort());
    expect(readJson('schema/main.json')).toMatchObject({ overrides: [] });
    expect(await run()).toMatchObject({ applied: [], written: [], removed: [], warnings: [] });
    expect((await projectFilesRepo(one.meta).list()).length).toBe(first.written.length);
  });

  it('applies an edited file, and the edit sticks', async () => {
    await run();
    const orders = readJson('pages/orders.json');
    (orders['title'] as Record<string, unknown>)['fallback'] = 'Sales orders';
    store.files.set('pages/orders.json', stableStringify(orders));

    expect((await run()).applied).toEqual(['pages/orders.json']);
    const page = await pagesRepo(one.meta).findBySlug(one.mainId, 'orders');
    expect(page?.title).toBe('Sales orders');
    expect(await run()).toMatchObject({ applied: [], written: [] });
  });

  it('writes a Studio edit into the file, changing only the lines it touched', async () => {
    await run();
    const before = store.files.get('pages/customers.json') ?? '';
    const page = await pagesRepo(one.meta).findBySlug(one.mainId, 'customers');
    await pagesRepo(one.meta).updateMeta(page?.id ?? '', { title: 'Clients' });

    expect((await run()).written).toEqual(['pages/customers.json']);
    const after = store.files.get('pages/customers.json') ?? '';
    const beforeLines = before.split('\n');
    const changed = after.split('\n').filter((line, index) => line !== beforeLines[index]);
    expect(after.split('\n')).toHaveLength(beforeLines.length);
    // The title, and the hash line that now says the page was edited.
    expect(changed).toEqual([expect.stringContaining('"fallback": "Clients"'), expect.stringContaining('"hash": ')]);
    expect(await run()).toMatchObject({ applied: [], written: [] });
  });

  it('writes a page created in Studio, and removes the file of one deleted there', async () => {
    await run();
    const created = await pagesRepo(one.meta).create({
      slug: 'notes',
      type: 'page-dashboard',
      title: 'Notes',
      config: {
        v: 1,
        kind: 'dashboard',
        id: 'page_notes_x',
        template: 'page-dashboard',
        title: { key: 'nav.notes', fallback: 'Notes' },
        source: { connectionId: null, table: null },
        nav: { group: 'workspace', icon: 'notebook', order: 3, slug: 'notes' },
        access: { minRole: 'viewer', permissions: [] },
        config: { layout: { version: 1, items: [] } },
      },
    });
    expect((await run()).written).toEqual(['pages/notes.json']);
    expect(readJson('pages/notes.json')).toMatchObject({ source: { database: null, table: null } });
    expect(readJson('pages/notes.json')).not.toHaveProperty('origin');

    await pagesRepo(one.meta).delete(created.id);
    expect((await run()).deletedFiles).toEqual(['pages/notes.json']);
    expect(store.files.has('pages/notes.json')).toBe(false);
  });

  it('removes the page of a deleted file', async () => {
    await run();
    store.files.delete('pages/orders.json');
    expect((await run()).removed).toEqual(['pages/orders.json']);
    expect(await pagesRepo(one.meta).findBySlug(one.mainId, 'orders')).toBeNull();
    expect(await projectFilesRepo(one.meta).find('pages/orders.json')).toBeNull();
  });

  it('reports an invalid file and keeps the page, then applies it once fixed', async () => {
    await run();
    const good = store.files.get('pages/orders.json') ?? '';
    store.files.set('pages/orders.json', good.replace('"template": "page-crud"', '"template": "Page Crud"'));
    const report = await run();
    expect(report.invalid).toEqual([{ path: 'pages/orders.json', problems: [expect.stringMatching(/^template: /)] }]);
    expect(report.applied).toEqual([]);

    store.files.set('pages/orders.json', '{ "v": 1,');
    expect((await run()).invalid[0]?.problems[0]).toMatch(/^not valid JSON: /);

    const fixed = parseJsonText(good);
    if (!fixed.ok) throw new Error(fixed.message);
    const value = fixed.value as Record<string, unknown>;
    (value['title'] as Record<string, unknown>)['fallback'] = 'Fixed';
    store.files.set('pages/orders.json', stableStringify(value));
    expect((await run()).applied).toEqual(['pages/orders.json']);
    expect((await pagesRepo(one.meta).findBySlug(one.mainId, 'orders'))?.title).toBe('Fixed');
  });

  it('lets the file win when the file and the database both changed', async () => {
    await run();
    const orders = readJson('pages/orders.json');
    (orders['title'] as Record<string, unknown>)['fallback'] = 'From the file';
    store.files.set('pages/orders.json', stableStringify(orders));
    const page = await pagesRepo(one.meta).findBySlug(one.mainId, 'orders');
    await pagesRepo(one.meta).updateMeta(page?.id ?? '', { title: 'From Studio' });

    const report = await run();
    expect(report.applied).toEqual(['pages/orders.json']);
    expect(report.warnings).toEqual(['pages/orders.json and the database both changed; the file was applied.']);
    expect((await pagesRepo(one.meta).findBySlug(one.mainId, 'orders'))?.title).toBe('From the file');
  });

  it('applies an edited schema file and writes a schema edit from Studio', async () => {
    await run();
    store.files.set(
      'schema/main.json',
      stableStringify({ overrides: [{ table: 'main.orders', op: 'table.label', value: { label: 'Sales' } }] }),
    );
    expect((await run()).applied).toEqual(['schema/main.json']);
    const rows = await overridesRepo(one.meta).listForConnection(one.mainId);
    expect(rows.filter((item) => item.origin !== 'auto').map((item) => item.value)).toEqual([{ label: 'Sales' }]);

    await overridesRepo(one.meta).create({ connectionId: one.mainId, op: 'column.hidden', tableName: 'main.orders', columnName: 'status', value: { hidden: true } });
    expect((await run()).written).toEqual(['schema/main.json']);
    expect(readJson('schema/main.json')['overrides']).toHaveLength(2);
  });
});

describe('a project on a server', () => {
  let dev: Install;
  let server: Install;
  let store: ReturnType<typeof memoryFileStore>;
  const boot = () => reconcileProject({ meta: server.meta, store, mode: 'server' });
  const statusFor = async (path: string) => {
    const snapshot = await snapshotProject(server.meta, store);
    const found = snapshot.states.find((candidate) => candidate.path === path);
    return found === undefined ? 'unknown' : statusOf(found);
  };

  beforeEach(async () => {
    // The developer's machine writes the files; the server is another install
    // of the same project, deployed with them.
    dev = await makeInstall();
    server = await makeInstall();
    store = memoryFileStore();
    await reconcileProject({ meta: dev.meta, store, mode: 'dev' });
  });
  afterEach(async () => {
    await dev.close();
    await server.close();
  });

  it('agrees with the files on first start when it generated the same pages', async () => {
    const report = await boot();
    expect(report).toMatchObject({ applied: [], flagged: [], invalid: [], warnings: [] });
    expect((await projectFilesRepo(server.meta).list()).length).toBe(store.files.size);
    expect(await statusFor('pages/orders.json')).toBe('in-sync');
  });

  it('flags a Studio edit and keeps it through a redeploy of the old file', async () => {
    await boot();
    const page = await pagesRepo(server.meta).findBySlug(server.mainId, 'orders');
    await pagesRepo(server.meta).updateMeta(page?.id ?? '', { title: 'Edited on the server' });

    expect((await boot()).flagged).toEqual(['pages/orders.json']);
    expect(await statusFor('pages/orders.json')).toBe('changed-on-server');
    expect((await pagesRepo(server.meta).findBySlug(server.mainId, 'orders'))?.title).toBe('Edited on the server');
    expect((await projectFilesRepo(server.meta).find('pages/orders.json'))?.serverEditedAt).not.toBeNull();

    // A second start with the same files changes nothing and flags nothing new.
    expect(await boot()).toMatchObject({ applied: [], flagged: [] });
  });

  it('applies a deployed change to an untouched page, and clears the flag once the pull is deployed', async () => {
    await boot();
    const orders = parseJsonText(store.files.get('pages/orders.json') ?? '');
    if (!orders.ok) throw new Error(orders.message);
    const value = orders.value as Record<string, unknown>;
    (value['title'] as Record<string, unknown>)['fallback'] = 'Deployed title';
    store.files.set('pages/orders.json', stableStringify(value));
    expect((await boot()).applied).toEqual(['pages/orders.json']);
    expect((await pagesRepo(server.meta).findBySlug(server.mainId, 'orders'))?.title).toBe('Deployed title');

    const customers = await pagesRepo(server.meta).findBySlug(server.mainId, 'customers');
    await pagesRepo(server.meta).updateMeta(customers?.id ?? '', { title: 'Server title' });
    await boot();
    // The pull writes the server's copy; deploying it clears the flag.
    const snapshot = await snapshotProject(server.meta, store);
    const serverCopy = snapshot.states.find((candidate) => candidate.path === 'pages/customers.json')?.db;
    store.files.set('pages/customers.json', stableStringify(serverCopy?.value));
    expect(await boot()).toMatchObject({ applied: [], flagged: [] });
    expect(await statusFor('pages/customers.json')).toBe('in-sync');
    expect((await projectFilesRepo(server.meta).find('pages/customers.json'))?.serverEditedAt).toBeNull();
  });

  it('holds a page changed on both sides as a conflict, keeping the server copy', async () => {
    await boot();
    const page = await pagesRepo(server.meta).findBySlug(server.mainId, 'orders');
    await pagesRepo(server.meta).updateMeta(page?.id ?? '', { title: 'Server side' });
    const orders = parseJsonText(store.files.get('pages/orders.json') ?? '');
    if (!orders.ok) throw new Error(orders.message);
    const value = orders.value as Record<string, unknown>;
    (value['title'] as Record<string, unknown>)['fallback'] = 'Project side';
    store.files.set('pages/orders.json', stableStringify(value));

    const report = await boot();
    expect(report).toMatchObject({ applied: [], flagged: ['pages/orders.json'] });
    expect(await statusFor('pages/orders.json')).toBe('conflict');
    expect((await pagesRepo(server.meta).findBySlug(server.mainId, 'orders'))?.title).toBe('Server side');
  });

  it('shows a page made on the server as not in the project, and writes no file', async () => {
    await boot();
    await pagesRepo(server.meta).create({
      slug: 'server-only',
      type: 'page-dashboard',
      title: 'Server only',
      config: {
        v: 1,
        kind: 'dashboard',
        id: 'page_server_only',
        template: 'page-dashboard',
        title: { key: 'nav.server-only', fallback: 'Server only' },
        source: { connectionId: null, table: null },
        nav: { group: 'workspace', icon: 'star', order: 9, slug: 'server-only' },
        access: { minRole: 'viewer', permissions: [] },
        config: { layout: { version: 1, items: [] } },
      },
    });
    const files = store.files.size;
    expect(await boot()).toMatchObject({ applied: [], flagged: [] });
    expect(store.files.size).toBe(files);
    expect(await statusFor('pages/server-only.json')).toBe('not-in-project');
  });
});

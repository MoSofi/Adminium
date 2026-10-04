// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app that runs from its project folder: installed from it, applied again
 * in place when its manifest changes, and left exactly as it was when a
 * change cannot be applied — under `adminium dev` and under a server, which
 * are allowed different things.
 *
 * Every engine this machine can run: the tables, the columns an app gains and
 * the refusals are all the database's to agree with.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pagesRepo, publicEndpointsRepo } from '@adminium/meta';

import { ENGINES } from './app-install-harness.js';
import { findSampleApp } from '../src/apps/sample-data.js';
import { folderHarness, type FolderHarness } from './folder-app-harness.js';

let h: FolderHarness;
afterEach(async () => {
  await h.close();
});

const slugs = async (): Promise<string[]> =>
  (await pagesRepo(h.harness.meta).listAll()).map((page) => page.slug).filter((slug) => slug.startsWith('repairs-')).sort();

const endpoints = async (): Promise<string[]> =>
  (await publicEndpointsRepo(h.harness.meta).listByConnection(h.harness.connectionId))
    .filter((endpoint) => endpoint.managedBy === 'repairs')
    .map((endpoint) => endpoint.ref)
    .sort();

const count = async (table: string): Promise<number> => Number((await h.harness.rows(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.['n']);

/** What anyone may read and send, as `app new --customer` grants it. */
const ACCESS = {
  publicAccess: [
    { table: 'items', methods: ['GET'], select: ['id', 'title', 'status'] },
    { table: 'requests', methods: ['POST'], select: ['id'], writable: ['message'] },
  ],
};

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`an app run from the project folder [${dialect}]`, { timeout: 120_000 }, () => {
    it('is installed from the folder, by nobody, with its tables, pages, role and sample data', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      expect(await h.sync()).toEqual([{ key: 'repairs', state: 'installed', hash: expect.any(String) }]);

      expect(await h.row('repairs')).toMatchObject({ source: 'folder', status: 'installed', version: '0.1.0' });
      expect(await slugs()).toEqual(['repairs-items', 'repairs-requests']);
      // Dev adds the sample data once, on the first install.
      expect(await count('repairs_items')).toBe(6);
      expect(await count('repairs_requests')).toBe(0);
      expect(h.lines.log.join('\n')).toContain('App "repairs" installed from apps/repairs.');
      expect(h.lines.log.join('\n')).toContain('its sample data was added');
      expect(h.lines.warn).toEqual([]);

      // Nobody stands behind it, and the log says so.
      const audit = await h.audit();
      expect(audit.find((entry) => entry.action === 'app.installed')).toEqual({ action: 'app.installed', actorKind: 'system', actorLabel: 'project folder' });
      expect(h.changed).toEqual([['repairs', expect.any(String)]]);
      expect((await h.state('repairs'))?.appliedHash).toBe(h.changed[0]?.[1]);

      // The list says where it comes from, and it is whole with no package anywhere.
      const listed = JSON.parse((await h.harness.inject({ method: 'GET', url: '/apps' })).body) as { apps: unknown[]; staged: unknown[] };
      expect(listed.apps).toEqual([expect.objectContaining({ key: 'repairs', source: 'folder', folder: { state: 'here' }, missing: false })]);
      expect(listed.staged).toEqual([]);
    });

    it('adds the sample rows on the first apply that goes through, when the apply that first named them stopped half-way', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs', '--customer');
      // The app as a first step leaves it: its tables, and no sample rows named yet.
      let sample: Record<string, unknown> = {};
      h.edit('apps/repairs/manifest/sample.json', (value) => {
        sample = value;
        return {};
      });
      expect((await h.sync())[0]).toMatchObject({ state: 'installed' });
      expect(await count('repairs_items')).toBe(0);

      // The sample rows are named in the same step as public access that cannot be made (a create with nothing a stranger may write).
      h.put('apps/repairs/manifest/sample.json', sample);
      h.put('apps/repairs/manifest/access.json', { publicAccess: [{ table: 'requests', methods: ['POST'], select: ['id'] }] });
      const stopped = (await h.sync())[0];
      expect(stopped?.state).not.toBe('applied');
      expect(await count('repairs_items')).toBe(0);

      // Put right: this apply goes through, and the rows are added now. "It named them before" was never "they were added".
      h.put('apps/repairs/manifest/access.json', ACCESS);
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect(await count('repairs_items')).toBe(6);
      expect(h.lines.log.join('\n')).toContain('its sample data was added');

      // Rows a person removed on purpose do not come back with the next change.
      const target = await findSampleApp(h.harness.meta, 'repairs');
      await h.harness.samples?.remove(target as NonNullable<typeof target>, { keepChanged: false, userId: null, userLabel: 'test' });
      expect(await count('repairs_items')).toBe(0);
      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({ ...table, columns: [...(table['columns'] as unknown[]), { ref: 'colour', type: 'text', maxLength: 40, nullable: true }] }));
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect(await count('repairs_items')).toBe(0);
    });

    it('does nothing when nothing changed', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.sync();
      const before = (await h.audit()).length;
      h.changed.length = 0;

      expect(await h.sync()).toEqual([{ key: 'repairs', state: 'unchanged', hash: expect.any(String) }]);
      expect((await h.audit()).length).toBe(before);
      expect(h.changed).toEqual([]);
      // A second server start finds it applied too, and adds no sample data again.
      expect(await h.restart().reconcile()).toEqual([{ key: 'repairs', state: 'unchanged', hash: expect.any(String) }]);
      expect(await count('repairs_items')).toBe(6);
    });

    it('applies a changed manifest in place: a new column, a new table and its page, with the rows kept', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.sync();
      const first = (await h.state('repairs'))?.appliedHash;

      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
        ...table,
        columns: [...(table['columns'] as unknown[]), { ref: 'colour', type: 'text', maxLength: 40, label: { 'en-US': 'Colour' } }],
      }));
      h.put('apps/repairs/manifest/tables/notes.json', {
        ref: 'notes',
        label: { 'en-US': 'Note' },
        labelPlural: { 'en-US': 'Notes' },
        keyField: 'body',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'body', type: 'text', maxLength: 200, default: '' },
          { ref: 'item_id', type: 'fk', references: 'items' },
        ],
      });
      h.put('apps/repairs/manifest/pages/repairs-notes.json', {
        ref: 'repairs-notes',
        template: 'page-crud',
        title: { key: 'repairs.notes', fallback: 'Notes' },
        nav: { group: 'main', icon: 'inbox', order: 3 },
        bindings: { rows: 'notes' },
      });

      expect(await h.sync()).toEqual([{ key: 'repairs', state: 'applied', hash: expect.any(String) }]);
      expect(h.lines.warn).toEqual([]);
      expect(h.lines.log.join('\n')).toContain('App "repairs" applied from apps/repairs (new tables: repairs_notes).');

      // The same version, the same row, the same rows: nothing was reinstalled.
      expect(await h.row('repairs')).toMatchObject({ source: 'folder', status: 'installed', version: '0.1.0' });
      expect(await count('repairs_items')).toBe(6);
      await h.harness.run(`UPDATE repairs_items SET colour = 'red'`);
      expect(await count('repairs_notes')).toBe(0);
      expect(await slugs()).toEqual(['repairs-items', 'repairs-notes', 'repairs-requests']);
      expect((await h.state('repairs'))?.appliedHash).not.toBe(first);
      expect((await h.audit()).filter((entry) => entry.action === 'app.applied')).toEqual([
        { action: 'app.applied', actorKind: 'system', actorLabel: 'project folder' },
      ]);
    });

    it('leaves the app as it was when a change cannot be applied, says why, and does not try it again', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.sync();
      const good = await h.state('repairs');

      // Six sample rows share two statuses: a status that must be one of a kind cannot be.
      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
        ...table,
        columns: (table['columns'] as { ref: string }[]).map((column) => (column.ref === 'status' ? { ...column, unique: true } : column)),
      }));
      const [result] = await h.sync();
      expect(result).toMatchObject({ key: 'repairs', state: 'not-applied', stage: 'tables' });
      expect(result?.message).toContain('repairs_items');
      expect(h.lines.warn.join('\n')).toContain('App "repairs" (apps/repairs) was not applied');

      // What was applied before is still what is recorded and served.
      expect(await h.state('repairs')).toMatchObject({ appliedHash: good?.appliedHash, failure: { stage: 'tables', hash: result?.hash } });
      expect(await count('repairs_items')).toBe(6);
      const listed = JSON.parse((await h.harness.inject({ method: 'GET', url: '/apps' })).body) as {
        apps: { folder?: { notApplied?: { stage: string; message: string } } }[];
      };
      expect(listed.apps[0]?.folder?.notApplied).toMatchObject({ stage: 'tables' });

      // The same manifest again: shown, and nothing runs.
      const audit = (await h.audit()).length;
      h.lines.warn.length = 0;
      expect((await h.sync())[0]).toMatchObject({ state: 'not-applied', stage: 'tables' });
      expect((await h.audit()).length).toBe(audit);
      expect(h.lines.warn).toEqual([]);

      // Put back as it was: the failure is over, with nothing to apply.
      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
        ...table,
        columns: (table['columns'] as { ref: string; unique?: boolean }[]).map(({ unique: _unique, ...column }) => column),
      }));
      expect((await h.sync())[0]).toMatchObject({ state: 'unchanged' });
      expect((await h.state('repairs'))?.failure).toBeNull();
    });

    it('tries a failed manifest once more when the server starts again', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      // No database yet: the app needs tables and has nowhere to put them.
      h.restart({ databases: [] });
      const [result] = await h.sync();
      expect(result).toMatchObject({ state: 'not-applied' });
      expect(result?.message).toContain('this project has no database with a URL yet');
      expect(await h.row('repairs')).toBeNull();
      expect((await h.sync())[0]).toMatchObject({ state: 'not-applied' });

      // The database is configured, and the server restarted: the same manifest installs.
      h.restart();
      expect((await h.sync())[0]).toMatchObject({ state: 'installed' });
    });

    it('lists an app that does not build, and leaves the installed one alone', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.sync();
      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({ ...table, columns: [{ ref: 'id', type: 'nonsense' }] }));
      const [result] = await h.sync();
      expect(result).toMatchObject({ key: 'repairs', state: 'not-built', stage: 'build', hash: null });
      expect(result?.message).toContain('apps/repairs/manifest/tables/items.json');
      expect(await h.row('repairs')).toMatchObject({ status: 'installed' });
      expect(await count('repairs_items')).toBe(6);
      expect((await h.state('repairs'))?.failure).toMatchObject({ stage: 'build' });
    });

    it('refuses a key that is also installed from a package, and touches neither', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      const built = await h.build();
      expect(built.apps[0]?.problems).toBeUndefined();
      // The same app, installed as a package before the folder was ever applied.
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const manifest = JSON.parse(readFileSync(join(h.root, '.adminium/build/apps/repairs/app.json'), 'utf8')) as Record<string, unknown>;
      await (await import('@adminium/meta')).manifestsRepo(h.harness.meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
        manifestKey: 'repairs',
        version: '0.1.0',
        kind: 'app',
        source: 'file',
        document: manifest,
        connectionId: h.harness.connectionId,
      });

      const [result] = await h.sync();
      expect(result).toMatchObject({ state: 'not-applied', stage: 'conflict' });
      expect(result?.message).toContain('is also installed from a package');
      expect(await h.row('repairs')).toMatchObject({ source: 'file' });
    });

    it('gives public access as declared under dev', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      expect((await h.sync())[0]).toMatchObject({ state: 'installed' });
      expect(await endpoints()).toHaveLength(2);
      // The customer side reaches nothing while the public API is off, so dev switches it on, and says so.
      expect(h.publicApi.enabled).toBe(true);
      expect(h.lines.log.join('\n')).toContain('App "repairs": switched the public API on (Settings → API)');
    });

    it('takes a change to what an entry shows while the folder is worked on, and keeps what was allowed on a server, saying so', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      await h.sync();
      const shown = async (): Promise<unknown> =>
        (await publicEndpointsRepo(h.harness.meta).listByConnection(h.harness.connectionId)).filter((endpoint) => endpoint.managedBy === 'repairs').map((endpoint) => [endpoint.ref, (JSON.parse(endpoint.definition) as { select: string[] }).select]);
      const before = (await shown()) as [string, string[]][];
      const requests = before.find(([, select]) => select.length === 1)?.[0] as string;

      // The person edits access.json: a create now answers with one more column. Under dev it is theirs to say.
      h.put('apps/repairs/manifest/access.json', { publicAccess: [ACCESS.publicAccess[0], { ...ACCESS.publicAccess[1], select: ['id', 'message'] }] });
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect(((await shown()) as [string, string[]][]).find(([ref]) => ref === requests)?.[1]).toEqual(['id', 'message']);
      expect(h.lines.warn.join('\n')).not.toContain('was left as it was');

      // A server only runs the folder: it keeps what was allowed, as an update of a published app does, and says so.
      h.restart({ mode: 'server', apps: { repairs: { publicAccess: true } } });
      h.put('apps/repairs/manifest/access.json', { publicAccess: [{ ...ACCESS.publicAccess[0], select: ['id', 'title', 'status', 'notes'] }, { ...ACCESS.publicAccess[1], select: ['id', 'message'] }] });
      const kept = (await h.sync())[0];
      expect(kept).toMatchObject({ state: 'applied' });
      expect(kept?.accessWarnings).toEqual([expect.stringMatching(/^The public access of "[a-z_]+" was left as it was: /)]);
      expect(h.lines.warn.join('\n')).toContain('was left as it was');
      expect(((await shown()) as [string, string[]][]).find(([, select]) => select.includes('title'))?.[1]).toEqual(['id', 'title', 'status']);
    });

    it('leaves the public API alone for an app that grants nothing to the public', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.sync();
      expect(h.publicApi.enabled).toBe(false);
      expect(h.lines.log.join('\n')).not.toContain('public API');
    });

    it('gives none on a server unless the config says so, and says how to allow it', async () => {
      h = await folderHarness(dialect, { mode: 'server' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      expect((await h.sync())[0]).toMatchObject({ state: 'installed' });
      expect(await endpoints()).toEqual([]);
      expect(h.lines.log.join('\n')).toContain('App "repairs" is installed WITHOUT public access');
      expect(h.lines.log.join('\n')).toContain('set apps.repairs.publicAccess to true');
      // A server never adds sample data.
      expect(await count('repairs_items')).toBe(0);

      // A changed manifest is applied, and still opens nothing.
      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
        ...table,
        columns: [...(table['columns'] as unknown[]), { ref: 'colour', type: 'text', maxLength: 40 }],
      }));
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect(await endpoints()).toEqual([]);
      // MySQL gives a `now` time column no database default: Adminium fills it on a create, a raw insert says it.
      await h.harness.run(`INSERT INTO repairs_items (title, status, colour, created_at) VALUES ('a', 'open', 'red', CURRENT_TIMESTAMP)`);

      // The committed switch: the next start gives what the manifest declares.
      // Nothing else changes: the switch alone is what is applied.
      h.restart({ apps: { repairs: { publicAccess: true } } });
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect(await endpoints()).toHaveLength(2);
      expect((await h.sync())[0]).toMatchObject({ state: 'unchanged' });

      // Taken out again: the access is not taken back unasked, and the server says it is there.
      h.lines.warn.length = 0;
      h.restart({ apps: {} });
      await h.sync();
      expect(await endpoints()).toHaveLength(2);
      expect(h.lines.warn.join('\n')).toContain('App "repairs" HAS public access that adminium.config.ts does not allow');
    });

    it('says so when a server finds public access that was given under dev', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      await h.sync();
      expect(await endpoints()).toHaveLength(2);
      expect(h.lines.warn).toEqual([]);

      h.restart({ mode: 'server' });
      expect((await h.sync())[0]).toMatchObject({ state: 'unchanged' });
      expect(h.lines.warn.join('\n')).toContain('App "repairs" HAS public access that adminium.config.ts does not allow');
      expect(h.lines.warn.join('\n')).toContain('set apps.repairs.publicAccess to true');
      // Said once a start, not on every look.
      await h.sync();
      expect(h.lines.warn).toHaveLength(1);
    });

    it('installs with public access on a server whose config allows it', async () => {
      h = await folderHarness(dialect, { mode: 'server', apps: { repairs: { publicAccess: true } } });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      expect((await h.sync())[0]).toMatchObject({ state: 'installed' });
      expect(await endpoints()).toHaveLength(2);
      expect(h.lines.log.join('\n')).not.toContain('WITHOUT public access');
      // The access is made; switching an anonymous API on stays a person's decision on a server.
      expect(h.publicApi.enabled).toBe(false);
      expect(h.lines.log.join('\n')).toContain('App "repairs": its public access is made, and the public API is off. Switch it on in Settings → API.');
    });

    it('says when the server has no public API at all', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      h.publicApi.registered = false;
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      expect((await h.sync())[0]).toMatchObject({ state: 'installed' });
      expect(h.publicApi.enabled).toBe(false);
      expect(h.lines.log.join('\n')).toContain('this server has no public API: set ADMINIUM_PUBLIC_API_ORIGINS');
    });

    it('is not applied when a table name it needs is taken, and names the table', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.harness.run('CREATE TABLE repairs_items (id INTEGER PRIMARY KEY, title VARCHAR(20))');
      const [result] = await h.sync();
      expect(result).toMatchObject({ state: 'not-applied' });
      expect(result?.message).toContain('repairs_items');
      // Nothing of it was made beside the table that was in the way.
      await expect(count('repairs_requests')).rejects.toBeTruthy();
    });

    it('is not applied when it requires an add-on this server cannot have', async () => {
      h = await folderHarness(dialect, { mode: 'server' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/add-ons.json', { requires: [{ key: 'invoices', range: '^1.0.0', reason: { 'en-US': 'It sends invoices.' } }] });
      const built = await h.build();
      expect(built.apps[0]?.problems, JSON.stringify(built.apps[0]?.problems)).toBeUndefined();
      const [result] = await h.sync();
      expect(result).toMatchObject({ state: 'not-applied' });
      expect(result?.message).toContain('invoices');
      expect(await h.row('repairs')).toBeNull();
    });

    it('is changed and removed from the folder, not from Studio', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.sync();

      for (const request of [
        { method: 'POST' as const, url: '/apps/install', payload: { key: 'repairs', version: '0.1.0', connectionId: h.harness.connectionId } },
        { method: 'POST' as const, url: '/apps/repairs/update', payload: {} },
        { method: 'DELETE' as const, url: '/apps/repairs', payload: {} },
      ]) {
        const reply = await h.harness.inject(request);
        expect(reply.statusCode, `${request.method} ${request.url}: ${reply.body}`).toBe(422);
        expect(reply.body).toContain('KEY_IN_PROJECT');
      }
      expect(await h.row('repairs')).toMatchObject({ status: 'installed' });

      // The folder is deleted: the app stays installed, is said to be gone, and can now be uninstalled.
      h.remove('apps/repairs');
      expect(await h.sync()).toEqual([]);
      expect(await h.row('repairs')).toMatchObject({ source: 'folder', status: 'installed' });
      const listed = JSON.parse((await h.harness.inject({ method: 'GET', url: '/apps' })).body) as { apps: { folder?: { state: string } }[] };
      expect(listed.apps[0]?.folder).toEqual({ state: 'gone' });

      const removed = await h.harness.inject({ method: 'DELETE', url: '/apps/repairs', payload: {} });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(await h.row('repairs')).toBeNull();
      expect(await h.state('repairs')).toBeNull();
      // Its tables and rows are kept, as an uninstall keeps them.
      expect(await count('repairs_items')).toBe(6);
    });
  });
}

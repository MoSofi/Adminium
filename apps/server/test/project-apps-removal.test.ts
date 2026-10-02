// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a folder app's manifest no longer declares.
 *
 * A page and a role go. A table or a column that holds data is never dropped
 * on the way: it becomes a question, and only a yes drops it. A column that
 * holds less than it did is counted and left alone. A server drops nothing.
 *
 * Every engine this machine can run: dropping a column is a different
 * statement on each, and SQLite rebuilds the table to do it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Manifest, RequiredColumn } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, pagesRepo, projectAppsRepo, rolesRepo, usersRepo } from '@adminium/meta';

import { diffRemovals } from '../src/apps/removal.js';
import { appBuildDir } from '../src/project/apps/build-apps.js';

import { ENGINES } from './app-install-harness.js';
import { folderHarness, type FolderHarness } from './folder-app-harness.js';

let h: FolderHarness;
afterEach(async () => {
  await h.close();
});

const count = async (table: string): Promise<number> => Number((await h.harness.rows(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.['n']);

const slugs = async (): Promise<string[]> =>
  (await pagesRepo(h.harness.meta).listAll()).map((page) => page.slug).filter((slug) => slug.startsWith('repairs-')).sort();

const recordOf = async (ref: string) =>
  (await appTablesRepo(h.harness.meta).forInstall(h.harness.connectionId, 'repairs')).find((record) => record.ref === ref);

/** Take columns out of the starter's `items` table. */
const dropColumns = (...refs: string[]): void => {
  h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
    ...table,
    columns: (table['columns'] as { ref: string }[]).filter((column) => !refs.includes(column.ref)),
  }));
};

/** Give `items` a column of the test's own (the sample data names every column the starter has). */
const addColour = (): void => {
  h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
    ...table,
    columns: [...(table['columns'] as unknown[]), { ref: 'colour', type: 'text', maxLength: 40, nullable: true }],
  }));
};

/** The app installed with a `colour` column that two rows hold a value in. */
async function installedWithColour(): Promise<void> {
  await h.newApp('repairs');
  addColour();
  await h.sync();
  await h.harness.run(`UPDATE repairs_items SET colour = 'red' WHERE status = 'done'`);
}

const coloured = async (): Promise<number> =>
  Number((await h.harness.rows('SELECT COUNT(*) AS n FROM repairs_items WHERE colour IS NOT NULL'))[0]?.['n']);

const NOTES_TABLE = {
  ref: 'notes',
  label: { 'en-US': 'Note' },
  labelPlural: { 'en-US': 'Notes' },
  keyField: 'body',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'body', type: 'text', maxLength: 200, default: '' },
  ],
};

interface Listed {
  apps: { folder?: { removals?: { kind: string; table: string; tableName: string; column?: string; rows: number; detail?: string }[] } }[];
}
const listed = async (): Promise<Listed> => JSON.parse((await h.harness.inject({ method: 'GET', url: '/apps' })).body) as Listed;

/**
 * Build the folder and make its manifest the installed document WITHOUT
 * applying it: what an apply leaves behind when it stops after the document
 * moved and before anything the manifest dropped was looked at.
 */
async function documentMovedTo(): Promise<void> {
  await h.build();
  const document = JSON.parse(readFileSync(join(appBuildDir(h.root, 'repairs'), 'app.json'), 'utf8')) as Manifest;
  const manifests = manifestsRepo(h.harness.meta, { encrypt: (v) => v, decrypt: (v) => v });
  const row = (await manifests.list('app')).find((m) => m.row.manifestKey === 'repairs')!;
  await manifests.setVersion(row.row.id, { version: document.version, document });
}

const answer = (accept: boolean) => h.harness.inject({ method: 'POST', url: '/project/apps/repairs/removals', payload: { accept } });

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`what a folder app no longer declares [${dialect}]`, { timeout: 120_000 }, () => {
    it('removes a page nobody edited, and keeps an edited one as an ordinary page', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.sync();
      const pages = pagesRepo(h.harness.meta);
      const edited = (await pages.findBySlug(h.harness.connectionId, 'repairs-requests'))!;
      const config = edited.config as { config: Record<string, unknown> };
      await pages.replaceConfig(edited.id, { ...config, config: { ...config.config, note: 'changed by hand' } });

      h.remove('apps/repairs/manifest/pages/repairs-items.json');
      h.remove('apps/repairs/manifest/pages/repairs-requests.json');
      h.edit('apps/repairs/manifest/roles.json', (roles) =>
        (roles as unknown as { permissions: string[] }[]).map((role) => ({ ...role, permissions: role.permissions.filter((p) => !p.startsWith('page:')) })),
      );
      // The app keeps its two tables: a manifest needs a page, so one stays declared under another address.
      h.put('apps/repairs/manifest/pages/repairs-all.json', {
        ref: 'repairs-all',
        template: 'page-crud',
        title: { key: 'repairs.all', fallback: 'All items' },
        nav: { group: 'main', icon: 'list-checks', order: 1 },
        bindings: { rows: 'items' },
      });
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });

      expect(await slugs()).toEqual(['repairs-all', 'repairs-requests']);
      const kept = (await pages.findBySlug(h.harness.connectionId, 'repairs-requests'))!;
      expect(kept.manifestId).toBeNull();
      expect(h.lines.log.join('\n')).toContain('App "repairs": removed the page repairs-items.');
      expect(h.lines.log.join('\n')).toContain('App "repairs": kept repairs-requests as an ordinary page: somebody edited it.');
      // The tables and their rows were never in question.
      expect(await count('repairs_items')).toBe(6);
    });

    it('removes a role with its grants, and says who held it', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.sync();
      const roles = rolesRepo(h.harness.meta);
      const staff = (await roles.findBySlug('repairs-staff'))!;
      const owner = (await usersRepo(h.harness.meta).list())[0]!;
      await roles.assignToUser(owner.id, staff.id);

      h.put('apps/repairs/manifest/roles.json', []);
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect(await roles.findBySlug('repairs-staff')).toBeNull();
      expect(h.lines.log.join('\n')).toContain('App "repairs": removed the role repairs-staff (1 member(s) and 0 API key(s) held it).');
    });

    it('asks before a column that holds data goes, keeps it on a no, and does not ask again', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await installedWithColour();

      dropColumns('colour');
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      // Two rows hold a colour: they are counted, and still there.
      const asked = (await listed()).apps[0]?.folder?.removals;
      expect(asked).toEqual([{ kind: 'column', table: 'items', tableName: 'repairs_items', column: 'colour', rows: 2 }]);
      expect(h.lines.warn.join('\n')).toContain('no longer declares the column "repairs_items.colour" (2 rows hold a value). Nothing was dropped.');
      expect(await coloured()).toBe(2);
      const waiting = JSON.parse((await h.harness.inject({ method: 'GET', url: '/project/apps/repairs/removals' })).body) as { removals: unknown[] };
      expect(waiting.removals).toEqual(asked);

      const reply = await answer(false);
      expect(reply.statusCode, reply.body).toBe(200);
      expect(JSON.parse(reply.body)).toEqual({ key: 'repairs', accepted: false, dropped: { tables: [], columns: [] }, kept: ['repairs_items.colour'] });
      expect(await coloured()).toBe(2);
      expect((await listed()).apps[0]?.folder?.removals).toBeUndefined();
      expect((await h.audit()).some((entry) => entry.action === 'app.removal-declined')).toBe(true);

      // Nothing waits, and another change to the app does not bring the question back.
      expect((await answer(false)).statusCode).toBe(404);
      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
        ...table,
        columns: [...(table['columns'] as unknown[]), { ref: 'size', type: 'text', maxLength: 10, nullable: true }],
      }));
      h.lines.warn.length = 0;
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await h.state('repairs'))?.removals).toBeNull();
      expect(h.lines.warn).toEqual([]);
      expect(await coloured()).toBe(2);
    });

    it('drops the column on a yes, and only the column', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await installedWithColour();
      dropColumns('colour');
      await h.sync();

      const reply = await answer(true);
      expect(reply.statusCode, reply.body).toBe(200);
      expect(JSON.parse(reply.body)).toEqual({ key: 'repairs', accepted: true, dropped: { tables: [], columns: ['repairs_items.colour'] }, kept: [] });
      await expect(h.harness.rows('SELECT colour FROM repairs_items')).rejects.toBeTruthy();
      expect(await h.harness.rows('SELECT title, status, notes FROM repairs_items ORDER BY id')).toHaveLength(6);
      expect((await h.state('repairs'))?.removals).toBeNull();
      expect((await h.audit()).some((entry) => entry.action === 'app.removal-accepted')).toBe(true);
      // The app still applies cleanly afterwards.
      expect((await h.sync())[0]).toMatchObject({ state: 'unchanged' });
    });

    it('drops a column and a table that hold nothing without asking', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/tables/notes.json', NOTES_TABLE);
      addColour();
      await h.sync();
      expect(await count('repairs_notes')).toBe(0);

      h.remove('apps/repairs/manifest/tables/notes.json');
      dropColumns('colour');
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await h.state('repairs'))?.removals).toBeNull();
      expect(h.lines.warn).toEqual([]);
      expect(h.lines.log.join('\n')).toContain('App "repairs": dropped repairs_notes, repairs_items.colour: they held nothing.');
      await expect(count('repairs_notes')).rejects.toBeTruthy();
      await expect(h.harness.rows('SELECT colour FROM repairs_items')).rejects.toBeTruthy();
      expect((await recordOf('notes'))?.state).toBe('dropped');
      expect(await count('repairs_items')).toBe(6);
    });

    it('asks before a table with rows goes: a no keeps it out of the app, a yes drops it', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/tables/notes.json', NOTES_TABLE);
      h.put('apps/repairs/manifest/tables/tags.json', { ...NOTES_TABLE, ref: 'tags', label: { 'en-US': 'Tag' }, labelPlural: { 'en-US': 'Tags' } });
      await h.sync();
      await h.harness.run(`INSERT INTO repairs_notes (id, body) VALUES (1, 'keep me')`);
      await h.harness.run(`INSERT INTO repairs_tags (id, body) VALUES (1, 'a'), (2, 'b')`);

      h.remove('apps/repairs/manifest/tables/notes.json');
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await listed()).apps[0]?.folder?.removals).toEqual([{ kind: 'table', table: 'notes', tableName: 'repairs_notes', rows: 1 }]);
      expect(await count('repairs_notes')).toBe(1);

      // A second table goes before the first was answered: one question holds both.
      h.remove('apps/repairs/manifest/tables/tags.json');
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await listed()).apps[0]?.folder?.removals).toEqual([
        { kind: 'table', table: 'notes', tableName: 'repairs_notes', rows: 1 },
        { kind: 'table', table: 'tags', tableName: 'repairs_tags', rows: 2 },
      ]);

      // Declared again, a table leaves the question.
      h.put('apps/repairs/manifest/tables/tags.json', { ...NOTES_TABLE, ref: 'tags', label: { 'en-US': 'Tag' }, labelPlural: { 'en-US': 'Tags' } });
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await listed()).apps[0]?.folder?.removals).toEqual([{ kind: 'table', table: 'notes', tableName: 'repairs_notes', rows: 1 }]);
      expect(await count('repairs_tags')).toBe(2);

      const reply = await answer(true);
      expect(reply.statusCode, reply.body).toBe(200);
      expect(JSON.parse(reply.body)).toMatchObject({ accepted: true, dropped: { tables: ['repairs_notes'], columns: [] } });
      await expect(count('repairs_notes')).rejects.toBeTruthy();
      expect((await recordOf('notes'))?.state).toBe('dropped');
      expect(await count('repairs_tags')).toBe(2);
      expect(await count('repairs_items')).toBe(6);
    });

    it('keeps a declined table in the database and out of the app', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/tables/notes.json', NOTES_TABLE);
      await h.sync();
      await h.harness.run(`INSERT INTO repairs_notes (id, body) VALUES (1, 'keep me')`);
      h.remove('apps/repairs/manifest/tables/notes.json');
      await h.sync();

      expect(JSON.parse((await answer(false)).body)).toMatchObject({ accepted: false, kept: ['repairs_notes'] });
      expect(await count('repairs_notes')).toBe(1);
      expect((await recordOf('notes'))?.state).toBe('released');
    });

    it('counts the rows a narrower column no longer fits, and changes nothing in the database', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      await h.sync();
      const long = Number((await h.harness.rows(`SELECT COUNT(*) AS n FROM repairs_items WHERE ${dialect === 'sqlite' ? 'length' : 'char_length'}(title) > 30`))[0]?.['n']);
      expect(long).toBeGreaterThan(0);

      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
        ...table,
        columns: (table['columns'] as { ref: string }[]).map((column) => (column.ref === 'title' ? { ...column, maxLength: 30 } : column)),
      }));
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await listed()).apps[0]?.folder?.removals).toEqual([
        { kind: 'narrow', table: 'items', tableName: 'repairs_items', column: 'title', rows: long, detail: 'it now holds at most 30 characters (it held 120)' },
      ]);
      expect(h.lines.warn.join('\n')).toContain(`${String(long)} row${long === 1 ? '' : 's'} do not fit and stay as they are`);

      // Yes or no, the rows stay as they are.
      expect(JSON.parse((await answer(true)).body)).toEqual({ key: 'repairs', accepted: true, dropped: { tables: [], columns: [] }, kept: [] });
      expect(Number((await h.harness.rows(`SELECT COUNT(*) AS n FROM repairs_items WHERE ${dialect === 'sqlite' ? 'length' : 'char_length'}(title) > 30`))[0]?.['n'])).toBe(long);
      expect(await count('repairs_items')).toBe(6);
    });

    it('lets only a Super Admin say yes', async () => {
      h = await folderHarness(dialect, { mode: 'dev', superAdmin: false });
      await installedWithColour();
      dropColumns('colour');
      await h.sync();
      const reply = await answer(true);
      expect(reply.statusCode, reply.body).toBe(403);
      expect(reply.body).toContain('DROP_NEEDS_SUPER_ADMIN');
      expect(await coloured()).toBe(2);
      // Keeping the data is anyone's who may manage apps.
      expect((await answer(false)).statusCode).toBe(200);
    });

    it('never answers a question against a manifest that declares the column again', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await installedWithColour();
      dropColumns('colour');
      await h.sync();
      expect((await h.state('repairs'))?.removals?.changes).toHaveLength(1);

      // The folder declares it again, and that apply stopped before the question was looked at.
      addColour();
      await documentMovedTo();
      const reply = await answer(true);
      expect(reply.statusCode, reply.body).toBe(404);
      expect(await coloured()).toBe(2);
      expect((await h.state('repairs'))?.removals).toBeNull();
    });

    it('never drops a column of a table another app also uses', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await installedWithColour();
      await appTablesRepo(h.harness.meta).record({
        appKey: 'other',
        manifestId: null,
        connectionId: h.harness.connectionId,
        ref: 'things',
        tableName: 'repairs_items',
        owned: false,
        state: 'adopted',
      });
      dropColumns('colour');
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await h.state('repairs'))?.removals).toBeNull();
      expect(h.lines.log.join('\n')).toContain('kept "repairs_items.colour": the app did not make that table, or does not use it alone.');
      expect(await coloured()).toBe(2);
    });

    it('lets a column it keeps be left empty, so the app can still add rows', async () => {
      for (const mode of ['server', 'dev'] as const) {
        h = await folderHarness(dialect, { mode, apps: { repairs: { sampleData: false } } });
        await h.newApp('repairs');
        // Required, with no default: every row must say it.
        h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
          ...table,
          columns: [...(table['columns'] as unknown[]), { ref: 'colour', type: 'text', maxLength: 40 }],
        }));
        await h.sync();
        await h.harness.run(`INSERT INTO repairs_items (title, status, colour, created_at) VALUES ('a', 'open', 'red', CURRENT_TIMESTAMP)`);
        await expect(h.harness.run(`INSERT INTO repairs_items (title, status, created_at) VALUES ('b', 'open', CURRENT_TIMESTAMP)`)).rejects.toBeTruthy();

        dropColumns('colour');
        expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
        // Kept on a server, asked about under dev: either way it is still there, and no longer in the way.
        expect(await coloured()).toBe(1);
        expect(h.lines.log.join('\n')).toContain('may be left empty from now on: the app no longer fills it.');
        await h.harness.run(`INSERT INTO repairs_items (title, status, created_at) VALUES ('b', 'open', CURRENT_TIMESTAMP)`);
        expect(await count('repairs_items')).toBe(2);
        if (mode === 'server') await h.close();
      }
    });

    it('still deals with a table and a column when the apply that dropped them stopped part way', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/tables/notes.json', NOTES_TABLE);
      addColour();
      await h.sync();
      await h.harness.run(`UPDATE repairs_items SET colour = 'red' WHERE status = 'done'`);
      await h.harness.run(`INSERT INTO repairs_notes (id, body) VALUES (1, 'keep me')`);

      // The installed document is already the new manifest: there is no "before" left to compare with.
      h.remove('apps/repairs/manifest/tables/notes.json');
      dropColumns('colour');
      await documentMovedTo();
      await projectAppsRepo(h.harness.meta).setFailure(
        'repairs',
        { stage: 'pages', message: 'stopped', hash: 'sha256:stopped', owed: [{ table: 'items', column: 'colour' }] },
        Date.now(),
        { nothingApplied: true },
      );
      expect((await h.state('repairs'))?.appliedHash).toBeNull();

      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await listed()).apps[0]?.folder?.removals).toEqual([
        { kind: 'table', table: 'notes', tableName: 'repairs_notes', rows: 1 },
        { kind: 'column', table: 'items', tableName: 'repairs_items', column: 'colour', rows: 2 },
      ]);
      expect((await h.state('repairs'))?.failure).toBeNull();
    });

    it('keeps the columns a refused manifest drops with the refusal', async () => {
      h = await folderHarness(dialect, { mode: 'dev' });
      await installedWithColour();
      dropColumns('colour');
      // Six sample rows share two statuses: a status that must be one of a kind cannot be, and the apply stops.
      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
        ...table,
        columns: (table['columns'] as { ref: string }[]).map((column) => (column.ref === 'status' ? { ...column, unique: true } : column)),
      }));
      expect((await h.sync())[0]).toMatchObject({ state: 'not-applied', stage: 'tables' });
      expect((await h.state('repairs'))?.failure?.owed).toEqual([{ table: 'items', column: 'colour' }]);
      // It stopped before the installed document moved: what was applied is still applied.
      expect((await h.state('repairs'))?.appliedHash).not.toBeNull();
      expect(await coloured()).toBe(2);
    });

    it('says what a narrower column no longer fits on a server, and stores no question', async () => {
      h = await folderHarness(dialect, { mode: 'server' });
      await h.newApp('repairs');
      await h.sync();
      await h.harness.run(`INSERT INTO repairs_items (title, status, created_at) VALUES ('${'x'.repeat(40)}', 'open', CURRENT_TIMESTAMP)`);
      h.edit('apps/repairs/manifest/tables/items.json', (table) => ({
        ...table,
        columns: (table['columns'] as { ref: string }[]).map((column) => (column.ref === 'title' ? { ...column, maxLength: 30 } : column)),
      }));
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await h.state('repairs'))?.removals).toBeNull();
      expect(h.lines.log.join('\n')).toContain('"repairs_items.title": it now holds at most 30 characters (it held 120); 1 row(s) do not fit and stay as they are.');
    });

    it('never drops and never asks on a server: what holds data is kept, and said', async () => {
      h = await folderHarness(dialect, { mode: 'server' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/tables/notes.json', NOTES_TABLE);
      addColour();
      await h.sync();
      await h.harness.run(`INSERT INTO repairs_notes (id, body) VALUES (1, 'keep me')`);

      h.remove('apps/repairs/manifest/tables/notes.json');
      // An empty column too: a server drops nothing at all.
      dropColumns('colour');
      expect((await h.sync())[0]).toMatchObject({ state: 'applied' });
      expect((await h.state('repairs'))?.removals).toBeNull();
      expect(await count('repairs_notes')).toBe(1);
      expect(await h.harness.rows('SELECT colour FROM repairs_items')).toEqual([]);
      expect((await recordOf('notes'))?.state).toBe('released');
      expect(h.lines.log.join('\n')).toContain('App "repairs": kept "repairs_notes": removing data is done from `adminium dev` or Studio.');
      expect(h.lines.log.join('\n')).toContain('App "repairs": kept "repairs_items.colour": removing data is done from `adminium dev` or Studio.');
      expect((await answer(true)).statusCode).toBe(404);
    });
  });
}

describe('what counts as a column that holds less', () => {
  const column = (over: Partial<RequiredColumn>): RequiredColumn => ({ ref: 'note', type: 'text', maxLength: 40, ...over }) as RequiredColumn;
  const app = (note: RequiredColumn): Manifest =>
    ({ kind: 'app', key: 'a', requiredSchema: { tables: [{ ref: 't', columns: [{ ref: 'id', type: 'int', role: 'pk' }, note] }] } }) as unknown as Manifest;
  const narrowed = (before: Partial<RequiredColumn>, after: Partial<RequiredColumn>) =>
    diffRemovals(app(column(before)), app(column(after))).narrowings.map((entry) => entry.detail);

  it('is one that starts requiring a value: a column requires one unless it says it may be empty', () => {
    expect(narrowed({ nullable: true }, {})).toEqual(['it must now have a value']);
    expect(narrowed({ nullable: true }, { nullable: false })).toEqual(['it must now have a value']);
    // It required a value all along, however that was written.
    expect(narrowed({}, { nullable: false })).toEqual([]);
    // A default fills the rows that have none.
    expect(narrowed({ nullable: true }, { default: '' })).toEqual([]);
  });
});

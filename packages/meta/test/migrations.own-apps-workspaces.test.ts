// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0075: saves, after-install items, workspaces and their files, on every
 * available dialect, over a store that already holds rows.
 *
 * - The upgrade creates no workspace, and every existing template, report
 *   layout and invoice layout reads "shown in all".
 * - A person's prefs row from before keeps every axis and has no workspace.
 * - Memberships cascade from both sides; deleting a workspace sets a
 *   person's last choice back to none.
 * - Every bounded column takes its full width on Postgres and MySQL.
 * - A version of a key is saved once; after-install items keep their tick
 *   through a re-put and go with their install.
 * - "Shown in" narrows to chosen workspaces, and a workspace's delete lists
 *   the items it would leave shown nowhere.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  AppVersionSaved,
  applyMigrations,
  appAfterInstallRepo,
  appSavesRepo,
  connectionsRepo,
  emailTemplatesRepo,
  manifestsRepo,
  userPrefsRepo,
  usersRepo,
  WorkspaceNameTaken,
  workspaceInstallsRepo,
  workspaceSavesRepo,
  workspacesRepo,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_760_000_000_000;
const PRE = ALL_MIGRATIONS.filter((m) => m.name < '0075_own_apps_and_workspaces');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };

async function connection(meta: MetaDb, name: string): Promise<string> {
  return (await connectionsRepo(meta, crypto).create({ name, engine: 'postgres', introspectDsn: `postgres://ro@db.internal:5432/${name}` })).id;
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0075_own_apps_and_workspaces [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });
    const migrate = (migrations = ALL_MIGRATIONS) => applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations });

    it('upgrades a store with rows: no workspace, everything shown in all, prefs kept', async () => {
      await migrate(PRE);
      const user = await usersRepo(t.meta).create({ email: 'ana@example.test', name: 'Ana', passwordHash: 'x' });
      await (t.meta.db as unknown as { insertInto: (t: string) => { values: (r: object) => { execute: () => Promise<unknown> } } })
        .insertInto('adminium_user_prefs')
        .values({ userId: user.id, theme: 'dark', accent: null, density: null, locale: null, dir: null, uiState: null, updatedAt: T0 })
        .execute();
      await emailTemplatesRepo(t.meta).upsert('welcome', 'en_US', { name: 'Welcome', subject: 'Hi', blocks: [], enabled: true });
      await migrate();

      expect(await workspacesRepo(t.meta).list()).toEqual([]);
      expect(await workspacesRepo(t.meta).count()).toBe(0);
      expect((await emailTemplatesRepo(t.meta).findByKeyLocale('welcome', 'en_US'))?.shownIn).toBe('all');
      expect(await userPrefsRepo(t.meta).get(user.id)).toMatchObject({ theme: 'dark', workspaceId: null });
    });

    it('groups databases many to many, cascades from both sides and resets a last choice', async () => {
      await migrate();
      const fernhill = await connection(t.meta, 'fernhill');
      const archive = await connection(t.meta, 'fernhill_archive');
      const suppliers = await connection(t.meta, 'suppliers');
      const kilnDb = await connection(t.meta, 'kiln');
      const repo = workspacesRepo(t.meta);
      const coffee = await repo.create({ name: 'Fernhill Coffee', connectionIds: [fernhill, archive, suppliers] }, T0);
      const kiln = await repo.create({ name: '  Kiln Street Pottery ', connectionIds: [kilnDb, suppliers] }, T0 + 1);
      expect(kiln).toMatchObject({ name: 'Kiln Street Pottery', position: 1 });
      expect(coffee.position).toBe(0);
      await expect(repo.create({ name: 'Fernhill Coffee' })).rejects.toBeInstanceOf(WorkspaceNameTaken);
      await expect(repo.create({ name: 'x'.repeat(81) })).rejects.toThrow();
      // The widest name fits on every engine.
      const wide = await repo.create({ name: 'w'.repeat(80) });
      expect(wide.name).toHaveLength(80);
      expect(await repo.forConnection(suppliers)).toEqual([coffee.id, kiln.id]);

      expect(await repo.reorder([kiln.id, coffee.id])).toBe(false);
      expect(await repo.reorder([wide.id, kiln.id, coffee.id])).toBe(true);
      expect((await repo.list()).map((w) => w.id)).toEqual([wide.id, kiln.id, coffee.id]);
      expect(await repo.forConnection(suppliers)).toEqual([kiln.id, coffee.id]);

      expect(await repo.setForConnection(suppliers, [coffee.id])).toEqual({ added: [], removed: [kiln.id] });
      await expect(repo.setForConnection(suppliers, ['wsp_absent'])).rejects.toThrow();

      const user = await usersRepo(t.meta).create({ email: 'ana@example.test', name: 'Ana', passwordHash: 'x' });
      await userPrefsRepo(t.meta).set(user.id, { workspaceId: kiln.id });
      expect((await userPrefsRepo(t.meta).get(user.id))?.workspaceId).toBe(kiln.id);

      // Deleting a connection takes it out of every workspace; the workspace stays, emptier.
      await connectionsRepo(t.meta, crypto).delete(kilnDb);
      expect((await repo.findById(kiln.id))?.connectionIds).toEqual([]);
      // Deleting a workspace leaves its databases and clears a person's last choice.
      expect(await repo.remove(kiln.id)).toBe(true);
      expect((await userPrefsRepo(t.meta).get(user.id))?.workspaceId).toBeNull();
      expect((await repo.findById(coffee.id))?.connectionIds.sort()).toEqual([fernhill, archive, suppliers].sort());

      await repo.setSender(coffee.id, { name: 'Fernhill Coffee', from: 'hello@fernhill.example', replyTo: null, postal: '1 Bean St' });
      expect((await repo.findById(coffee.id))?.sender).toEqual({ name: 'Fernhill Coffee', from: 'hello@fernhill.example', replyTo: null, postal: '1 Bean St' });
    });

    it('narrows an item to chosen workspaces and lists what a delete would leave nowhere', async () => {
      await migrate();
      const repo = workspacesRepo(t.meta);
      const a = await repo.create({ name: 'A' });
      const b = await repo.create({ name: 'B' });
      const templates = emailTemplatesRepo(t.meta);
      const one = await templates.upsert('one', 'en_US', { name: 'One', subject: 's', blocks: [], enabled: true });
      const two = await templates.upsert('two', 'en_US', { name: 'Two', subject: 's', blocks: [], enabled: true });
      expect(await repo.shownIn('email-template', one.id)).toEqual({ mode: 'all', workspaceIds: [] });
      await repo.setShownIn('email-template', one.id, [a.id]);
      await repo.setShownIn('email-template', two.id, [a.id, b.id]);
      expect(await repo.shownIn('email-template', one.id)).toEqual({ mode: 'chosen', workspaceIds: [a.id] });
      expect(await repo.onlyIn(a.id)).toEqual([{ kind: 'email-template', itemId: one.id }]);
      await repo.remove(a.id);
      // Chosen, none: never widened to all.
      expect(await repo.shownIn('email-template', one.id)).toEqual({ mode: 'chosen', workspaceIds: [] });
      await repo.setShownIn('email-template', two.id, null);
      expect(await repo.shownIn('email-template', two.id)).toEqual({ mode: 'all', workspaceIds: [] });
      expect(await repo.setShownIn('report', 'rpt_absent', null)).toBe(false);
    });

    it('reads a kind\'s links in one go, and an item\'s delete takes its links', async () => {
      await migrate();
      const repo = workspacesRepo(t.meta);
      const a = await repo.create({ name: 'A' });
      const b = await repo.create({ name: 'B' });
      const templates = emailTemplatesRepo(t.meta);
      const one = await templates.upsert('one', 'en_US', { name: 'One', subject: 's', blocks: [], enabled: true });
      const two = await templates.upsert('two', 'en_US', { name: 'Two', subject: 's', blocks: [], enabled: true });
      await repo.setShownIn('email-template', one.id, [b.id, a.id]);
      await repo.setShownIn('email-template', two.id, [b.id]);
      expect(await repo.linksOfKind('email-template')).toEqual(new Map([[one.id, [a.id, b.id].sort()], [two.id, [b.id]]]));
      expect(await repo.linksOfKind('report')).toEqual(new Map());
      expect(await repo.chosenIn('email-template', a.id)).toEqual(new Set([one.id]));
      expect((await templates.findById(one.id))?.shownIn).toBe('chosen');
      // Only workspaces that exist, once each, in the order given.
      expect(await repo.existing([b.id, 'wsp_absent', b.id, a.id])).toEqual([b.id, a.id]);
      expect(await repo.existing([])).toEqual([]);
      // Both ways an email row is deleted take its links.
      await templates.removeById(one.id);
      await templates.remove('two', 'en_US');
      expect(await repo.linksOfKind('email-template')).toEqual(new Map());
    });

    it('saves a version once, keeps after-install ticks, and holds a workspace install to one run', async () => {
      await migrate();
      const conn = await connection(t.meta, 'fernhill');
      const saves = appSavesRepo(t.meta);
      const fp = `sha512-${'A'.repeat(86)}==`;
      const first = await saves.create({ appKey: 'f'.repeat(80), version: '1.10.200', lineage: 'l'.repeat(36), connectionId: conn, label: 'L'.repeat(120), savedBy: null, integrity: fp, bytes: 123_456 }, T0);
      expect(first.integrity).toHaveLength(95);
      await expect(saves.create({ appKey: 'f'.repeat(80), version: '1.10.200', lineage: 'x', connectionId: conn, label: 'x', savedBy: null, integrity: fp, bytes: 1 })).rejects.toBeInstanceOf(AppVersionSaved);
      expect((await saves.list({ connectionId: conn })).map((s) => s.bytes)).toEqual([123_456]);

      const install = await manifestsRepo(t.meta, crypto).install({ manifestKey: 'ops', version: '1.0.0', kind: 'app', source: 'file', document: {}, connectionId: conn, scopeKey: conn });
      const after = appAfterInstallRepo(t.meta);
      const items = await after.put({ manifestId: install.row.id, appKey: 'ops' }, [{ kind: 'webhook', item: 'Notify Slack', field: 'url' }, { kind: 'secret-setting', item: 'email.smtp', field: 'password' }], T0);
      expect(items).toHaveLength(2);
      expect(await after.setDone(install.row.id, items[0]!.id, true, null, T0 + 1)).toBe(true);
      expect(await after.setDone('mft_other', items[1]!.id, true, null)).toBe(false);
      await after.put({ manifestId: install.row.id, appKey: 'ops' }, [{ kind: 'webhook', item: 'Notify Slack', field: 'url' }], T0 + 2);
      expect((await after.list(install.row.id)).find((i) => i.id === items[0]!.id)?.done).toBe(true);
      expect(await after.remove(install.row.id, [{ kind: 'webhook', item: 'Notify Slack', field: 'url' }])).toBe(1);
      await manifestsRepo(t.meta, crypto).uninstall(install.row.id);
      expect(await after.list(install.row.id)).toEqual([]);

      const wsSave = await workspaceSavesRepo(t.meta).create({ workspaceId: null, name: 'Fernhill Coffee', label: 'Main', savedBy: null, integrity: fp, bytes: 99, appSaveIds: [first.id], document: '{"v":1}' });
      expect((await workspaceSavesRepo(t.meta).findById(wsSave.id))?.appSaveIds).toEqual([first.id]);
      const installs = workspaceInstallsRepo(t.meta);
      const job = await installs.create({ integrity: fp, staged: 'stg_1', name: 'Fernhill Coffee', apps: [{ key: 'ops', version: '1.0.0', integrity: fp, target: null, state: 'pending' }], createdBy: null }, T0);
      expect(await installs.lock(job.id, 'run-1', T0)).toBe(true);
      expect(await installs.lock(job.id, 'run-2', T0 + 1)).toBe(false);
      // A lock left by a gone process is taken over.
      expect(await installs.lock(job.id, 'run-3', T0 + 16 * 60_000)).toBe(true);
      await installs.update(job.id, { state: 'stopped', apps: [{ key: 'ops', version: '1.0.0', integrity: fp, target: conn, state: 'stopped', error: 'x' }] });
      await installs.unlock(job.id, 'run-3');
      expect(await installs.findById(job.id)).toMatchObject({ state: 'stopped', runLock: null, apps: [{ target: conn, state: 'stopped' }] });
    });
  });
}

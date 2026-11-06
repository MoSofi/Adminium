// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0076: the same app or add-on once per database, on every available
 * dialect, over a store that already holds installs.
 *
 * - Every existing install gets its scope (its connection; a table-less
 *   add-on its host's; a payment provider `server`) and owns the bare
 *   addresses (`instance_slug = ''`).
 * - The key is unique per scope and per slug, and a NULL connection cannot
 *   slip past either (NULLs are distinct in a unique key on all three).
 * - `manifests` is NOT rebuilt: the attachments, credentials and outboxes
 *   that hang off it by FK are all still there afterwards.
 * - Settings, outboxes and app roles move to the install id; settings of a
 *   key with no install are dropped; uninstalling one install takes only
 *   its own.
 * - Attachments name their host install; one joining two databases is
 *   flagged.
 * - What an install made carries its id.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, addOnSettingsRepo, connectionsRepo, appOutboxesRepo, applyMigrations, manifestsRepo, newId, rolesRepo, type MetaDb } from '../src/index.js';
import { writeBool } from '../src/repos/util.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_760_000_000_000;
const PRE = ALL_MIGRATIONS.filter((m) => m.name < '0076_installs_per_database');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };

// The store as 0075 left it: rows written straight, in the old shapes.
type Raw = { insertInto: (table: string) => { values: (row: Record<string, unknown>) => { execute: () => Promise<unknown> } } };
const raw = (meta: MetaDb) => meta.db as unknown as Raw;

async function seed(meta: MetaDb) {
  const db = raw(meta);
  const connection = async (name: string) =>
    (await connectionsRepo(meta, crypto).create({ name, engine: 'postgres', introspectDsn: `postgres://ro@db.internal:5432/${name}` })).id;
  const fernhill = await connection('fernhill');
  const kiln = await connection('kiln');
  const manifest = async (key: string, kind: 'app' | 'add-on', connectionId: string | null, document: Record<string, unknown>) => {
    const id = newId('mft');
    await db
      .insertInto('adminium_manifests')
      .values({
        id,
        manifestKey: key,
        version: '1.0.0',
        source: 'file',
        manifest: JSON.stringify({ key, ...document }),
        connectionId,
        status: 'installed',
        kind,
        installedAt: T0,
        updatedAt: T0,
      })
      .execute();
    return id;
  };
  const pos = await manifest('pos', 'app', fernhill, {});
  const invoices = await manifest('invoices', 'add-on', null, { addOn: { attaches: [{ app: '*' }] } });
  const stripe = await manifest('payments-stripe', 'add-on', null, { addOn: { provides: [{ contract: 'payment-provider', version: 1 }] } });
  const declared = await manifest('labels', 'add-on', null, { addOn: { scope: 'server' } });
  const design = await manifest('design', 'add-on', kiln, {});
  const attach = async (manifestId: string, attachedTo: string) =>
    db.insertInto('adminium_manifest_attachments').values({ id: newId('mat'), manifestId, attachedTo, disabledAt: null, createdAt: T0 }).execute();
  await attach(invoices, 'pos');
  await attach(design, 'pos');
  await attach(stripe, 'pos');
  await attach(invoices, 'not-installed');
  await db
    .insertInto('adminium_add_on_credentials')
    .values({ id: newId('aoc'), manifestId: stripe, kind: 'api-key', payload: 'enc', expiresAt: null, scopes: null, createdAt: T0, updatedAt: T0 })
    .execute();
  await db.insertInto('adminium_add_on_settings').values({ addOnKey: 'invoices', values: JSON.stringify({ business_name: 'Fernhill Coffee' }), updatedBy: null, updatedAt: T0 }).execute();
  await db.insertInto('adminium_add_on_settings').values({ addOnKey: 'ghost', values: JSON.stringify({ a: 1 }), updatedBy: null, updatedAt: T0 }).execute();
  await db
    .insertInto('adminium_app_outboxes')
    .values({ id: newId('aob'), appKey: 'pos', manifestId: pos, connectionId: fernhill, definition: '{}', scannedAt: null, createdAt: T0, updatedAt: T0 })
    .execute();
  const roleId = newId('role');
  await db
    .insertInto('adminium_roles')
    .values({ id: roleId, slug: 'pos-cashier', name: 'Cashier', description: null, isBuiltin: writeBool(meta, false), createdAt: T0, updatedAt: T0, appKey: 'pos', screensOnly: writeBool(meta, false) })
    .execute();
  await db
    .insertInto('adminium_automations')
    .values({ id: newId('auto'), connectionId: fernhill, name: 'Reminder', description: null, enabled: writeBool(meta, false), trigger: '{"kind":"manual"}', graph: '{"nodes":[]}', createdAt: T0, updatedAt: T0, managedBy: 'pos' })
    .execute();
  return { fernhill, kiln, pos, invoices, stripe, declared, design, roleId };
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0076_installs_per_database [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE });
    });
    afterEach(async () => {
      await t.destroy();
    });
    const upgrade = () => applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

    it('gives every existing install its scope and the bare addresses, and never rebuilds manifests', async () => {
      const s = await seed(t.meta);
      await upgrade();
      const rows = await t.meta.db.selectFrom('adminium_manifests').select(['id', 'manifestKey', 'scopeKey', 'instanceSlug']).execute();
      const scope = Object.fromEntries(rows.map((row) => [row.manifestKey, row.scopeKey]));
      expect(scope).toEqual({ pos: s.fernhill, invoices: s.fernhill, 'payments-stripe': 'server', labels: 'server', design: s.kiln });
      expect(rows.every((row) => row.instanceSlug === '')).toBe(true);

      // Trap 9: the FK children of manifests are all still there.
      expect(await t.meta.db.selectFrom('adminium_manifest_attachments').selectAll().execute()).toHaveLength(4);
      expect(await t.meta.db.selectFrom('adminium_add_on_credentials').selectAll().execute()).toHaveLength(1);
      expect(await t.meta.db.selectFrom('adminium_app_outboxes').selectAll().execute()).toHaveLength(1);

      const links = await t.meta.db.selectFrom('adminium_manifest_attachments').select(['manifestId', 'attachedTo', 'hostInstall', 'flag']).execute();
      const link = (manifestId: string, to = 'pos') => links.find((one) => one.manifestId === manifestId && one.attachedTo === to);
      expect(link(s.invoices)).toMatchObject({ hostInstall: s.pos, flag: null });
      expect(link(s.stripe)).toMatchObject({ hostInstall: s.pos, flag: null });
      // Design keeps its tables on kiln and is attached to Fernhill's Point of Sale.
      expect(link(s.design)).toMatchObject({ hostInstall: s.pos, flag: 'crosses' });
      expect(link(s.invoices, 'not-installed')).toMatchObject({ hostInstall: '', flag: null });

      expect((await t.meta.db.selectFrom('adminium_roles').select('manifestId').where('id', '=', s.roleId).executeTakeFirstOrThrow()).manifestId).toBe(s.pos);
      expect((await t.meta.db.selectFrom('adminium_automations').select('installId').executeTakeFirstOrThrow()).installId).toBe(s.pos);
    });

    it('keys a key once per database and once per address, and a NULL connection cannot slip past', async () => {
      const s = await seed(t.meta);
      await upgrade();
      const repo = manifestsRepo(t.meta, crypto);
      const base = { manifestKey: 'pos', version: '1.0.0', kind: 'app' as const, source: 'file', document: {} };
      await expect(repo.install({ ...base, connectionId: s.fernhill, scopeKey: s.fernhill, instanceSlug: 'again' })).rejects.toThrow();
      await expect(repo.install({ ...base, connectionId: s.kiln, scopeKey: s.kiln })).rejects.toThrow();
      const kiln = await repo.install({ ...base, connectionId: s.kiln, scopeKey: s.kiln, instanceSlug: 'kiln' });
      expect((await repo.listByKey('pos')).map((m) => m.row.id)).toEqual([s.pos, kiln.row.id]);
      // A second server-wide row of a payment provider.
      await expect(repo.install({ ...base, manifestKey: 'payments-stripe', kind: 'add-on', scopeKey: 'server', instanceSlug: 'two' })).rejects.toThrow();
    });

    it('moves settings, outboxes and roles to the install, and one uninstall takes only its own', async () => {
      const s = await seed(t.meta);
      await upgrade();
      const settings = addOnSettingsRepo(t.meta);
      expect(await settings.valuesForInstall(s.invoices)).toEqual({ business_name: 'Fernhill Coffee' });
      // A key with no install had settings nobody could reach: dropped.
      expect(await t.meta.db.selectFrom('adminium_add_on_settings').select('addOnKey').execute()).toEqual([{ addOnKey: 'invoices' }]);

      const repo = manifestsRepo(t.meta, crypto);
      const kilnInvoices = await repo.install({ manifestKey: 'invoices', version: '1.0.0', kind: 'add-on', source: 'file', document: {}, scopeKey: s.kiln, instanceSlug: 'kiln' });
      await settings.patch({ manifestId: kilnInvoices.row.id, addOnKey: 'invoices' }, { business_name: 'Kiln Street Pottery' }, [{ key: 'business_name' }]);

      const kilnPos = await repo.install({ manifestKey: 'pos', version: '1.0.0', kind: 'app', source: 'file', document: {}, connectionId: s.kiln, scopeKey: s.kiln, instanceSlug: 'kiln' });
      const outboxes = appOutboxesRepo(t.meta);
      await outboxes.put({ appKey: 'pos', manifestId: kilnPos.row.id, connectionId: s.kiln, definition: '{"kiln":1}' });
      expect((await outboxes.list()).map((row) => row.manifestId).sort()).toEqual([s.pos, kilnPos.row.id].sort());
      const roles = rolesRepo(t.meta);
      await roles.create({ slug: 'pos-kiln-cashier', name: 'Cashier · kiln', appKey: 'pos', manifestId: kilnPos.row.id });

      await repo.uninstall(kilnInvoices.row.id);
      await repo.uninstall(kilnPos.row.id);
      expect(await settings.valuesForInstall(s.invoices)).toEqual({ business_name: 'Fernhill Coffee' });
      expect(await settings.valuesForInstall(kilnInvoices.row.id)).toEqual({});
      expect((await outboxes.list()).map((row) => row.manifestId)).toEqual([s.pos]);
      expect((await roles.listForInstall(s.pos)).map((role) => role.slug)).toEqual(['pos-cashier']);
      // The other install's role loses only its link.
      expect((await roles.findBySlug('pos-kiln-cashier'))?.manifestId).toBeNull();
    });
  });
}

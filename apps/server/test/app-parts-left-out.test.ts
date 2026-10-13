// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PART OF AN APP BUILT ON AN ADD-ON IT ONLY SUGGESTS. Installed without the
 * add-on, the part is left out — its tables are not made, and what names them
 * goes with them — and the app works. Connected later, the part is put in:
 * the tables, the link into them, the kept total over them, the page and the
 * grants. Through the real routes, on SQLite, Postgres and MySQL.
 */
import { readFileSync } from 'node:fs';

import { appTablesRepo, manifestsRepo, readAppModules, rolesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { mapTableRefs } from '../src/apps/real-refs.js';
import { addOnHarness, appManifest, CRYPTO, ENGINES, type Harness } from './app-add-ons.helpers.js';

type Doc = Record<string, unknown>;
const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };

const invoicesAddOn = (): Doc => ({ ...(JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Doc), version: '1.1.0' });

/** A part of the quote shape, spelled out as the app's own table. */
function tableOnPart(part: string, ref: string, extra: Doc[] = []): Doc {
  const names: Record<string, string> = { document: 'quotes', lines: 'quote_lines' };
  const shape = (invoicesAddOn()['addOn'] as { shapes: Doc[] }).shapes.find((one) => one['name'] === 'quote')!;
  const def = (shape['parts'] as Record<string, { columns: Doc[]; states?: Doc }>)[part]!;
  const map = (short: string) => names[short] ?? short;
  const columns = def.columns.map((column) => {
    const rules = column['rules'] as Doc | undefined;
    return {
      ...column,
      ...(typeof column['references'] === 'string' ? { references: map(column['references']) } : {}),
      ...(rules === undefined ? {} : { rules: Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, name === 'rollup' ? mapTableRefs(rule, map, { refKeys: ['from'] }).value : mapTableRefs(rule, map).value])) }),
    };
  });
  return { ref, module: 'quotes', builtOn: 'invoices/quote@1', part, columns: [...columns, ...extra], ...(def.states === undefined ? {} : { states: mapTableRefs(def.states, map).value }) };
}

const page = (ref: string, table: string, module: string) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'manifest:sample', icon: 'list', order: 1 }, bindings: { rows: table }, module });

function crm(): Doc {
  return appManifest('crm', {
    version: '0.2.0',
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    addOns: {
      suggests: [{ key: 'invoices', range: '>=1.1.0', reason: en('Quotes are made by this add-on.'), checked: true }],
      features: [{ id: 'quotes', label: en('Quotes'), requires: ['invoices'] }],
    },
    modules: [
      { id: 'selling', label: en('Selling'), default: 'always' },
      { id: 'quotes', label: en('Quotes'), default: 'on', feature: 'quotes' },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          module: 'selling',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'quote_id', type: 'int', nullable: true },
            { ref: 'quoted', type: 'decimal', scale: 'currency', nullable: true, rules: { rollup: { from: 'quotes', via: 'deal_id', latest: { of: 'total', by: 'sent_at', row: 'quote_id' } } } },
          ],
        },
        { ref: 'notes', module: 'selling', columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'quote_id', type: 'fk', references: 'quotes', nullable: true }, { ref: 'text', type: 'text', maxLength: 200, nullable: true }] },
        tableOnPart('document', 'quotes', [{ ref: 'deal_id', type: 'fk', references: 'deals', index: true }]),
        tableOnPart('lines', 'quote_lines'),
      ],
    },
    roles: [
      { key: 'rep', name: 'Sales rep', modules: ['selling', 'quotes'], permissions: ['table:@deals:read', 'table:@deals:create', 'table:@quotes:read', 'table:@quotes:create', 'page:@crm-deals:view', 'page:@crm-quotes:view'] },
      { key: 'quoter', name: 'Quote clerk', modules: ['quotes'], permissions: ['table:@quotes:read'] },
    ],
    pages: [page('crm-deals', 'deals', 'selling'), page('crm-quotes', 'quotes', 'quotes')],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  });
}

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const storedModules = async (harness: Harness) => readAppModules((await manifestsRepo(harness.meta, CRYPTO).findByKey('crm'))!.row.modules);
const columnsOf = async (harness: Harness, table: string): Promise<string[]> => {
  const made = (await appTablesRepo(harness.meta).forInstall(harness.connectionId, 'crm')).map((record) => record.tableName);
  expect(made).toContain(table);
  const rows = await harness.rows(`select * from ${table} limit 0`).catch(() => []);
  void rows;
  const document = (await manifestsRepo(harness.meta, CRYPTO).findByKey('crm'))!.document as { requiredSchema: { tables: { ref: string; columns: { ref: string }[] }[] } };
  return document.requiredSchema.tables.find((one) => `crm_${one.ref}` === table)!.columns.map((column) => column.ref);
};

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a part built on an add-on the app only suggests, on ${dialect}`, () => {
    it('is left out of an install without the add-on, and the app is whole without it', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      await h.stageApp(crm());
      // The check, with the add-on unticked: the part is said to be left out, and its tables are not in the plan.
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'crm', version: '0.2.0', connectionId: h.connectionId, addOns: [] } });
      expect(planned.statusCode, planned.body).toBe(200);
      const plan = planned.json().plan;
      expect(plan.problems).toEqual([]);
      expect(plan.modules).toEqual([
        expect.objectContaining({ id: 'selling', default: 'always', leftOut: false, needs: [] }),
        expect.objectContaining({ id: 'quotes', default: 'on', leftOut: true, needs: ['invoices'], tables: ['quotes', 'quote_lines'], roles: ['Sales rep', 'Quote clerk'] }),
      ]);
      expect(plan.tables.map((table: { ref: string }) => table.ref).sort()).toEqual(['deals', 'notes']);

      const installed = await h.install('crm', '0.2.0', { planChecksum: plan.checksum });
      expect(installed.statusCode, installed.body).toBe(200);
      const names = await h.tableNames();
      expect(names).toEqual(expect.arrayContaining(['crm_deals', 'crm_notes']));
      expect(names).not.toContain('crm_quotes');
      expect(names).not.toContain('crm_quote_lines');
      // The link into the part is not made; the kept total is a plain, empty column.
      expect(await columnsOf(h, 'crm_notes')).toEqual(['id', 'deal_id', 'text']);
      await h.rows("insert into crm_deals (name) values ('Atrium')");
      expect((await h.rows('select quoted, quote_id from crm_deals'))[0]).toMatchObject({ quoted: null, quote_id: null });
      // A role of the part alone is not made; the other keeps what is there.
      const roles = (await rolesRepo(h.meta).list()).filter((role) => role.appKey === 'crm');
      expect(roles.map((role) => [role.slug, role.modules])).toEqual([['crm-rep', ['selling']]]);
      // What was left out is remembered, and the part reads as off: it waits for the add-on.
      const stored = await storedModules(h);
      expect(stored?.leftOut).toEqual({ modules: ['quotes'], tables: ['quotes', 'quote_lines'], columns: { notes: ['quote_id'] } });
      const parts = await h.inject({ method: 'GET', url: '/apps/crm/parts' });
      expect(parts.statusCode, parts.body).toBe(200);
      expect(parts.json().parts).toEqual([
        expect.objectContaining({ id: 'selling', on: true, switch: true, leftOut: false }),
        expect.objectContaining({ id: 'quotes', on: false, switch: true, leftOut: true, waiting: [expect.objectContaining({ key: 'invoices' })] }),
      ]);
    });

    it('is put in when the add-on is installed for the app afterwards', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      await h.stageApp(crm());
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'crm', version: '0.2.0', connectionId: h.connectionId, addOns: [] } });
      const first = await h.install('crm', '0.2.0', { planChecksum: planned.json().plan.checksum });
      expect(first.statusCode, first.body).toBe(200);
      await h.rows("insert into crm_deals (name) values ('Atrium')");
      expect(await h.tableNames()).not.toContain('crm_quotes');

      const addOn = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'invoices', version: '1.1.0', attachTo: ['crm'], connectionId: h.connectionId } });
      expect(addOn.statusCode, addOn.body).toBe(200);

      const names = await h.tableNames();
      expect(names).toEqual(expect.arrayContaining(['crm_quotes', 'crm_quote_lines']));
      expect(await columnsOf(h, 'crm_notes')).toEqual(['id', 'deal_id', 'quote_id', 'text']);
      // The deal made before keeps its row; nothing was dropped to put the part in.
      expect((await h.rows('select name from crm_deals')).map((row) => row['name'])).toEqual(['Atrium']);
      const stored = await storedModules(h);
      expect(stored?.leftOut).toBeUndefined();
      const parts = await h.inject({ method: 'GET', url: '/apps/crm/parts' });
      expect(parts.json().parts[1]).toMatchObject({ id: 'quotes', on: true, leftOut: false, waiting: [] });
      const roles = (await rolesRepo(h.meta).list()).filter((role) => role.appKey === 'crm');
      expect(roles.map((role) => [role.slug, role.modules]).sort()).toEqual([
        ['crm-quoter', ['quotes']],
        ['crm-rep', ['selling', 'quotes']],
      ]);
      expect((await appTablesRepo(h.meta).forInstall(h.connectionId, 'crm')).filter((record) => record.state === 'created').map((record) => [record.ref, record.module]).sort()).toEqual([
        ['deals', 'selling'],
        ['notes', 'selling'],
        ['quote_lines', 'quotes'],
        ['quotes', 'quotes'],
      ]);
    });

    it('stays in once it is in: the add-on switched off for the app turns the part off, and an update of the app takes nothing away', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      const planned = await h.plan(crm());
      const installed = await h.install('crm', '0.2.0', { planChecksum: planned.json().plan.checksum, addOns: [{ key: 'invoices', version: '1.1.0' }] });
      expect(installed.statusCode, installed.body).toBe(200);
      await h.rows("insert into crm_deals (name) values ('Atrium')");

      const off = await h.inject({ method: 'PATCH', url: '/add-ons/invoices', payload: { attachedTo: 'crm', enabled: false } });
      expect(off.statusCode, off.body).toBe(200);
      // Off, not gone: the part waits for its add-on, and nothing of it was left out.
      const parts = await h.inject({ method: 'GET', url: '/apps/crm/parts' });
      expect(parts.json().parts[1]).toMatchObject({ id: 'quotes', on: false, leftOut: false, waiting: [expect.objectContaining({ key: 'invoices' })] });

      // The app's next version, applied while the add-on is switched off for it.
      await h.stageApp({ ...crm(), version: '0.2.1' });
      const updated = await h.inject({ method: 'POST', url: '/apps/crm/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await h.tableNames()).toEqual(expect.arrayContaining(['crm_quotes', 'crm_quote_lines']));
      const stored = (await manifestsRepo(h.meta, CRYPTO).findByKey('crm'))!;
      expect(stored.row.version).toBe('0.2.1');
      const document = stored.document as { requiredSchema: { tables: { ref: string }[] }; pages: { ref: string }[]; roles: { key: string }[] };
      expect(document.requiredSchema.tables.map((table) => table.ref)).toEqual(['deals', 'notes', 'quotes', 'quote_lines']);
      expect(document.pages.map((one) => one.ref)).toEqual(['crm-deals', 'crm-quotes']);
      expect(document.roles.map((role) => role.key)).toEqual(['rep', 'quoter']);
      expect(readAppModules(stored.row.modules)?.leftOut).toBeUndefined();
      expect((await appTablesRepo(h.meta).forInstall(h.connectionId, 'crm')).filter((record) => record.state === 'created').map((record) => record.ref).sort()).toEqual(['deals', 'notes', 'quote_lines', 'quotes']);
      expect((await h.rows('select name from crm_deals')).map((row) => row['name'])).toEqual(['Atrium']);
    });

    it('is made at once when the add-on is ticked with the install', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      const planned = await h.plan(crm());
      expect(planned.statusCode, planned.body).toBe(200);
      // With nothing said, the plan is of the ticks the check step shows: the add-on is ticked, so the part is in.
      expect(planned.json().plan.modules[1]).toMatchObject({ id: 'quotes', leftOut: false });
      const installed = await h.install('crm', '0.2.0', { planChecksum: planned.json().plan.checksum, addOns: [{ key: 'invoices', version: '1.1.0' }] });
      expect(installed.statusCode, installed.body).toBe(200);
      expect(await h.tableNames()).toEqual(expect.arrayContaining(['crm_deals', 'crm_notes', 'crm_quotes', 'crm_quote_lines']));
      expect((await storedModules(h))?.leftOut).toBeUndefined();
    });

    it('refuses a tick for a part the app does not have, or one that is always on', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      const planned = await h.plan(crm());
      for (const part of ['selling', 'vans']) {
        const refused = await h.install('crm', '0.2.0', { planChecksum: planned.json().plan.checksum, addOns: [{ key: 'invoices', version: '1.1.0' }], modules: { [part]: false } });
        expect(refused.statusCode, refused.body).toBe(422);
        expect(refused.json().error.details.reason).toBe('NO_SUCH_PART');
      }
    });
  });
}

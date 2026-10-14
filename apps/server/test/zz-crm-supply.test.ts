/**
 * Plan 67, P16: SUPPLY ON THE INVENTORY ADD-ON, against a real install of the
 * released stage 1 with Invoices and Inventory as they are built, on SQLite,
 * Postgres and MySQL.
 *
 *  1. The three roles Supply is for (CRM admin, operations manager, Read-only)
 *     are given six of Inventory's tables, READ ONLY, each held to a few
 *     columns (nothing of what goods cost); no other role of the app is given
 *     any of Inventory's tables.
 *  2. A deal's need of a stock line carries the deal's state (a copy the
 *     server keeps), so "what open deals ask for" is a figure the server can
 *     hold to open deals for every reader, the operations manager included,
 *     who reads no deal. The rep and the operations manager may no longer
 *     write that copy.
 *  3. Inventory switched off for the app: the grants are taken back, and
 *     Supply is off (waiting); switched on again, both come back.
 *  4. Installed without Inventory: Supply is off and waits for the add-on
 *     (its own table is made all the same: it is built on no shape of the
 *     add-on's), and the grants are written nowhere.
 *
 * What these roles are then ANSWERED by the data routes, the figures and the
 * live stream (and the refusals of a rep and the sales manager) is shown on
 * the browser stand, which is this same server with its routes: `e2e/supply.e2e.ts`.
 *
 * To run: `ADD_ONS_REPO=… npm run proofs -- supply`.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { builtAddOn, writing, type Installed } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const inventory = builtAddOn('inventory');
const invoices = builtAddOn('invoices');
const n = (value: unknown): number => Number(value);

interface Stage {
  manifest: Record<string, unknown> & { version: string; roles: { key: string; limits?: Record<string, { writable?: string[] }> }[] };
  files: Record<string, string | Buffer>;
}

/** A stage's package as the harness takes it: text files only, each picture's bytes stood in for. */
function packed(stage: Stage): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(stage.files)) {
    if (path === 'manifest.json') continue;
    files[path] = typeof content === 'string' ? content : 'png';
  }
  const sample = JSON.parse(files['seeds/meridian.json']!) as { assets?: Record<string, { sha256: string }> };
  for (const asset of Object.values(sample.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
  files['seeds/meridian.json'] = JSON.stringify(sample);
  return files;
}

/** What Supply's three roles read of each of Inventory's tables, and nothing more. */
const READ: Record<string, string[]> = {
  inventory_items: ['id', 'name', 'sku', 'note', 'unit', 'active', 'on_hand'],
  inventory_suppliers: ['id', 'name', 'lead_days', 'note', 'active'],
  inventory_item_suppliers: ['id', 'item_id', 'supplier_id', 'rank', 'supplier_name'],
  inventory_stock_points: ['id', 'item_id', 'place_id', 'on_hand', 'available', 'on_order', 'reorder_level', 'low', 'item_active'],
  inventory_purchase_orders: ['id', 'number', 'supplier_id', 'supplier_name', 'status', 'sent_on', 'expected_on', 'lead_days', 'received_at'],
  inventory_po_lines: ['id', 'po_id', 'item_id', 'item_name', 'qty', 'open_qty', 'order_status'],
};
const SUPPLY_ROLES = ['admin', 'ops-manager', 'read-only'];
const OTHER_ROLES = ['sales-manager', 'rep', 'account-manager', 'marketer', 'front-desk'];

describe.skipIf(inventory !== null && invoices !== null)('Supply on Inventory', () => {
  it('needs the add-ons built: set ADMINIUM_ADD_ONS_REPO', () => {
    throw new Error('ADMINIUM_ADD_ONS_REPO names no checkout with Invoices and Inventory built');
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable || inventory === null || invoices === null)(`Supply on the Inventory add-on, on ${dialect}`, () => {
    let h: Harness;
    let one: Stage;
    /** What a role of the app holds of Inventory's tables, by table: its actions and their limits. */
    const held = async (role: string): Promise<Record<string, Record<string, unknown>>> => {
      const found = await rolesRepo(h.meta).findBySlug(`crm-${role}`);
      expect(found, role).not.toBeNull();
      const out: Record<string, Record<string, unknown>> = {};
      for (const row of await permissionsRepo(h.meta).listForRole(found!.id)) {
        if (row.resourceKind !== 'table') continue;
        const table = row.resourceRef.slice(row.resourceRef.indexOf('/') + 1).split('.').pop()!;
        if (!table.startsWith('inventory_')) continue;
        out[table] = Object.fromEntries(Object.entries(row.actions as Record<string, unknown>).filter(([, value]) => value !== false));
      }
      return out;
    };
    const supplyOn = async (): Promise<boolean> => ((await h.inject({ method: 'GET', url: '/apps/crm/parts' })).json() as { parts: { id: string; on: boolean }[] }).parts.find((part) => part.id === 'supply')!.on;

    beforeAll(async () => {
      const script = (await import(pathToFileURL(`${APP}/scripts/stage-manifest.mjs`).href)) as { stageFiles: (stage: number) => Stage };
      one = script.stageFiles(1);
      h = await addOnHarness(dialect, {});
      await h.stageAddOn(invoices!.manifest, { bundled: true, files: invoices!.files });
      await h.stageAddOn(inventory!.manifest, { bundled: true, files: inventory!.files });
      await h.stageApp(one.manifest, packed(one));
      const installed = await h.install('crm', one.manifest.version, { addOns: [{ key: 'invoices', version: invoices!.version }, { key: 'inventory', version: inventory!.version }], modules: { quotes: true, inbox: true, supply: true } });
      expect(installed.statusCode, installed.body).toBe(200);
      // The sample, Inventory's part of it made by Inventory's own saves.
      const inv = (ref: string) => `inventory_${ref}`;
      const as: Installed = { h, addOn: inventory!, reply: installed.json() as Record<string, unknown>, real: inv, rowsOf: (ref, where) => h.rows(`select * from ${inv(ref)}${where === undefined ? '' : ` where ${where}`}`), hosts: [] };
      const w = await writing(as);
      await createSampleDataService({ ...h.sampleData, writes: () => w.writes }).add((await findSampleApp(h.meta, 'crm'))!, { locale: 'en-US', userId: h.owner.id, userLabel: 'owner@test' });
    }, 600_000);
    afterAll(async () => {
      await h?.close();
    });

    it('gives the three roles Supply is for six of Inventory\'s tables, read only and a few columns each, and nobody else any', async () => {
      const expected = Object.fromEntries(Object.entries(READ).map(([table, readable]) => [table, { read: true, readLimit: { readable } }]));
      for (const role of SUPPLY_ROLES) expect(await held(role), role).toEqual(expected);
      for (const role of OTHER_ROLES) expect(await held(role), role).toEqual({});
      // Of what a line costs, nothing: its average cost and its value are left out of every grant.
      expect(Object.values(READ).flat()).not.toContain('cost_avg');
      expect(Object.values(READ).flat()).not.toContain('price');
      expect(await supplyOn()).toBe(true);
    });

    it('keeps a need\'s deal state with the deal, and keeps it out of the rep\'s and the operations manager\'s writes', async () => {
      const needs = await h.rows('select d.deal_state as s, x.state as t from crm_deal_stock_needs d join crm_deals x on x.id = d.deal_id');
      expect(needs).toHaveLength(16);
      expect(needs.every((row) => row['s'] === row['t'] && row['s'] === 'open')).toBe(true);
      // The ledger's "short today", now held to open deals by the server's own column.
      const short = await h.rows(
        "select i.name, sum(d.qty) as need, max(i.on_hand) as have from crm_deal_stock_needs d join inventory_items i on i.id = d.item where d.qty is not null and d.deal_state = 'open' group by i.name having sum(d.qty) > max(i.on_hand) order by i.name",
      );
      expect(short.map((row) => `${String(row['name'])} ${String(n(row['need']))}/${String(n(row['have']))}`)).toEqual(['Acoustic booths, single 10/4', 'Acoustic rooms, four-person 2/0', 'Task seating, mesh back 68/60']);
      for (const role of ['rep', 'ops-manager']) expect(one.manifest.roles.find((r) => r.key === role)!.limits!['deal_stock_needs']!.writable, role).toEqual(['deal_id', 'item', 'qty']);
    });

    it('takes the grants back while Inventory is switched off for the app, with Supply off; gives both back when it is on', async () => {
      const off = await h.inject({ method: 'PATCH', url: '/add-ons/inventory', payload: { attachedTo: 'crm', enabled: false } });
      expect(off.statusCode, off.body).toBe(200);
      for (const role of SUPPLY_ROLES) expect(await held(role), role).toEqual({});
      expect(await supplyOn()).toBe(false);
      const parts = (await h.inject({ method: 'GET', url: '/apps/crm/parts' })).json() as { parts: { id: string; waiting: { key: string }[] }[] };
      expect(parts.parts.find((part) => part.id === 'supply')!.waiting.map((one) => one.key)).toEqual(['inventory']);
      const on = await h.inject({ method: 'PATCH', url: '/add-ons/inventory', payload: { attachedTo: 'crm', enabled: true } });
      expect(on.statusCode, on.body).toBe(200);
      for (const role of SUPPLY_ROLES) expect(Object.keys(await held(role)).sort(), role).toEqual(Object.keys(READ).sort());
      expect(await supplyOn()).toBe(true);
    });
  });

  describe.skipIf(!reachable || invoices === null)(`Supply waiting for Inventory, installed without it, on ${dialect}`, () => {
    let h: Harness;
    afterAll(async () => {
      await h?.close();
    });

    it('keeps Supply off and waiting for the add-on, with no grant on Inventory; its own table is made, its link to a stock line inert', async () => {
      const script = (await import(pathToFileURL(`${APP}/scripts/stage-manifest.mjs`).href)) as { stageFiles: (stage: number) => Stage };
      const one = script.stageFiles(1);
      h = await addOnHarness(dialect, {});
      await h.stageAddOn(invoices!.manifest, { bundled: true, files: invoices!.files });
      await h.stageApp(one.manifest, packed(one));
      const installed = await h.install('crm', one.manifest.version, { addOns: [{ key: 'invoices', version: invoices!.version }], modules: { quotes: true, inbox: true, supply: true } });
      expect(installed.statusCode, installed.body).toBe(200);
      // The part is no shape of the add-on's: its one table is made (a need's stock line is a plain number, no foreign key).
      expect(await h.tableNames()).toContain('crm_deal_stock_needs');
      expect(await h.tableNames()).not.toContain('inventory_items');
      const parts = (await h.inject({ method: 'GET', url: '/apps/crm/parts' })).json() as { parts: { id: string; on: boolean; waiting: { key: string }[] }[] };
      const supply = parts.parts.find((part) => part.id === 'supply')!;
      expect([supply.on, supply.waiting.map((one) => one.key)]).toEqual([false, ['inventory']]);
      for (const role of SUPPLY_ROLES) {
        const found = await rolesRepo(h.meta).findBySlug(`crm-${role}`);
        const rows = found === null ? [] : await permissionsRepo(h.meta).listForRole(found.id);
        expect(rows.filter((row) => row.resourceRef.includes('inventory_')), role).toEqual([]);
      }
    }, 600_000);
  });
}

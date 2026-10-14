/**
 * Plan 67, F23: THE APP BY STAGE, against a real install.
 *
 * The first release ships six parts and nothing of the other four (ruling R5):
 * no table, no page, no rule, no role. Here, with the Invoices and Inventory
 * add-ons as they are built, on SQLite, Postgres and MySQL:
 *
 *  1. a stage 1 install offers the six parts and no more, makes no table of a
 *     later part, offers no Field crew, runs no "a won deal makes a job", and
 *     its switch route has no "jobs" to switch;
 *  2. its sample goes in whole, with the ledger's selling figures;
 *  3. the stage 2 file UPDATES that install while it holds the sample and rows
 *     typed since: nothing is lost, the three new parts arrive switched off,
 *     the follow-up's link to a job is added, and once Jobs on site is
 *     switched on the Field crew is offered.
 *
 * The stage files are cut by the app's own `scripts/stage-manifest.mjs`, the
 * script the release and the browser stand use.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { builtAddOn, writing, type Installed } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const inventory = builtAddOn('inventory');
const invoices = builtAddOn('invoices');
const n = (value: unknown): number => Number(value);

interface Doc {
  version: string;
  modules: { id: string }[];
  requiredSchema: { tables: { ref: string }[] };
}
interface Stage {
  manifest: Doc & Record<string, unknown>;
  files: Record<string, string | Buffer>;
}
type Stages = (stage: number) => Stage;

/** A stage's package as the harness takes it: text files only, each picture's bytes stood in for (its place in the package is what counts). */
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

describe.skipIf(inventory !== null && invoices !== null)('the CRM by stage', () => {
  it('needs the add-ons built: set ADMINIUM_ADD_ONS_REPO', () => {
    throw new Error('ADMINIUM_ADD_ONS_REPO names no checkout with Invoices and Inventory built');
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable || inventory === null || invoices === null)(`the CRM by stage, on ${dialect}`, () => {
    let h: Harness;
    let stage: Stages;
    let reply: Record<string, unknown> = {};
    const addOns = () => [{ key: 'invoices', version: invoices!.version }, { key: 'inventory', version: inventory!.version }];
    const count = async (table: string, where = '1 = 1') => n((await h.rows(`select count(*) as c from ${table} where ${where}`))[0]!['c']);
    // The app's own tables; `crm_sample_data` is Adminium's note of which rows are the sample's.
    const crmTables = async () => (await h.tableNames()).filter((name) => name.startsWith('crm_') && name !== 'crm_sample_data').sort();
    const roles = async () => (await rolesRepo(h.meta).list()).filter((role) => role.appKey === 'crm').map((role) => role.slug).sort();
    const parts = async () => ((await h.inject({ method: 'GET', url: '/apps/crm/parts' })).json() as { parts: { id: string; on: boolean }[] }).parts;

    beforeAll(async () => {
      const script = (await import(pathToFileURL(`${APP}/scripts/stage-manifest.mjs`).href)) as { stageFiles: (stage: number) => Stage };
      stage = (number) => script.stageFiles(number);
      h = await addOnHarness(dialect, {});
      await h.stageAddOn(invoices!.manifest, { bundled: true, files: invoices!.files });
      await h.stageAddOn(inventory!.manifest, { bundled: true, files: inventory!.files });
    }, 600_000);
    afterAll(async () => {
      await h?.close();
    });

    it('stage 1 installs as six parts: no table, role or rule of a later part, and no such part to switch on', async () => {
      const one = stage(1);
      await h.stageApp(one.manifest, packed(one));
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'crm', version: one.manifest.version, connectionId: h.connectionId, addOns: addOns().map((addOn) => addOn.key) } });
      expect(planned.statusCode, planned.body).toBe(200);
      const plan = (planned.json() as { plan: { problems: unknown[]; checksum: string; modules: { id: string; roles: string[] }[] } }).plan;
      expect(plan.problems).toEqual([]);
      // What the owner is offered to tick: the six, and no role of the field crew under any of them.
      expect(plan.modules.map((part) => part.id)).toEqual(['selling', 'quotes', 'accounts', 'team', 'inbox', 'supply']);
      expect(plan.modules.flatMap((part) => part.roles)).not.toContain('Field crew');

      const installed = await h.install('crm', one.manifest.version, { planChecksum: plan.checksum, addOns: addOns(), modules: { quotes: true, inbox: true, supply: true } });
      expect(installed.statusCode, installed.body).toBe(200);
      expect((installed.json() as { rules?: { skipped: unknown[] } }).rules?.skipped ?? []).toEqual([]);
      reply = installed.json() as Record<string, unknown>;

      const made = await crmTables();
      expect(made).toEqual(one.manifest.requiredSchema.tables.map((table) => `crm_${table.ref}`).sort());
      expect(made.length).toBe(47);
      for (const later of ['crm_jobs', 'crm_job_visits', 'crm_showroom_bookings', 'crm_feedback', 'crm_vehicles', 'crm_time_sheets']) expect(made, later).not.toContain(later);
      // A follow-up has no link to a job: there is no job to link to.
      await expect(h.rows('select job_id from crm_follow_ups')).rejects.toThrow();
      expect(await roles()).toEqual(['crm-account-manager', 'crm-admin', 'crm-front-desk', 'crm-marketer', 'crm-ops-manager', 'crm-read-only', 'crm-rep', 'crm-sales-manager']);
      expect((await parts()).map((part) => [part.id, part.on])).toEqual([['selling', true], ['quotes', true], ['accounts', true], ['team', true], ['inbox', true], ['supply', true]]);
      // A part this file does not hold cannot be switched on: the server has no such part.
      for (const later of ['jobs', 'showroom', 'aftercare', 'fleet']) {
        const tried = await h.inject({ method: 'PUT', url: `/apps/crm/parts/${later}`, payload: { on: true } });
        expect(tried.statusCode, `${later}: ${tried.body}`).toBe(404);
      }
    }, 600_000);

    it('its sample goes in whole: the ledger\'s selling figures, eleven people, and stock from Inventory', async () => {
      const one = stage(1);
      // Inventory's part of the sample is made by saves of Inventory's own (an opening receipt, four orders).
      const inv = (ref: string) => `inventory_${ref}`;
      const as: Installed = { h, addOn: inventory!, reply, real: inv, rowsOf: (ref, where) => h.rows(`select * from ${inv(ref)}${where === undefined ? '' : ` where ${where}`}`), hosts: [] };
      const w = await writing(as);
      const service = createSampleDataService({ ...h.sampleData, writes: () => w.writes });
      const app = (await findSampleApp(h.meta, 'crm'))!;
      await service.add(app, { locale: 'en-US', userId: h.owner.id, userLabel: 'owner@test' });
      const sample = JSON.parse(String(one.files['seeds/meridian.json'])) as { tables: { ref: string; rows: unknown[] }[] };
      const short: string[] = [];
      for (const table of sample.tables) {
        const got = await count(`crm_${table.ref}`);
        if (got !== table.rows.length) short.push(`${table.ref}: ${String(got)} of ${String(table.rows.length)}`);
      }
      expect(short).toEqual([]);
      expect((await usersRepo(h.meta).countByStatus()).sample).toBe(11);
      const open = (await h.rows("select count(*) as c, sum(amount) as a, sum(weighted_value) as w from crm_deals where state = 'open'"))[0]!;
      expect([n(open['c']), n(open['a']), n(open['w'])]).toEqual([14, 286300, 156562.5]);
      expect([await count('crm_deals', "state = 'won'"), await count('crm_deals', "state = 'lost'")]).toEqual([8, 18]);
      expect(await count('crm_follow_ups', "kind = 'aftercare'")).toBe(0);
      expect(await count('inventory_items')).toBe(10);
    }, 600_000);

    it('stage 2 updates that install with its data in place: three parts arrive switched off, and the crew with Jobs on site', async () => {
      // Rows typed since the install, beside the sample.
      await h.rows("insert into crm_lost_reasons (label, position) values ('Typed before the update', 9)");
      const before = { deals: await count('crm_deals'), followUps: await count('crm_follow_ups'), companies: await count('crm_companies'), quotes: await count('crm_quotes'), items: await count('inventory_items') };

      const two = stage(2);
      const next = { ...two.manifest, version: two.manifest.version.replace(/\d+$/, (patch) => String(Number(patch) + 1)) };
      await h.stageApp(next, packed(two));
      const updated = await h.inject({ method: 'POST', url: '/apps/crm/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);

      const made = await crmTables();
      const want = two.manifest.requiredSchema.tables.map((table) => `crm_${table.ref}`).sort();
      expect({ extra: made.filter((name) => !want.includes(name)), missing: want.filter((name) => !made.includes(name)) }).toEqual({ extra: [], missing: [] });
      for (const now of ['crm_jobs', 'crm_job_visits', 'crm_sign_offs', 'crm_showroom_bookings', 'crm_feedback']) expect(made, now).toContain(now);
      // Vehicles and crew is stage 3's: still not here.
      expect(made).not.toContain('crm_vehicles');
      // Nothing that was there was lost or changed.
      expect({ deals: await count('crm_deals'), followUps: await count('crm_follow_ups'), companies: await count('crm_companies'), quotes: await count('crm_quotes'), items: await count('inventory_items') }).toEqual(before);
      expect(await count('crm_lost_reasons', "label = 'Typed before the update'")).toBe(1);
      const open = (await h.rows("select count(*) as c, sum(amount) as a, sum(weighted_value) as w from crm_deals where state = 'open'"))[0]!;
      expect([n(open['c']), n(open['a']), n(open['w'])]).toEqual([14, 286300, 156562.5]);
      // The follow-up's link to a job is there now, empty on every row that was there before.
      expect(await count('crm_follow_ups', 'job_id is not null')).toBe(0);
      expect(await count('crm_jobs')).toBe(0);

      // The three new parts are there to switch, and off: nobody ticked them.
      const now = await parts();
      expect(now.map((part) => part.id)).toEqual(['selling', 'quotes', 'accounts', 'team', 'inbox', 'showroom', 'jobs', 'aftercare', 'supply']);
      expect(now.filter((part) => ['showroom', 'jobs', 'aftercare'].includes(part.id)).map((part) => part.on)).toEqual([false, false, false]);
      expect(now.filter((part) => !['showroom', 'jobs', 'aftercare'].includes(part.id)).every((part) => part.on)).toBe(true);
      const on = await h.inject({ method: 'PUT', url: '/apps/crm/parts/jobs', payload: { on: true } });
      expect(on.statusCode, on.body).toBe(200);
      expect((await parts()).find((part) => part.id === 'jobs')!.on).toBe(true);
      expect(await roles()).toContain('crm-crew');
      // Stage 3's part is still not one this install has.
      expect((await h.inject({ method: 'PUT', url: '/apps/crm/parts/fleet', payload: { on: true } })).statusCode).toBe(404);
    }, 600_000);
  });
}

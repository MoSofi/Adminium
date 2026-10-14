import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

// The app this copy of the proofs came from (`npm run proofs` names it), not a fixed lane.
const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
// The sample the app ships, from the app's own repo.
const SEEDS = process.env.CRM_SEEDS ?? `${APP}/whole/seeds`;
const bundle = () => JSON.parse(readFileSync(`${SEEDS}/meridian.json`, 'utf8')) as { tables: { ref: string; rows: unknown[] }[] };

const manifest = () => {
  const m = JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
  return m;
};

/** The install as an owner who ticks Invoices & Receipts and every part: quotes are a part that waits for the add-on. */
const WITH_EVERY_PART = { install: { addOns: [{ key: 'invoices', version: '1.1.0' }], modules: { quotes: true, inbox: true, showroom: true, jobs: true, aftercare: true, supply: true, fleet: true } } };

async function invoices(meta: MetaDb): Promise<void> {
  const document = JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  document['version'] = '1.1.0';
  const addOn = document['addOn'] as { attaches?: { app: string }[] };
  addOn.attaches = [...(addOn.attaches ?? []).filter((one) => one.app !== 'crm'), { app: 'crm' }];
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'invoices', version: '1.1.0', kind: 'add-on', source: 'file', document: document as never });
}

const memoryFiles = { write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }) } as unknown as FileStore;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's sample on ${dialect}`, () => {
    let h: InvoicingHarness;
    let service: ReturnType<typeof createSampleDataService>;
    beforeAll(async () => {
      // The harness packs text only: the picture's bytes do not matter to this proof, its place in the package does.
      const packed = JSON.parse(readFileSync(`${SEEDS}/meridian.json`, 'utf8')) as { assets?: Record<string, { file: string; sha256: string }> };
      for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
      const files: Record<string, string> = { 'seeds/meridian.json': JSON.stringify(packed), 'seeds/assets/signature.png': 'png' };
      h = await installInvoicing(dialect, manifest(), invoices, files, WITH_EVERY_PART);
      service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
    }, 240_000);
    afterAll(async () => { await h?.close(); });
    const n = async (sql: string) => Number((await h.rows(sql))[0]!['n']);

    it('adds every row of the bundle and the sixteen people', async () => {
      const app = (await findSampleApp(h.meta, 'crm'))!;
      await service.add(app, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
      const short: string[] = [];
      for (const table of bundle().tables) {
        const got = await n(`SELECT COUNT(*) AS n FROM ${h.real(table.ref)}`);
        if (got !== table.rows.length) short.push(`${table.ref}: ${String(got)} of ${String(table.rows.length)}`);
      }
      expect(short).toEqual([]);
      expect((await usersRepo(h.meta).countByStatus()).sample).toBe(16);
    }, 240_000);

    it('holds the ledger, from the columns the engine keeps', async () => {
      const deals = h.real('deals');
      const two = async (where: string) => { const r = (await h.rows(`SELECT COUNT(*) AS n, SUM(amount) AS a, SUM(weighted_value) AS w FROM ${deals} WHERE ${where}`))[0]!; return [Number(r['n']), Number(r['a']), Number(r['w'])]; };
      expect(await two(`state = 'open'`)).toEqual([14, 286300, 156562.5]);
      const dana = (await usersRepo(h.meta).list({ status: 'sample', limit: 50 })).find((user) => user.name === 'Dana Whitlock')!;
      expect(await two(`state = 'open' AND owner_id = '${dana.id}'`)).toEqual([6, 143400, 95740]);
      expect((await two(`state = 'won'`)).slice(0, 2)).toEqual([8, 130000]);
      expect((await two(`state = 'lost'`)).slice(0, 2)).toEqual([18, 294400]);
      // Closed (ledger 8): every closed deal says the day it closed and the days it was open; won deals took 54 days on average, the longest 77.
      expect(await n(`SELECT COUNT(*) AS n FROM ${deals} WHERE state <> 'open' AND (closed_on IS NULL OR cycle_days IS NULL)`)).toBe(0);
      expect(await n(`SELECT COUNT(*) AS n FROM ${deals} WHERE state = 'open' AND (closed_on IS NOT NULL OR cycle_days IS NOT NULL)`)).toBe(0);
      const cycle = (await h.rows(`SELECT SUM(cycle_days) AS s, MAX(cycle_days) AS m, COUNT(*) AS n FROM ${deals} WHERE state = 'won'`))[0]!;
      expect([Math.round(Number(cycle['s']) / Number(cycle['n'])), Number(cycle['m'])]).toEqual([54, 77]);
      // Targets (ledger 14): what counts toward a target is ONE column the engine keeps, so the server can add it up for whoever reads it:
      // a won deal's amount, an open deal's weighted value, nothing of a lost one. Open and won together: 156,562.50 + 130,000.
      expect(await n(`SELECT COUNT(*) AS n FROM ${deals} WHERE target_value IS NULL OR (state = 'lost' AND target_value <> 0) OR (state = 'won' AND target_value <> amount) OR (state = 'open' AND target_value <> weighted_value)`)).toBe(0);
      expect(Number((await h.rows(`SELECT SUM(target_value) AS s FROM ${deals}`))[0]!['s'])).toBe(286562.5);
      expect(Number((await h.rows(`SELECT SUM(target_value) AS s FROM ${deals} WHERE owner_id = '${dana.id}' AND state = 'open'`))[0]!['s'])).toBe(95740);
      // S1: the five quoted deals stand at their newest SENT version.
      const quoted = await h.rows(`SELECT quoted_amount FROM ${deals} WHERE quoted_amount IS NOT NULL`);
      expect(quoted.map((r) => Number(r['quoted_amount'])).sort((a, b) => a - b)).toEqual([21500, 27500, 31000, 38000, 52800]);
      // Every quote line took its list price from the price list as it went in, so no version is short of one.
      expect(await n(`SELECT COUNT(*) AS n FROM ${h.real('quote_lines')} WHERE list_rate IS NULL OR price_id IS NULL`)).toBe(0);
      expect(await n(`SELECT COALESCE(SUM(unlisted_lines), 0) AS n FROM ${h.real('quotes')}`)).toBe(0);
      // Jobs: seven signed off; the snags that still stop a sign-off are counted on their jobs.
      expect(await n(`SELECT COUNT(*) AS n FROM ${h.real('jobs')} WHERE state = 'signed-off'`)).toBe(7);
      // The sample's jobs carry the ledger's numbers in the app's own series (J-01 to J-08), in the order the deals were won.
      const jobs = await h.rows(`SELECT j.code, j.code_seq, d.closed_at FROM ${h.real('jobs')} j JOIN ${deals} d ON d.id = j.deal_id ORDER BY j.code`);
      expect(jobs.map((r) => r['code'])).toEqual(['J-01', 'J-02', 'J-03', 'J-04', 'J-05', 'J-06', 'J-07', 'J-08']);
      expect(jobs.map((r) => Number(r['code_seq']))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      const closed = jobs.map((r) => new Date(String(r['closed_at'])).getTime());
      expect(closed).toEqual([...closed].sort((x, y) => x - y));
      const stops = await n(`SELECT COUNT(*) AS n FROM ${h.real('snags')} WHERE stops_sign_off = ${dialect === 'postgres' ? 'true' : '1'} AND state <> 'put-right'`);
      expect(await n(`SELECT COALESCE(SUM(blocking_snags), 0) AS n FROM ${h.real('jobs')}`)).toBe(stops);
      // A delivery-note line found its job, and a snag its crew, though the bundle wrote neither.
      expect(await n(`SELECT COUNT(*) AS n FROM ${h.real('delivery_note_lines')} WHERE job_id IS NULL`)).toBe(0);
      expect(await n(`SELECT COUNT(*) AS n FROM ${h.real('snags')} WHERE due_on IS NULL OR due_days IS NULL`)).toBe(0);
    });

    it.runIf(process.env.CRM_DIAG === '1')('diagnosis: columns the bundle leaves out and the install leaves empty', async () => {
      const m = manifest() as { requiredSchema: { tables: { ref: string; columns: { ref: string; rules?: Record<string, unknown>; nullable?: boolean }[] }[] } };
      const out: string[] = [];
      for (const table of bundle().tables as { ref: string; rows: Record<string, unknown>[] }[]) {
        const declared = m.requiredSchema.tables.find((t) => t.ref === table.ref)!;
        const written = new Set(table.rows.flatMap((row) => Object.keys(row)));
        for (const column of declared.columns) {
          if (written.has(column.ref) || column.rules === undefined) continue;
          const kinds = Object.keys(column.rules).filter((k) => ['rollup', 'copy', 'formula', 'stamp', 'sequence', 'default'].includes(k));
          if (kinds.length === 0) continue;
          const empty = await n(`SELECT COUNT(*) AS n FROM ${h.real(table.ref)} WHERE ${column.ref === 'to' || column.ref === 'from' ? `"${column.ref}"` : column.ref} IS NULL`);
          const zero = await n(`SELECT COUNT(*) AS n FROM ${h.real(table.ref)} WHERE CAST(${column.ref === 'to' || column.ref === 'from' ? `"${column.ref}"` : column.ref} AS CHAR) IN ('0', '0.0', '0.00', '')`).catch(() => -1);
          if (empty > 0 || zero === table.rows.length) out.push(`${table.ref}.${column.ref} [${kinds.join(',')}] empty ${String(empty)} zero ${String(zero)} of ${String(table.rows.length)}`);
        }
      }
      console.log(out.join('\n'));
    }, 240_000);

    it('the first job anybody makes beside the sample is J-09', async () => {
      // The sample's jobs hold J-01 to J-08 in the app's own series (once they were typed "S-01": a typed "J-01" met this very job).
      const w = await writerFor(h);
      const free = (await h.rows(`SELECT id FROM ${h.real('deals')} WHERE id NOT IN (SELECT deal_id FROM ${h.real('jobs')}) ORDER BY id`))[0]!;
      const job = await w.create('jobs', { deal_id: free['id'], site_name: 'A new site' });
      const made = (await h.rows(`SELECT code, code_seq FROM ${h.real('jobs')} WHERE id = ${String(job['id'])}`))[0]!;
      expect([made['code'], Number(made['code_seq'])]).toEqual(['J-09', 9]);
      // Taken out again, so that the count of what the sample leaves behind is the sample's own.
      await h.rows(`DELETE FROM ${h.real('jobs')} WHERE id = ${String(job['id'])}`);
    });

    it('takes it all away again', async () => {
      const app = (await findSampleApp(h.meta, 'crm'))!;
      // The settings row was the install's before the sample came (the app's one starting row): the sample filled in
      // what it left empty, Meridian's depot, and wrote over nothing. Still one row.
      const depot = async () => (await h.rows(`SELECT depot_name, depot_town, snag_days FROM ${h.real('settings')}`)).map((row) => [row['depot_name'], row['depot_town'], Number(row['snag_days'])]);
      expect(await depot()).toEqual([['Meridian depot', 'Leeds', 5]]);
      await service.remove(app, { keepChanged: true, userId: null, userLabel: 'test' });
      // The depot leaves with the sample; the row and its defaults are the owner's and stay.
      expect(await depot()).toEqual([[null, null, 5]]);
      const left: string[] = [];
      for (const table of bundle().tables) {
        const got = await n(`SELECT COUNT(*) AS n FROM ${h.real(table.ref)}`);
        if (got !== 0) left.push(`${table.ref}: ${String(got)}`);
      }
      // Everything of the sample is gone; the install's settings row is the owner's and stays.
      expect(left).toEqual(['settings: 1']);
      expect((await usersRepo(h.meta).countByStatus()).sample).toBe(0);
    }, 240_000);
  });
}

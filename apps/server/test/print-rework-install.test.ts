// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PRINT SHOP, REWORKED, INSTALLED WITH THE BUILT CUSTOMISER IT REQUIRES.
 *
 * The app is read from a checkout of the Print Shop repository
 * (`ADMINIUM_PRINT_REPO`): its manifest and its sample files as they ship.
 * The Customiser is read from a checkout of the add-ons repository, built
 * (`ADMINIUM_ADD_ONS_REPO`), vouched for as a sandbox vouches for it
 * (`ADMINIUM_ADD_ON_DEV_TRUST=customiser`). The clock stands where the comps
 * pin Marlow Press: Wednesday 5 August 2026, 10:20. On each engine this run
 * reaches:
 *
 * - the app installs with the Customiser, its tables prefixed;
 * - its sample loads, the Customiser's rows for it among them, and the
 *   figures it stores are Adminium's: each order's delivery band on its
 *   weight, the tax at the settings' rate, its total (MP-4126 £92.95,
 *   MP-4113 £767.76, MP-4115 collected £27.80), each job's proof state;
 * - a job's ready-by comes from Adminium, in working days from Wednesday
 *   10:20 before the two o'clock cut-off: Mon 10 August standard, Thu 6
 *   express, Wed 12 with a printed proof by post; a change asked on its proof
 *   moves it to Tue 11, and the proof's approval counts it again from then;
 *   the works' own next order is MP-4127;
 * - a guest's order of a business card made in the Customiser, paying for the
 *   back it prints, is taken by the design check, and the order snapshots the
 *   design and locks its draft; the same card without the back paid for is
 *   refused.
 *
 * Without either checkout the suite is skipped, by name.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { WriteContext, WriteTarget } from '../src/crud/write-context.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { solveProof } from '../src/public-api/proof.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

const CUSTOMISER = 'customiser';
/**
 * The add-ons' release the app requires (`^1.0.16`) is the one that first
 * ships the Customiser. A checkout built before that release carries the
 * version before it: it is staged at the version the app asks for, as that
 * release will be.
 */
const RELEASE = '1.0.16';
const checkout = builtAddOn(CUSTOMISER);
const built = checkout === null ? null : { ...checkout, version: RELEASE, manifest: { ...checkout.manifest, version: RELEASE } };

/** The Print Shop checkout: its manifest and the sample files it ships. */
function printApp(): { manifest: Doc; files: Record<string, string> } | null {
  const root = process.env['ADMINIUM_PRINT_REPO'];
  if (root === undefined || root === '' || !existsSync(join(root, 'manifest.json'))) return null;
  const files: Record<string, string> = {};
  if (existsSync(join(root, 'seeds'))) for (const name of readdirSync(join(root, 'seeds'))) if (name.endsWith('.json')) files[`seeds/${name}`] = readFileSync(join(root, 'seeds', name), 'utf8');
  return { manifest: JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Doc, files };
}
const print = printApp();

/** Marlow Press's pinned clock: Wednesday 5 August 2026, 10:20 in Marlow (British Summer Time), before the two o'clock cut-off. */
const WEDNESDAY = new Date('2026-08-05T09:20:00Z');
const EMAIL = 'guest@example.com';
/**
 * The guest's order create, by the ref Adminium gives its entry: the second
 * entry on the app's orders that reads at the verified level (the first is a
 * signed-in customer's own orders).
 */
const CREATE = 'printing_orders_verified_2';
const OPTS = { locale: 'en-US', userId: null, userLabel: 'test' };
const COLLECT = { name: 'Harbour Bakery', email: EMAIL, delivery_method: 'collect' };
const DESK: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_rosa', label: 'Rosa' }, request: null };

describe.each(LEGS)('Print Shop, reworked, installed with the built Customiser — %s', (dialect, available) => {
  const runs = available && built !== null && print !== null;
  let h: Harness;
  let served: Served;
  let trusted: string | undefined;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.13.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  /** `values` and `state` are words SQL keeps for itself: each is named in the engine's quotes. */
  const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
  const one = async (statement: string) => (await h.rows(statement))[0]!;
  const id = async (statement: string) => Number((await one(statement))['id']);
  const dateOf = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
  const proof = async (purpose: 'upload' | 'write', address: string) => {
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/challenge?purpose=${purpose}`, remoteAddress: address, headers: served.headers() });
    const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return `${c.id}.${solveProof(c.salt, c.difficulty)}`;
  };
  /** A create behind the human check, through the shop's key, as a browser sends one. */
  const create = async (ref: string, payload: Doc) => {
    const address = fresh();
    const headers = served.headers(undefined, { 'x-adminium-proof': await proof('write', address) });
    return served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${ref}`, remoteAddress: address, headers, payload });
  };
  /** A quote: the same body, no human check, nothing kept. */
  const quote = (ref: string, payload: Doc) => served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${ref}/dry-run`, remoteAddress: fresh(), headers: served.headers(), payload });

  /** A staff save through the write service, as the works' own screens make one. */
  const target = async (table: string): Promise<WriteTarget> => {
    const view = await loadSnapshotView(h.meta, h.connectionId, { lists: true });
    const { db, dialect: engine } = await h.manager.data(h.connectionId);
    return { connectionId: h.connectionId, view, table: view.table(view.model.tables.find((candidate) => candidate.name === table)!.id), db, dialect: engine, timezone: 'Europe/London' };
  };
  const normal = (at: WriteTarget, values: Doc) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(at.table.columns.get(k)!, v)]));
  const staffCreate = async (table: string, values: Doc) => {
    const at = await target(table);
    return createWriteService(writeStores(h.meta)).create({ target: at, values: normal(at, values), context: DESK, announce: async () => {} });
  };
  const staffUpdate = async (table: string, key: number, values: Doc) => {
    const at = await target(table);
    return createWriteService(writeStores(h.meta)).update({ target: at, pk: { id: key }, values: normal(at, values), context: DESK, announce: async () => {} });
  };

  /** The sample's rows by what tells them apart. */
  const product = (code: string) => id(`SELECT id FROM printing_products WHERE code = '${code}'`);
  const option = (code: string, kind: string, choice: string) =>
    id(`SELECT o.id FROM printing_options o JOIN printing_products p ON p.id = o.product_id WHERE p.code = '${code}' AND o.kind = '${kind}' AND o.code = '${choice}'`);
  const packaging = (code: string) => id(`SELECT id FROM printing_packaging WHERE code = '${code}'`);
  /** A flyers job: 1,000 A5 on 170gsm silk, both sides. */
  const flyers = async (extra: Doc = {}): Promise<Doc> => ({
    values: {
      product_id: await product('flyers'),
      qty: 1000,
      material_option_id: await option('flyers', 'material', 'silk170'),
      size_option_id: await option('flyers', 'size', 'a5'),
      sides_option_id: await option('flyers', 'sides', 'double'),
      packaging_id: await packaging('bundled'),
      ...extra,
    },
  });
  /** Harbour Bakery's 500 business cards on 350gsm silk board, both sides, laminated both sides in matt, boxed. */
  const cards = async (extra: Doc = {}): Promise<Doc> => ({
    values: {
      product_id: await product('business-cards'),
      qty: 500,
      material_option_id: await option('business-cards', 'material', 'silk350'),
      size_option_id: await option('business-cards', 'size', 'bcard'),
      sides_option_id: await option('business-cards', 'sides', 'double'),
      lamination_option_id: await option('business-cards', 'lamination', 'lam-both'),
      look: 'matt',
      packaging_id: await packaging('boxed'),
      ...extra,
    },
  });
  const order = (jobs: Doc[], more: Doc = {}) => ({ values: { ...COLLECT, ...more }, children: { jobs } });
  /** A quote's jobs: each child row's figures. */
  const jobsOf = (res: { json: () => unknown }) => (res.json() as { children: { jobs: { data: Doc }[] } }).children.jobs.map((row) => row.data);

  /** A business card saved through the shop's key on Harbour, both sides filled in. */
  const saveCard = async () => {
    const ready = await id(`SELECT id FROM customiser_ready_designs WHERE app = 'printing' AND name = 'Harbour'`);
    const base = await id(`SELECT id FROM customiser_bases WHERE app = 'printing' AND name = 'Business cards'`);
    const values = {
      layout: 'left',
      palette: 'harbour',
      sides: 2,
      parts: {
        name: { text: 'Nell Fairweather' },
        title: { text: 'Head baker' },
        phone: { text: '01628 471 302' },
        email: { text: 'hello@harbourbakery.co.uk' },
        web: { text: 'harbourbakery.co.uk' },
        addr: { text: '12 Quay Street\nMarlow SL7 1BT' },
      },
    };
    const res = await create('customiser_designs', { values: { format: 1, ready_design_id: ready, base_id: base, values, email: EMAIL } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { id: unknown; code: string } };
    return { id: Number(body.data.id), code: body.data.code };
  };

  beforeAll(async () => {
    if (!runs) return;
    vi.useFakeTimers({ toFake: ['Date'], now: WEDNESDAY });
    trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = CUSTOMISER;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    // The works' clock and money: Marlow, in pounds.
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'GBP' }).where('id', '=', h.connectionId).execute();
    await h.stageAddOn(built!.manifest, { files: built!.files });
    await h.stageApp(print!.manifest, print!.files);
    const installed = await h.install('printing', String(print!.manifest['version']), { addOns: [{ key: CUSTOMISER, version: built!.version }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    const key = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    const added = await createSampleDataService(h.sampleData).add((await findSampleApp(h.meta, 'printing'))!, OPTS);
    expect(added.counts['orders']).toBe(15);
    served = await servePublic(h as never, key, { ADMINIUM_DATA_DIR: h.dataDir });
  }, 240_000);
  afterAll(async () => {
    if (!runs) return;
    await served?.close();
    await h?.close();
    vi.useRealTimers();
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
  });

  it.skipIf(!runs)('installs with the Customiser, every table prefixed', async () => {
    const names = await h.tableNames();
    for (const ref of ['settings', 'materials', 'sizes', 'finishes', 'breaks', 'packaging', 'delivery_bands', 'products', 'options', 'option_rules', 'orders', 'jobs', 'job_features', 'artwork', 'proofs', 'saved_quotes', 'quote_lines', 'sample_requests', 'closures', 'machines']) {
      expect(names).toContain(`printing_${ref}`);
    }
    expect(names).toContain('customiser_designs');
  });

  it.skipIf(!runs)("loads Marlow Press's sample, its stored totals worked out by Adminium", async () => {
    expect(Number((await one(`SELECT COUNT(*) AS n FROM printing_jobs`))['n'])).toBe(15);
    expect(Number((await one(`SELECT COUNT(*) AS n FROM customiser_designs WHERE app = 'printing'`))['n'])).toBe(1);
    const totals = async (number: string) => {
      const row = await one(`SELECT goods_total, delivery, tax, total FROM printing_orders WHERE number = '${number}'`);
      return [row['goods_total'], row['delivery'], row['tax'], row['total']].map(Number);
    };
    // 500 cards, 1.02 kg: the band up to 2 kg; tax 20 %.
    expect(await totals('MP-4126')).toEqual([70.96, 6.5, 15.49, 92.95]);
    // Six PVC banners, 9.48 kg: the band up to 10 kg.
    expect(await totals('MP-4113')).toEqual([630, 9.8, 127.96, 767.76]);
    // Collected at the works: no delivery.
    expect(await totals('MP-4115')).toEqual([23.17, 0, 4.63, 27.8]);
    // MP-4114 waits on its second proof after a change; MP-4126 was approved and is on the press.
    const jobs = await h.rows(`SELECT o.number, j.proof_state, j.changes, j.proof_ok FROM printing_jobs j JOIN printing_orders o ON o.id = j.order_id WHERE o.number IN ('MP-4114', 'MP-4126') ORDER BY o.number`);
    expect(jobs.map((row) => [row['number'], row['proof_state'], Number(row['changes']), Number(row['proof_ok'])])).toEqual([
      ['MP-4114', 'sent', 1, 0],
      ['MP-4126', 'approved', 0, 1],
    ]);
  });

  it.skipIf(!runs)('dates each job in working days from Wednesday 10:20: Mon 10 standard, Thu 6 express, Wed 12 with a printed proof', async () => {
    const res = await quote(CREATE, order([await flyers(), await flyers({ express: true }), await flyers({ proof_by_post: true })]));
    expect(res.statusCode, res.body).toBe(200);
    expect(jobsOf(res).map((row) => [Number(row['turnaround_days']), dateOf(row['ready_by'])])).toEqual([
      [3, '2026-08-10'],
      [1, '2026-08-06'],
      [5, '2026-08-12'],
    ]);
    expect(dateOf((res.json() as { data: Doc }).data['ready_by'])).toBe('2026-08-12');
  });

  it.skipIf(!runs)("numbers the works' own next order MP-4127, after the sample's MP-4126", async () => {
    const placed = await create(CREATE, order([await flyers()], { client_key: 'print-install-test-order-0001' }));
    expect(placed.statusCode, placed.body).toBe(201);
    expect((await one(`SELECT number FROM printing_orders WHERE number_seq IS NOT NULL ORDER BY id DESC`))['number']).toBe('MP-4127');
  });

  it.skipIf(!runs)('moves a job a working day for a change asked, to Tue 11, and counts it again from its approval', async () => {
    const job = await one(`SELECT j.id, j.order_id, j.ready_by FROM printing_jobs j JOIN printing_orders o ON o.id = j.order_id WHERE o.number = 'MP-4127'`);
    expect(dateOf(job['ready_by'])).toBe('2026-08-10');
    const first = await staffCreate('printing_proofs', { order_id: Number(job['order_id']), job_id: Number(job['id']), kind: 'email', note: 'Proof by email.' });
    await staffUpdate('printing_proofs', Number(first['id']), { state: 'change_asked', change_note: 'Make the date line bigger.' });
    const changed = await one(`SELECT changes, turnaround_days, ready_by FROM printing_jobs WHERE id = ${String(job['id'])}`);
    expect([Number(changed['changes']), Number(changed['turnaround_days']), dateOf(changed['ready_by'])]).toEqual([1, 4, '2026-08-11']);
    // The order's ready-by is its newest job's: it moves with it.
    expect(dateOf((await one(`SELECT ready_by FROM printing_orders WHERE id = ${String(job['order_id'])}`))['ready_by'])).toBe('2026-08-11');
    // The second proof approved: the job's own three days, counted from now.
    await staffUpdate('printing_proofs', Number(first['id']), { state: 'superseded' });
    const second = await staffCreate('printing_proofs', { order_id: Number(job['order_id']), job_id: Number(job['id']), kind: 'email', note: 'Second proof.' });
    await staffUpdate('printing_proofs', Number(second['id']), { state: 'approved' });
    const approved = await one(`SELECT proof_state, proof_ok, turnaround_days, ready_by FROM printing_jobs WHERE id = ${String(job['id'])}`);
    expect([approved['proof_state'], Number(approved['proof_ok']), Number(approved['turnaround_days']), dateOf(approved['ready_by'])]).toEqual(['approved', 1, 3, '2026-08-10']);
    expect(dateOf((await one(`SELECT ready_by FROM printing_orders WHERE id = ${String(job['order_id'])}`))['ready_by'])).toBe('2026-08-10');
  });

  it.skipIf(!runs)("refuses a card made in the Customiser whose back is not paid for", async () => {
    const design = await saveCard();
    const res = await quote(CREATE, order([await cards({ design_code: design.code })]));
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    const error = (res.json() as { error: { code: string; params: Doc } }).error;
    expect(error.code).toBe('PUBLIC_WRITE_REFUSED');
    expect(error.params).toMatchObject({ child: 'jobs', index: 0, column: 'design_code', reason: 'feature-not-paid', feature: 'print-back' });
  });

  it.skipIf(!runs)('takes a card made in the Customiser, paying for its back, under the number after it, and snapshots the design', async () => {
    const design = await saveCard();
    const back = { job_features: [{ values: { option_id: await option('business-cards', 'feature', 'print-back') } }] };
    const placed = await create(CREATE, order([{ ...(await cards({ design_code: design.code })), children: back }], { client_key: 'print-install-test-order-0002' }));
    expect(placed.statusCode, placed.body).toBe(201);
    const row = await one(`SELECT number FROM printing_orders WHERE number_seq IS NOT NULL ORDER BY id DESC`);
    expect(row['number']).toBe('MP-4128');
    const versions = await h.rows(`SELECT version, receipt_id FROM customiser_design_versions WHERE design_id = ${String(design.id)}`);
    expect(versions.map((v) => Number(v['version']))).toEqual([1]);
    expect(versions[0]!['receipt_id']).not.toBeNull();
    expect((await one(`SELECT ${q('state')} AS state FROM customiser_designs WHERE id = ${String(design.id)}`))['state']).toBe('ordered');
    const job = await one(`SELECT j.design_id, f.feature FROM printing_jobs j JOIN printing_orders o ON o.id = j.order_id JOIN printing_job_features f ON f.job_id = j.id WHERE o.number = 'MP-4128'`);
    expect([Number(job['design_id']), job['feature']]).toEqual([design.id, 'print-back']);
  });

  it.skipIf(!runs)('prices a delivered order before its address is typed, and still refuses the save without it', async () => {
    // Asked for only when the order is delivered (`requiredWhen`): the quote fills the address in for itself.
    const delivered = order([await flyers()], { delivery_method: 'deliver' });
    const quoted = await quote(CREATE, delivered);
    expect(quoted.statusCode, quoted.body).toBe(200);
    expect((quoted.json() as { data: Doc }).data['delivery_band_id']).not.toBeNull();
    const saved = await create(CREATE, { ...delivered, values: { ...delivered.values, client_key: 'print-install-test-order-0003' } });
    expect(saved.statusCode, saved.body).toBe(400);
    expect((saved.json() as { error: { code: string; params: Doc } }).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'address_line1', reason: 'required' } });
  });

  it.skipIf(built !== null && print !== null)('is skipped: set ADMINIUM_PRINT_REPO to a Print Shop checkout and ADMINIUM_ADD_ONS_REPO to a built add-ons checkout', () => {
    expect(built === null || print === null).toBe(true);
  });
});

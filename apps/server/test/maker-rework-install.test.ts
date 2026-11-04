// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MAKER SHOP, REWORKED, INSTALLED WITH THE BUILT CUSTOMISER IT REQUIRES.
 *
 * The app is read from a checkout of the Maker Shop repository
 * (`ADMINIUM_MAKER_REPO`): its manifest and its sample files as they ship.
 * The Customiser is read from a checkout of the add-ons repository, built
 * (`ADMINIUM_ADD_ONS_REPO`), vouched for as a sandbox vouches for it
 * (`ADMINIUM_ADD_ON_DEV_TRUST=customiser`). The clock stands where the comps
 * pin Birch Row: Thursday 6 August 2026, 16:40. On each engine this run
 * reaches:
 *
 * - the app installs with the Customiser, its tables prefixed;
 * - its sample loads, the Customiser's rows for it among them, and the
 *   figures it stores are Adminium's: BR-2290's £83.95 with its logo, the
 *   walnut sheets on hand from their movements;
 * - a guest's order is quoted as the comp draws it: walnut coasters at £31.28
 *   each for four sets, £29.24 for eight; a set with the shopper's own logo at
 *   £1.50 a piece on top, never broken; and each line's post-by counted in
 *   studio days over the Whitby closure: Tue 11, Wed 12, Thu 13 and Fri 21
 *   August for leads of 3, 4, 5 and 10;
 * - a design whose words run past their part's limit is refused by the
 *   design check, on the code the guest typed;
 * - an order of a design snapshots it in the Customiser and locks its draft,
 *   and the order takes the next number, BR-2291;
 * - "Something's wrong" finds its order only among the orders sent to the
 *   address it gives, and "Ask us for something" is taken.
 *
 * Without either checkout the suite is skipped, by name.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { solveProof } from '../src/public-api/proof.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { png } from './picture-images.js';
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

/** The Maker Shop checkout: its manifest and the sample files it ships. */
function makerApp(): { manifest: Doc; files: Record<string, string> } | null {
  const root = process.env['ADMINIUM_MAKER_REPO'];
  if (root === undefined || root === '' || !existsSync(join(root, 'manifest.json'))) return null;
  const files: Record<string, string> = {};
  if (existsSync(join(root, 'seeds'))) for (const name of readdirSync(join(root, 'seeds'))) if (name.endsWith('.json')) files[`seeds/${name}`] = readFileSync(join(root, 'seeds', name), 'utf8');
  return { manifest: JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Doc, files };
}
const maker = makerApp();

/** Birch Row's pinned clock: Thursday 6 August 2026, 16:40 in Settle (British Summer Time), before the five o'clock cut-off. */
const THURSDAY = new Date('2026-08-06T15:40:00Z');
const EMAIL = 'guest@example.com';
/**
 * The guest's order create, by the ref Adminium gives its entry: the second
 * entry on the app's orders that reads at the verified level (the first is a
 * signed-in shopper's own orders).
 */
const CREATE = 'maker_orders_verified_2';
const OPTS = { locale: 'en-US', userId: null, userLabel: 'test' };
const ADDRESS = { name: 'Guest Shopper', email: EMAIL, address_line1: '1 Test Row', town: 'Settle', postcode: 'BD24 9ZZ' };

describe.each(LEGS)('Maker Shop, reworked, installed with the built Customiser — %s', (dialect, available) => {
  const runs = available && built !== null && maker !== null;
  let h: Harness;
  let served: Served;
  let trusted: string | undefined;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.12.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  /** `values` and `state` are words SQL keeps for itself: each is named in the engine's quotes. */
  const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
  const one = async (statement: string) => (await h.rows(statement))[0]!;
  const id = async (statement: string) => Number((await one(statement))['id']);
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

  /** The sample's rows by what tells them apart. */
  const product = (code: string) => id(`SELECT id FROM maker_products WHERE code = '${code}'`);
  const option = (code: string, kind: string, choice: string) =>
    id(`SELECT o.id FROM maker_options o JOIN maker_products p ON p.id = o.product_id WHERE p.code = '${code}' AND o.kind = '${kind}' AND o.code = '${choice}'`);
  const service = (code: string) => id(`SELECT id FROM maker_postage_services WHERE code = '${code}'`);
  /** The first option of a kind on a product, as the product page preselects it. */
  const first = async (code: string, kind: string) =>
    id(`SELECT o.id FROM maker_options o JOIN maker_products p ON p.id = o.product_id WHERE p.code = '${code}' AND o.kind = '${kind}' ORDER BY o.position`);
  /** A line of a product in its first material, size and finish. */
  const line = async (code: string, qty: number, extra: Doc = {}): Promise<Doc> => ({
    values: { product_id: await product(code), qty, material_id: await first(code, 'material'), size_id: await first(code, 'size'), finish_id: await first(code, 'finish'), ...extra },
  });
  const order = async (lines: Doc[], more: Doc = {}) => ({ values: { ...ADDRESS, service_id: await service('second'), ...more }, children: { order_lines: lines } });

  /** A design saved through the shop's key on the coasters' Ring, with the words given, and a logo when asked. */
  const saveDesign = async (words: string, logo: boolean) => {
    const ready = await id(`SELECT id FROM customiser_ready_designs WHERE app = 'maker' AND name = 'Ring'`);
    const base = await id(`SELECT id FROM customiser_bases WHERE app = 'maker' AND name = 'Engraved walnut coasters'`);
    let file: string | undefined;
    if (logo) {
      const address = fresh();
      const sent = await served.composed.app.inject({
        method: 'POST',
        url: `/api/v1/public/uploads?${new URLSearchParams({ ref: 'customiser_designs', column: 'logo_file', name: 'logo.png' }).toString()}`,
        remoteAddress: address,
        headers: served.headers(undefined, { 'content-type': 'image/png', 'x-adminium-proof': await proof('upload', address) }),
        payload: png({ width: 64, height: 64 }).bytes,
      });
      expect(sent.statusCode, sent.body).toBe(200);
      file = (sent.json() as { data: { id: string } }).data.id;
    }
    const parts: Doc = { words: { text: words } };
    if (logo) parts['logo'] = { file: 'logo_file' };
    const res = await create('customiser_designs', { values: { format: 1, ready_design_id: ready, base_id: base, values: { parts }, ...(file === undefined ? {} : { logo_file: file }), email: EMAIL } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { id: unknown; code: string } };
    return { id: Number(body.data.id), code: body.data.code };
  };
  /** A quote's lines: each child row's figures. */
  const linesOf = (res: { json: () => unknown }) => (res.json() as { children: { order_lines: { data: Doc }[] } }).children.order_lines.map((row) => row.data);

  beforeAll(async () => {
    if (!runs) return;
    vi.useFakeTimers({ toFake: ['Date'], now: THURSDAY });
    trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = CUSTOMISER;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    // The studio's clock and money: Settle, in pounds.
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'GBP' }).where('id', '=', h.connectionId).execute();
    await h.stageAddOn(built!.manifest, { files: built!.files });
    await h.stageApp(maker!.manifest, maker!.files);
    const installed = await h.install('maker', String(maker!.manifest['version']), { addOns: [{ key: CUSTOMISER, version: built!.version }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    const key = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    const added = await createSampleDataService(h.sampleData).add((await findSampleApp(h.meta, 'maker'))!, OPTS);
    expect(added.counts['orders']).toBe(22);
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
    for (const ref of ['orders', 'order_lines', 'order_line_features', 'options', 'products', 'proofs', 'closures', 'settings', 'stock_movements']) expect(names).toContain(`maker_${ref}`);
    expect(names).toContain('customiser_designs');
  });

  it.skipIf(!runs)("loads Birch Row's sample, its stored figures worked out by Adminium", async () => {
    expect(Number((await one(`SELECT COUNT(*) AS n FROM maker_order_lines`))['n'])).toBe(26);
    expect(Number((await one(`SELECT COUNT(*) AS n FROM customiser_designs WHERE app = 'maker'`))['n'])).toBe(3);
    // Tom's logo coasters: two sets at £34, his logo at £1.50 a piece on eight pieces, second class: £83.95.
    const tom = await one(`SELECT pieces_total, postage, total, post_by FROM maker_orders WHERE number = 'BR-2290'`);
    expect([Number(tom['pieces_total']), Number(tom['postage']), Number(tom['total'])]).toEqual([80, 3.95, 83.95]);
    expect(String(tom['post_by'] instanceof Date ? (tom['post_by'] as Date).toISOString() : tom['post_by']).slice(0, 10)).toBe('2026-08-11');
    // The walnut sheets on hand and spoken for, from their movements.
    const walnut = await one(`SELECT on_hand, committed, available FROM maker_materials WHERE code = 'wal6'`);
    expect([Number(walnut['on_hand']), Number(walnut['committed']), Number(walnut['available'])]).toEqual([14, 2, 12]);
    // Iris's book nook waits on its second proof; Sam's keyring was approved.
    const lines = await h.rows(`SELECT o.number, l.proof_state, l.proof_ok FROM maker_order_lines l JOIN maker_orders o ON o.id = l.order_id WHERE o.number IN ('BR-2288', 'BR-2289') ORDER BY o.number`);
    expect(lines.map((row) => [row['number'], row['proof_state'], Number(row['proof_ok'])])).toEqual([
      ['BR-2288', 'sent', 0],
      ['BR-2289', 'approved', 1],
    ]);
  });

  it.skipIf(!runs)('quotes walnut coasters at the break the comp draws: £31.28 each for four sets, £29.24 for eight', async () => {
    const four = await quote(CREATE, await order([await line('coast-wal', 4)]));
    expect(four.statusCode, four.body).toBe(200);
    expect([linesOf(four)[0]!['each'], linesOf(four)[0]!['line_total']].map(Number)).toEqual([31.28, 125.12]);
    const eight = await quote(CREATE, await order([await line('coast-wal', 8)]));
    expect(eight.statusCode, eight.body).toBe(200);
    expect([linesOf(eight)[0]!['each'], linesOf(eight)[0]!['line_total']].map(Number)).toEqual([29.24, 233.92]);
    expect(Number((eight.json() as { data: Doc }).data['total'])).toBe(237.87);
  });

  it.skipIf(!runs)('dates each line in studio days from Thursday 16:40, over the Whitby closure', async () => {
    const res = await quote(CREATE, await order([await line('coast-wal', 1), await line('tray-3d', 1), await line('sign-house', 1), await line('mug-stone', 1)]));
    expect(res.statusCode, res.body).toBe(200);
    expect(linesOf(res).map((row) => [Number(row['lead_days']), String(row['post_by']).slice(0, 10)])).toEqual([
      [3, '2026-08-11'],
      [4, '2026-08-12'],
      [5, '2026-08-13'],
      [10, '2026-08-21'],
    ]);
    expect(String((res.json() as { data: Doc }).data['post_by']).slice(0, 10)).toBe('2026-08-21');
  });

  it.skipIf(!runs)("prices a set with the shopper's own logo at £1.50 a piece on top, never broken", async () => {
    const design = await saveDesign('The Pinfold · 2019', true);
    const logo = { order_line_features: [{ values: { option_id: await option('coast-wal', 'feature', 'logo') } }] };
    const two = await quote(CREATE, await order([{ ...(await line('coast-wal', 2, { design_code: design.code })), children: logo }]));
    expect(two.statusCode, two.body).toBe(200);
    expect([linesOf(two)[0]!['features_total'], linesOf(two)[0]!['line_total'], (two.json() as { data: Doc }).data['total']].map(Number)).toEqual([12, 80, 83.95]);
    // Four sets take the break; the logo does not.
    const four = await quote(CREATE, await order([{ ...(await line('coast-wal', 4, { design_code: design.code })), children: logo }]));
    expect(four.statusCode, four.body).toBe(200);
    expect([linesOf(four)[0]!['each'], linesOf(four)[0]!['features_total'], linesOf(four)[0]!['line_total']].map(Number)).toEqual([31.28, 24, 149.12]);
    // A logo the line does not pay for is refused.
    const unpaid = await quote(CREATE, await order([await line('coast-wal', 2, { design_code: design.code })]));
    expect(unpaid.statusCode, unpaid.body).toBeGreaterThanOrEqual(400);
    expect(unpaid.body).toContain('feature-not-paid');
  });

  it.skipIf(!runs)('refuses a design whose words run past their limit, on the code the guest typed', async () => {
    const design = await saveDesign('Short words', false);
    await h.rows(`UPDATE customiser_designs SET ${q('values')} = '${JSON.stringify({ parts: { words: { text: 'Far too many words for one coaster line' } } })}' WHERE id = ${String(design.id)}`);
    const res = await quote(CREATE, await order([await line('coast-wal', 1, { design_code: design.code })]));
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    const error = (res.json() as { error: { code: string; params: Doc } }).error;
    expect(error.code).toBe('PUBLIC_WRITE_REFUSED');
    expect(error.params).toMatchObject({ child: 'order_lines', index: 0, column: 'design_code', reason: 'too-long', part: 'words' });
  });

  it.skipIf(!runs)('an order of a design snapshots it and locks its draft, under the next number, BR-2291', async () => {
    const design = await saveDesign('Harbour Lights', false);
    const placed = await create(CREATE, await order([await line('coast-wal', 1, { design_code: design.code })], { client_key: 'maker-install-test-order-0001' }));
    expect(placed.statusCode, placed.body).toBe(201);
    const row = await one(`SELECT number, total FROM maker_orders WHERE number_seq IS NOT NULL ORDER BY id DESC`);
    expect(row['number']).toBe('BR-2291');
    expect(Number(row['total'])).toBe(37.95);
    const versions = await h.rows(`SELECT version, receipt_id FROM customiser_design_versions WHERE design_id = ${String(design.id)}`);
    expect(versions.map((v) => Number(v['version']))).toEqual([1]);
    expect(versions[0]!['receipt_id']).not.toBeNull();
    expect((await one(`SELECT ${q('state')} AS state FROM customiser_designs WHERE id = ${String(design.id)}`))['state']).toBe('ordered');
  });

  it.skipIf(!runs)("finds a problem's order only among the orders sent to the address it gives; takes a request for something made", async () => {
    const report = (email: string, ref: string, key: string) =>
      create('maker_problem_reports', { values: { order_ref: ref, name: 'Bex T.', email, what: 'damaged', details: 'The corner of the sign chipped in the post.', client_key: key } });
    const theirs = await report('bex.t@mail.example', 'br 2287', 'maker-install-test-problem-0001');
    expect(theirs.statusCode, theirs.body).toBe(201);
    expect(await one(`SELECT ref, order_id FROM maker_problem_reports ORDER BY id DESC`)).toMatchObject({ ref: 'FIX-0001' });
    expect(Number((await one(`SELECT order_id FROM maker_problem_reports ORDER BY id DESC`))['order_id'])).toBe(await id(`SELECT id FROM maker_orders WHERE number = 'BR-2287'`));
    const someoneElses = await report('stranger@example.com', 'BR-2287', 'maker-install-test-problem-0002');
    expect(someoneElses.statusCode, someoneElses.body).toBeGreaterThanOrEqual(400);
    expect((someoneElses.json() as { error: { params: Doc } }).error.params).toMatchObject({ column: 'order_ref', reason: 'unknown' });
    const ask = await create('maker_commission_requests', { values: { name: 'Ada W.', email: 'ada.w@example.com', idea: 'Twelve slate place names for a long table', quantity: 12, client_key: 'maker-install-test-request-0001' } });
    expect(ask.statusCode, ask.body).toBe(201);
    expect((await one(`SELECT ref FROM maker_commission_requests ORDER BY id DESC`))['ref']).toBe('ASK-0001');
  });

  it.skipIf(built !== null && maker !== null)('is skipped: set ADMINIUM_MAKER_REPO to a Maker Shop checkout and ADMINIUM_ADD_ONS_REPO to a built add-ons checkout', () => {
    expect(built === null || maker === null).toBe(true);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CUSTOMISER, AS IT IS BUILT, ANSWERING THE DESIGN QUESTION INSIDE AN ORDER.
 *
 * The design kit's tests prove the question with a fixture written to look
 * like an add-on. This takes the Customiser itself from a checkout of the
 * add-ons repository, built (`ADMINIUM_ADD_ONS_REPO`, `npm run build` in
 * `packages/customiser`): its manifest and the `dist/check.js` it names,
 * staged as a developer's own package and vouched for by
 * `ADMINIUM_ADD_ON_DEV_TRUST=customiser`, as a sandbox runs it. A print shop
 * whose order lines name a customer's design by its code asks it of every
 * line, through the public create and its dry run, on each engine this run
 * reaches:
 *
 * - a 40-character line in a part of 20 is refused, by its part;
 * - a logo with "Your own logo" unpaid is refused (`feature-not-paid`), and
 *   the feature paid for a design with no logo too (`feature-not-used`);
 * - a design whose ready-made design is another app's is unknown;
 * - a design that stands is ordered, with its feature paid where it has one;
 * - a copy nobody vouches for is never asked: a line with a design is refused.
 *
 * The Customiser's saved-design link (its own link key, which opens a
 * design's personal columns by a token) is left out of what is staged: this
 * engine refuses a link that shows personal columns without a proved mailbox,
 * and that link is the design-link work's to settle. The design question
 * reads nothing through it.
 *
 * Without the checkout the suite is skipped, by name.
 */
import { filesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Reply = Awaited<ReturnType<Served['get']>>;
type Doc = Record<string, unknown>;

const CUSTOMISER = 'customiser';
const built = builtAddOn(CUSTOMISER);
/** The Customiser as built, but for its saved-design link. */
const staged = (): Doc => {
  const manifest = { ...built!.manifest };
  manifest['publicAccess'] = (manifest['publicAccess'] as Doc[]).filter((entry) => entry['key'] === undefined);
  delete manifest['publicKeys'];
  return manifest;
};
const FLOOR = '0.3.43';
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

/** A print shop whose order lines name a customer's design by its code, and keep the features they pay for under them. */
function printShop(): Doc {
  return {
    manifestVersion: 1,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    kind: 'app',
    key: 'printing',
    name: 'Print shop',
    version: '1.0.0',
    description: { key: 'mft.printing.desc', fallback: 'A shop.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: FLOOR, engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'products', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
        { ref: 'orders', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
        {
          ref: 'order_lines',
          columns: [
            pk,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'product_id', type: 'fk', references: 'products', nullable: true },
            { ref: 'qty', type: 'int', default: 1 },
            { ref: 'design_code', type: 'text', maxLength: 40, nullable: true },
            {
              ref: 'design_id',
              type: 'int',
              nullable: true,
              rules: {
                addOnLink: { addOn: CUSTOMISER, table: 'designs' },
                lookup: { from: 'design_code', table: { addOn: CUSTOMISER, table: 'designs' }, column: 'code' },
              },
            },
          ],
          check: { by: { addOn: CUSTOMISER }, design: 'design_id', paid: { table: 'line_features', via: 'line_id', feature: 'feature' } },
        },
        { ref: 'line_features', columns: [pk, { ref: 'line_id', type: 'fk', references: 'order_lines' }, { ref: 'feature', type: 'text', maxLength: 40 }] },
      ],
    },
    pages: [{ ref: 'printing-home', template: 'page-dashboard', title: { key: 'mft.printing.page.home', fallback: 'Home' }, nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 } }],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { shop: '/' } },
    ],
    addOns: { requires: [{ key: CUSTOMISER, range: '^1.0.0', reason: { 'en-US': 'Customers make their cards their own.' } }] },
    publicAccess: [
      { table: 'products', methods: ['GET'], select: ['id', 'name', 'price'] },
      {
        table: 'orders',
        methods: ['POST'],
        writable: ['name', 'email'],
        humanCheck: true,
        select: ['id'],
        dryRun: true,
        children: {
          order_lines: {
            via: 'order_id',
            writable: ['product_id', 'qty', 'design_code'],
            select: ['id', 'design_id'],
            min: 1,
            max: 12,
            children: { line_features: { via: 'line_id', writable: ['feature'], select: ['id', 'feature'], max: 4 } },
          },
        },
      },
    ],
  };
}

describe.each(LEGS)('the built Customiser, checking a design inside the order — %s', (dialect, available) => {
  const runs = available && built !== null;
  let h: Harness;
  let served: Served;
  let untrusted: Served;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.7.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const create = async (payload: Doc, through: Served = served) => {
    const address = fresh();
    const challenge = await through.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: through.headers() });
    const c = (challenge.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    const headers = through.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    return through.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/printing_orders', remoteAddress: address, headers, payload });
  };
  const quote = (payload: Doc, through: Served = served) =>
    through.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/printing_orders/dry-run', remoteAddress: fresh(), headers: through.headers(), payload });
  const error = (res: Reply) => (res.json() as { error: { code: string; params?: Doc } }).error;
  const order = (...lines: { code?: string; features?: string[] }[]): Doc => ({
    values: { name: 'Ben', email: 'ben@example.com' },
    children: {
      order_lines: lines.map((line) => ({
        values: { product_id: 1, qty: 1, ...(line.code === undefined ? {} : { design_code: line.code }) },
        ...(line.features === undefined ? {} : { children: { line_features: line.features.map((feature) => ({ values: { feature } })) } }),
      })),
    },
  });
  const orders = async () => Number((await h.rows('SELECT COUNT(*) AS n FROM printing_orders'))[0]!['n']);
  const yes = (value: boolean) => (dialect === 'postgres' ? String(value) : value ? '1' : '0');
  /** `values` is a word SQL keeps for itself: the column is named in each engine's quotes. */
  const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);

  beforeAll(async () => {
    if (!runs) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(staged(), { files: built!.files });
    await h.stageApp(printShop());
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: CUSTOMISER, version: built!.version }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    const key = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    // The print shop's coaster-like card, and the maker's, each with words of 20 at 6 mm and a logo that costs "Your own logo".
    await h.rows(`INSERT INTO customiser_features (id, app, code, name, active) VALUES (1, 'printing', 'logo', 'Your own logo', ${yes(true)}), (2, 'maker', 'logo', 'Your own logo', ${yes(true)})`);
    await h.rows(`INSERT INTO customiser_bases (id, app, name, kind, width_mm, height_mm, sides, state, position) VALUES (1, 'printing', 'Square card', 'page', 95, 95, 1, 'published', 1), (2, 'maker', 'Coasters', 'piece', 95, 95, 1, 'published', 1)`);
    await h.rows(`INSERT INTO customiser_ready_designs (id, app, base_id, name, state, position) VALUES (1, 'printing', 1, 'Ring', 'published', 1), (2, 'maker', 2, 'Ring', 'published', 1)`);
    const words = JSON.stringify({ chars: 20, grows: true, unit: 'mm', size: 6, min: 4, max: 8, fonts: ['Manrope'], font: 'Manrope' });
    const logoRules = JSON.stringify({ picture: 'logo', fit: 'inside', file: 'logo_file', colour: 'one' });
    const parts = (id: number, app: string, ready: number, feature: number) =>
      `(${String(id)}, '${app}', ${String(ready)}, 'words', 'Your words', 'text', ${yes(false)}, ${yes(true)}, '${words}', NULL, 14, 60, 72, 13, 1), ` +
      `(${String(id + 1)}, '${app}', ${String(ready)}, 'logo', 'Your logo', 'picture', ${yes(false)}, ${yes(false)}, '${logoRules}', ${String(feature)}, 31, 17, 36, 36, 2)`;
    await h.rows(`INSERT INTO customiser_ready_parts (id, app, ready_design_id, code, name, kind, locked, required, rules, feature_id, x_mm, y_mm, w_mm, h_mm, position) VALUES ${parts(1, 'printing', 1, 1)}, ${parts(3, 'maker', 2, 2)}`);
    await h.rows(`INSERT INTO printing_products (id, name, price) VALUES (1, 'Card', 10)`);
    // A logo the customer uploaded: a stored picture of 48 KiB.
    const logo = (await filesRepo(h.meta).create({ filename: 'logo.png', mime: 'image/png', sizeBytes: 48 * 1024, sha256: 'b'.repeat(64), kind: 'upload' as never })).id;
    const design = async (id: number, code: string, ready: number, base: number, values: Doc, withLogo = false) => {
      await h.rows(
        `INSERT INTO customiser_designs (id, app, code, ${q('format')}, ready_design_id, base_id, ${q('values')}, logo_file, ${q('state')}, created_at, last_changed_at) ` +
          `VALUES (${String(id)}, 'printing', '${code}', 1, ${String(ready)}, ${String(base)}, '${JSON.stringify(values)}', ${withLogo ? `'${logo}'` : 'NULL'}, 'draft', '2026-11-01 10:00:00', '2026-11-01 10:00:00')`,
      );
    };
    await design(1, 'CZ00000000000001', 1, 1, { parts: { words: { text: 'The Pinfold 2019' } } });
    await design(2, 'CZ00000000000002', 1, 1, { parts: { words: { text: 'x'.repeat(40) } } });
    await design(3, 'CZ00000000000003', 1, 1, { parts: { words: { text: 'Ada' }, logo: { file: 'logo_file' } } }, true);
    // The print shop's design, made on the maker's ready-made design and base.
    await design(4, 'CZ00000000000004', 2, 2, { parts: { words: { text: 'Ada' } } });
    const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    try {
      process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = CUSTOMISER;
      served = await servePublic(h as never, key, { ADMINIUM_DATA_DIR: h.dataDir });
      // Nobody vouches for the Customiser's bytes here: its code is never loaded.
      delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
      untrusted = await servePublic(h as never, key, { ADMINIUM_DATA_DIR: h.dataDir });
    } finally {
      if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
      else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    }
  }, 240_000);
  afterAll(async () => {
    if (!runs) return;
    await served?.close();
    await untrusted?.close();
    await h?.close();
  });

  it.skipIf(!runs)('a design that stands is ordered, and the dry run gives the same answer as the save', async () => {
    const quoted = await quote(order({ code: 'CZ00000000000001' }));
    expect(quoted.statusCode, quoted.body).toBe(200);
    const before = await orders();
    const made = await create(order({ code: 'CZ00000000000001' }, {}));
    expect(made.statusCode, made.body).toBe(201);
    expect(await orders()).toBe(before + 1);
  });

  it.skipIf(!runs)('a 40-character line in a 20-character part is refused by its part, in the save and the dry run alike', async () => {
    const before = await orders();
    const saved = await create(order({ code: 'CZ00000000000002' }));
    expect(saved.statusCode, saved.body).toBe(400);
    expect(error(saved)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { child: 'order_lines', index: 0, column: 'design_code', reason: 'too-long', part: 'words' } });
    expect(error(await quote(order({ code: 'CZ00000000000002' })))).toEqual(error(saved));
    expect(await orders()).toBe(before);
  });

  it.skipIf(!runs)('a logo without “Your own logo” paid is refused, and the feature paid for a design without a logo too', async () => {
    const before = await orders();
    const unpaid = await create(order({ code: 'CZ00000000000003' }));
    expect(error(unpaid).params, unpaid.body).toMatchObject({ child: 'order_lines', index: 0, column: 'design_code', reason: 'feature-not-paid', feature: 'logo' });
    const unused = await create(order({ code: 'CZ00000000000001', features: ['logo'] }));
    expect(error(unused).params, unused.body).toMatchObject({ child: 'order_lines', index: 0, column: 'design_code', reason: 'feature-not-used', feature: 'logo' });
    expect(await orders()).toBe(before);
    // Paid for, and used: ordered.
    const paid = await create(order({ code: 'CZ00000000000003', features: ['logo'] }));
    expect(paid.statusCode, paid.body).toBe(201);
    expect(await orders()).toBe(before + 1);
  });

  it.skipIf(!runs)('a design on another app’s ready-made design is unknown, and the second line is named when it is the one refused', async () => {
    const saved = await create(order({ code: 'CZ00000000000001' }, { code: 'CZ00000000000004' }));
    expect(error(saved).params, saved.body).toMatchObject({ child: 'order_lines', index: 1, column: 'design_code', reason: 'design-unknown' });
  });

  it.skipIf(!runs)('a copy nobody vouches for is never asked: a line with a design is refused, a line without one goes through', async () => {
    const before = await orders();
    const designed = await create(order({ code: 'CZ00000000000001' }), untrusted);
    expect(designed.statusCode, designed.body).toBe(400);
    expect(error(designed).params).toMatchObject({ column: 'design_code', reason: 'check-unavailable' });
    expect(error(await quote(order({ code: 'CZ00000000000001' }), untrusted)).params).toMatchObject({ reason: 'check-unavailable' });
    const plain = await create(order({}), untrusted);
    expect(plain.statusCode, plain.body).toBe(201);
    expect(await orders()).toBe(before + 1);
  });

  it.skipIf(built !== null)('is skipped: no built Customiser (set ADMINIUM_ADD_ONS_REPO and run `npm run build` in packages/customiser)', () => {
    expect(built).toBeNull();
  });
});

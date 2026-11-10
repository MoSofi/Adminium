// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CUSTOMER'S DESIGN IN THE CUSTOMISER AS IT IS BUILT, ORDERED: THE ORDER
 * LINE SNAPSHOTS IT AND LOCKS THE DRAFT, IN THE SAME SAVE.
 *
 * The Customiser is taken from a checkout of the add-ons repository, built
 * (`ADMINIUM_ADD_ONS_REPO`, `npm run build` in `packages/customiser`): its
 * manifest as it ships and the `dist/check.js` it names, vouched for by
 * `ADMINIUM_ADD_ON_DEV_TRUST=customiser` as a sandbox runs it. A print shop
 * declares the half its README asks of an app: an order line that names a
 * design by its code checks it and, when the line is made, posts it into the
 * Customiser's `designs` ledger (`order`). A guest of the shop, on each
 * engine this run reaches:
 *
 * - saves a design with a logo through the shop's key, and orders it through
 *   the shop's public create;
 * - finds a `design_versions` row holding what the design held as ordered
 *   (its values; its logo stays on the design, which no longer changes), the
 *   posting that made it named as its receipt;
 * - finds the design `ordered`: its own link reads it, and refuses a change
 *   and a delete, while a draft is still deleted through its link;
 * - orders the same design again: no second version, as the README says;
 * - a staff change to the line after the order leaves the version as it
 *   was;
 * - and two new designs in one order each get their version.
 *
 * Without the checkout the suite is skipped, by name.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { publicKeysRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadDecider } from '../src/add-ons/decide.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import type { WriteContext, WriteTarget } from '../src/crud/write-context.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { createLedgerRuntime } from '../src/ledgers/registry.js';
import { solveProof } from '../src/public-api/proof.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { png } from './picture-images.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

const CUSTOMISER = 'customiser';
const LINK_KEY = 'customiser-link';
const DESIGNS = 'customiser_designs';
const OWN = 'customiser_designs_claimed';
const built = builtAddOn(CUSTOMISER);
const FLOOR = '0.3.43';
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;
const EMAIL = 'guest@example.com';
const DESK: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };

/** A print shop declaring the app's half the Customiser's README gives: the line checks the design and posts it when the line is made. */
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
          // The README's snippet, as it stands.
          postings: [
            {
              id: 'design',
              into: { addOn: CUSTOMISER, ledger: 'designs', action: 'order' },
              via: 'order_id',
              post: { on: { create: true } },
              map: { design: 'design_id' },
              only: { column: 'design_id', set: true },
            },
          ],
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

describe.each(LEGS)("a design ordered in the built Customiser: snapshotted and locked by the order's line — %s", (dialect, available) => {
  const runs = available && built !== null;
  let h: Harness;
  let served: Served;
  let door: Served;
  let trusted: string | undefined;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.11.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
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
  const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);
  /** `values` and `state` are words SQL keeps for itself: each is named in the engine's quotes. */
  const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
  const design = async (id: number) => (await h.rows(`SELECT id, ${q('state')} AS state, ${q('values')} AS words, logo_file FROM customiser_designs WHERE id = ${String(id)}`))[0];
  const versions = (id: number) => h.rows(`SELECT id, app, design_id, version, ${q('values')} AS words, receipt_id FROM customiser_design_versions WHERE design_id = ${String(id)} ORDER BY version`);
  const words = (text: string) => ({ parts: { words: { text }, logo: { file: 'logo_file' } } });

  /** A design saved through the shop's key with a logo uploaded for it: its id, its code, and its own link. */
  const save = async (text: string) => {
    const address = fresh();
    const sent = await served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/public/uploads?${new URLSearchParams({ ref: DESIGNS, column: 'logo_file', name: 'logo.png' }).toString()}`,
      remoteAddress: address,
      headers: served.headers(undefined, { 'content-type': 'image/png', 'x-adminium-proof': await proof('upload', address) }),
      payload: png({ width: 8, height: 8 }).bytes,
    });
    expect(sent.statusCode, sent.body).toBe(200);
    const logo = (sent.json() as { data: { id: string } }).data.id;
    const res = await create(DESIGNS, { values: { format: 1, ready_design_id: 1, base_id: 1, values: words(text), logo_file: logo, email: EMAIL } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { id: unknown; code: string }; link: { token: string; session: string } };
    return { id: Number(body.data.id), code: body.data.code, session: body.link.session };
  };
  /** An order whose one line names the design by its code. */
  const order = (code: string, qty = 1) => create('printing_orders', { values: { name: 'Guest', email: EMAIL }, children: { order_lines: [{ values: { product_id: 1, qty, design_code: code } }] } });
  const throughLink = (method: 'PATCH' | 'DELETE', id: number, session: string, payload?: Doc) =>
    door.composed.app.inject({ method, url: `/api/v1/public/records/${OWN}/${String(id)}`, remoteAddress: fresh(), headers: door.headers(session), ...(payload === undefined ? {} : { payload }) });

  /** A staff member's change to a row, through the write service as the server wires it, the Customiser's own code vouched for. */
  const staffUpdate = async (table: string, id: number, values: Doc) => {
    const view = await loadSnapshotView(h.meta, h.connectionId, { lists: true });
    const { db, dialect: engine } = await h.manager.data(h.connectionId);
    const target: WriteTarget = { connectionId: h.connectionId, view, table: view.table(view.model.tables.find((one) => one.name === table)!.id), db, dialect: engine, timezone: 'UTC' };
    const installs = keepAddOnInstalls(h.meta, async () => parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema));
    const decider = loadDecider({ key: CUSTOMISER, version: built!.version, path: 'dist/check.js', bytes: Buffer.from(built!.files['dist/check.js']!, 'utf8') });
    const ledgers = createLedgerRuntime({
      installs: () => installs.current(),
      refresh: () => installs.fresh(),
      decider: (key) => (key === CUSTOMISER ? decider : null),
      versionNow: async (key) => {
        const row = await h.meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).executeTakeFirst();
        return row === undefined ? null : { version: row.version, status: row.status };
      },
    });
    const writes = createWriteService({ ...writeStores(h.meta), ledgers });
    return writes.update({ target, pk: { id }, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(target.table.columns.get(k)!, v)])), context: DESK, announce: async () => {} });
  };

  beforeAll(async () => {
    if (!runs) return;
    trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    // The Customiser's code is vouched for as a sandbox vouches for it: the check and the posting load it.
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = CUSTOMISER;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(built!.manifest, { files: built!.files });
    await h.stageApp(printShop());
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: CUSTOMISER, version: built!.version }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    const key = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    const yes = (value: boolean) => (dialect === 'postgres' ? String(value) : value ? '1' : '0');
    // A one-sided card with words of up to 20 characters and a logo box that costs nothing.
    await h.rows(`INSERT INTO customiser_bases (id, app, name, kind, width_mm, height_mm, sides, ${q('state')}, position) VALUES (1, 'printing', 'Square card', 'page', 95, 95, 1, 'published', 1)`);
    await h.rows(`INSERT INTO customiser_ready_designs (id, app, base_id, name, ${q('state')}, position) VALUES (1, 'printing', 1, 'Ring', 'published', 1)`);
    const wordRules = JSON.stringify({ chars: 20, unit: 'mm', size: 6, min: 4, max: 8, fonts: ['Manrope'], font: 'Manrope' });
    const logoRules = JSON.stringify({ picture: 'logo', fit: 'inside', file: 'logo_file' });
    await h.rows(
      `INSERT INTO customiser_ready_parts (id, app, ready_design_id, code, name, kind, locked, required, rules, feature_id, x_mm, y_mm, w_mm, h_mm, position) VALUES ` +
        `(1, 'printing', 1, 'words', 'Your words', 'text', ${yes(false)}, ${yes(true)}, '${wordRules}', NULL, 14, 60, 72, 13, 1), ` +
        `(2, 'printing', 1, 'logo', 'Your logo', 'picture', ${yes(false)}, ${yes(false)}, '${logoRules}', NULL, 31, 17, 36, 36, 2)`,
    );
    await h.rows(`INSERT INTO printing_products (id, name, price) VALUES (1, 'Card', 10)`);
    const link = (await publicKeysRepo(h.meta).listManagedBy(CUSTOMISER)).find((one) => one.purpose === LINK_KEY && one.revokedAt === null);
    expect(link, 'the Customiser has a link key of its own').toBeDefined();
    served = await servePublic(h as never, key, { ADMINIUM_DATA_DIR: h.dataDir });
    door = await servePublic(h as never, link!.id, { ADMINIUM_DATA_DIR: h.dataDir });
  }, 240_000);
  afterAll(async () => {
    if (!runs) return;
    await door?.close();
    await served?.close();
    await h?.close();
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
  });

  it.skipIf(!runs)('the order snapshots the design as ordered, names the posting, and locks the draft', async () => {
    const saved = await save('Harbour Bakery');
    const before = await design(saved.id);
    expect(before).toMatchObject({ state: 'draft' });
    const ordered = await order(saved.code);
    expect(ordered.statusCode, ordered.body).toBe(201);
    const line = (await h.rows('SELECT id, design_id FROM printing_order_lines ORDER BY id DESC'))[0]!;
    expect(Number(line['design_id'])).toBe(saved.id);

    const [version, ...more] = await versions(saved.id);
    expect(more).toEqual([]);
    expect(version).toMatchObject({ app: 'printing', version: expect.anything() });
    expect(Number(version!['version'])).toBe(1);
    expect(json(version!['words'])).toEqual(words('Harbour Bakery'));
    // The posting that made it is its receipt, from this line.
    expect(version!['receipt_id']).not.toBeNull();
    const receipt = (await h.rows(`SELECT ledger, action, source_line, line_table, phase FROM customiser_postings WHERE id = ${String(version!['receipt_id'])}`))[0]!;
    expect(receipt).toMatchObject({ ledger: 'designs', action: 'order', phase: 'post' });
    expect(String(receipt['source_line'])).toBe(String(line['id']));

    // The draft is the order's now; its logo is the one it was ordered with.
    const after = await design(saved.id);
    expect(after).toMatchObject({ state: 'ordered' });
    expect(after!['logo_file']).toBe(before!['logo_file']);
    expect(after!['logo_file']).toEqual(expect.any(String));
  });

  it.skipIf(!runs)('an ordered design refuses a change and a delete through its own link; a draft is deleted through it', async () => {
    const saved = await save('Pinfold & Co');
    expect((await order(saved.code)).statusCode).toBe(201);
    const changed = await throughLink('PATCH', saved.id, saved.session, { values: { values: words('Changed after paying') } });
    expect(changed.statusCode, changed.body).toBeGreaterThanOrEqual(400);
    const removed = await throughLink('DELETE', saved.id, saved.session);
    // An ordered design answers as one that is not there.
    expect(removed.statusCode, removed.body).toBe(404);
    expect(await design(saved.id)).toMatchObject({ state: 'ordered' });
    expect(json((await design(saved.id))!['words'])).toEqual(words('Pinfold & Co'));
    expect(await versions(saved.id)).toHaveLength(1);

    // A draft nobody ordered goes through its link.
    const draft = await save('Never ordered');
    const gone = await throughLink('DELETE', draft.id, draft.session);
    expect(gone.statusCode, gone.body).toBeLessThan(300);
    expect(await design(draft.id)).toBeUndefined();
  });

  it.skipIf(!runs)('the same design ordered again gets no second version: the version the shop proofs stands', async () => {
    const saved = await save('Twice over');
    expect((await order(saved.code)).statusCode).toBe(201);
    const again = await order(saved.code, 3);
    expect(again.statusCode, again.body).toBe(201);
    const lines = await h.rows(`SELECT id FROM printing_order_lines WHERE design_id = ${String(saved.id)}`);
    expect(lines).toHaveLength(2);
    const all = await versions(saved.id);
    expect(all.map((one) => Number(one['version']))).toEqual([1]);
    expect(json(all[0]!['words'])).toEqual(words('Twice over'));
    expect(await design(saved.id)).toMatchObject({ state: 'ordered' });
  });

  it.skipIf(!runs)('a staff change to the line after the order leaves the version as it was', async () => {
    const saved = await save('Staff touch');
    expect((await order(saved.code)).statusCode).toBe(201);
    const line = (await h.rows(`SELECT id FROM printing_order_lines WHERE design_id = ${String(saved.id)}`))[0]!;
    const [before] = await versions(saved.id);
    await staffUpdate('printing_order_lines', Number(line['id']), { qty: 5 });
    expect(Number((await h.rows(`SELECT qty FROM printing_order_lines WHERE id = ${String(line['id'])}`))[0]!['qty'])).toBe(5);
    const after = await versions(saved.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before);
  });

  it.skipIf(!runs)('two new designs in one order each get a version of their own', async () => {
    const first = await save('Left card');
    const second = await save('Right card');
    const both = await create('printing_orders', {
      values: { name: 'Guest', email: EMAIL },
      children: { order_lines: [{ values: { product_id: 1, qty: 1, design_code: first.code } }, { values: { product_id: 1, qty: 1, design_code: second.code } }] },
    });
    /*
     * A Customiser that labels each new version `v<n>` gives both "v1", and
     * the write check refuses a label given twice: the order is refused. The
     * one that ships labels it by its design (`design-<id>-v<n>`), so the
     * order is taken; a checkout that went back to `v<n>` fails here.
     */
    expect(built!.files['dist/check.js']).toContain('`design-${');
    expect(both.statusCode, both.body).toBe(201);
    for (const [saved, text] of [[first, 'Left card'], [second, 'Right card']] as const) {
      const all = await versions(saved.id);
      expect(all.map((one) => Number(one['version']))).toEqual([1]);
      expect(json(all[0]!['words'])).toEqual(words(text));
      expect(await design(saved.id)).toMatchObject({ state: 'ordered' });
    }
  });

  it.skipIf(built !== null)('is skipped: no built Customiser (set ADMINIUM_ADD_ONS_REPO and run `npm run build` in packages/customiser)', () => {
    expect(built).toBeNull();
  });
});

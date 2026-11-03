// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOPPER'S DESIGN, MADE WITH AN ADD-ON, ON TWO SHOPS THAT SHARE ONE INSTALL.
 *
 * The design kit's entries ride both shops' keys and are held, each, to the
 * rows of the shop whose key serves them (`appColumn`): the maker's key never
 * reads the print shop's bases or ready-made designs, and a design saved
 * through the print shop's key is the print shop's whatever the browser
 * sends. (A shopper's own designs are added by anyone, so no entry lets
 * anyone read them: an app's key reads none at all.)
 *
 * An order line names its design only by the design's secret code
 * (`lookup` into the kit's table): a guest who sends a design's key outright
 * is refused, a code that finds nothing is `unknown` and a guess spent, and
 * the right code links the line. On every engine this run can reach, through
 * the real installer and the whole server.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { publicEndpointsRepo } from '@adminium/meta';
import { validateManifest } from '@adminium/manifest';

import { deriveScopeDocument, endpointMap, keyApp } from '../src/public-api/derive.js';
import { solveProof } from '../src/public-api/proof.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { BASES_REF, DESIGN_KIT, DESIGNS_REF, READY_REF, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Reply = Awaited<ReturnType<Served['get']>>;

describe.each(LEGS)('a shopper\'s design on two shops sharing one add-on — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  const keys: Record<'printing' | 'maker', string> = { printing: '', maker: '' };
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.7.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const as = async (shop: 'printing' | 'maker') => served.useKey(keys[shop]);
  const read = (url: string, extra: Record<string, string> = {}, address = fresh()) =>
    served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${url}`, remoteAddress: address, headers: served.headers(undefined, extra) });
  /** A create behind the human check, as a browser sends one. */
  const create = async (ref: string, payload: Record<string, unknown>, address = fresh()) => {
    const challenge = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: served.headers() });
    const c = (challenge.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    const headers = served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    return served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${ref}`, remoteAddress: address, headers, payload });
  };
  const ids = (res: Reply) => ((res.json() as { data: { id: unknown }[] }).data ?? []).map((row) => Number(row.id)).sort();
  const error = (res: Reply) => (res.json() as { error: { code: string; params?: Record<string, unknown> } }).error;
  const order = (line: Record<string, unknown>) => ({ values: { name: 'Ben', email: 'ben@example.com' }, children: { order_lines: [{ values: { product_id: 1, qty: 1, ...line } }] } });
  /** A design saved through a shop's key: its id and its code. */
  const design = async (shop: 'printing' | 'maker', base: number, words: string) => {
    await as(shop);
    const res = await create(DESIGNS_REF, { values: { base_id: base, name_text: words } });
    expect(res.statusCode, res.body).toBe(201);
    const row = (res.json() as { data: { id: unknown; code: string } }).data;
    return { id: Number(row.id), code: row.code };
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(designKitManifest());
    for (const shop of ['printing', 'maker'] as const) {
      await h.stageApp(designShopManifest(shop));
      const installed = await h.install(shop, '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }], publicAccess: true });
      expect(installed.statusCode, installed.body).toBe(200);
      keys[shop] = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    }
    await h.rows(`INSERT INTO design_kit_bases (id, name, app) VALUES (1, 'Mug', 'printing'), (2, 'Coaster', 'maker'), (3, 'Poster', 'printing')`);
    await h.rows(`INSERT INTO design_kit_ready (id, title, app) VALUES (1, 'Wedding', 'printing'), (2, 'Birthday', 'maker'), (3, 'Unclaimed', NULL)`);
    for (const shop of ['printing', 'maker'] as const) await h.rows(`INSERT INTO ${shop}_products (id, name, price) VALUES (1, 'Thing', 10)`);
    served = await servePublic(h as never, keys.printing);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('each shop\'s key reads only its own bases', async () => {
    await as('printing');
    expect(ids(await read(BASES_REF))).toEqual([1, 3]);
    await as('maker');
    expect(ids(await read(BASES_REF))).toEqual([2]);
    // Asked for another shop's row by its key: the one answer a row not there gets.
    expect((await read(`${BASES_REF}/1`)).statusCode).toBe(404);
  });

  it.skipIf(!available)('a design saved through the print shop\'s key is the print shop\'s, whatever the browser sends', async () => {
    const saved = await design('printing', 1, 'Ava & Sam');
    const stored = await h.rows(`SELECT app, state, name_text FROM design_kit_designs WHERE id = ${String(saved.id)}`);
    expect(stored[0]).toMatchObject({ app: 'printing', state: 'draft', name_text: 'Ava & Sam' });
    expect(saved.code).toMatch(/^[0-9A-Z]{16}$/);
    // The browser may not say whose it is.
    await as('printing');
    const claimed = await create(DESIGNS_REF, { values: { base_id: 1, name_text: 'Mine', app: 'maker' } });
    expect(claimed.statusCode, claimed.body).toBe(400);
    expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM design_kit_designs WHERE app = 'maker'`))[0]!['n'])).toBe(0);
  });

  it.skipIf(!available)('each shop\'s key reads only its own ready-made designs; a row of no shop is read by none', async () => {
    await as('printing');
    expect(ids(await read(READY_REF))).toEqual([1]);
    await as('maker');
    expect(ids(await read(READY_REF))).toEqual([2]);
    // Another shop's row asked for by its key, and a row of no shop: the answer a row not there gets.
    expect((await read(`${READY_REF}/1`)).statusCode).toBe(404);
    expect((await read(`${READY_REF}/3`)).statusCode).toBe(404);
  });

  it.skipIf(!available)('a line names a design only by its code: a key sent outright is refused, a wrong code is unknown, the right one links', async () => {
    const theirs = await design('printing', 1, 'Guest A');
    await as('printing');
    const before = Number((await h.rows('SELECT COUNT(*) AS n FROM printing_orders'))[0]!['n']);
    // Guest B sends A's design by its key: the link is Adminium's to fill.
    const outright = await create('printing_orders', order({ design_id: theirs.id }));
    expect(outright.statusCode, outright.body).toBe(400);
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM printing_orders'))[0]!['n'])).toBe(before);
    // A code that finds no design.
    const wrong = await create('printing_orders', order({ design_code: 'ZZZZZZZZZZZZZZZZ' }));
    expect(wrong.statusCode, wrong.body).toBe(400);
    expect(error(wrong)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { child: 'order_lines', index: 0, column: 'design_code', reason: 'unknown' } });
    // The right one, typed as a person types it: the line links to that design.
    const right = await create('printing_orders', order({ design_code: theirs.code.toLowerCase().replace(/(.{4})/g, '$1 ') }));
    expect(right.statusCode, right.body).toBe(201);
    const line = await h.rows(`SELECT design_id FROM printing_order_lines ORDER BY id DESC`);
    expect(Number(line[0]!['design_id'])).toBe(theirs.id);
  });

  it.skipIf(!available)('each wrong code is a guess spent: the sixth code a visitor types is refused before it is looked up', async () => {
    const good = await design('printing', 3, 'Kept');
    await as('printing');
    const me = fresh();
    for (let i = 0; i < 5; i += 1) {
      const miss = await create('printing_orders', order({ design_code: `NOPE${String(i)}` }), me);
      expect(error(miss).params, miss.body).toMatchObject({ column: 'design_code', reason: 'unknown' });
    }
    const spent = await create('printing_orders', order({ design_code: good.code }), me);
    expect(spent.statusCode, spent.body).toBe(429);
  });

  it.skipIf(!available)('a key no app made serves nothing of an entry held to an app; an app\'s key never writes or moves the column', async () => {
    const stored = endpointMap(await publicEndpointsRepo(h.meta).listByConnection(h.connectionId));
    const designs = [...stored.values()].find((endpoint) => endpoint.ref === DESIGNS_REF)!;
    expect(designs.definition.app_column).toBe('app');
    // Even a definition that offers a change and lists the column among what a browser writes.
    const loose = { ...designs, definition: { ...designs.definition, methods: ['POST', 'PATCH'] as never, writable: ['name_text', 'app'] } };
    const map = new Map([[loose.id, loose]]);
    const access = { [loose.id]: ['POST', 'PATCH'] as never };
    const held = deriveScopeDocument({ kind: 'browser', access, app: 'printing' }, map, null);
    const resource = held.document.resources[0]!;
    expect(resource.writable).toEqual(['name_text']);
    expect(resource.defaults).toMatchObject({ app: 'printing' });
    expect(resource.where).toContainEqual({ column: 'app', op: 'eq', value: 'printing' });
    // The owner's own key, or an add-on's link key: no app, nothing served, kept in the grant.
    const none = deriveScopeDocument({ kind: 'browser', access }, map, null);
    expect(none.document.resources).toEqual([]);
    expect(none.suspended).toEqual([{ endpointId: loose.id, ref: DESIGNS_REF, methods: ['POST', 'PATCH'] }]);
    // Whose a key is: an app's own customer key only; the add-on's link key, an app's other key and the owner's are no app's.
    expect(keyApp({ managedBy: 'printing', purpose: 'customer' })).toBe('printing');
    expect(keyApp({ managedBy: DESIGN_KIT, purpose: 'design-links' })).toBeNull();
    expect(keyApp({ managedBy: 'printing', purpose: 'kiosk' })).toBeNull();
    expect(keyApp({ managedBy: null, purpose: 'customer' })).toBeNull();
  });

  it.skipIf(!available)('a shop that lets a line write its design link outright is refused before it installs', () => {
    const doc = designShopManifest('printing') as { publicAccess: { children?: { order_lines: { writable: string[] } } }[] };
    doc.publicAccess[1]!.children!.order_lines.writable.push('design_id');
    const checked = validateManifest(doc) as { ok: boolean; issues?: { path: string; message: string }[] };
    expect(checked.ok).toBe(false);
    expect(JSON.stringify(checked.issues)).toContain('design_id');
  });

  it.skipIf(!available)('two shops requiring the add-on at ^1.0.0 both installed it once, and its update within the range is not blocked', async () => {
    const attached = await h.meta.db.selectFrom('adminium_manifest_attachments').select('attachedTo').execute();
    expect(attached.map((row) => row.attachedTo).sort()).toEqual(['maker', 'printing']);
    expect((await h.meta.db.selectFrom('adminium_manifests').select('manifestKey').where('manifestKey', '=', DESIGN_KIT).execute()).length).toBe(1);
    await h.stageAddOn(designKitManifest({ version: '1.0.1' }));
    const updated = await h.inject({ method: 'POST', url: `/add-ons/${DESIGN_KIT}/update`, payload: { to: '1.0.1' } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect((updated.json() as { to: string }).to).toBe('1.0.1');
  });
});

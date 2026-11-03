// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A GUEST'S DESIGN, CHECKED BY THE ADD-ON THAT KEEPS IT, INSIDE THE ORDER.
 *
 * A shop's order line may name a design a guest made with the design kit
 * (by the design's code). The kit answers whether the design may be ordered
 * and which priced features it uses; Adminium asks inside the order's own
 * create (and its dry run), checks the answer, and refuses an order whose
 * design does not stand or whose features are not the ones its lines pay
 * for. A kit whose deciding code nobody vouches for is never asked, and a
 * line with a design is then refused; a line without one goes through.
 *
 * Through the public create with children, and as the desk that changes a
 * line (its design, the features it pays for), on every engine this run can
 * reach, through the real installer and the whole server.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { filesRepo, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { DESIGN_KIT, DESIGN_KIT_FILES, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Reply = Awaited<ReturnType<Served['get']>>;
type Doc = Record<string, unknown>;

describe.each(LEGS)('a guest\'s design, checked inside the order — %s', (dialect, available) => {
  let h: Harness;
  /** The server that runs the kit's code (a developer's own trust), and one that vouches for nothing. */
  let served: Served;
  let untrusted: Served;
  let key = '';
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  /** A create behind the human check, as a browser sends one. */
  const create = async (payload: Doc, through: Served = served) => {
    const address = fresh();
    const challenge = await through.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: through.headers() });
    const c = (challenge.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    const headers = through.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    return through.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/printing_orders', remoteAddress: address, headers, payload });
  };
  /** The same order, quoted. */
  const quote = (payload: Doc, through: Served = served) =>
    through.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/printing_orders/dry-run', remoteAddress: fresh(), headers: through.headers(), payload });
  const error = (res: Reply) => (res.json() as { error: { code: string; params?: Doc } }).error;
  /** An order of lines, each naming a design by its code (or none) and the features it pays for. */
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
  let logo = '';
  /** A design of the print shop's, under a code a guest types. */
  const design = async (id: number, code: string, ready: number, words: Doc, withLogo = false) => {
    await h.rows(
      `INSERT INTO design_kit_designs (id, code, app, base_id, ready_id, state, words, logo) VALUES (${String(id)}, '${code}', 'printing', 1, ${String(ready)}, 'draft', '${JSON.stringify(words)}', ${withLogo ? `'${logo}'` : 'NULL'})`,
    );
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(designKitManifest({}, { checker: true }), { files: DESIGN_KIT_FILES });
    await h.stageApp(designShopManifest('printing', {}, { check: true }));
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    key = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    await h.rows(`INSERT INTO design_kit_bases (id, name, app) VALUES (1, 'Mug', 'printing')`);
    await h.rows(`INSERT INTO design_kit_ready (id, title, app) VALUES (1, 'Wedding', 'printing'), (2, 'Everything', 'printing')`);
    await h.rows(`INSERT INTO design_kit_ready_parts (id, ready_id, name, max_chars, required) VALUES (1, 1, 'top', 20, ${dialect === 'postgres' ? 'true' : '1'}), (2, 1, 'bottom', 30, ${dialect === 'postgres' ? 'false' : '0'})`);
    // A ready-made design of 401 parts: more rows than a check may read for one line.
    const many = Array.from({ length: 401 }, (_, i) => `(${String(100 + i)}, 2, 'p${String(i)}', 10, ${dialect === 'postgres' ? 'false' : '0'})`);
    await h.rows(`INSERT INTO design_kit_ready_parts (id, ready_id, name, max_chars, required) VALUES ${many.join(', ')}`);
    await h.rows(`INSERT INTO printing_products (id, name, price) VALUES (1, 'Mug', 10)`);
    // A logo the guest uploaded: a stored picture of 2 KiB.
    logo = (await filesRepo(h.meta).create({ filename: 'logo.png', mime: 'image/png', sizeBytes: 2048, sha256: 'a'.repeat(64), kind: 'upload' as never })).id;
    await design(1, 'AA00000000000001', 1, { top: 'Happy birthday' });
    await design(2, 'AA00000000000002', 1, { top: 'x'.repeat(40) });
    await design(3, 'AA00000000000003', 1, { top: 'Ada' }, true);
    await design(4, 'AA00000000000004', 2, {});
    await design(5, 'AA00000000000005', 1, { bottom: 'only the bottom' });
    const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    try {
      process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = DESIGN_KIT;
      served = await servePublic(h as never, key, { ADMINIUM_DATA_DIR: h.dataDir });
      // Nobody vouches for the kit's bytes here: its code is never loaded.
      delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
      untrusted = await servePublic(h as never, key, { ADMINIUM_DATA_DIR: h.dataDir });
    } finally {
      if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
      else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    }
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await untrusted?.close();
    await h?.close();
  });

  it.skipIf(!available)('a design that stands is ordered, and the dry run gives the same answer as the save', async () => {
    const quoted = await quote(order({ code: 'AA00000000000001' }));
    expect(quoted.statusCode, quoted.body).toBe(200);
    const before = await orders();
    const made = await create(order({ code: 'AA00000000000001' }, {}));
    expect(made.statusCode, made.body).toBe(201);
    expect(await orders()).toBe(before + 1);
    const lines = await h.rows('SELECT design_id FROM printing_order_lines ORDER BY id');
    expect(lines.map((line) => line['design_id'] === null ? null : Number(line['design_id']))).toEqual([1, null]);
  });

  it.skipIf(!available)('a 40-character text in a 20-character part is refused, by name, in the save and the dry run alike', async () => {
    const before = await orders();
    const saved = await create(order({ code: 'AA00000000000002' }));
    expect(saved.statusCode, saved.body).toBe(400);
    expect(error(saved)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { child: 'order_lines', index: 0, column: 'design_code', reason: 'too-long', part: 'top' } });
    const quoted = await quote(order({ code: 'AA00000000000002' }));
    expect(error(quoted)).toEqual(error(saved));
    expect(await orders()).toBe(before);
  });

  it.skipIf(!available)('an empty part that must be filled is refused', async () => {
    const saved = await create(order({ code: 'AA00000000000005' }));
    expect(error(saved).params).toMatchObject({ column: 'design_code', reason: 'required-empty', part: 'top' });
  });

  it.skipIf(!available)('a logo used without its paid feature is refused, and the paid feature without a logo is refused too', async () => {
    const before = await orders();
    const unpaid = await create(order({ code: 'AA00000000000003' }));
    expect(error(unpaid).params, unpaid.body).toMatchObject({ child: 'order_lines', index: 0, column: 'design_code', reason: 'feature-not-paid', feature: 'logo' });
    const unused = await create(order({ code: 'AA00000000000001', features: ['logo'] }));
    expect(error(unused).params, unused.body).toMatchObject({ child: 'order_lines', index: 0, column: 'design_code', reason: 'feature-not-used', feature: 'logo' });
    const twice = await create(order({ code: 'AA00000000000003', features: ['logo', 'logo'] }));
    expect(error(twice).params, twice.body).toMatchObject({ reason: 'feature-paid-twice', feature: 'logo' });
    expect(await orders()).toBe(before);
    // Paid for, and used: ordered.
    const paid = await create(order({ code: 'AA00000000000003', features: ['logo'] }));
    expect(paid.statusCode, paid.body).toBe(201);
    expect(await orders()).toBe(before + 1);
  });

  it.skipIf(!available)('a design whose reads pass 400 rows is refused by name, and the kit is never asked about it', async () => {
    const saved = await create(order({ code: 'AA00000000000004' }));
    expect(error(saved).params, saved.body).toMatchObject({ column: 'design_code', reason: 'design-too-large' });
  });

  it.skipIf(!available)('the second line is named when it is the one refused', async () => {
    const saved = await create(order({ code: 'AA00000000000001' }, { code: 'AA00000000000002' }));
    expect(error(saved).params, saved.body).toMatchObject({ child: 'order_lines', index: 1, reason: 'too-long' });
  });

  for (const how of ['throw', 'slow', 'shape', 'skip'] as const) {
    it.skipIf(!available)(`a kit whose code ${how === 'throw' ? 'throws' : how === 'slow' ? 'runs past its 250 ms' : how === 'shape' ? 'answers in no shape' : 'leaves a line out'} refuses the save`, async () => {
      const before = await orders();
      await h.rows(`UPDATE design_kit_settings SET misbehave = '${how}'`);
      try {
        const saved = await create(order({ code: 'AA00000000000001' }));
        expect(saved.statusCode, saved.body).toBe(400);
        expect(error(saved).params).toMatchObject({ column: 'design_code', reason: 'check-failed' });
        // A line with no design asks nothing, so nothing of the kit's can refuse it.
        const plain = await create(order({}));
        expect(plain.statusCode, plain.body).toBe(201);
      } finally {
        await h.rows('UPDATE design_kit_settings SET misbehave = NULL');
      }
      expect(await orders()).toBe(before + 1);
    });
  }

  it.skipIf(!available)('a kit nobody vouches for is never asked: a line with a design is refused, a line without one goes through', async () => {
    const before = await orders();
    const designed = await create(order({ code: 'AA00000000000001' }), untrusted);
    expect(designed.statusCode, designed.body).toBe(400);
    expect(error(designed).params).toMatchObject({ column: 'design_code', reason: 'check-unavailable' });
    const quoted = await quote(order({ code: 'AA00000000000001' }), untrusted);
    expect(error(quoted).params).toMatchObject({ reason: 'check-unavailable' });
    const plain = await create(order({}), untrusted);
    expect(plain.statusCode, plain.body).toBe(201);
    expect(await orders()).toBe(before + 1);
  });

  it.skipIf(!available)('a staff change asks again: a line\'s design moved, a feature paid for added, as the desk that makes them', async () => {
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    const id = (name: string) => model.tables.find((table) => table.name === name)!.id;
    const grants = [
      ...['read', 'create', 'update'].map((action) => `table:${h.connectionId}:${id('printing_order_lines')}:${action}`),
      ...['read', 'create', 'delete'].map((action) => `table:${h.connectionId}:${id('printing_line_features')}:${action}`),
      `table:${h.connectionId}:${id('printing_orders')}:read`,
    ];
    const user = await usersRepo(h.meta).create({ email: 'desk@shop.test', name: 'desk', passwordHash: await adminPasswordHash() });
    const role = await rolesRepo(h.meta).create({ slug: 'desk-own', name: 'Desk' });
    for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: fresh(), payload: { email: 'desk@shop.test', password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = sessionCookie(login.headers['set-cookie']);
    const data = (method: 'POST' | 'PATCH' | 'DELETE', path: string, payload?: Doc) =>
      served.composed.app.inject({ method, url: `/api/v1/data/${h.connectionId}/${path}`, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    await h.rows(`INSERT INTO printing_orders (id, name) VALUES (900, 'Desk order')`);
    const made = await data('POST', id('printing_order_lines'), { values: { order_id: 900, product_id: 1, qty: 1 } });
    expect(made.statusCode, made.body).toBe(201);
    const line = String((made.json() as { data: { id: unknown } }).data.id);
    const refusal = (res: Reply) => (res.json() as { error: { code: string; details?: Doc } }).error;
    // A design whose words are too long for its part: refused, said to the desk by its reason and part.
    const long = await data('PATCH', `${id('printing_order_lines')}/${line}`, { values: { design_code: 'AA00000000000002' } });
    expect(long.statusCode, long.body).toBe(409);
    expect(refusal(long)).toMatchObject({ code: 'CHECK_REFUSED', details: { column: 'design_id', reason: 'too-long', part: 'top' } });
    // A design with a logo, on a line that pays for none.
    const unpaid = await data('PATCH', `${id('printing_order_lines')}/${line}`, { values: { design_code: 'AA00000000000003' } });
    expect(refusal(unpaid)).toMatchObject({ code: 'CHECK_REFUSED', details: { reason: 'feature-not-paid', feature: 'logo' } });
    // The feature first, on a line with no design yet (not asked), then the design: it stands.
    const feature = await data('POST', id('printing_line_features'), { values: { line_id: Number(line), feature: 'logo' } });
    expect(feature.statusCode, feature.body).toBe(201);
    const paid = await data('PATCH', `${id('printing_order_lines')}/${line}`, { values: { design_code: 'AA00000000000003' } });
    expect(paid.statusCode, paid.body).toBe(200);
    // The same feature paid twice is refused on the feature's own save.
    const twice = await data('POST', id('printing_line_features'), { values: { line_id: Number(line), feature: 'logo' } });
    expect(refusal(twice)).toMatchObject({ code: 'CHECK_REFUSED', details: { reason: 'feature-paid-twice', feature: 'logo' } });
    // A removal never asks: taking a paid feature off is the desk's to do.
    const gone = await data('DELETE', `${id('printing_line_features')}/${String((feature.json() as { data: { id: unknown } }).data.id)}`);
    expect(gone.statusCode, gone.body).toBe(200);
  });
});

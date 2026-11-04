// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DESIGN READ BY ITS OWN LONG CODE SHOWS ITS PERSONAL WORDS.
 *
 * A shopper's words on a design (`values`) are personal data. A guest who
 * found their order again opens each design by its own code, sent with the
 * shop's session (`level: "lookup"`, `unlockBy` with `self`). A code of 16
 * characters is 80 bits of secret, as hard to find by trying as a shared
 * link's, and whoever holds it holds that one design: the read shows the
 * words, as the design's own link does.
 *
 * A shorter code, or a code of another row that unlocks the design, is not
 * that, and the entry is refused where it is written, as before: it could
 * never show the words to anyone. On every engine this run can reach.
 */
import type { Manifest } from '@adminium/manifest';
import { publicKeysRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { planPublicEndpoints } from '../src/apps/manifest-public.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { solveProof } from '../src/public-api/proof.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { DESIGN_BY_CODE_REF, DESIGN_KIT, DESIGN_LINK_KEY, DESIGNS_REF, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const WORDS = { line1: 'Mum & Dad 1985', colour: 'gold' };
const PERSONAL = /marked personal data/;

/** The kit with a shopper's words kept as personal data, and its code read as `unlock` says. */
function kit(unlock?: Doc): Doc {
  const made = designKitManifest({}, { link: true });
  const schema = made['requiredSchema'] as { tables: { ref: string; columns: Doc[] }[] };
  const tables = schema.tables.map((table) =>
    table.ref === 'designs' ? { ...table, columns: table.columns.map((column) => (column['ref'] === 'values' ? { ...column, rules: { personal: true } } : column)) } : table,
  );
  const entries = (made['publicAccess'] as Doc[]).map((entry) => (entry['unlockBy'] !== undefined && unlock !== undefined ? { ...entry, unlockBy: unlock } : entry));
  return { ...made, requiredSchema: { ...schema, tables }, publicAccess: entries };
}

describe.each(LEGS)('a design read by its own long code shows its personal words — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.5.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const create = async (ref: string, payload: Doc) => {
    const address = fresh();
    const challenge = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: served.headers() });
    const c = (challenge.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    const headers = served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    return served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${ref}`, remoteAddress: address, headers, payload });
  };
  const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);
  /** The issues a kit's entry on the code read would be refused with, against this engine's tables. */
  const codeReadIssues = async (manifest: Doc): Promise<string[]> => {
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const names = { bases: 'design_kit_bases', designs: 'design_kit_designs', ready: 'design_kit_ready' };
    return planPublicEndpoints(manifest as unknown as Manifest, names, view)
      .filter((planned) => planned.ref === DESIGN_BY_CODE_REF)
      .flatMap((planned) => planned.issues);
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(kit());
    await h.stageApp(designShopManifest('printing', {}, { lookup: true }));
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    const key = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    await h.rows(`INSERT INTO design_kit_bases (id, name, app) VALUES (1, 'Mug', 'printing')`);
    await h.rows(`INSERT INTO printing_products (id, name, price) VALUES (1, 'Thing', 10)`);
    expect((await publicKeysRepo(h.meta).listManagedBy(DESIGN_KIT)).some((one) => one.purpose === DESIGN_LINK_KEY)).toBe(true);
    served = await servePublic(h as never, key, { ADMINIUM_DATA_DIR: h.dataDir });
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('shows the words to a signed-in guest who opens the design by its 16-character code', async () => {
    const saved = await create(DESIGNS_REF, { values: { base_id: 1, name_text: 'Draft', values: WORDS, email: 'marta@example.com' } });
    expect(saved.statusCode, saved.body).toBe(201);
    const design = saved.json() as { data: { id: unknown; code: string } };
    const order = await create('printing_orders', { values: { name: 'Guest', email: 'guest@example.com' }, children: { order_lines: [{ values: { product_id: 1, qty: 1, design_code: design.data.code } }] } });
    expect(order.statusCode, order.body).toBe(201);
    const id = Number((order.json() as { data: { id: unknown } }).data.id);
    const linkCode = String((await h.rows(`SELECT link_code FROM printing_orders WHERE id = ${String(id)}`))[0]!['link_code']);
    const claim = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim', remoteAddress: fresh(), headers: served.headers(), payload: { match: { id, link_code: linkCode } } });
    expect(claim.statusCode, claim.body).toBe(200);
    const session = (claim.json() as { data: { session: string } }).data.session;

    const opened = await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${DESIGN_BY_CODE_REF}`, remoteAddress: fresh(), headers: served.headers(session, { 'x-adminium-code': design.data.code }) });
    expect(opened.statusCode, opened.body).toBe(200);
    const rows = (opened.json() as { data: Doc[] }).data;
    expect(rows.map((row) => Number(row['id']))).toEqual([Number(design.data.id)]);
    expect(json(rows[0]!['values'])).toEqual(WORDS);
    // Never kept by a browser or a cache, and the code is never shown back.
    expect(opened.headers['cache-control']).toBe('no-store');
    expect(opened.body).not.toContain(design.data.code);
    // Without the code, nothing at all.
    const none = await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${DESIGN_BY_CODE_REF}`, remoteAddress: fresh(), headers: served.headers(session) });
    expect((none.json() as { data: Doc[] }).data).toEqual([]);
  });

  it.skipIf(!available)('is written without a refusal for a code of 16 characters', async () => {
    expect((await codeReadIssues(kit())).filter((issue) => PERSONAL.test(issue))).toEqual([]);
  });

  it.skipIf(!available)('refuses the words to a read by a 12-character code', async () => {
    const issues = await codeReadIssues(kit({ header: true, column: 'code', self: true, length: 12 }));
    expect(issues.some((issue) => PERSONAL.test(issue) && issue.includes('"values"')), issues.join('\n')).toBe(true);
  });

  it.skipIf(!available)('refuses the words to a read unlocked by a code of another row, however long', async () => {
    const issues = await codeReadIssues(kit({ table: 'designs', column: 'code', link: 'id' }));
    expect(issues.some((issue) => PERSONAL.test(issue) && issue.includes('"values"')), issues.join('\n')).toBe(true);
  });
});

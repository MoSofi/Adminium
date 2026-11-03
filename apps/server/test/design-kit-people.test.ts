// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S WORDS ON AN ADD-ON'S TABLE, FOUND, EXPORTED AND ERASED WITH THEM.
 *
 * The print shop's customer orders a mug with "Marta & Jo" on it: the words
 * are kept on the design kit's design, which the order's line names. The shop
 * declares that copy (`people[].copies[]` with `addOn`, through the line's
 * link), so a search for the customer lists the design, its export carries
 * the words, and an erasure blanks them — and only on the designs her own
 * orders name. On every engine this run can reach, through the whole server.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConsentService } from '../src/consent/service.js';
import { personZip } from '../src/privacy/export.js';
import { findPerson } from '../src/privacy/sources.js';
import { TEST_SECRET } from './helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { DESIGN_KIT, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const MARTA = 'marta@example.com';

describe.each(LEGS)("a person's words on an add-on's table — %s", (dialect, available) => {
  let h: Harness;
  let served: Served;
  let cookie: string;
  const send = (url: string, payload: Record<string, unknown>) => served.composed.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie }, payload });
  const design = async (id: number) => (await h.rows(`SELECT id, name_text, app FROM design_kit_designs WHERE id = ${String(id)}`))[0]!;

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(designKitManifest());
    await h.stageApp(designShopManifest('printing'));
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    await h.rows(`INSERT INTO printing_customers (id, name, email) VALUES (1, 'Marta Kovac', '${MARTA}'), (2, 'Ben Other', 'ben@example.com')`);
    await h.rows(`INSERT INTO printing_orders (id, customer_id, name, email) VALUES (1, 1, 'Marta Kovac', '${MARTA}'), (2, 2, 'Ben Other', 'ben@example.com')`);
    await h.rows(
      `INSERT INTO design_kit_designs (id, code, app, name_text) VALUES (1, 'AAAABBBBCCCCDDD1', 'printing', 'Marta & Jo'), (2, 'AAAABBBBCCCCDDD2', 'printing', 'For Ben'), (3, 'AAAABBBBCCCCDDD3', 'printing', 'Never ordered')`,
    );
    await h.rows(`INSERT INTO printing_order_lines (id, order_id, qty, design_id) VALUES (1, 1, 1, 1), (2, 2, 1, 2), (3, 1, 2, NULL)`);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const officer = await usersRepo(h.meta).create({ email: 'pia@shop.dev', name: 'Pia', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(officer.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.8.0.1', payload: { email: 'pia@shop.dev', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('a search for her lists the design her order names, and her download carries her words on it, and no other design', async () => {
    const res = await send('/privacy/find', { address: MARTA });
    expect(res.statusCode, res.body).toBe(200);
    const sources = (res.json() as { data: { sources: { id: string; kind: string; table: string | null; keys: string[] }[] } }).data.sources;
    const designs = sources.find((source) => source.kind === 'copy' && (source.table ?? '').endsWith('design_kit_designs'));
    expect(designs).toMatchObject({ id: 'copy-printing-customers-design-kit-designs', keys: ['1'] });
    // The download: her words on the design, and nothing else of it.
    const found = await findPerson({ meta: h.meta, manager: h.manager, consent: createConsentService({ meta: h.meta, secret: TEST_SECRET }) }, MARTA);
    const zip = unzipSync(personZip(found, Date.now()));
    expect(JSON.parse(strFromU8(zip['copy-printing-customers-design-kit-designs.json']!))).toEqual([{ id: 1, name_text: 'Marta & Jo' }]);
    expect(JSON.stringify(Object.values(zip).map((file) => strFromU8(file)))).not.toContain('For Ben');
  });

  it.skipIf(!available)('erasing her blanks her words on that design, and leaves the others', async () => {
    const preview = await send('/privacy/erase/preview', { address: MARTA });
    expect(preview.statusCode, preview.body).toBe(200);
    const goes = (preview.json() as { data: { goes: { table?: string; count: number }[] } }).data.goes;
    expect(goes.find((item) => (item.table ?? '').endsWith('design_kit_designs'))?.count).toBe(1);
    const res = await send('/privacy/erase', { address: MARTA, confirm: MARTA });
    expect(res.statusCode, res.body).toBe(200);
    expect((await design(1))['name_text'] ?? null).toBeNull();
    expect(await design(1)).toMatchObject({ app: 'printing' });
    expect((await design(2))['name_text']).toBe('For Ben');
    expect((await design(3))['name_text']).toBe('Never ordered');
  });
});

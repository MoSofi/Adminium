// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOPPER'S SAVED DESIGN, CHANGED IN PLACE, FOUND AGAIN, AND ERASED.
 *
 * The design kit keeps the designs shoppers make. Saving one through a shop's
 * key answers its own link once (`shareLink`), with a session on the kit's
 * link key; that link reads the design and changes it in place while it is a
 * draft (`own: true`, `writableWhen`), so a shopper who saves and comes back
 * keeps one design, one code and one mailed link. The link never reaches
 * another shopper's design, never writes a column its entry does not name, and
 * never changes a design once it is ordered.
 *
 * A guest who finds their order again reads its lines, each with the code of
 * the design it names, and opens each design by that code (`unlockBy.self`
 * with `level`): only with the shop's session, only that shop's designs.
 *
 * The words on a design are JSON (`values`): a shop that declares them as a
 * copy of its customer (`holds: "details"`) finds, downloads and erases them
 * with her. On every engine this run can reach, through the whole server.
 */
import { publicKeysRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConsentService } from '../src/consent/service.js';
import { personZip } from '../src/privacy/export.js';
import { findPerson } from '../src/privacy/sources.js';
import { solveProof } from '../src/public-api/proof.js';
import { TEST_SECRET } from './helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { DESIGN_BY_CODE_REF, DESIGN_KIT, DESIGN_LINK_KEY, DESIGN_OWN_REF, DESIGNS_REF, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Reply = Awaited<ReturnType<Served['get']>>;
type Shop = 'printing' | 'maker';

const MARTA = 'marta@example.com';
const WORDS = { line1: 'Mum & Dad 1985', colour: 'gold' };

describe.each(LEGS)("a shopper's saved design, changed in place and found again — %s", (dialect, available) => {
  let h: Harness;
  let served: Served;
  let door: Served;
  let cookie: string;
  const keys: Record<Shop, string> = { printing: '', maker: '' };
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.6.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const as = async (shop: Shop) => served.useKey(keys[shop]);
  /** A create behind the human check, as a browser sends one. */
  const create = async (ref: string, payload: Record<string, unknown>) => {
    const address = fresh();
    const challenge = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: served.headers() });
    const c = (challenge.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    const headers = served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    return served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${ref}`, remoteAddress: address, headers, payload });
  };
  /** A change through the kit's link key, with the session its link opened. */
  const change = (id: number, values: Record<string, unknown>, session: string) =>
    door.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/${DESIGN_OWN_REF}/${String(id)}`, remoteAddress: fresh(), headers: door.headers(session), payload: { values } });
  /** A design read by its code through a shop's key, with a session of that shop or none. */
  const byCode = (code: string, session?: string) =>
    served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${DESIGN_BY_CODE_REF}`, remoteAddress: fresh(), headers: served.headers(session, { 'x-adminium-code': code }) });
  const rows = (res: Reply) => (res.json() as { data: Record<string, unknown>[] }).data;
  const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);
  const stored = async (id: number) => (await h.rows(`SELECT id, code, app, state, name_text, ${dialect === 'mysql' ? '`values`' : '"values"'} AS words FROM design_kit_designs WHERE id = ${String(id)}`))[0]!;
  const count = async () => Number((await h.rows('SELECT COUNT(*) AS n FROM design_kit_designs'))[0]!['n']);

  /** A design saved through a shop's key: its id, code, and the own link it answered with. */
  const save = async (shop: Shop, words: Record<string, unknown>, email = MARTA) => {
    await as(shop);
    const res = await create(DESIGNS_REF, { values: { base_id: shop === 'printing' ? 1 : 2, name_text: 'Draft', values: words, email } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { id: unknown; code: string }; link?: { key: string; token: string; session?: string } };
    return { id: Number(body.data.id), code: body.data.code, link: body.link };
  };
  /** An order through a shop's key whose one line names a design by its code, and the session its lookup opens. */
  const orderFor = async (shop: Shop, code: string, email = 'guest@example.com') => {
    await as(shop);
    const res = await create(`${shop}_orders`, { values: { name: 'Guest', email }, children: { order_lines: [{ values: { product_id: 1, qty: 1, design_code: code } }] } });
    expect(res.statusCode, res.body).toBe(201);
    const id = Number((res.json() as { data: { id: unknown } }).data.id);
    const linkCode = String((await h.rows(`SELECT link_code FROM ${shop}_orders WHERE id = ${String(id)}`))[0]!['link_code']);
    const claim = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim', remoteAddress: fresh(), headers: served.headers(), payload: { match: { id, link_code: linkCode } } });
    expect(claim.statusCode, claim.body).toBe(200);
    return { id, session: (claim.json() as { data: { session: string } }).data.session };
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(designKitManifest({}, { link: true }));
    for (const shop of ['printing', 'maker'] as const) {
      await h.stageApp(designShopManifest(shop, {}, { lookup: true }));
      const installed = await h.install(shop, '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }], publicAccess: true });
      expect(installed.statusCode, installed.body).toBe(200);
      keys[shop] = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    }
    await h.rows(`INSERT INTO design_kit_bases (id, name, app) VALUES (1, 'Mug', 'printing'), (2, 'Coaster', 'maker')`);
    for (const shop of ['printing', 'maker'] as const) await h.rows(`INSERT INTO ${shop}_products (id, name, price) VALUES (1, 'Thing', 10)`);
    const link = (await publicKeysRepo(h.meta).listManagedBy(DESIGN_KIT)).find((key) => key.purpose === DESIGN_LINK_KEY && key.revokedAt === null);
    expect(link, 'the kit has a link key of its own').toBeDefined();
    served = await servePublic(h as never, keys.printing, { ADMINIUM_DATA_DIR: h.dataDir });
    door = await servePublic(h as never, link!.id);
    const officer = await usersRepo(h.meta).create({ email: 'pia@shop.dev', name: 'Pia', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(officer.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.8.0.1', payload: { email: 'pia@shop.dev', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await door?.close();
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('saving a design answers its own link once, with a session on the kit\'s link key that opens it', async () => {
    const saved = await save('printing', WORDS);
    expect(saved.link).toMatchObject({ key: DESIGN_LINK_KEY });
    expect(saved.link!.token).toMatch(/^[0-9A-Z]{16}$/);
    expect(saved.link!.session).toEqual(expect.any(String));
    const opened = await door.get(`/records/${DESIGN_OWN_REF}`, saved.link!.session);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(rows(opened).map((row) => Number(row['id']))).toEqual([saved.id]);
    expect(json(rows(opened)[0]!['values'])).toEqual(WORDS);
    // The mailed link opens the same design, from another device.
    const claimed = await door.post('/claim/token', { token: saved.link!.token });
    expect(claimed.statusCode, claimed.body).toBe(200);
  });

  it.skipIf(!available)('the shopper changes their draft in place: one design, one code, no new row', async () => {
    const saved = await save('printing', WORDS);
    const before = await count();
    const res = await change(saved.id, { values: { ...WORDS, line1: 'Mum & Dad 1986' }, name_text: 'Anniversary' }, saved.link!.session!);
    expect(res.statusCode, res.body).toBe(200);
    expect(await count()).toBe(before);
    const row = await stored(saved.id);
    expect(row).toMatchObject({ code: saved.code, app: 'printing', state: 'draft', name_text: 'Anniversary' });
    expect(json(row['words'])).toEqual({ ...WORDS, line1: 'Mum & Dad 1986' });
  });

  it.skipIf(!available)('a column the link does not name is refused, and nothing of the design moves', async () => {
    const saved = await save('printing', WORDS);
    for (const values of [{ app: 'maker' }, { state: 'ordered' }, { code: 'AAAABBBBCCCCDDDD' }, { link_token: 'AAAABBBBCCCCDDDD' }, { email: 'other@example.com' }]) {
      const res = await change(saved.id, values, saved.link!.session!);
      expect(res.statusCode, `${JSON.stringify(values)}: ${res.body}`).toBe(400);
    }
    expect(await stored(saved.id)).toMatchObject({ code: saved.code, app: 'printing', state: 'draft', name_text: 'Draft' });
  });

  it.skipIf(!available)('another shopper\'s design is never changed, nor read, through this link', async () => {
    const mine = await save('printing', WORDS);
    const theirs = await save('printing', { line1: 'Not yours' }, 'ben@example.com');
    const res = await change(theirs.id, { values: { line1: 'Taken over' } }, mine.link!.session!);
    expect(res.statusCode, res.body).toBe(404);
    expect(json((await stored(theirs.id))['words'])).toEqual({ line1: 'Not yours' });
    expect((await door.get(`/records/${DESIGN_OWN_REF}/${String(theirs.id)}`, mine.link!.session)).statusCode).toBe(404);
    // Without a session, the link key opens nothing at all.
    expect((await door.get(`/records/${DESIGN_OWN_REF}`)).statusCode).not.toBe(200);
  });

  it.skipIf(!available)('an ordered design is never changed by its shopper', async () => {
    const saved = await save('printing', WORDS);
    // What the order line's posting does to the draft: it is the order's now.
    await h.rows(`UPDATE design_kit_designs SET state = 'ordered' WHERE id = ${String(saved.id)}`);
    const res = await change(saved.id, { values: { line1: 'Changed after paying' } }, saved.link!.session!);
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    expect(json((await stored(saved.id))['words'])).toEqual(WORDS);
    // It still reads: the shopper sees what was ordered.
    expect(rows(await door.get(`/records/${DESIGN_OWN_REF}`, saved.link!.session)).map((row) => row['state'])).toEqual(['ordered']);
  });

  it.skipIf(!available)('after finding the order, the guest reads its lines\' design codes and opens each design by its code', async () => {
    const saved = await save('printing', WORDS);
    const order = await orderFor('printing', saved.code);
    const lines = await served.get('/records/printing_order_lines_claimed', order.session);
    expect(lines.statusCode, lines.body).toBe(200);
    expect(rows(lines).map((line) => line['design_code'])).toEqual([saved.code]);
    const opened = await byCode(saved.code, order.session);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(rows(opened).map((row) => Number(row['id']))).toEqual([saved.id]);
    expect(json(rows(opened)[0]!['values'])).toEqual(WORDS);
    // The code is never shown back, nor the link's secret.
    expect(opened.body).not.toContain(saved.code);
    expect(opened.body).not.toContain(saved.link!.token);
  });

  it.skipIf(!available)('nobody without the shop\'s session opens a design by its code, and another shop never does', async () => {
    const saved = await save('printing', WORDS);
    await as('printing');
    expect((await byCode(saved.code)).statusCode).toBe(404);
    // A wrong code, with a session: nothing.
    const order = await orderFor('printing', saved.code);
    expect(rows(await byCode('ZZZZZZZZZZZZZZZZ', order.session))).toEqual([]);
    // The maker's guest, signed in on the maker's key, with the print shop's design code: nothing.
    const makers = await save('maker', { line1: 'Coaster' });
    const theirs = await orderFor('maker', makers.code);
    expect(rows(await byCode(saved.code, theirs.session))).toEqual([]);
    expect(rows(await byCode(makers.code, theirs.session)).map((row) => Number(row['id']))).toEqual([makers.id]);
  });

  it.skipIf(!available)('erasing the customer removes "Mum & Dad 1985" from her design, after finding and downloading it', async () => {
    const saved = await save('printing', WORDS);
    const other = await save('printing', { line1: 'For Ben' }, 'ben@example.com');
    const order = await orderFor('printing', saved.code, MARTA);
    await h.rows(`INSERT INTO printing_customers (id, name, email) VALUES (1, 'Marta Kovac', '${MARTA}')`);
    await h.rows(`UPDATE printing_orders SET customer_id = 1 WHERE id = ${String(order.id)}`);
    const send = (url: string, payload: Record<string, unknown>) => served.composed.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie }, payload });
    const found = await send('/privacy/find', { address: MARTA });
    expect(found.statusCode, found.body).toBe(200);
    const sources = (found.json() as { data: { sources: { id: string; kind: string; table: string | null; keys: string[] }[] } }).data.sources;
    expect(sources.find((source) => source.kind === 'copy' && (source.table ?? '').endsWith('design_kit_designs'))?.keys).toEqual([String(saved.id)]);
    // Her download carries her words as she wrote them, the same on every engine.
    const person = await findPerson({ meta: h.meta, manager: h.manager, consent: createConsentService({ meta: h.meta, secret: TEST_SECRET }) }, MARTA);
    const zip = unzipSync(personZip(person, Date.now()));
    const designs = JSON.parse(strFromU8(zip['copy-printing-customers-design-kit-designs.json']!)) as Record<string, unknown>[];
    expect(designs).toEqual([{ id: saved.id, name_text: 'Draft', values: WORDS }]);
    const erased = await send('/privacy/erase', { address: MARTA, confirm: MARTA });
    expect(erased.statusCode, erased.body).toBe(200);
    const after = await stored(saved.id);
    expect(after['words'] ?? null).toBeNull();
    expect(after['name_text'] ?? null).toBeNull();
    expect(JSON.stringify(await h.rows(`SELECT * FROM design_kit_designs WHERE id = ${String(saved.id)}`))).not.toContain('Mum & Dad 1985');
    // The design stays the shop's, and Ben's is left as it was.
    expect(after).toMatchObject({ app: 'printing', code: saved.code });
    expect(json((await stored(other.id))['words'])).toEqual({ line1: 'For Ben' });
  });
});

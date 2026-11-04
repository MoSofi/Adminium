// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STAFF PAGE OF AN ADD-ON PUTS FILES INTO ITS OWN FILE COLUMNS, AND READS
 * THE APP'S PRICE FOR EACH OF ITS FEATURES.
 *
 * The design kit keeps a base's outline (an SVG) and a shop's fonts (WOFF2)
 * in file columns of its own tables, each with the add-on's own rule. Its
 * page uploads through the files route, as a record form does, naming the
 * real table and column the kit's read gave it, and then saves the row with
 * the reference the server made: that save is when the file becomes the
 * row's. A designer (one of the shop's roles, granted the kit's tables by
 * the shop) does both; a reader is refused the upload and the save. An SVG
 * with a script comes back cleaned, with what was taken out named.
 *
 * The shop's option rows link to the kit's features (`addOnLink`) and hold
 * a price: the kit's read lists that table among those that hand it rows,
 * and a designer whose role reads its link and its price (and not its cost)
 * reads them there with nothing new granted; a reader holds no read of it
 * and is refused.
 *
 * On every engine this run can reach, through the real installer and the
 * whole server, people signing in with a password.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { filesRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cleanSvg } from '../src/files/svg.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { DESIGN_KIT, DESIGN_KIT_FILES, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { woff2 } from './model-files.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const S = 'xmlns="http://www.w3.org/2000/svg"';
const INK = 'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';
/** A piece's outline as a shop might send it: a script, a click handler and Inkscape's name for its layer. */
const DIRTY = `<svg ${S} ${INK} viewBox="0 0 80 40"><script>alert(1)</script><g inkscape:label="Layer 1"><path d="M0 0H80V40H0Z" onclick="steal()"/></g></svg>`;
const CLEAN = `<svg ${S} viewBox="0 0 80 40"><path d="M0 0H80V40H0Z"/></svg>`;

interface Uploaded {
  data: { id: string; filename: string; mime: string; sizeBytes: number };
  ref?: string;
  removed?: string[];
}

describe.each(LEGS)('a design kit\'s page uploads into its own file columns and reads the shop\'s prices — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  /** The tables by their ids here. */
  const ids = { bases: '', fonts: '', options: '' };
  let signIns = 0;
  const people: Record<'designer' | 'reader', { id: string; cookie: string }> = {} as never;

  /** Somebody holding one of the shop's roles, signed in. */
  const person = async (email: string, role: string) => {
    const user = await usersRepo(h.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
    const found = await rolesRepo(h.meta).findBySlug(`printing-${role}`);
    expect(found, `printing-${role}`).not.toBeNull();
    await rolesRepo(h.meta).assignToUser(user.id, found!.id);
    signIns += 1;
    const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.${String(signIns >> 8)}.${String(signIns & 255)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return { id: user.id, cookie: sessionCookie(res.headers['set-cookie']) };
  };
  /** The upload a kit page's `useUpload` sends: the real table, the column, no record (the save attaches it). */
  const send = (who: { cookie: string }, table: string, column: string, bytes: Buffer | string, filename: string) =>
    served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/files?${new URLSearchParams({ filename, connectionId: h.connectionId, table, column }).toString()}`,
      headers: { cookie: who.cookie, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
  /** The save that follows it: the row, with the reference in its column. */
  const save = (who: { cookie: string }, table: string, key: string | number, values: Record<string, unknown>) =>
    served.composed.app.inject({ method: 'PATCH', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table)}/${String(key)}`, headers: { cookie: who.cookie }, payload: { values } });
  const create = (who: { cookie: string }, table: string, values: Record<string, unknown>) =>
    served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table)}`, headers: { cookie: who.cookie }, payload: { values } });
  const kit = (who: { cookie: string }) => served.composed.app.inject({ method: 'GET', url: `/api/v1/add-ons/${DESIGN_KIT}/kit`, headers: { cookie: who.cookie } });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(designKitManifest({}, { uploads: true }), { files: DESIGN_KIT_FILES });
    await h.stageApp(designShopManifest('printing', {}, { prices: true }));
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    const idOf = (name: string): string => model.tables.find((table) => table.name === name)!.id;
    ids.bases = idOf('design_kit_bases');
    ids.fonts = idOf('design_kit_fonts');
    ids.options = idOf('printing_options');
    await h.rows(`INSERT INTO design_kit_bases (id, name, app) VALUES (1, 'Heart tag', 'printing')`);
    await h.rows(`INSERT INTO design_kit_features (id, code, name) VALUES (1, 'logo', 'A logo'), (2, 'engraving', 'Engraving'), (3, 'gift-box', 'A gift box')`);
    await h.rows(`INSERT INTO printing_options (id, name, feature_id, price, cost) VALUES (1, 'Logo', 1, 4.50, 1.20), (2, 'Engraving', 2, 7.00, 2.10), (3, 'Delivery', NULL, 3.95, 3.00)`);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    people.designer = await person('designer@shop.test', 'designer');
    people.reader = await person('reader@shop.test', 'reader');
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('tells the designer it may change a base and add a font, and the reader that it may not', async () => {
    const mine = (await kit(people.designer)).json() as { tables: Record<string, { can: { create: boolean; update: boolean } }> };
    expect(mine.tables['bases']?.can).toMatchObject({ update: true });
    expect(mine.tables['fonts']?.can).toMatchObject({ create: true, update: true });
    const theirs = (await kit(people.reader)).json() as { tables: Record<string, { can: { create: boolean; update: boolean } }> };
    expect(theirs.tables['bases']?.can).toMatchObject({ create: false, update: false });
  });

  it.skipIf(!available)('a designer uploads an outline, the save attaches it to the base, and the bytes are the drawing', async () => {
    const res = await send(people.designer, ids.bases, 'outline_file', CLEAN, 'heart.svg');
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as Uploaded;
    expect(body.data).toMatchObject({ filename: 'heart.svg', mime: 'image/svg+xml' });
    // Nothing was taken out of a clean drawing, and the reply says so.
    expect(body.removed).toEqual([]);
    const ref = body.ref ?? body.data.id;
    // Until the save, it is the uploader's and no row's.
    expect((await filesRepo(h.meta).findById(body.data.id))?.attachedAt).toBeNull();
    const saved = await save(people.designer, ids.bases, 1, { outline_file: ref });
    expect(saved.statusCode, saved.body).toBe(200);
    const file = await filesRepo(h.meta).findById(body.data.id);
    expect(file).toMatchObject({ entityTable: ids.bases, entityId: '1' });
    expect(file?.attachedAt).not.toBeNull();
    const [row] = await h.rows('SELECT outline_file FROM design_kit_bases WHERE id = 1');
    expect(row?.['outline_file']).toBe(ref);
    const content = await served.composed.app.inject({ method: 'GET', url: `/api/v1/files/${body.data.id}/content`, headers: { cookie: people.reader.cookie } });
    expect(content.statusCode, content.body).toBe(200);
    expect(content.body).toBe(cleanSvg(Buffer.from(CLEAN)).toString('utf8'));
  });

  it.skipIf(!available)('an outline with a script comes back cleaned, naming what was taken out', async () => {
    const res = await send(people.designer, ids.bases, 'outline_file', DIRTY, 'dirty.svg');
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as Uploaded;
    expect(body.removed).toEqual(['<script>', 'inkscape:*', 'onclick']);
    expect(body.data.sizeBytes).toBe(cleanSvg(Buffer.from(DIRTY)).length);
    const saved = await save(people.designer, ids.bases, 1, { outline_file: body.ref ?? body.data.id });
    expect(saved.statusCode, saved.body).toBe(200);
    const content = await served.composed.app.inject({ method: 'GET', url: `/api/v1/files/${body.data.id}/content`, headers: { cookie: people.designer.cookie } });
    expect(content.body).not.toContain('script');
    expect(content.body).not.toContain('onclick');
    expect(content.body).toContain('d="M0 0H80V40H0Z"');
  });

  it.skipIf(!available)('a designer adds a font and its file; a font is no outline, and an outline no font', async () => {
    const made = await create(people.designer, ids.fonts, { family: 'Shop Serif' });
    expect(made.statusCode, made.body).toBe(201);
    const key = (made.json() as { data: { id: number | string } }).data.id;
    const res = await send(people.designer, ids.fonts, 'file', woff2(), 'ShopSerif.woff2');
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as Uploaded;
    expect(body.data.mime).toBe('font/woff2');
    // Only an SVG says what was taken out of it.
    expect(body).not.toHaveProperty('removed');
    const saved = await save(people.designer, ids.fonts, key, { file: body.ref ?? body.data.id });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await filesRepo(h.meta).findById(body.data.id)).toMatchObject({ entityTable: ids.fonts, entityId: String(key) });
    // Each column takes its own kind and nothing else, by the bytes.
    expect((await send(people.designer, ids.bases, 'outline_file', woff2(), 'font.svg')).statusCode).toBe(415);
    expect((await send(people.designer, ids.fonts, 'file', CLEAN, 'outline.woff2')).statusCode).toBe(415);
  });

  it.skipIf(!available)('refuses an SVG that would draw something else, naming it, and keeps nothing', async () => {
    const count = async (): Promise<number> => Number((await h.meta.db.selectFrom('adminium_files').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst())?.n ?? 0);
    const before = await count();
    const res = await send(people.designer, ids.bases, 'outline_file', `<svg ${S}><foreignObject><p>hi</p></foreignObject></svg>`, 'page.svg');
    expect(res.statusCode, res.body).toBe(415);
    expect((res.json() as { error: { message: string } }).error.message).toContain('foreignObject');
    expect(await count()).toBe(before);
  });

  it.skipIf(!available)('a reader is refused the upload, and the save', async () => {
    const refused = await send(people.reader, ids.bases, 'outline_file', CLEAN, 'heart.svg');
    expect(refused.statusCode, refused.body).toBe(403);
    expect((refused.json() as { error: { details?: { permission?: string } } }).error.details?.permission).toBe(`table:${h.connectionId}:${ids.bases}:update`);
    expect((await send(people.reader, ids.fonts, 'file', woff2(), 'f.woff2')).statusCode).toBe(403);
    // Nor may it put a file the designer uploaded into the row.
    const theirs = (await send(people.designer, ids.bases, 'outline_file', CLEAN, 'heart.svg')).json() as Uploaded;
    expect((await save(people.reader, ids.bases, 1, { outline_file: theirs.ref ?? theirs.data.id })).statusCode).toBe(403);
  });

  it.skipIf(!available)('lists the shop\'s option rows among the tables that hand the kit rows', async () => {
    const reply = (await kit(people.designer)).json() as { hosts: { tableRef: string; id: string; via: string }[] };
    expect(reply.hosts).toContainEqual(expect.objectContaining({ tableRef: 'printing:options', id: ids.options, via: 'link' }));
  });

  it.skipIf(!available)('a designer reads each feature\'s price from the shop\'s option rows, and never what it costs', async () => {
    const where = JSON.stringify({ column: 'feature_id', op: 'in', value: [1, 2] });
    const res = await served.composed.app.inject({
      method: 'GET',
      url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(ids.options)}?${new URLSearchParams({ select: 'feature_id,price', where, order: 'feature_id.asc' }).toString()}`,
      headers: { cookie: people.designer.cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = (res.json() as { data: Record<string, unknown>[] }).data;
    expect(rows.map((row) => [Number(row['feature_id']), Number(row['price'])])).toEqual([
      [1, 4.5],
      [2, 7],
    ]);
    // Asked for every column, the role's read still holds back the cost.
    const all = await served.composed.app.inject({ method: 'GET', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(ids.options)}`, headers: { cookie: people.designer.cookie } });
    expect(all.statusCode, all.body).toBe(200);
    for (const row of (all.json() as { data: Record<string, unknown>[] }).data) {
      expect(row).not.toHaveProperty('cost');
      expect(row).not.toHaveProperty('name');
    }
    // A read is all it is.
    expect((await save(people.designer, ids.options, 1, { price: '0.01' })).statusCode).toBe(403);
  });

  it.skipIf(!available)('a reader holds no read of the shop\'s option rows, and is refused', async () => {
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(ids.options)}`, headers: { cookie: people.reader.cookie } });
    expect(res.statusCode, res.body).toBe(403);
  });
});

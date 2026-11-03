// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOP'S PRODUCT ASSETS ANY VISITOR'S BROWSER MAY LOAD, through the whole
 * server, on every engine this run can reach, from an app installed by the
 * real installer.
 *
 * Staff upload a product's preview model (GLB), its print model (STL or
 * 3MF), its font (WOFF2) and its SVG pieces through the files route; each is
 * read whole as it is uploaded (a model that points outside itself, a zip
 * renamed 3MF, an SVG that could run anything are refused; an SVG's script
 * and event handlers are cleaned away). A visitor's viewer then `fetch`es the
 * model of a product the entry shows, with no key and no session, and never
 * one of a product its conditions hide; each kind is held to its own size.
 */
import { filesRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FILE_COLUMN_MAX_BYTES, PUBLIC_ASSET_MAX_BYTES } from '@adminium/manifest';

import { cleanSvg } from '../src/files/svg.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { binaryStl, glb, goodGlb, threeMf, triangleGltf, woff2 } from './model-files.js';
import { ORIGIN, servePublic, type Served } from './public-lane.helpers.js';
import { makeZip } from './zip-maker.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const S = 'xmlns="http://www.w3.org/2000/svg"';

function shop(): Record<string, unknown> {
  const manifest = invoicingManifest([
    {
      ref: 'products',
      columns: [
        id,
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'published', type: 'bool', default: false },
        { ref: 'preview', type: 'text', nullable: true, rules: { file: { accept: ['glb'], maxBytes: FILE_COLUMN_MAX_BYTES } } },
        { ref: 'print', type: 'text', nullable: true, rules: { file: { accept: ['stl', '3mf'], maxBytes: FILE_COLUMN_MAX_BYTES } } },
        // A column whose own rule takes more than a font visitors are served: the server holds it to the font's cap.
        { ref: 'font', type: 'text', nullable: true, rules: { file: { accept: ['woff2'], maxBytes: 5 * 1024 * 1024 } } },
        { ref: 'pieces', type: 'json', nullable: true, rules: { file: { accept: ['svg'], maxBytes: 2 * 1024 * 1024, maxCount: 12 } } },
        // Staff's own file, shown to visitors as a column but never served as an asset.
        { ref: 'notes', type: 'text', nullable: true, rules: { file: { accept: ['svg', 'pdf'], maxBytes: 1024 * 1024 } } },
        // A column taking a model and a font: each held to its own kind's size.
        { ref: 'kit', type: 'text', nullable: true, rules: { file: { accept: ['glb', 'woff2'], maxBytes: FILE_COLUMN_MAX_BYTES } } },
      ],
    },
  ]);
  manifest['key'] = 'nooks';
  // Product assets and the kinds they are in are read from 0.3.43 on.
  manifest['compatibility'] = { minAdminiumVersion: '0.3.43' };
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'products' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    {
      table: 'products',
      methods: ['GET'],
      select: ['id', 'name', 'preview', 'print', 'font', 'pieces', 'notes', 'kit'],
      filters: [{ column: 'published', op: 'eq', value: true }],
      assets: ['preview', 'print', 'font', 'pieces', 'kit'],
    },
  ];
  return manifest;
}

describe.each(LEGS)('product assets anyone may load — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let cookie: string;
  let base: string;
  let table: string;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.6.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const sendUpload = (bytes: Buffer, filename: string, column: string | null, withTable = true) =>
    served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/files?${new URLSearchParams({ filename, connectionId: h.connectionId, ...(withTable ? { table } : {}), ...(column === null ? {} : { column }) }).toString()}`,
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
  const upload = async (bytes: Buffer, filename: string, column: string | null, withTable = true): Promise<{ ref: string; id: string }> => {
    const res = await sendUpload(bytes, filename, column, withTable);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { ref?: string; data: { id: string } };
    return { ref: body.ref ?? body.data.id, id: body.data.id };
  };
  const product = async (name: string, values: Record<string, unknown>, published = true): Promise<number> => {
    const res = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table)}`, headers: { cookie }, payload: { values: { name, published, ...values } } });
    expect(res.statusCode, res.body).toBe(201);
    return Number((await h.rows(`select max(id) as id from ${h.real('products')}`))[0]!['id']);
  };
  /** A viewer's fetch: no key, no session; from another site's page. */
  const asset = (row: number, column: string, fileId: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' | 'OPTIONS' = 'GET') =>
    served.composed.app.inject({ method, url: `${base}/nooks_products/${String(row)}/${column}/${fileId}`, remoteAddress: fresh(), headers: { origin: 'https://nooks.example', ...headers } });

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shop());
    const keyId = (h.reply['publicAccess'] as { keyId: string }).keyId;
    served = await servePublic(h, keyId, { ADMINIUM_DATA_DIR: h.dataDir });
    const desk = await usersRepo(h.meta).create({ email: 'maker@nooks.dev', name: 'Maker', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    cookie = sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'maker@nooks.dev', password: ADMIN_PASSWORD } })).headers['set-cookie']);
    const config = (await served.get('/config')).json() as { data: { assets?: string; pictures?: string; refs: Record<string, { assets?: string[] }> } };
    expect(config.data.assets).toBe(`/api/v1/public/assets/${keyId}`);
    expect(config.data.pictures).toBeUndefined();
    expect(config.data.refs['nooks_products']?.assets).toEqual(['preview', 'print', 'font', 'pieces', 'kit']);
    base = config.data.assets!;
    table = (await served.composed.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${h.connectionId}`, headers: { cookie } })).json<{ sources: { id: string }[] }>().sources.find((s) => s.id.endsWith('nooks_products'))!.id;
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)("loads the model of a product the entry shows, and never one of a product its conditions hide", async () => {
    const model = goodGlb();
    const shown = await upload(model, 'nook.glb', 'preview');
    const hidden = await upload(goodGlb(400), 'secret.glb', 'preview');
    const row = await product('Library nook', { preview: shown.ref });
    const draft = await product('Unreleased nook', { preview: hidden.ref }, false);

    const res = await asset(row, 'preview', shown.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.equals(model)).toBe(true);
    const stored = (await filesRepo(h.meta).findById(shown.id))!;
    expect(res.headers).toMatchObject({
      'content-type': 'model/gltf-binary',
      'content-length': String(model.length),
      'content-disposition': 'inline; filename="preview.glb"',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'cross-origin',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400, immutable',
      etag: `"a-${stored.sha256}"`,
      'referrer-policy': 'no-referrer',
    });
    expect(res.headers).not.toHaveProperty('set-cookie');
    // Loaded already: 304, nothing sent.
    const again = await asset(row, 'preview', shown.id, { 'if-none-match': `"a-${stored.sha256}"` });
    expect(again.statusCode).toBe(304);
    expect(again.rawPayload.length).toBe(0);
    // The browser's preflight before a fetch with headers of its own, from the app's own pages: answered as the namespace answers one.
    const preflight = await asset(row, 'preview', shown.id, { origin: ORIGIN, 'access-control-request-method': 'GET' }, 'OPTIONS');
    expect(preflight.statusCode).toBeLessThan(300);
    expect(preflight.headers['access-control-allow-origin']).toBe(ORIGIN);

    // The unpublished product: its own model, its id known, is nothing.
    const refused = await asset(draft, 'preview', hidden.id);
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toMatchObject({ error: { code: 'PUBLIC_REF_NOT_FOUND' } });
    // Published, it loads; taken back to draft, it stops.
    await h.rows(`UPDATE ${h.real('products')} SET published = ${dialect === 'postgres' ? 'true' : '1'} WHERE id = ${String(draft)}`);
    expect((await asset(draft, 'preview', hidden.id)).statusCode).toBe(200);
    await h.rows(`UPDATE ${h.real('products')} SET published = ${dialect === 'postgres' ? 'false' : '0'} WHERE id = ${String(draft)}`);
    expect((await asset(draft, 'preview', hidden.id)).statusCode).toBe(404);
    // A column the entry shows but not as assets, a row that names another's file, a file id that is none.
    const note = await upload(Buffer.from(`<svg ${S}><rect width="1" height="1"/></svg>`), 'note.svg', 'notes');
    const noted = await product('Noted nook', { notes: note.ref });
    expect((await asset(noted, 'notes', note.id)).statusCode).toBe(404);
    const other = await product('Other nook', {});
    await h.rows(`UPDATE ${h.real('products')} SET preview = '${shown.ref}' WHERE id = ${String(other)}`);
    for (const reply of [await asset(row, 'notes', shown.id), await asset(other, 'preview', shown.id), await asset(row, 'preview', 'file_00000000000000000000000000'), await asset(999_999, 'preview', shown.id)]) {
      expect(reply.statusCode).toBe(404);
    }
  });

  it.skipIf(!available)('takes print models by their own form: a binary STL whose header starts with "solid", a 3MF; refuses a renamed zip', async () => {
    const stl = binaryStl(4, 'solid exported by a slicer');
    const kept = await upload(stl, 'bracket.stl', 'print');
    const row = await product('Bracket', { print: kept.ref });
    const res = await asset(row, 'print', kept.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('model/stl');
    expect(res.rawPayload.equals(stl)).toBe(true);

    const pkg = threeMf();
    const three = await upload(pkg, 'nook.3mf', 'print');
    expect((await filesRepo(h.meta).findById(three.id))!.mime).toBe('model/3mf');

    const renamed = await sendUpload(makeZip([{ name: 'readme.txt', data: 'hello' }]), 'nook.3mf', 'print');
    expect(renamed.statusCode).toBe(415);
    expect(renamed.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
    expect(renamed.json<{ error: { message: string } }>().error.message).toMatch(/not a 3MF/);
    // A zip bomb: a small file declaring a huge model part, refused before anything is inflated.
    const bomb = await sendUpload(threeMf({ model: { size: 300 * 1024 * 1024 } }), 'bomb.3mf', 'print');
    expect(bomb.statusCode).toBe(415);
    expect(bomb.json<{ error: { message: string } }>().error.message).toMatch(/more than 200 MB/);
  });

  it.skipIf(!available)('refuses a GLB that points outside itself, or needs a decoder', async () => {
    const outside = triangleGltf({ images: [{ uri: 'https://tracker.example/t.png' }] });
    const res = await sendUpload(glb(outside.json, { bin: outside.bin }), 'tracked.glb', 'preview');
    expect(res.statusCode).toBe(415);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/points at files outside it/);
    const draco = triangleGltf({ extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] });
    expect((await sendUpload(glb(draco.json, { bin: draco.bin }), 'draco.glb', 'preview')).statusCode).toBe(415);
  });

  it.skipIf(!available)('cleans an SVG piece as it is uploaded, serves it with a policy that runs nothing, and refuses what could', async () => {
    const piece = `<svg ${S} viewBox="0 0 10 10" onload="alert(1)"><script>alert(document.cookie)</script><path d="M0 0H10V10Z" onclick="steal()"/></svg>`;
    const one = await upload(Buffer.from(piece), 'wall.svg', 'pieces');
    const two = await upload(Buffer.from(`<svg ${S}><rect width="4" height="4" fill="#b85"/></svg>`), 'roof.svg', 'pieces');
    const stored = (await filesRepo(h.meta).findById(one.id))!;
    const cleaned = cleanSvg(Buffer.from(piece));
    expect(cleaned.toString()).toBe(`<svg ${S} viewBox="0 0 10 10"><path d="M0 0H10V10Z"/></svg>`);
    expect(stored.sizeBytes).toBe(cleaned.length);
    const row = await product('Cottage', { pieces: [one.id, two.id] });
    for (const [fileId, bytes] of [[one.id, cleaned], [two.id, null]] as const) {
      const res = await asset(row, 'pieces', fileId);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers).toMatchObject({
        'content-type': 'image/svg+xml',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'x-content-type-options': 'nosniff',
      });
      if (bytes !== null) expect(res.rawPayload.equals(bytes)).toBe(true);
      expect(res.body).not.toMatch(/script|onload|onclick/);
    }
    // What could change the drawing or reach outside it is refused, never quietly cut.
    for (const [svg, said] of [
      [`<svg ${S}><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`, /foreignObject/],
      [`<svg ${S}><use href="https://evil.example/s.svg#a"/></svg>`, /outside the drawing/],
      [`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg ${S}/>`, /DOCTYPE/],
      [`<svg ${S}><text>&nbsp;</text></svg>`, /entity/],
    ] as const) {
      const res = await sendUpload(Buffer.from(svg), 'bad.svg', 'pieces');
      expect(res.statusCode, res.body).toBe(415);
      expect(res.json<{ error: { message: string } }>().error.message).toMatch(said);
    }
  });

  it.skipIf(!available)('refuses, in the column, an SVG that was never cleaned', async () => {
    // Uploaded for the table but no column: kept as sent (the workspace takes SVG), so never cleaned.
    const raw = await upload(Buffer.from(`<svg ${S} onload="x()"><circle r="2"/></svg>`), 'raw.svg', null);
    const res = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table)}`, headers: { cookie }, payload: { values: { name: 'Raw', pieces: [raw.id] } } });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('file-not-here');
  });

  it.skipIf(!available)('serves a font as a font, and holds each kind to its own size where it is chosen', { timeout: 60_000 }, async () => {
    const font = woff2();
    const kept = await upload(font, 'brand.woff2', 'font');
    const row = await product('Branded', { font: kept.ref });
    const res = await asset(row, 'font', kept.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('font/woff2');

    // A font over 2 MB, though the column's own rule takes 5.
    const big = woff2({ size: PUBLIC_ASSET_MAX_BYTES.woff2 + 1024 });
    const refused = await sendUpload(big, 'huge.woff2', 'font');
    expect(refused.statusCode, refused.body).toBe(413);
    expect(refused.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE', details: { publicAsset: true } } });
    expect(refused.json<{ error: { message: string } }>().error.message).toContain("Every visitor's browser loads the files in this column");
    // In a column that takes a model and a font, the font is still held to a font's size once its bytes say it is one.
    const mixed = await sendUpload(big, 'huge.woff2', 'kit');
    expect(mixed.statusCode, mixed.body).toBe(413);
    expect(mixed.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE', details: { maxBytes: PUBLIC_ASSET_MAX_BYTES.woff2 } } });
    expect((await sendUpload(goodGlb(PUBLIC_ASSET_MAX_BYTES.woff2 + 1024), 'kit.glb', 'kit')).statusCode).toBe(201);

    // A model over 30 MB is refused where it is chosen (by the column's own cap while that is below 30 MB).
    const heavy = goodGlb(PUBLIC_ASSET_MAX_BYTES.glb + 1024);
    const tooBig = await sendUpload(heavy, 'heavy.glb', 'preview');
    expect(tooBig.statusCode, tooBig.body).toBe(413);
    if (FILE_COLUMN_MAX_BYTES > PUBLIC_ASSET_MAX_BYTES.glb) expect(tooBig.json()).toMatchObject({ error: { details: { maxBytes: PUBLIC_ASSET_MAX_BYTES.glb, publicAsset: true } } });
    // …and one whose file says it is over 30 MB (saved before its column was held to it) is never served.
    const model = await upload(goodGlb(), 'later.glb', 'preview');
    const shown = await product('Later', { preview: model.ref });
    expect((await asset(shown, 'preview', model.id)).statusCode).toBe(200);
    await h.meta.db.updateTable('adminium_files' as never).set({ sizeBytes: PUBLIC_ASSET_MAX_BYTES.glb + 1 } as never).where('id' as never, '=', model.id as never).execute();
    expect((await asset(shown, 'preview', model.id)).statusCode).toBe(404);
  });
});

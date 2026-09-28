// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PICTURE ANYONE MAY SEE, through the whole server — on every engine this
 * run can reach, from an app installed by the real installer.
 *
 * A dish's photo, uploaded by staff, loads in an `<img>` with no key, no
 * session and no origin: cleaned of where it was taken, served for any page
 * to show and cached, answered 304 when the browser has it. What is not a
 * picture of a row anyone may read is one 404: a dish off the menu, a photo
 * replaced since, a file no picture column names (a neighbour's id is easy to
 * guess), one that is not an image by its bytes, one too big to unpack.
 */
import { filesRepo, publicApiStateRepo, publicKeysRepo, publicScopesRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { cleanPicture } from '../src/public-api/picture.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { jpeg, png, pngChunk } from './picture-images.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function kitchen(): Record<string, unknown> {
  const manifest = invoicingManifest([
    {
      ref: 'menu_items',
      columns: [
        id,
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'image', type: 'text', maxLength: 400, nullable: true, semantic: 'image' },
        { ref: 'available', type: 'bool', default: true },
      ],
    },
  ]);
  manifest['key'] = 'kitchen';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'menu_items' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [{ table: 'menu_items', methods: ['GET'], select: ['id', 'name', 'image'], filters: [{ column: 'available', op: 'eq', value: true }], pictures: ['image'] }];
  return manifest;
}

describe.each(LEGS)('a picture anyone may see — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let cookie: string;
  let base: string;
  let table: string;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.5.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  /** A staff upload of an image for the menu's image column: the value a row keeps, and the file's id. */
  const upload = async (bytes: Buffer, filename: string): Promise<{ ref: string; id: string }> => {
    const res = await served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/files?${new URLSearchParams({ filename, connectionId: h.connectionId, table, column: 'image' }).toString()}`,
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { ref: string; data: { id: string } };
    return { ref: body.ref, id: body.data.id };
  };
  /** A dish written by staff: its photo is attached to it, as every write through Adminium attaches one. */
  const dish = async (name: string, image: string | null, on = true): Promise<number> => {
    const res = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table)}`, headers: { cookie }, payload: { values: { name, image, available: on } } });
    expect(res.statusCode, res.body).toBe(201);
    return Number((await h.rows(`select max(id) as id from ${h.real('menu_items')}`))[0]!['id']);
  };
  const rephoto = async (row: number, image: string) => {
    const res = await served.composed.app.inject({ method: 'PATCH', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table)}/${String(row)}`, headers: { cookie }, payload: { values: { image } } });
    expect(res.statusCode, res.body).toBe(200);
  };
  /** An `<img>`'s request: no key, no session, no origin. */
  const picture = (row: number, fileId: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' = 'GET', address = fresh()) =>
    served.composed.app.inject({ method, url: `${base}/kitchen_menu_items/${String(row)}/image/${fileId}`, remoteAddress: address, headers });

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, kitchen());
    const keyId = (h.reply['publicAccess'] as { keyId: string }).keyId;
    served = await servePublic(h, keyId, { ADMINIUM_DATA_DIR: h.dataDir });
    const desk = await usersRepo(h.meta).create({ email: 'chef@kitchen.dev', name: 'Chef', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    cookie = sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'chef@kitchen.dev', password: ADMIN_PASSWORD } })).headers['set-cookie']);
    const config = (await served.get('/config')).json() as { data: { pictures?: string; refs: Record<string, { pictures?: string[] }> } };
    expect(config.data.pictures).toBe(`/api/v1/public/pictures/${keyId}`);
    expect(config.data.refs['kitchen_menu_items']?.pictures).toEqual(['image']);
    base = config.data.pictures!;
    table = (await served.composed.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${h.connectionId}`, headers: { cookie } })).json<{ sources: { id: string }[] }>().sources.find((s) => s.id.endsWith('kitchen_menu_items'))!.id;
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('loads a dish photo with no key, no session and no origin, cleaned, for any page to show', async () => {
    const photo = png({ text: 'GPS 51.5074 N, 14 Elm Row', exif: true });
    const file = await upload(photo.bytes, 'IMG_2291.png');
    const row = await dish('Grain bowl', file.ref);
    const res = await picture(row, file.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.equals(photo.clean)).toBe(true);
    expect(res.body).not.toContain('Elm Row');
    const etag = cleanPicture(photo.bytes, 'image/png').etag;
    expect(res.headers).toMatchObject({
      'content-type': 'image/png',
      'content-length': String(photo.clean.length),
      'content-disposition': 'inline; filename="image.png"',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'cross-origin',
      'access-control-allow-origin': '*',
      // Kept minutes, not a week: a dish taken off the menu stops showing once they are up.
      'cache-control': 'public, max-age=300, must-revalidate',
      etag,
      'referrer-policy': 'no-referrer',
    });
    expect(res.headers).not.toHaveProperty('set-cookie');
    expect(res.body).not.toContain('IMG_2291');
    // Asked from another site's page: the same picture.
    expect((await picture(row, file.id, { origin: 'https://someone-else.example', referer: 'https://someone-else.example/menu' })).statusCode).toBe(200);
    // The browser has it: 304, nothing sent.
    const again = await picture(row, file.id, { 'if-none-match': etag });
    expect(again.statusCode).toBe(304);
    expect(again.rawPayload.length).toBe(0);
    expect(again.headers['etag']).toBe(etag);
    expect((await picture(row, file.id, { 'if-none-match': '"p1-something-else"' })).statusCode).toBe(200);
    // HEAD: the headers, no bytes.
    const head = await picture(row, file.id, {}, 'HEAD');
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-type']).toBe('image/png');
    expect(head.rawPayload.length).toBe(0);
  });

  it.skipIf(!available)('takes the place and comments out of a photo, and serves a JPEG with HTML after it as a picture still', async () => {
    const photo = jpeg();
    const polyglot = Buffer.concat([photo.bytes, Buffer.from('<html><script>alert(document.cookie)</script></html>', 'latin1')]);
    const file = await upload(polyglot, 'poster.jpg');
    const row = await dish('Poster', file.ref);
    const res = await picture(row, file.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toMatch(/GPS|Elm Row|kitchen/);
    // Nothing after the picture's end is served: the page pasted on it goes.
    expect(res.body).not.toContain('<script>');
    expect(res.rawPayload.equals(photo.clean)).toBe(true);
    expect(res.headers).toMatchObject({ 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
  });

  it.skipIf(!available)('answers one 404 for a dish off the menu, a photo since replaced, and a file no picture names', async () => {
    const first = await upload(png({ fill: 10 }).bytes, 'a.png');
    const second = await upload(png({ fill: 20 }).bytes, 'b.png');
    const hidden = await dish('Off the menu', first.ref, false);
    expect((await picture(hidden, first.id)).statusCode).toBe(404);
    const row = await dish('Soup', first.ref);
    expect((await picture(row, first.id)).statusCode).toBe(200);
    await rephoto(row, second.ref);
    const replaced = await picture(row, first.id);
    expect(replaced.statusCode).toBe(404);
    expect((await picture(row, second.id)).statusCode).toBe(200);
    // A staff file no picture column names: its id, even beside a public dish's, is nothing.
    const privateFile = await upload(png({ fill: 30 }).bytes, 'payroll.png');
    expect((await picture(row, privateFile.id)).statusCode).toBe(404);
    // Every refusal says the same.
    for (const res of [replaced, await picture(row, privateFile.id), await picture(999_999, second.id), await picture(row, 'file_00000000000000000000000000')]) {
      expect(res.json()).toMatchObject({ error: { code: 'PUBLIC_REF_NOT_FOUND' } });
    }
  });

  it.skipIf(!available)('never serves a file another row’s column was made to name', async () => {
    const photo = await upload(png({ fill: 40 }).bytes, 'mine.png');
    const mine = await dish('Mine', photo.ref);
    expect((await picture(mine, photo.id)).statusCode).toBe(200);
    // Another dish's column written by hand to name the first dish's file: the file is not that row's.
    const other = await dish('Other', null);
    await h.rows(`UPDATE ${h.real('menu_items')} SET image = '${photo.ref}' WHERE id = ${String(other)}`);
    const borrowed = await picture(other, photo.id);
    expect(borrowed.statusCode).toBe(404);
    expect(borrowed.json()).toMatchObject({ error: { code: 'PUBLIC_REF_NOT_FOUND' } });
  });

  it.skipIf(!available)('never serves a file that is not a picture by its bytes, or one too big to be one', async () => {
    // An SVG a destination swapped in (or one staff uploaded where a workspace allows it) — even one served before.
    const swapped = await upload(png().bytes, 'logo.png');
    const logo = await dish('Logo', swapped.ref);
    expect((await picture(logo, swapped.id)).statusCode).toBe(200);
    expect(await filesRepo(h.meta).findById(swapped.id)).not.toBeNull();
    await h.meta.db.updateTable('adminium_files' as never).set({ mime: 'image/svg+xml' } as never).where('id' as never, '=', swapped.id as never).execute();
    expect((await picture(logo, swapped.id)).statusCode).toBe(404);
    // Bytes that are not what the file says.
    const liar = await upload(png().bytes, 'photo.png');
    await h.meta.db.updateTable('adminium_files' as never).set({ mime: 'image/jpeg' } as never).where('id' as never, '=', liar.id as never).execute();
    expect((await picture(await dish('Liar', liar.ref), liar.id)).statusCode).toBe(404);
    // 9000 pixels wide.
    const wide = await upload(png({ width: 9000, height: 10 }).bytes, 'wide.png');
    expect((await picture(await dish('Wide', wide.ref), wide.id)).statusCode).toBe(404);
    // More than 2 MiB.
    const whole = png().bytes;
    const big = Buffer.concat([whole.subarray(0, whole.length - 12), pngChunk('tEXt', Buffer.alloc(2 * 1024 * 1024, 65)), whole.subarray(whole.length - 12)]);
    const heavy = await upload(big, 'big.png');
    expect((await picture(await dish('Heavy', heavy.ref), heavy.id)).statusCode).toBe(404);
  });

  it.skipIf(!available)('answers fifty browsers asking at once, cleaning the picture once', async () => {
    const file = await upload(png({ width: 60, height: 60, text: 'x'.repeat(100_000) }).bytes, 'hero.png');
    const row = await dish('Hero', file.ref);
    const replies = await Promise.all(Array.from({ length: 50 }, () => picture(row, file.id)));
    expect(replies.map((r) => r.statusCode)).toEqual(Array.from({ length: 50 }, () => 200));
    expect(new Set(replies.map((r) => r.headers['etag'])).size).toBe(1);
  });

  it.skipIf(!available)('stops with the public API, and for a key that is none', { timeout: 30_000 }, async () => {
    const file = await upload(png().bytes, 'x.png');
    const row = await dish('Toast', file.ref);
    expect((await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/pictures/pk_nope/kitchen_menu_items/${String(row)}/image/${file.id}`, remoteAddress: fresh() })).statusCode).toBe(404);
    await settingsRepo(h.meta).set('publicApi.enabled', false);
    try {
      // The switch is read through a cache of a few seconds (a Studio flip clears it at once).
      await new Promise((resolve) => setTimeout(resolve, 5_200));
      const off = await picture(row, file.id);
      expect(off.statusCode).toBe(503);
      expect(off.json()).toMatchObject({ error: { code: 'PUBLIC_API_DISABLED' } });
    } finally {
      await settingsRepo(h.meta).set('publicApi.enabled', true);
      await new Promise((resolve) => setTimeout(resolve, 5_200));
    }
  });

  it.runIf(available && dialect === 'sqlite')('refuses the 1201st picture a minute from one address, an IPv6 network counted as one', async () => {
    const file = await upload(png().bytes, 'y.png');
    const row = await dish('Crumb', file.ref);
    // Two addresses of one /64: one visitor, as far as pictures go.
    const addresses = ['2001:db8:5:7::1', '2001:db8:5:7::2'];
    let last = 0;
    for (let i = 0; i < 1201; i += 1) last = (await picture(row, file.id, {}, 'GET', addresses[i % 2])).statusCode;
    expect(last).toBe(429);
    // Another address is not held to it.
    expect((await picture(row, file.id)).statusCode).toBe(200);
  }, 120_000);

  it.skipIf(!available)("shows nothing of rows a session's holder alone reads, whatever the key's scope says", { timeout: 60_000 }, async () => {
    const file = await upload(png({ fill: 50 }).bytes, 'staff-meal.png');
    const row = await dish('Staff meal', file.ref);
    expect((await picture(row, file.id)).statusCode).toBe(200);
    // A scope written by hand, where no check of the entry's shape runs: its rows for a session's holder alone.
    const key = (await publicKeysRepo(h.meta).findById((h.reply['publicAccess'] as { keyId: string }).keyId))!;
    const scopes = publicScopesRepo(h.meta);
    const scope = (await scopes.findById(key.scopeId))!;
    const doc = JSON.parse(scope.document) as { resources: { ref: string; sessionOnly?: boolean }[] };
    doc.resources.find((resource) => resource.ref === 'kitchen_menu_items')!.sessionOnly = true;
    // A save elsewhere reaches this server's keys when its switch is next read (a cache of a few seconds).
    const settle = async () => {
      await publicApiStateRepo(h.meta).bump();
      await new Promise((resolve) => setTimeout(resolve, 5_200));
    };
    await scopes.update(scope.id, { document: JSON.stringify(doc) });
    await settle();
    try {
      // An <img> carries no session: the picture is answered as the rows are, to a visitor with none.
      const res = await picture(row, file.id);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'PUBLIC_REF_NOT_FOUND' } });
      expect((await served.get('/records/kitchen_menu_items')).statusCode).toBe(404);
    } finally {
      await scopes.update(scope.id, { document: scope.document });
      await settle();
    }
    expect((await picture(row, file.id)).statusCode).toBe(200);
  });

  // Last: a second server on the same stores closes the connections they share when it stops.
  it.skipIf(!available)('keeps a picture cleaned once beside its file, and serves it from there after a restart', async () => {
    const photo = png({ width: 12, height: 12, text: 'GPS 51.5074 N, 14 Elm Row' });
    const file = await upload(photo.bytes, 'kept.png');
    const row = await dish('Kept', file.ref);
    const first = await picture(row, file.id);
    expect(first.statusCode, first.body).toBe(200);
    const etag = first.headers['etag'] as string;
    // The original's bytes gone: only a kept copy could still answer.
    const stored = (await filesRepo(h.meta).findById(file.id))!;
    await rm(join(h.dataDir, 'files', stored.storageKey), { force: true });
    const restarted = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId, { ADMINIUM_DATA_DIR: h.dataDir });
    try {
      const ask = (headers: Record<string, string> = {}) =>
        restarted.composed.app.inject({ method: 'GET', url: `${base}/kitchen_menu_items/${String(row)}/image/${file.id}`, remoteAddress: fresh(), headers });
      // Seen already: 304 from the copy's first bytes, before anything else is opened.
      const seen = await ask({ 'if-none-match': etag });
      expect(seen.statusCode).toBe(304);
      expect(seen.headers['etag']).toBe(etag);
      const again = await ask();
      expect(again.statusCode, again.body).toBe(200);
      expect(again.rawPayload.equals(photo.clean)).toBe(true);
      expect(again.headers['etag']).toBe(etag);
      expect(again.headers['content-length']).toBe(String(photo.clean.length));
      expect(again.body).not.toContain('Elm Row');
    } finally {
      await restarted.close();
    }
  });
});

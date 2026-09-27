// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A dish's photo, uploaded by staff, shown by an `<img>` on a page of ANOTHER
 * site, in a real browser, through the built server.
 *
 * The server's own pages are kept to themselves by a header every response
 * carries (a resource may be read by the same site only); a browser that meets
 * it on a picture draws nothing, and nothing says why. So what only a browser
 * can show is proved here: the picture draws, from a page on another origin,
 * with no key, no session and no cookie.
 *
 * The app makes `e2e_kitchen_*` tables on the seeded connection, and the test
 * uninstalls it with its tables (`afterAll` too, after a failure).
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';

import { expect, test, type APIResponse } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { BASE_URL } from './constants.js';
import { seededConnectionId } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const KEY = 'e2e-kitchen';
const VERSION = '1.0.0';

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: KEY,
  name: 'E2E Kitchen',
  version: VERSION,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A menu with photos.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  pages: [{ ref: 'e2e-kitchen-menu', template: 'page-crud', title: { key: 't', fallback: 'Menu' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'menu_items' } }],
  frontends: [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ],
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'menu_items',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 80 },
          { ref: 'image', type: 'text', maxLength: 400, nullable: true, semantic: 'image' },
          { ref: 'available', type: 'bool', default: true },
        ],
      },
    ],
  },
  publicAccess: [{ table: 'menu_items', methods: ['GET'], select: ['id', 'name', 'image'], filters: [{ column: 'available', op: 'eq', value: true }], pictures: ['image'] }],
};

/** A 24 × 16 PNG of one colour, with a text chunk a camera might have written. */
function photo(): Buffer {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.from(type, 'latin1');
    return Buffer.concat([u32(data.length), head, data, u32(crc32(Buffer.concat([head, data])))]);
  };
  const [width, height] = [24, 16];
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 180)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])])),
    chunk('tEXt', Buffer.from('Comment\0taken at 14 Elm Row', 'latin1')),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function ok<T = unknown>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

test.describe('a picture anyone may see', () => {
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    await context.request.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
    await context.request.put('/api/v1/public-api', { data: { enabled: false } }).catch(() => undefined);
    await context.close();
  });

  test('draws on a page of another site, with no key, session or cookie', async ({ page, playwright }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    const connectionId = await seededConnectionId(page);
    const staff = page.request;
    await ok(await staff.put('/api/v1/public-api', { data: { enabled: true } }));

    const bundle = bundleOf({
      'package.json': JSON.stringify({ name: `@adminium-apps/${KEY}`, version: VERSION }),
      'manifest.json': JSON.stringify(MANIFEST),
      'staff/index.html': '<!doctype html><html><body data-app="e2e-kitchen-staff"></body></html>',
      'customer/index.html': '<!doctype html><html><body data-app="e2e-kitchen-customer"></body></html>',
    });
    await ok(await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(bundle.integrity)}`, { headers: { 'content-type': 'application/octet-stream' }, data: bundle.buffer }));
    await ok(await staff.post('/api/v1/apps/install', { data: { key: KEY, version: VERSION, connectionId } }));
    const schema = await ok<{ model: { tables: { id: string; name: string }[] } }>(await staff.get(`/api/v1/connections/${connectionId}/schema`));
    const table = schema.model.tables.find((t) => t.name === 'e2e_kitchen_menu_items')!.id;

    // Staff upload the dish's photo and put it on the menu.
    const file = await ok<{ ref: string }>(
      await staff.post(`/api/v1/files?${new URLSearchParams({ filename: 'IMG_2291.png', connectionId, table, column: 'image' }).toString()}`, {
        headers: { 'content-type': 'application/octet-stream' },
        data: photo(),
      }),
      201,
    );
    const dish = await ok<{ data: { id: number } }>(await staff.post(`/api/v1/data/${connectionId}/${encodeURIComponent(table)}`, { data: { values: { name: 'Grain bowl', image: file.ref } } }), 201);

    // Where the key's pictures are: from its config, as a page reads it.
    const anonymous = await playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const surface = await ok<{ publishableKey: string }>(await anonymous.get(`/apps/${KEY}/customer/surface-config.json`));
    const config = await ok<{ data: { pictures?: string } }>(await anonymous.get('/api/v1/public/config', { headers: { authorization: `Bearer ${surface.publishableKey}`, origin: BASE_URL } }));
    expect(config.data.pictures).toMatch(/^\/api\/v1\/public\/pictures\//);
    const fileId = /(file_[0-9A-Z]{26})/.exec(file.ref)![1]!;
    const src = `${BASE_URL}${config.data.pictures!}/e2e_kitchen_menu_items/${String(dish.data.id)}/image/${fileId}`;
    // Fetched with nothing at all: the picture.
    const bare = await anonymous.get(src);
    expect(bare.status(), await bare.text()).toBe(200);
    expect(bare.headers()['cross-origin-resource-policy']).toBe('cross-origin');
    await anonymous.dispose();

    /*
     * A page on another site, in a browser with nothing of this server's:
     * another host name and port, served on this machine — plain http, as the
     * test server is (a secure page loads no picture over http), and local (a
     * browser keeps a page from elsewhere from reaching a local server at all).
     */
    const site = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><html><body><img id="dish" alt="Grain bowl" src="${src}"></body></html>`);
    });
    await new Promise<void>((resolve) => site.listen(0, 'localhost', resolve));
    const elsewhere = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await elsewhere.newPage();
    await guest.goto(`http://localhost:${String((site.address() as AddressInfo).port)}/`);
    const drawn = await guest.locator('#dish').evaluate(
      (img: HTMLImageElement) =>
        new Promise<{ width: number; height: number }>((resolve) => {
          const done = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          if (img.complete) done();
          else {
            img.addEventListener('load', done);
            img.addEventListener('error', done);
          }
        }),
    );
    expect(drawn).toEqual({ width: 24, height: 16 });
    await elsewhere.close();
    await new Promise((resolve) => site.close(resolve));

    // Off the menu: the same address draws nothing.
    await ok(await staff.patch(`/api/v1/data/${connectionId}/${encodeURIComponent(table)}/${String(dish.data.id)}`, { data: { values: { available: false } } }));
    const gone = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
    expect((await gone.get(src)).status()).toBe(404);
    await gone.dispose();

    await ok(await staff.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }));
  });
});

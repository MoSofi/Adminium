// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FILE SHIPPED BESIDE AN ADD-ON PAGE'S CODE — a starter font, a picture,
 * their licence — is fetched by the page from its own folder, behind the
 * page's own gates: given to somebody whose role opens the page, refused to
 * somebody whose roles do not (and to nobody), gone while the add-on is
 * switched off. Only a kind of file a page draws with, served as what it is
 * and never as a script; nothing outside the page's folder, no step up, no
 * file the package was not verified to hold.
 */
import { rolesRepo, usersRepo, type User } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const FONT = 'wOF2-starter-font-bytes';
const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
function kit(): Record<string, unknown> {
  const doc = stockKitManifest() as Record<string, unknown> & { addOn: Record<string, unknown> };
  doc.addOn = { ...doc.addOn, pages: [{ ref: 'stock-kit-count', title: { key: 'stock.count', fallback: 'Count' }, icon: 'clipboard', client: 'dist/pages/count.js', nav: { group: 'library', order: 5 } }] };
  return doc;
}
const FILES = {
  'dist/pages/count.js': 'export default function Count() { return null; }',
  'dist/pages/fonts/Starter.woff2': FONT,
  'dist/pages/fonts/OFL.txt': 'SIL Open Font License',
  'dist/pages/mark.svg': PICTURE,
  'dist/pages/helper.js': 'export const x = 1;',
  'dist/secret.woff2': 'outside the folder',
};

async function installed(): Promise<Harness> {
  const harness = await addOnHarness('sqlite', { unbuiltWords: {} });
  await harness.stageAddOn(kit(), { files: FILES });
  const reply = await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
  expect(reply.statusCode, reply.body).toBe(200);
  return harness;
}
async function person(harness: Harness, role: 'stock-kit-manager' | 'stock-kit-reader' | null): Promise<User> {
  const user = await usersRepo(harness.meta).create({ email: `${role ?? 'nobody'}@test`, name: role ?? 'Nobody' });
  if (role !== null) await rolesRepo(harness.meta).assignToUser(user.id, (await rolesRepo(harness.meta).findBySlug(role))!.id);
  return user;
}
/** One file, as the harness answers (its reply carries the headers too). */
const file = async (harness: Harness, path: string, as?: User | null) =>
  (await harness.inject({ method: 'GET', url: `/add-ons/stock-kit/pages/stock-kit-count/files/${path}`, ...(as === undefined ? {} : { as }) })) as Awaited<ReturnType<Harness['inject']>> & { headers: Record<string, string | string[] | undefined> };

describe('a file shipped beside a page\'s code', () => {
  it('is given to somebody whose role opens the page, as what it is', async () => {
    h = await installed();
    const manager = await person(h, 'stock-kit-manager');
    const font = await file(h, 'fonts/Starter.woff2', manager);
    expect(font.statusCode, font.body).toBe(200);
    expect(font.body).toBe(FONT);
    expect(font.headers['content-type']).toBe('font/woff2');
    expect(font.headers['x-content-type-options']).toBe('nosniff');
    expect((await file(h, 'fonts/OFL.txt', manager)).headers['content-type']).toBe('text/plain; charset=utf-8');
    const picture = await file(h, 'mark.svg', manager);
    expect(picture.statusCode).toBe(200);
    expect(picture.headers['content-type']).toBe('image/svg+xml');
    // Opened on its own, it runs nothing.
    expect(String(picture.headers['content-security-policy'])).toMatch(/^sandbox; default-src 'none'/);
  });

  it('is refused to somebody whose roles do not open the page, and to nobody', async () => {
    h = await installed();
    for (const who of [await person(h, 'stock-kit-reader'), await person(h, null)]) expect((await file(h, 'fonts/Starter.woff2', who)).statusCode).toBe(403);
    expect((await file(h, 'fonts/Starter.woff2', null)).statusCode).toBe(401);
  });

  it('is not there while the add-on is switched off for the dashboard', async () => {
    h = await installed();
    const manager = await person(h, 'stock-kit-manager');
    expect((await h.inject({ method: 'PATCH', url: '/add-ons/stock-kit', payload: { attachedTo: 'dashboard', enabled: false } })).statusCode).toBe(200);
    expect((await file(h, 'fonts/Starter.woff2', manager)).statusCode).toBe(404);
  });

  it('is never a script, a file outside the page\'s folder, a step up, or a file the package does not hold', async () => {
    h = await installed();
    const manager = await person(h, 'stock-kit-manager');
    for (const path of ['helper.js', 'count.js', '../secret.woff2', 'fonts/../../secret.woff2', '%2e%2e/secret.woff2', 'fonts/Missing.woff2', 'fonts//Starter.woff2']) {
      const reply = await file(h, path, manager);
      expect(reply.statusCode, path).toBe(404);
      expect(reply.body, path).not.toContain('outside the folder');
    }
  });
});

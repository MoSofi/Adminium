// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CODE OF AN ADD-ON'S PAGE IS THE PAGE. An add-on that installs like an
 * app keeps each page of its code behind that page's own permission: the
 * address its code is served from answers 403 to anybody who lacks it. Its
 * slot fills load for anybody signed in, as they must (they draw inside other
 * pages). An add-on released before keeps its pages open to anybody signed
 * in, at the address it always had.
 */
import { permissionsRepo, rolesRepo, usersRepo, type User } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const PAGE = 'export default function Count() { return null; }';
const FILL = 'export const register = () => {};';
/** The stock kit with a slot fill beside its page, each in a file of its own. */
function kit(): Record<string, unknown> {
  const doc = stockKitManifest() as Record<string, unknown> & { addOn: Record<string, unknown> };
  doc.addOn = { ...doc.addOn, pages: [{ ref: 'stock-kit-count', title: { key: 'stock.count', fallback: 'Count' }, icon: 'clipboard', client: 'dist/count.js', nav: { group: 'library', order: 5 } }], slots: [{ slot: 'settings.add-on.panel', client: 'dist/fill.js', order: 10 }] };
  return doc;
}
const FILES = { 'dist/count.js': PAGE, 'dist/fill.js': FILL };

async function installed(): Promise<Harness> {
  const harness = await addOnHarness('sqlite', { unbuiltWords: {} });
  await harness.stageAddOn(kit(), { files: FILES });
  const reply = await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
  expect(reply.statusCode, reply.body).toBe(200);
  return harness;
}
/** Somebody signed in who holds one of the kit's roles, or none. */
async function person(harness: Harness, role: 'stock-kit-manager' | 'stock-kit-reader' | null): Promise<User> {
  const user = await usersRepo(harness.meta).create({ email: `${role ?? 'nobody'}@test`, name: role ?? 'Nobody' });
  if (role !== null) await rolesRepo(harness.meta).assignToUser(user.id, (await rolesRepo(harness.meta).findBySlug(role))!.id);
  return user;
}
const pageCode = (harness: Harness, as?: User | null) => harness.inject({ method: 'GET', url: '/add-ons/stock-kit/pages/stock-kit-count/bundle', ...(as === undefined ? {} : { as }) });

describe('the code of a page kept behind its permission', () => {
  it('is given to somebody whose role opens the page, with the fingerprint a host pins', async () => {
    h = await installed();
    const reply = await pageCode(h, await person(h, 'stock-kit-manager'));
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.body).toBe(PAGE);
    const listed = (await h.inject({ method: 'GET', url: '/add-ons' })).json().addOns.find((entry: { key: string }) => entry.key === 'stock-kit');
    // The list names one address a page, and it is the gated one.
    expect(listed.bundles).toContainEqual(expect.objectContaining({ path: 'dist/count.js', ref: 'stock-kit-count', url: '/api/v1/add-ons/stock-kit/pages/stock-kit-count/bundle' }));
    expect(listed.bundles.filter((bundle: { path: string }) => bundle.path === 'dist/count.js')).toHaveLength(1);
  });

  it('answers 403 to somebody signed in whose roles do not open it, and 401 to nobody', async () => {
    h = await installed();
    // The reader's role opens the kit's generated page, not this one.
    for (const who of [await person(h, 'stock-kit-reader'), await person(h, null)]) {
      const reply = await pageCode(h, who);
      expect(reply.statusCode, reply.body).toBe(403);
      expect(reply.json().error).toMatchObject({ code: 'FORBIDDEN', details: { page: 'stock-kit-count' } });
      expect(reply.body).not.toContain('export default');
    }
    expect((await pageCode(h, null)).statusCode).toBe(401);
  });

  it('opens for a role of the owner\'s own once it is granted the page, by the page\'s ref', async () => {
    h = await installed();
    // What the Roles screen's save sends is this grant; the page has no row of its own, so its ref is the name.
    const { rows, invalid } = matrixRowsFromGrants(['page:stock-kit-count:view']);
    expect(invalid).toEqual([]);
    expect(rows).toMatchObject([{ resourceKind: 'page', resourceRef: 'stock-kit-count' }]);
    const role = await rolesRepo(h.meta).create({ slug: 'counter', name: 'Counter' } as never);
    const who = await person(h, null);
    await rolesRepo(h.meta).assignToUser(who.id, role.id);
    expect((await pageCode(h, who)).statusCode).toBe(403);
    for (const row of rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions);
    expect((await pageCode(h, who)).statusCode).toBe(200);
  });

  it('is not served from the address slot fills use, to anybody', async () => {
    h = await installed();
    for (const who of [undefined, await person(h, 'stock-kit-manager')]) {
      const reply = await h.inject({ method: 'GET', url: '/add-ons/stock-kit/bundle/dist/count.js', ...(who === undefined ? {} : { as: who }) });
      expect(reply.statusCode, reply.body).toBe(404);
    }
  });

  it('a slot fill loads for somebody with none of the add-on\'s roles', async () => {
    h = await installed();
    const reply = await h.inject({ method: 'GET', url: '/add-ons/stock-kit/bundle/dist/fill.js', as: await person(h, null) });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.body).toBe(FILL);
  });

  it('a page nobody declared is not there, whoever asks', async () => {
    h = await installed();
    expect((await h.inject({ method: 'GET', url: '/add-ons/stock-kit/pages/stock-kit-items/bundle' })).statusCode).toBe(404);
    expect((await h.inject({ method: 'GET', url: '/add-ons/absent/pages/x/bundle' })).statusCode).toBe(404);
  });
});

describe('an add-on released before pages were kept behind a permission', () => {
  /** As Invoices 1.0.7 is: no tables, no roles, one page, the floor of its day. */
  const before = (): Record<string, unknown> => ({
    kind: 'add-on',
    manifestVersion: 1,
    key: 'papers',
    name: 'Papers',
    version: '1.0.7',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'papers.line', fallback: 'Prints.' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, hostApi: 1, pages: [{ ref: 'documents', title: { key: 'papers.nav', fallback: 'Papers' }, icon: 'file', client: 'dist/count.js', nav: { group: 'library', order: 20 } }] },
  });

  it('serves its page to anybody signed in, at the address it always had and at the page\'s own', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(before(), { files: { 'dist/count.js': PAGE } });
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'papers', version: '1.0.7', attachTo: [] } })).statusCode).toBe(200);
    const nobody = await usersRepo(h.meta).create({ email: 'nobody@test', name: 'Nobody' });
    const old = await h.inject({ method: 'GET', url: '/add-ons/papers/bundle/dist/count.js', as: nobody });
    expect(old.statusCode, old.body).toBe(200);
    expect(old.body).toBe(PAGE);
    expect((await h.inject({ method: 'GET', url: '/add-ons/papers/pages/documents/bundle', as: nobody })).statusCode).toBe(200);
    expect((await h.inject({ method: 'GET', url: '/add-ons/papers/bundle/dist/count.js', as: null })).statusCode).toBe(401);
    // The list still names the one address it always named, and no page ref.
    const listed = (await h.inject({ method: 'GET', url: '/add-ons' })).json().addOns.find((entry: { key: string }) => entry.key === 'papers');
    expect(listed.bundles).toEqual([expect.objectContaining({ path: 'dist/count.js', url: '/api/v1/add-ons/papers/bundle/dist/count.js' })]);
    expect(listed.bundles[0]).not.toHaveProperty('ref');
  });
});

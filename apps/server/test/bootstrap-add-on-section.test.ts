// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN SECTION OF THE RAIL. An add-on that installs like an app
 * has a section as an app has: its generated pages and the pages of its code,
 * in one order, under its own groups. Each page of its code is kept behind
 * its own permission: a reader who lacks it is told nothing of the page. An
 * add-on from before keeps its page in the shared rail, open to anybody
 * signed in.
 */
import { manifestsRepo, newId, permissionsRepo, rolesRepo, usersRepo, writeBool, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rbacPlugin } from '../src/plugins/rbac.js';
import { pagesAreGated } from '../src/add-ons/page-gate.js';
import { buildAddOnNav, buildAddOnSections } from '../src/routes/bootstrap/handlers.js';
import { bootstrapAppSection, bootstrapNavItem } from '../src/routes/bootstrap/schema.js';
import { ADMIN_PASSWORD, adminPasswordHash, buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const title = (fallback: string) => ({ key: `kit.${fallback.toLowerCase()}`, fallback });

/** An add-on built for a server that installs it like an app: two generated pages, three pages of code, two groups. */
function kit(floor = '0.3.18'): Record<string, unknown> {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'kit',
    name: 'Kit',
    version: '1.2.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: title('Line'),
    categories: ['data'],
    compatibility: { minAdminiumVersion: floor },
    addOn: {
      attaches: [{ app: '*', range: '*' }],
      connect: { kind: 'none' },
      hostApi: 1,
      navGroups: [{ key: 'kit-stock', label: title('Stock (code)'), order: 5 }],
      pages: [
        { ref: 'kit-count', title: title('Count'), icon: 'clipboard', client: 'dist/count.js', nav: { group: 'kit-stock', order: 15 } },
        { ref: 'kit-report', title: title('Report'), icon: 'chart', client: 'dist/report.js', nav: { group: 'library', order: 30 } },
        // No place in the rail: reached by a button on another page.
        { ref: 'kit-transfer', title: title('Transfer'), icon: 'move', client: 'dist/transfer.js' },
      ],
    },
    requiredSchema: { prefixed: true, tables: [{ ref: 'items', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] }] },
    navGroups: [
      { key: 'kit-stock', label: { 'en-US': 'Stock', 'de-DE': 'Bestand' }, order: 1 },
      { key: 'kit-setup', label: { 'en-US': 'Setup' }, order: 2 },
    ],
    pages: [
      { ref: 'kit-items', template: 'page-crud', title: title('Items'), nav: { group: 'kit-stock', icon: 'box', order: 10 }, bindings: { main: 'items' } },
      { ref: 'kit-overview', template: 'page-crud', title: title('Overview'), nav: { group: 'manage', icon: 'house', order: 1 }, bindings: { main: 'items' } },
    ],
    roles: [{ key: 'manager', name: 'Kit manager', permissions: ['table:@items:read', 'page:@kit-items:view', 'page:@kit-count:view'] }],
  };
}

const generated = (slug: string, order: number, group: string | null) => ({
  group,
  item: { pageId: `page_${slug}`, slug, labelKey: `nav.${slug}`, fallback: slug, icon: 'box', order, connectionId: 'c1', connectionName: 'Shop', currency: null, sourceTable: 'public.kit_items', appKey: null, addOnKey: 'kit' },
});

describe('an add-on\'s section, built from what was read', () => {
  const addOns = [{ key: 'kit', version: '1.2.0', document: kit() }];
  const appItems = new Map([['kit', [generated('kit-items', 10, 'kit-stock'), generated('kit-overview', 1, 'manage')]]]);

  it('holds its generated pages and the pages of its code in one order, under its own groups', () => {
    const nav = buildAddOnNav([{ document: kit() }]);
    const [section, ...more] = buildAddOnSections({ addOns, appItems, codePages: nav.pages, locale: 'en-US' });
    expect(more).toEqual([]);
    expect(section).toMatchObject({ kind: 'add-on', appKey: 'kit', label: 'Kit', version: '1.2.0', staff: null });
    // The page in none of its groups first, under no heading; then the group, generated and code pages by their order.
    expect(section!.groups.map((group) => [group.key, group.label, group.items.map((item) => item.addOnPage?.ref ?? item.slug)])).toEqual([
      ['', null, ['kit-overview']],
      ['kit-stock', 'Stock', ['kit-items', 'kit-count']],
    ]);
    // A page of its code opens at the add-on's own route: no slug, its ref for an id, and no app's key.
    expect(section!.groups[1]!.items[1]).toMatchObject({ pageId: 'kit-count', slug: '', addOnKey: 'kit', appKey: null, addOnPage: { key: 'kit', ref: 'kit-count' }, fallback: 'Count', order: 15 });
    expect(() => bootstrapAppSection.parse(section)).not.toThrow();
  });

  it('the top-level label wins, in the reader\'s language', () => {
    const [section] = buildAddOnSections({ addOns, appItems, codePages: buildAddOnNav([{ document: kit() }]).pages, locale: 'de-DE' });
    expect(section!.groups[1]!.label).toBe('Bestand');
  });

  it('a page in its section is marked so, and its group heads nothing in the shared rail; a page in a built-in group stays there', () => {
    const nav = buildAddOnNav([{ document: kit() }]);
    expect(nav.pages.map((page) => [page.ref, page.inSection, page.unlisted, page.group])).toEqual([
      ['kit-transfer', false, true, 'library'],
      ['kit-count', true, false, 'kit-stock'],
      ['kit-report', false, false, 'library'],
    ]);
    expect(nav.groups).toEqual([]);
  });

  it('a reader without a page\'s permission is told nothing of it: no row, no unlisted entry', () => {
    const nav = buildAddOnNav([{ document: kit() }], (ref) => ref === 'kit-report');
    expect(nav.pages.map((page) => page.ref)).toEqual(['kit-report']);
    const sections = buildAddOnSections({ addOns, appItems: new Map(), codePages: nav.pages, locale: 'en-US' });
    // Nothing of its section is left to draw.
    expect(sections).toEqual([]);
  });

  it('an add-on from before the install floor asks nobody: its page is in the shared rail for everyone', () => {
    const before = kit('0.3.1');
    expect(pagesAreGated(before as never)).toBe(false);
    expect(pagesAreGated(kit() as never)).toBe(true);
    const old = { ...before, navGroups: undefined, pages: undefined, roles: undefined, requiredSchema: undefined, addOn: { ...(before['addOn'] as object), pages: [{ ref: 'documents', title: title('Invoices'), icon: 'file', client: 'dist/i.js', nav: { group: 'library', order: 20 } }], navGroups: undefined } };
    const nav = buildAddOnNav([{ document: JSON.parse(JSON.stringify(old)) }], () => false);
    expect(nav.pages.map((page) => [page.ref, page.inSection])).toEqual([['documents', false]]);
  });

  it('the reply\'s schema keeps the add-on\'s mark on a page', () => {
    const parsed = bootstrapNavItem.parse(generated('kit-items', 10, 'kit-stock').item);
    expect(parsed).toMatchObject({ addOnKey: 'kit', appKey: null });
    const code = bootstrapNavItem.parse({ ...generated('x', 1, null).item, addOnPage: { key: 'kit', ref: 'kit-count' } });
    expect(code.addOnPage).toEqual({ key: 'kit', ref: 'kit-count' });
  });
});

describe('GET /bootstrap with an add-on that has a section', () => {
  let t: AuthTestApp;
  beforeEach(async () => {
    t = await buildAuthApp();
    await t.app.register(rbacPlugin, { meta: t.meta });
  });
  afterEach(async () => t.destroy());

  async function page(meta: MetaDb, slug: string, order: number, group: string | null): Promise<string> {
    const id = newId('page');
    const now = Date.now();
    await meta.db
      .insertInto('adminium_pages')
      .values({
        id,
        connectionId: null,
        slug,
        type: 'page-crud',
        title: slug,
        icon: 'box',
        navGroup: 'app',
        navOrder: order,
        config: JSON.stringify({ v: 1, kind: 'page', template: 'page-crud', app: 'kit', ...(group === null ? {} : { nav: { group } }) }),
        origin: 'manifest',
        manifestId: null,
        generatedFromSnapshotId: null,
        revision: 1,
        isEnabled: writeBool(meta, true),
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return id;
  }
  /** The kit installed and switched on for the dashboard, with its two generated pages. */
  async function installed(over: { status?: 'installed' | 'installing'; attachTo?: string[] } = {}) {
    await manifestsRepo(t.meta, CRYPTO).install({ manifestKey: 'kit', version: '1.2.0', kind: 'add-on', source: 'file', document: kit(), status: over.status ?? 'installed', attachTo: over.attachTo ?? ['dashboard'] });
    return { items: await page(t.meta, 'kit-items', 10, 'kit-stock'), overview: await page(t.meta, 'kit-overview', 1, 'manage') };
  }
  const bootstrap = async (cookie: string | null) => (await t.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: cookie ?? '' } })).json().data;
  /** Someone holding one role, granted exactly these pages. */
  async function reader(pages: string[]): Promise<string | null> {
    const role = await rolesRepo(t.meta).create({ slug: 'kit-reader', name: 'Kit reader' } as never);
    for (const ref of pages) await permissionsRepo(t.meta).grant(role.id, 'page', ref, { view: true, edit: false } as never);
    const user = await usersRepo(t.meta).create({ email: 'rae@example.com', name: 'Rae', passwordHash: await adminPasswordHash() });
    await rolesRepo(t.meta).assignToUser(user.id, role.id);
    return (await login(t.app, 'rae@example.com', ADMIN_PASSWORD)).cookie;
  }

  it('a Super Admin sees the whole section, and its pages name the add-on and no app', async () => {
    await installed();
    const data = await bootstrap((await login(t.app)).cookie);
    const section = data.appSections.find((entry: { appKey: string }) => entry.appKey === 'kit');
    expect(section).toMatchObject({ kind: 'add-on', label: 'Kit', version: '1.2.0', staff: null });
    expect(section.groups.map((group: { key: string; items: { slug: string; addOnPage?: { ref: string } }[] }) => [group.key, group.items.map((item) => item.addOnPage?.ref ?? item.slug)])).toEqual([
      ['', ['kit-overview']],
      ['kit-stock', ['kit-items', 'kit-count']],
    ]);
    for (const group of section.groups) for (const item of group.items) expect(item).toMatchObject({ addOnKey: 'kit', appKey: null });
    // Its pages are in no shared group, and its code page in a built-in group stays in the shared rail.
    expect(data.nav.groups.flatMap((group: { items: { slug: string }[] }) => group.items.map((item) => item.slug))).toEqual([]);
    expect(data.addOnNav.pages.map((entry: { ref: string; inSection: boolean; unlisted: boolean }) => [entry.ref, entry.inSection, entry.unlisted])).toEqual([
      ['kit-transfer', false, true],
      ['kit-count', true, false],
      ['kit-report', false, false],
    ]);
    expect(data.hiddenPages).toEqual([]);
  });

  it('a reader gets exactly the rows of the pages they hold: neither the row nor the unlisted entry of one they lack', async () => {
    const pages = await installed();
    const data = await bootstrap(await reader([pages.items, 'kit-count']));
    const section = data.appSections.find((entry: { appKey: string }) => entry.appKey === 'kit');
    expect(section.groups.map((group: { key: string; items: { slug: string; addOnPage?: { ref: string } }[] }) => [group.key, group.items.map((item) => item.addOnPage?.ref ?? item.slug)])).toEqual([['kit-stock', ['kit-items', 'kit-count']]]);
    expect(data.addOnNav.pages.map((entry: { ref: string }) => entry.ref)).toEqual(['kit-count']);
  });

  it('a reader with none of its pages has no section at all', async () => {
    await installed();
    const data = await bootstrap(await reader([]));
    expect(data.appSections).toEqual([]);
    expect(data.addOnNav.pages).toEqual([]);
  });

  it('an add-on still being installed, or switched off for the dashboard, has no section', async () => {
    await installed({ status: 'installing' });
    const data = await bootstrap((await login(t.app)).cookie);
    expect(data.appSections).toEqual([]);
    expect(data.addOnNav.pages).toEqual([]);
  });
});

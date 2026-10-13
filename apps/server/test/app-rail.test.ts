// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S SECTION OF THE SIDEBAR, against the whole server on SQLite,
 * Postgres and MySQL: a page kept off the sidebar (`nav.offRail`), an entry
 * that is not a page (`navLinks`), and the emails screen narrowed to one app.
 * Each is asked as the people who may and who may not: what the menu, search
 * and "where is" answer to each, and that nothing names a place to somebody
 * who cannot open it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { settingsRepo } from '@adminium/meta';

import { whereIs } from '../src/assistant/tools/where.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { LEGS, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The server says the version it was built at; the words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const node = (key: string, action: Record<string, unknown>) => ({ id: key, kind: 'action', title: key, action });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const page = (ref: string, table: string, title: string, nav: Record<string, unknown>, more: Record<string, unknown> = {}) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: title }, nav: { group: 'selling', icon: 'list', ...nav }, bindings: { rows: table }, ...more });

function sales(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'sales',
    name: 'Sales',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.sales.desc', fallback: 'Sales.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [
      { key: 'selling', label: en('Selling'), order: 1 },
      { key: 'setup', label: { 'en-US': 'Set up', 'de-DE': 'Einrichten' }, order: 2 },
    ],
    modules: [
      { id: 'selling', label: en('Selling'), default: 'always' },
      { id: 'jobs', label: en('Jobs'), default: 'on' },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'deals', module: 'selling', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }, { ref: 'state', type: 'text', maxLength: 20, default: 'open' }, { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }] },
        { ref: 'stages', module: 'selling', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }] },
        { ref: 'jobs', module: 'jobs', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }] },
      ],
    },
    roles: [
      // Opens the app's screens, and views both pages: the one on the sidebar and the one kept off it.
      { key: 'rep', name: 'Rep', permissions: ['app:@:staff', 'table:@deals:read', 'table:@stages:read', 'page:@sales-deals:view', 'page:@sales-stages:view'] },
      // Views the one page on the sidebar, and opens no screen of the app.
      { key: 'clerk', name: 'Clerk', permissions: ['table:@deals:read', 'page:@sales-deals:view'] },
    ],
    pages: [
      page('sales-deals', 'deals', 'Deals', { order: 1 }, { module: 'selling' }),
      page('sales-stages', 'stages', 'Stages', { order: 2, offRail: true }, { module: 'selling' }),
      page('sales-jobs', 'jobs', 'Jobs', { order: 3 }, { module: 'jobs' }),
    ],
    navLinks: [
      { ref: 'approvals', label: { 'en-US': 'Approvals', 'de-DE': 'Freigaben' }, nav: { group: 'selling', icon: 'check', order: 2 }, to: { side: 'staff', path: '/approvals' } },
      { ref: 'job-board', label: en('Job board'), nav: { group: 'selling', icon: 'hammer', order: 4 }, to: { side: 'staff' }, module: 'jobs' },
      { ref: 'rules', label: en('Rules'), nav: { group: 'setup', icon: 'workflow', order: 1 }, to: { screen: 'automations' } },
      { ref: 'emails', label: en('Emails'), nav: { group: 'setup', icon: 'mail', order: 2 }, to: { screen: 'email-templates' } },
      { ref: 'sample-data', label: en('Sample data'), nav: { group: 'setup', icon: 'database', order: 3 }, to: { screen: 'settings' } },
    ],
    emailTemplates: [{ key: 'sales-won', name: 'sales-won', locales: { 'en-US': { subject: '{{record.name}} is won', blocks: [{ block: 'email.text', data: { text: 'Well done on {{record.name}}.' } }] } } }],
    automations: [
      {
        key: 'deal-won',
        name: en('A deal is won: write to its owner'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'state', when: [{ left: { field: 'state' }, op: 'is', right: 'won' }] },
        graph: flow(node('mail', { kind: 'email', templateKey: 'sales-won', to: { kind: 'staff', column: 'owner_id' } })),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', placement: 'external' }],
  };
}

type Item = { pageId: string; slug: string; fallback: string; order: number; offRail?: true; link?: { href: string; document: boolean } };
type Section = { appKey: string; groups: { key: string; label: string | null; items: Item[] }[] };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app's section of the sidebar, on ${dialect}`, () => {
    let s: WholeServer;
    const boot = async (who: string): Promise<{ raw: string; section: Section | undefined }> => {
      const res = await s.get(who, '/api/v1/bootstrap');
      expect(res.statusCode, res.body).toBe(200);
      const sections = ((res.json() as { data: { appSections?: Section[] } }).data.appSections ?? []) as Section[];
      return { raw: res.body, section: sections.find((entry) => entry.appKey === 'sales') };
    };
    const items = (section: Section | undefined): Item[] => (section?.groups ?? []).flatMap((group) => group.items);
    const named = (section: Section | undefined, key: string): string[] => (section?.groups.find((group) => group.key === key)?.items ?? []).map((item) => item.fallback);
    const pagesFound = async (who: string, q: string): Promise<string[]> => {
      const res = await s.get(who, `/api/v1/search?types=page&q=${encodeURIComponent(q)}`);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { groups: { hits: { slug: string }[] }[] } }).data.groups.flatMap((group) => group.hits.map((hit) => hit.slug));
    };
    const whereFor = async (who: string, q: string): Promise<string[]> => {
      const user = { id: s.ids[who]!, name: who };
      const answer = await whereIs(
        {
          meta: s.meta,
          manager: s.manager,
          can: async (permission: string) => permissionSetAllows(await resolvePermissionSet(s.meta, { kind: 'user', id: user.id, label: user.name }), permission),
          canReadTable: async () => async () => false,
          userId: user.id,
          rowData: true,
          locale: 'en_US',
          t: (key: string, fallback?: string) => fallback ?? key,
          context: 'general',
          host: { connectionIds: [] },
        } as never,
        q,
      );
      return answer.pages.map((found) => found.path);
    };
    const apps = async (change: (apps: Record<string, Record<string, unknown>>) => void): Promise<void> => {
      const next = structuredClone(((await settingsRepo(s.meta).get('surfaces.apps')) ?? {}) as Record<string, Record<string, unknown>>);
      next['sales'] ??= {};
      change(next);
      await settingsRepo(s.meta).set('surfaces.apps', next as never, { updatedBy: null });
      s.app.surfaceSettings?.invalidate();
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, sales(), { people: { rita: ['rep'], carl: ['clerk'] } });
      await apps((held) => (held['sales']!['staff'] = 'external'));
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('the owner gets every entry, in the order the manifest gives, each at an address the server wrote', async () => {
      const { section } = await boot('owner');
      expect(section?.groups.map((group) => group.label)).toEqual(['Selling', 'Set up']);
      expect(named(section, 'selling')).toEqual(['Deals', 'Approvals', 'Stages', 'Jobs', 'Job board']);
      expect(named(section, 'setup')).toEqual(['Rules', 'Emails', 'Sample data']);
      const byName = Object.fromEntries(items(section).map((item) => [item.fallback, item]));
      // A page kept off the sidebar travels with the section, marked; the others are not marked.
      expect(byName['Stages']).toMatchObject({ slug: 'sales-stages', offRail: true });
      expect(byName['Deals']).not.toHaveProperty('offRail');
      expect(byName['Deals']).not.toHaveProperty('link');
      // The screens of the dashboard, narrowed to this app by its installed key.
      expect(byName['Rules']).toMatchObject({ pageId: 'link:rules', slug: '', link: { href: '/automations?app=sales', document: false } });
      expect(byName['Emails']!.link).toEqual({ href: '/email-templates?app=sales', document: false });
      expect(byName['Sample data']!.link).toEqual({ href: '/studio/apps/sales', document: false });
      // The app's own staff side, on its own address.
      expect(byName['Approvals']!.link).toEqual({ href: '/apps/sales/staff/approvals', document: true });
      expect(byName['Job board']!.link).toEqual({ href: '/apps/sales/staff/', document: true });
    });

    it('somebody who opens the app and no settings screen gets the staff entries and none of the dashboard\'s', async () => {
      const { raw, section } = await boot('rita');
      expect(named(section, 'selling')).toEqual(['Deals', 'Approvals', 'Stages', 'Job board']);
      expect(named(section, 'setup')).toEqual([]);
      for (const hidden of ['/automations?app=', '/email-templates?app=', '/studio/apps/sales', 'link:rules', 'link:emails', 'link:sample-data']) expect(raw, hidden).not.toContain(hidden);
      // The page kept off the sidebar is hers to view: it is listed (marked), found by search and by "where is".
      expect(items(section).find((item) => item.slug === 'sales-stages')).toMatchObject({ offRail: true });
      expect(await pagesFound('rita', 'Stag')).toEqual(['sales-stages']);
      expect(await whereFor('rita', 'stages')).toEqual(['/p/sales-stages']);
      // It opens by its address for her, and is refused to somebody who may not view it.
      const stages = items(section).find((item) => item.slug === 'sales-stages')!;
      expect((await s.get('rita', `/api/v1/pages/${stages.pageId}`)).statusCode).toBe(200);
      expect((await s.get('carl', `/api/v1/pages/${stages.pageId}`)).statusCode).toBe(403);
    });

    it('somebody who may not view it finds the page nowhere, and no entry of a side they cannot open', async () => {
      const { raw, section } = await boot('carl');
      expect(named(section, 'selling')).toEqual(['Deals']);
      expect(named(section, 'setup')).toEqual([]);
      for (const hidden of ['sales-stages', 'Stages', 'Approvals', 'link:', '/apps/sales/staff/approvals', 'Job board', 'Sample data', '?app=']) expect(raw, hidden).not.toContain(hidden);
      expect(items(section).filter((item) => item.link !== undefined)).toEqual([]);
      expect(await pagesFound('carl', 'Stag')).toEqual([]);
      expect(await whereFor('carl', 'stages')).toEqual([]);
      expect(await whereFor('carl', '')).toEqual(['/p/sales-deals']);
    });

    it('labels follow the reader\'s language', async () => {
      const set = await s.send('rita', 'PATCH', '/api/v1/me/prefs', { locale: 'de_DE' });
      expect(set.statusCode, set.body).toBe(200);
      {
        const { section } = await boot('rita');
        expect(named(section, 'selling')).toContain('Freigaben');
        await s.send('rita', 'PATCH', '/api/v1/me/prefs', { locale: 'en_US' });
      }
    });

    it('an entry leaves with its part, and the staff entries with the side', async () => {
      const flip = (on: boolean) => s.send('owner', 'PUT', '/api/v1/apps/sales/parts/jobs', { on });
      expect((await flip(false)).statusCode).toBe(200);
      expect(named((await boot('owner')).section, 'selling')).toEqual(['Deals', 'Approvals', 'Stages']);
      expect((await flip(true)).statusCode).toBe(200);
      expect(named((await boot('owner')).section, 'selling')).toContain('Job board');

      await apps((held) => (held['sales']!['off'] = ['staff']));
      const off = await boot('owner');
      expect(named(off.section, 'selling')).toEqual(['Deals', 'Stages', 'Jobs']);
      expect(named(off.section, 'setup')).toEqual(['Rules', 'Emails', 'Sample data']);
      await apps((held) => delete held['sales']!['off']);
    });

    it('a stored entry that is not one of the closed list is left out, never followed', async () => {
      const row = (await s.meta.db.selectFrom('adminium_manifests').select(['id', 'manifest']).where('manifestKey', '=', 'sales').executeTakeFirstOrThrow()) as { id: string; manifest: unknown };
      const document = (typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest) as { navLinks: Record<string, unknown>[] };
      const place = { group: 'setup', icon: 'x', order: 9 };
      const forged = [
        { ref: 'a', label: en('Forged A'), nav: place, to: { url: 'https://evil.example' } },
        { ref: 'b', label: en('Forged B'), nav: place, to: { side: 'staff', path: '//evil.example' } },
        { ref: 'c', label: en('Forged C'), nav: place, to: { side: 'staff', path: '/../../settings/roles' } },
        { ref: 'd', label: en('Forged D'), nav: place, to: { screen: 'automations', app: 'other' } },
        { ref: 'e', label: en('Forged E'), nav: place, to: { screen: 'roles' } },
        { ref: 'f', label: en('Forged F'), nav: place, to: { side: 'staff', path: 'javascript:alert(1)' } },
        { ref: 'g', label: en('Forged G'), nav: place, to: { side: 'customer' } },
      ];
      await s.meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify({ ...document, navLinks: [...document.navLinks, ...forged] }) } as never).where('id', '=', row.id).execute();
      const { raw, section } = await boot('owner');
      expect(raw).not.toContain('Forged');
      expect(raw).not.toContain('evil.example');
      expect(named(section, 'setup')).toEqual(['Rules', 'Emails', 'Sample data']);
      await s.meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify(document) } as never).where('id', '=', row.id).execute();
    });

    it('the emails screen narrowed to one app lists that app\'s, and only narrows', async () => {
      type Listed = { items: { key: string }[]; counts: { template: number; campaign: number; archived: number } };
      const list = async (who: string, query: string): Promise<Listed> => {
        const res = await s.get(who, `/api/v1/email-templates${query}`);
        expect(res.statusCode, res.body).toBe(200);
        return res.json() as Listed;
      };
      const all = await list('owner', '');
      const mine = await list('owner', '?app=sales');
      expect(mine.items.map((item) => item.key)).toEqual(['sales-won']);
      expect(mine.counts).toEqual({ template: 1, campaign: 0, archived: 0 });
      expect(all.items.length).toBeGreaterThanOrEqual(mine.items.length);
      // Every row of the narrowed list is a row of the whole one: the parameter adds nothing.
      for (const item of mine.items) expect(all.items.map((one) => one.key)).toContain(item.key);
      // An app that is not there, and one that never was: nothing, and no other app's rows.
      expect((await list('owner', '?app=other')).items).toEqual([]);
      expect((await list('owner', '?app=other')).counts).toEqual({ template: 0, campaign: 0, archived: 0 });
      // With a search too: still inside the app's.
      expect((await list('owner', '?app=sales&q=won')).items.map((item) => item.key)).toEqual(['sales-won']);
      expect((await list('owner', '?app=sales&q=zzz')).items).toEqual([]);
      // Not a key: refused, never read as a pattern.
      for (const bad of ['%25', 'sales%27%20or%201=1', '../x', 'SALES', '']) {
        expect((await s.get('owner', `/api/v1/email-templates?app=${bad}`)).statusCode, bad).toBe(422);
      }
      // Whoever may list gets the same cut of what they could already list.
      const hers = await list('rita', '?app=sales');
      const hersAll = await list('rita', '');
      for (const item of hers.items) expect(hersAll.items.map((one) => one.key)).toContain(item.key);
    });
  });
}

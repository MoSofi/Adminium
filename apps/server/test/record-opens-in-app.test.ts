// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A RECORD OPENS (`frontends[].records`), against the whole server on
 * SQLite, Postgres and MySQL: a notice, its email and a search hit lead to the
 * app's own screen for somebody whose roles open the app's staff side, and to
 * the dashboard's record page for everybody else; a role given later moves a
 * notice already written; a side that is switched off, a part that is off and
 * a stored address that is not one all fall back to the dashboard's page; and
 * a person who is signed out goes through sign-in and back.
 */
import { rolesRepo, settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The server says the version it was built at; the words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const node = (key: string, action: Record<string, unknown>) => ({ id: key, kind: 'action', title: key, action });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const page = (ref: string, table: string, order: number, more: Record<string, unknown> = {}) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'sales', icon: 'list', order }, bindings: { rows: table }, ...more });

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
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    modules: [
      { id: 'selling', label: en('Selling'), default: 'always' },
      { id: 'jobs', label: en('Jobs'), default: 'on' },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          module: 'selling',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 120 },
            { ref: 'amount', type: 'int', default: 0 },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'notes', type: 'text', maxLength: 1000, nullable: true, rules: { mentions: true } },
          ],
        },
        { ref: 'jobs', module: 'jobs', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }, { ref: 'notes', type: 'text', maxLength: 1000, nullable: true, rules: { mentions: true } }] },
        // No address is said for this one: its records open where they always did.
        { ref: 'deliveries', module: 'selling', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }, { ref: 'notes', type: 'text', maxLength: 1000, nullable: true, rules: { mentions: true } }] },
      ],
    },
    roles: [
      // Opens the app's screens and the dashboard's pages.
      { key: 'rep', name: 'Rep', permissions: ['app:@:staff', 'table:@deals:read', 'table:@deals:create', 'table:@deals:update', 'table:@jobs:read', 'table:@jobs:update', 'table:@deliveries:read', 'table:@deliveries:update', 'page:@sales-deals:view', 'page:@sales-jobs:view', 'page:@sales-deliveries:view'] },
      // Opens the app's screens and no page of the dashboard.
      { key: 'fitter', name: 'Fitter', permissions: ['app:@:staff', 'table:@deals:read', 'table:@deliveries:read'] },
      // Reads in the dashboard only: no grant on the app's screens.
      { key: 'auditor', name: 'Auditor', permissions: ['table:@deals:read', 'table:@jobs:read', 'table:@deliveries:read', 'page:@sales-deals:view', 'page:@sales-jobs:view', 'page:@sales-deliveries:view'] },
    ],
    pages: [page('sales-deals', 'deals', 1, { module: 'selling' }), page('sales-jobs', 'jobs', 2, { module: 'jobs' }), page('sales-deliveries', 'deliveries', 3, { module: 'selling' })],
    automations: [
      {
        key: 'amount-changed',
        name: en('A deal’s amount changes: tell its owner at once'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'amount' },
        graph: flow(node('tell', { kind: 'notification', to: { column: 'owner_id' }, title: en('Amount changed: {{record.name}}'), urgent: true })),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', placement: 'external', records: { deals: '/deals/{id}', jobs: '/jobs/{id}/sheet' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`where a record opens, on ${dialect}`, () => {
    let s: WholeServer;
    let atrium = 0;
    let roof = 0;
    let van = 0;
    const at = (who: string): string => `@[${who[0]!.toUpperCase()}${who.slice(1)}](${s.ids[who]!})`;
    type Notice = { title: string; actionUrl: string | null; opens?: { appKey: string; path: string }; kind: string };
    const notices = async (who: string, kind: string): Promise<Notice[]> => ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: Notice[] } }).data.items.filter((item) => item.kind === kind);
    type Hit = { label: string; pageSlug: string; table: string; opens?: { appKey: string; path: string; url: string } };
    const found = async (who: string, q: string): Promise<Hit[]> => {
      const res = await s.get(who, `/api/v1/search?types=record&q=${encodeURIComponent(q)}`);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { groups: { hits: Hit[] }[] } }).data.groups.flatMap((group) => group.hits);
    };
    const apps = async (change: (apps: Record<string, Record<string, unknown>>) => void): Promise<void> => {
      const held = ((await settingsRepo(s.meta).get('surfaces.apps')) ?? {}) as Record<string, Record<string, unknown>>;
      const next = structuredClone(held);
      next['sales'] ??= {};
      change(next);
      await settingsRepo(s.meta).set('surfaces.apps', next as never, { updatedBy: null });
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, sales(), { people: { dana: ['rep'], ivy: ['rep'], abe: ['auditor'], fay: ['fitter'] }, smtp: true });
      // The side opens on its own address, as the manifest asks.
      await apps((held) => (held['sales']!['staff'] = 'external'));
      expect(said(await s.make('owner', 'deals', { name: 'Atrium', owner_id: s.ids['dana'] }))).toBe('ok');
      expect(said(await s.make('owner', 'jobs', { name: 'Roofline' }))).toBe('ok');
      expect(said(await s.make('owner', 'deliveries', { name: 'Vanload' }))).toBe('ok');
      atrium = Number((await s.rows("select id from sales_deals where name = 'Atrium'"))[0]!['id']);
      roof = Number((await s.rows("select id from sales_jobs where name = 'Roofline'"))[0]!['id']);
      van = Number((await s.rows("select id from sales_deliveries where name = 'Vanload'"))[0]!['id']);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a mention leads into the app for somebody who opens it, and to the dashboard for somebody who does not', async () => {
      await s.emails();
      expect(said(await s.change('dana', 'deals', atrium, { notes: `${at('ivy')} ${at('abe')} see this` }))).toBe('ok');

      const ivy = await notices('ivy', 'mention');
      expect(ivy).toHaveLength(1);
      expect(ivy[0]).toMatchObject({ actionUrl: `/apps/sales/staff/deals/${String(atrium)}`, opens: { appKey: 'sales', path: `/deals/${String(atrium)}` } });

      const abe = await notices('abe', 'mention');
      expect(abe).toHaveLength(1);
      expect(abe[0]!.actionUrl).toBe(`/p/sales-deals/r/${String(atrium)}`);
      expect(abe[0]).not.toHaveProperty('opens');

      const mails = await s.emails();
      const toIvy = mails.find((mail) => mail.to === 'ivy@sales.test')!;
      expect(toIvy.html).toContain(`/apps/sales/staff/deals/${String(atrium)}`);
      expect(toIvy.html).not.toContain('/p/sales-deals/r/');
      const toAbe = mails.find((mail) => mail.to === 'abe@sales.test')!;
      expect(toAbe.html).toContain(`/p/sales-deals/r/${String(atrium)}`);
      expect(toAbe.html).not.toContain('/apps/sales/staff/');
    });

    it('a table with an address of its own shape, and one with none', async () => {
      expect(said(await s.change('dana', 'jobs', roof, { notes: `${at('ivy')} roof` }))).toBe('ok');
      expect(said(await s.change('dana', 'deliveries', van, { notes: `${at('ivy')} van` }))).toBe('ok');
      const urls = (await notices('ivy', 'mention')).map((notice) => notice.actionUrl);
      expect(urls).toContain(`/apps/sales/staff/jobs/${String(roof)}/sheet`);
      // No address said: the dashboard's page, as before.
      expect(urls).toContain(`/p/sales-deliveries/r/${String(van)}`);
    });

    it('a rule\'s notice and its email\'s button land in the app, on the address the operator set', async () => {
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://admin.sales.test' as never, { updatedBy: null });
      await s.emails();
      expect(said(await s.change('owner', 'deals', atrium, { amount: 500 }))).toBe('ok');
      await s.jobs();
      const told = await notices('dana', 'automation.notice');
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ title: 'Amount changed: Atrium', actionUrl: `/apps/sales/staff/deals/${String(atrium)}`, opens: { appKey: 'sales', path: `/deals/${String(atrium)}` } });
      // A rule runs with no request: the link starts with what the operator set, never a bare path.
      const mail = (await s.emails()).find((sent) => sent.to === 'dana@sales.test')!;
      expect(mail.html).toContain(`https://admin.sales.test/apps/sales/staff/deals/${String(atrium)}`);

      // A host mapped to the side: the email's link is that host's, with the side at its root.
      await settingsRepo(s.meta).set('surfaces.domains', { 'desk.sales.test': { appKey: 'sales', side: 'staff' } } as never, { updatedBy: null });
      expect(said(await s.change('owner', 'deals', atrium, { amount: 600 }))).toBe('ok');
      await s.jobs();
      const mapped = (await s.emails()).find((sent) => sent.to === 'dana@sales.test')!;
      expect(mapped.html).toContain(`https://desk.sales.test/deals/${String(atrium)}`);
      expect(mapped.html).not.toContain('admin.sales.test');
      await settingsRepo(s.meta).set('surfaces.domains', {} as never, { updatedBy: null });
    });

    it('a side shown inside the dashboard opens there', async () => {
      await apps((held) => (held['sales']!['staff'] = 'internal'));
      expect((await notices('ivy', 'mention')).map((notice) => notice.actionUrl)).toContain(`/a/sales/deals/${String(atrium)}`);
      await apps((held) => (held['sales']!['staff'] = 'external'));
    });

    it('search: the hit opens in the app for somebody who opens it', async () => {
      const dana = await found('dana', 'Atrium');
      expect(dana).toHaveLength(1);
      expect(dana[0]).toMatchObject({ label: 'Atrium', pageSlug: 'sales-deals', opens: { appKey: 'sales', path: `/deals/${String(atrium)}`, url: `/apps/sales/staff/deals/${String(atrium)}` } });

      // No grant on the app's screens: the dashboard's page, and no word of the app.
      const abe = await found('abe', 'Atrium');
      expect(abe).toHaveLength(1);
      expect(abe[0]!.pageSlug).toBe('sales-deals');
      expect(abe[0]).not.toHaveProperty('opens');

      // The app's screens and no page of the dashboard: the record is found, and the page is not named.
      const fay = await found('fay', 'Atrium');
      expect(fay).toHaveLength(1);
      expect(fay[0]).toMatchObject({ label: 'Atrium', pageSlug: '', opens: { url: `/apps/sales/staff/deals/${String(atrium)}` } });
      // A table with no address still needs its page: she reads it and has nowhere to land, so it is not found.
      expect(await found('fay', 'Vanload')).toEqual([]);
      expect((await found('dana', 'Vanload'))[0]).not.toHaveProperty('opens');
    });

    it('a role given later moves a notice already written; one taken moves it back', async () => {
      const roles = rolesRepo(s.meta);
      const rep = (await roles.findBySlug('sales-rep'))!;
      await roles.assignToUser(s.ids['abe']!, rep.id);
      const now = (await notices('abe', 'mention'))[0]!;
      expect(now.actionUrl).toBe(`/apps/sales/staff/deals/${String(atrium)}`);
      await roles.removeFromUser(s.ids['abe']!, rep.id);
      expect((await notices('abe', 'mention'))[0]!.actionUrl).toBe(`/p/sales-deals/r/${String(atrium)}`);
    });

    it('a side that is switched off, and a part that is off send everybody to the dashboard\'s page', async () => {
      const urlsOf = async (): Promise<(string | null)[]> => (await notices('ivy', 'mention')).map((notice) => notice.actionUrl);

      await apps((held) => (held['sales']!['off'] = ['staff']));
      expect(await urlsOf()).toContain(`/p/sales-deals/r/${String(atrium)}`);
      expect((await urlsOf()).filter((url) => url?.startsWith('/apps/') === true)).toEqual([]);
      expect((await found('dana', 'Atrium'))[0]).not.toHaveProperty('opens');
      await apps((held) => delete held['sales']!['off']);
      expect(await urlsOf()).toContain(`/apps/sales/staff/deals/${String(atrium)}`);

      // The part "jobs" is switched off: its table's address goes with it, the other table's stays.
      const flip = (on: boolean) => s.send('owner', 'PUT', '/api/v1/apps/sales/parts/jobs', { on });
      const off = await flip(false);
      expect(off.statusCode, off.body).toBe(200);
      const urls = await urlsOf();
      expect(urls).not.toContain(`/apps/sales/staff/jobs/${String(roof)}/sheet`);
      expect(urls).toContain(`/apps/sales/staff/deals/${String(atrium)}`);
      expect((await flip(true)).statusCode).toBe(200);
      expect(await urlsOf()).toContain(`/apps/sales/staff/jobs/${String(roof)}/sheet`);
    });

    it('a stored address that is not one answers nothing', async () => {
      const row = (await s.meta.db.selectFrom('adminium_manifests').select(['id', 'manifest', 'updatedAt']).where('manifestKey', '=', 'sales').executeTakeFirstOrThrow()) as { id: string; manifest: unknown; updatedAt: number };
      const document = (typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest) as { frontends: { records: Record<string, string> }[] };
      const write = async (records: Record<string, string>, stamp: number): Promise<void> => {
        const next = { ...document, frontends: [{ ...document.frontends[0]!, records }] };
        await s.meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify(next), updatedAt: stamp } as never).where('id', '=', row.id).execute();
      };
      let stamp = Number(row.updatedAt);
      for (const bad of ['//evil.example/{id}', 'https://evil.example/{id}', '/../../a/other/{id}', '/\\evil.example/{id}', 'javascript:alert(1)//{id}', '/deals/{id}?next=//evil.example', '/deals']) {
        await write({ deals: bad }, (stamp += 1));
        const urls = (await notices('ivy', 'mention')).map((notice) => notice.actionUrl);
        expect(urls.join(' '), bad).not.toContain('evil.example');
        expect(urls, bad).toContain(`/p/sales-deals/r/${String(atrium)}`);
        expect((await found('dana', 'Atrium'))[0], bad).not.toHaveProperty('opens');
      }
      await write(document.frontends[0]!.records, (stamp += 1));
      expect((await notices('ivy', 'mention')).map((notice) => notice.actionUrl)).toContain(`/apps/sales/staff/deals/${String(atrium)}`);
    });

    it('signed out, the address goes through sign-in and back; signed in without the grant, it is refused', async () => {
      const url = `/apps/sales/staff/deals/${String(atrium)}`;
      const navigate = { 'sec-fetch-mode': 'navigate', accept: 'text/html' };
      const out = await s.app.inject({ method: 'GET', url, headers: navigate });
      expect(out.statusCode).toBe(302);
      expect(out.headers.location).toBe(`/login?next=${encodeURIComponent(url)}`);

      const inside = await s.app.inject({ method: 'GET', url, headers: { ...navigate, cookie: s.cookie['dana']! } });
      expect(inside.statusCode, inside.body.slice(0, 200)).toBe(200);
      expect(inside.headers['content-type']).toContain('text/html');

      // No grant on the app's screens: the page that says so, never the app.
      const refused = await s.app.inject({ method: 'GET', url, headers: { ...navigate, cookie: s.cookie['abe']! } });
      expect(refused.statusCode).not.toBe(200);
    });
  });
}

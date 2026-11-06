// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT ONE INSTALL'S PAGE READS, through the real routes on every engine
 * this run can reach.
 *
 *  - The list says which install each row is: its id, its address, its
 *    database, its name, and where a self-made file was made.
 *  - The overview counts what the install put here, and says which tables
 *    were here before it.
 *  - The "After you install" list is the install's own: named, each with the
 *    permission it needs, seen done where the server can see it, ticked by
 *    someone who holds that permission, put away only once all is done.
 *  - The look and languages a file brought: what it wrote, what somebody
 *    changed since, and an undo for whoever may change the server's settings.
 *
 * With two installs of a key and nothing naming which, every route answers
 * `APP_INSTALL_AMBIGUOUS`; with the header, it acts on that install alone.
 */
import { appAfterInstallRepo, permissionsRepo, rolesRepo, settingsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';
import { HELP_HOST, LOGO, LOGO_SHA, memoryLibrary, withTableAndPage, type Doc } from './app-instance.helpers.js';

const node = (id: string, kind: string, more: Doc = {}) => ({ id, kind, title: `Step ${id}`, ...more });

function shop(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'corner-shop',
    name: 'Corner shop',
    version: '1.0.0',
    publisher: { id: 'local', name: 'Corner shop, Leith' },
    license: 'UNLICENSED',
    description: { key: 'corner-shop.description', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    provenance: { lineage: 'corner-shop-lineage-09', savedAt: '2026-11-05T09:30:00Z', adminiumVersion: '0.3.49', label: 'Corner shop, Leith' },
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'number', type: 'text', maxLength: 40 },
          ],
        },
      ],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 'shop.orders', fallback: 'Orders' }, nav: { group: 'manifest:corner-shop', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    roles: [{ key: 'clerk', name: 'Clerk', permissions: ['table:@orders:read', 'system:audit:read'] }],
    automations: [
      {
        key: 'tell-slack',
        name: 'Tell the shop channel',
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'orders' },
        graph: { version: 1, nodes: [node('t', 'trigger'), node('w', 'action', { action: { kind: 'webhook', bodyKind: 'slack', body: 'Order {{record.number}}' } })] },
      },
    ],
    scheduledReports: [{ key: 'monday-orders', name: 'Orders on Monday', page: 'orders', schedule: { frequency: 'weekly', dayOfWeek: 1, time: '08:00' } }],
  };
}

interface Item {
  id: string;
  kind: string;
  item: string;
  name: string | null;
  done: boolean;
  doneBy: { id: string; name: string } | null;
  seen: boolean;
  right: string;
  canTick: boolean;
  link: { to: string; id?: string } | null;
}
type List = { items: Item[]; hidden: boolean };

const body = <T>(reply: { body: string }): T => JSON.parse(reply.body) as T;
// The harness's inject names three methods; PUT and the header ride through the same call.
const send = (h: Harness, request: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) => h.inject(request as never);

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

async function twoInstalls(h: Harness): Promise<{ fernhill: string; kiln: string; other: string }> {
  const first = await h.install(shop());
  expect(first.statusCode, first.body).toBe(200);
  const other = await h.otherConnection();
  const second = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'corner-shop', version: '1.0.0', connectionId: other.id } });
  expect(second.statusCode, second.body).toBe(200);
  const rows = await h.meta.db.selectFrom('adminium_manifests').select(['id', 'instanceSlug']).where('manifestKey', '=', 'corner-shop').execute();
  return { fernhill: rows.find((row) => row.instanceSlug === '')!.id, kiln: rows.find((row) => row.instanceSlug !== '')!.id, other: other.id };
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`one install's page [${dialect}]`, () => {
    it('lists each install with its address, database, name and where it was made', async () => {
      const h = (open = await installHarness(dialect, { full: true, library: memoryLibrary() }));
      const { fernhill, kiln } = await twoInstalls(h);
      const listed = body<{ apps: Doc[] }>(await h.inject({ method: 'GET', url: '/apps' })).apps.filter((app) => app['key'] === 'corner-shop');
      const madeAt = { label: 'Corner shop, Leith', savedAt: '2026-11-05T09:30:00Z', adminiumVersion: '0.3.49' };
      expect(listed.find((app) => app['installId'] === fernhill)).toMatchObject({ slug: '', address: 'corner-shop', connectionName: 'Clinic', name: 'Corner shop', madeAt });
      expect(listed.find((app) => app['installId'] === kiln)).toMatchObject({ slug: 'second', address: 'corner-shop~second', connectionName: 'Second', name: 'Corner shop', madeAt });
    }, 120_000);

    it('counts what an install added, and keeps its list its own', async () => {
      const h = (open = await installHarness(dialect, { full: true, library: memoryLibrary() }));
      const { fernhill, kiln } = await twoInstalls(h);
      const asKiln = { 'x-adminium-install': kiln };
      const asFernhill = { 'x-adminium-install': fernhill };

      // Nothing naming which install: never a guess.
      for (const url of ['/apps/corner-shop/after-install', '/apps/corner-shop/look', '/apps/corner-shop/overview']) {
        const ambiguous = await h.inject({ method: 'GET', url });
        expect(ambiguous.statusCode, url).toBe(409);
        expect(ambiguous.body).toContain('APP_INSTALL_AMBIGUOUS');
      }

      const overview = body<Doc>(await send(h, { method: 'GET', url: '/apps/corner-shop/overview', headers: asKiln }));
      expect(overview['added']).toEqual({ pages: 1, emailTemplates: 0, scheduledReports: 1, roles: 1 });
      expect((overview['tables'] as Doc[]).map((table) => [table['ref'], table['before'] ?? false])).toEqual([['orders', false]]);

      const kilnList = body<List>(await send(h, { method: 'GET', url: '/apps/corner-shop/after-install', headers: asKiln }));
      expect(kilnList.hidden).toBe(false);
      const byKind = (list: List, kind: string) => list.items.find((item) => item.kind === kind)!;
      expect(kilnList.items.map((item) => item.kind).sort()).toEqual(['recipients', 'system-grant', 'webhook']);
      expect(byKind(kilnList, 'webhook')).toMatchObject({ item: 'tell-slack', name: 'Tell the shop channel', done: false, seen: false, right: 'system:automations:manage', canTick: true, link: { to: 'automation' } });
      expect(byKind(kilnList, 'recipients')).toMatchObject({ item: 'monday-orders', name: 'Orders on Monday', right: 'system:reports:manage', link: { to: 'reports' } });
      expect(byKind(kilnList, 'system-grant')).toMatchObject({ item: 'clerk', name: 'Clerk · second', right: 'system:roles:manage', seen: false, link: { to: 'roles' } });
      // Nothing of a value to fill in is ever in the reply.
      expect(JSON.stringify(kilnList)).not.toContain('hooks.slack');

      // Kiln's clerk given the permission: seen done there, and only there.
      const kilnClerk = (await rolesRepo(h.meta).listForInstall(kiln))[0]!;
      await permissionsRepo(h.meta).grant(kilnClerk.id, 'system', 'audit.read', { allowed: true });
      const seen = byKind(body<List>(await send(h, { method: 'GET', url: '/apps/corner-shop/after-install', headers: asKiln })), 'system-grant');
      expect(seen).toMatchObject({ seen: true, done: true, doneBy: null });
      const fernhillList = body<List>(await send(h, { method: 'GET', url: '/apps/corner-shop/after-install', headers: asFernhill }));
      expect(byKind(fernhillList, 'system-grant')).toMatchObject({ seen: false, done: false });

      // Ticked by hand, by the owner.
      const ticked = await send(h, { method: 'PUT', url: `/apps/corner-shop/after-install/${byKind(kilnList, 'webhook').id}`, payload: { done: true }, headers: asKiln });
      expect(ticked.statusCode, ticked.body).toBe(200);
      expect(byKind(body<List>(ticked), 'webhook')).toMatchObject({ done: true, doneBy: { name: 'Owner' } });
      // Fernhill's item is not on Kiln's list.
      const elsewhere = await send(h, { method: 'PUT', url: `/apps/corner-shop/after-install/${byKind(fernhillList, 'webhook').id}`, payload: { done: true }, headers: asKiln });
      expect(elsewhere.statusCode).toBe(404);
      expect(byKind(body<List>(await send(h, { method: 'GET', url: '/apps/corner-shop/after-install', headers: asFernhill })), 'webhook').done).toBe(false);

      // Put away only once everything is done.
      const early = await send(h, { method: 'PUT', url: '/apps/corner-shop/after-install/hidden', payload: { hidden: true }, headers: asKiln });
      expect(early.statusCode, early.body).toBe(409);
      expect(early.body).toContain('AFTER_INSTALL_NOT_DONE');
      await send(h, { method: 'PUT', url: `/apps/corner-shop/after-install/${byKind(kilnList, 'recipients').id}`, payload: { done: true }, headers: asKiln });
      const hidden = await send(h, { method: 'PUT', url: '/apps/corner-shop/after-install/hidden', payload: { hidden: true }, headers: asKiln });
      expect(hidden.statusCode, hidden.body).toBe(200);
      expect(body<List>(hidden).hidden).toBe(true);
      // A new item to do shows it again.
      await appAfterInstallRepo(h.meta).put({ manifestId: kiln, appKey: 'corner-shop' }, [{ kind: 'sender', item: 'receipt', field: 'brand.fromEmail' }]);
      expect(body<List>(await send(h, { method: 'GET', url: '/apps/corner-shop/after-install', headers: asKiln })).hidden).toBe(false);

      // What was done is in Kiln's activity, not Fernhill's.
      const activityOf = async (headers: Record<string, string>) =>
        (body<Doc>(await send(h, { method: 'GET', url: '/apps/corner-shop/overview', headers }))['activity'] as Doc[]).map((entry) => entry['action']);
      expect(await activityOf(asKiln)).toContain('app.after-install-ticked');
      expect(await activityOf(asFernhill)).not.toContain('app.after-install-ticked');
    }, 120_000);

    it('lets only someone who holds an item\'s permission tick it', async () => {
      const h = (open = await installHarness(dialect, { full: true, library: memoryLibrary(), can: (permission) => permission !== 'system:automations:manage' }));
      expect((await h.install(shop())).statusCode).toBe(200);
      const list = body<List>(await h.inject({ method: 'GET', url: '/apps/corner-shop/after-install' }));
      const webhook = list.items.find((item) => item.kind === 'webhook')!;
      expect(webhook.canTick).toBe(false);
      expect(list.items.find((item) => item.kind === 'recipients')!.canTick).toBe(true);
      const refused = await send(h, { method: 'PUT', url: `/apps/corner-shop/after-install/${webhook.id}`, payload: { done: true } });
      expect(refused.statusCode, refused.body).toBe(403);
    }, 120_000);

    it('says a table was here before the app when it found it and used it', async () => {
      const h = (open = await installHarness(dialect, { full: true, library: memoryLibrary() }));
      const other = await h.otherConnection('Copy');
      await other.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
      const doc = withTableAndPage({ ...shop(), key: 'fern-notes', name: 'Fern notes', roles: [], automations: [], scheduledReports: [], provenance: undefined });
      delete doc['provenance'];
      await h.stage(doc);
      const installed = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'fern-notes', version: '1.0.0', connectionId: other.id, existing: 'use' } });
      expect(installed.statusCode, installed.body).toBe(200);
      const overview = body<Doc>(await h.inject({ method: 'GET', url: '/apps/fern-notes/overview' }));
      expect((overview['tables'] as Doc[]).map((table) => [table['table'], table['before'] ?? false])).toEqual([['notes', true]]);
    }, 120_000);

    it('reads back the look and languages a file brought, and puts them back', async () => {
      for (const canSettings of [false, true]) {
        const library = memoryLibrary();
        const h = (open = await installHarness(dialect, { library, ...(canSettings ? {} : { can: (permission: string) => permission !== 'system:settings:manage' }) }));
        await seedBuiltinEmailTemplates(h.meta, Date.now());
        await settingsRepo(h.meta).set('branding.appName', 'Harbour');
        await settingsRepo(h.meta).set('appearance.accent', 'rose');
        const doc = withTableAndPage({
          ...shop(),
          key: 'fern-notes',
          name: 'Fern notes',
          roles: [],
          automations: [],
          scheduledReports: [],
          instance: {
            branding: { appName: 'Fernhill', accent: 'teal', logo: { file: 'instance/logo.svg', sha256: LOGO_SHA } },
            wording: [{ locale: 'de_DE', namespace: 'common', key: 'common.save', value: 'Sichern' }],
            systemEmails: [{ key: 'password-reset', locale: 'en_US', content: { subject: 'Choose a new Fernhill password', blocks: [{ id: 'help', block: 'email.text', data: { text: `Read https://${HELP_HOST}/reset` } }] } }],
            settings: { 'assistant.name': 'Fern' },
          },
        });
        await h.stage(doc, { 'instance/logo.svg': LOGO });
        if (!canSettings) {
          // Without the settings permission, nothing of the part can be applied, so nothing is there to read.
          const installed = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'fern-notes', version: '1.0.0', connectionId: h.connectionId } });
          expect(installed.statusCode, installed.body).toBe(200);
          expect(body<Doc>(await h.inject({ method: 'GET', url: '/apps/fern-notes/look' }))).toEqual({ look: null });
          const refused = await h.inject({ method: 'POST', url: '/apps/fern-notes/look/undo' });
          expect(refused.statusCode).toBe(403);
          await h.close();
          open = null;
          continue;
        }
        const installed = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'fern-notes', version: '1.0.0', connectionId: h.connectionId, instance: true, instanceHosts: { 'password-reset/en_US': [HELP_HOST] } } });
        expect(installed.statusCode, installed.body).toBe(200);

        const look = body<{ look: Doc }>(await h.inject({ method: 'GET', url: '/apps/fern-notes/look' })).look;
        expect(look).toMatchObject({ logo: true, colours: true, wordings: 1, systemEmails: 1, settings: 2, changed: [], canUndo: true });
        expect(typeof look['appliedAt']).toBe('number');

        // Somebody picks another colour since: theirs, and an undo leaves it.
        await settingsRepo(h.meta).set('appearance.accent', 'indigo');
        expect(body<{ look: Doc }>(await h.inject({ method: 'GET', url: '/apps/fern-notes/look' })).look['changed']).toEqual(['colours']);

        const undone = await h.inject({ method: 'POST', url: '/apps/fern-notes/look/undo' });
        expect(undone.statusCode, undone.body).toBe(200);
        expect(body<{ kept: string[] }>(undone).kept).toEqual(['setting:appearance.accent']);
        expect(body<{ restored: string[] }>(undone).restored).toContain('setting:branding.appName');
        expect(await settingsRepo(h.meta).get('branding.appName')).toBe('Harbour');
        expect(await settingsRepo(h.meta).get('appearance.accent')).toBe('indigo');
        expect(body<Doc>(await h.inject({ method: 'GET', url: '/apps/fern-notes/look' }))).toEqual({ look: null });
        expect((body<Doc>(await h.inject({ method: 'GET', url: '/apps/fern-notes/overview' }))['activity'] as Doc[]).map((entry) => entry['action'])).toContain('app.look-undone');
      }
    }, 180_000);
  });
}

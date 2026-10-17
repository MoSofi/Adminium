// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH OF AN APP'S OWN RULES ARE SWITCHED ON, read by the app's own people
 * (`GET /api/v1/apps/:key/rules`), against the whole server on SQLite,
 * Postgres and MySQL, with the app installed by the real installer:
 *
 *  - a rep, a manager and somebody who only reads, each holding the app's
 *    staff grant, read each rule the installed manifest ships: its key, its
 *    name in their own language, and its switch, before and after the owner
 *    flips one;
 *  - a person whose role opens only the app's own screens reads it too, and
 *    still reads nothing of the rules' own routes;
 *  - somebody with no staff grant on the app is refused, whatever else they
 *    hold, and so is somebody signed out;
 *  - another app's rules, a rule somebody made by hand on one of the app's
 *    tables, a rule of a part that is switched off and a rule the installed
 *    manifest does not ship are never in the answer;
 *  - the answer holds a key, a name and a switch, and no condition, step,
 *    recipient or address.
 */
import { automationsRepo, rolesRepo, userPrefsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { allowedForScreensOnly } from '../src/apps/screens-only.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The server says the version it was built at; the words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const tell = (role: string, title: string) => ({ id: 'tell', kind: 'action', title: 'Tell', action: { kind: 'notification', to: { roles: [role] }, title: en(title), body: en('Write to secret-buyer@harbour.dev about {{record.name}}') } });
const page = (ref: string, table: string, more: Record<string, unknown> = {}) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: table }, ...more });

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crm.desc', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    modules: [
      { id: 'sales', label: en('Sales'), default: 'always' },
      { id: 'jobs', label: en('Jobs on site'), default: 'off' },
    ],
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'deals', module: 'sales', columns: [id, text('name', 80), { ref: 'stage', type: 'enum', enum: ['open', 'won', 'lost'], default: 'open' }, text('owner_id', 36, { rules: { staff: true } })] },
        { ref: 'jobs', module: 'jobs', columns: [id, text('name', 80)] },
      ],
    },
    roles: [
      { key: 'rep', name: 'Rep', modules: ['sales'], permissions: ['app:@:staff', 'table:@deals:read', 'table:@deals:create', 'table:@deals:update', 'page:@crm-deals:view'] },
      { key: 'manager', name: 'Sales manager', modules: ['sales'], permissions: ['app:@:staff', 'table:@deals:read', 'table:@deals:update', 'table:@deals:delete', 'page:@crm-deals:view'] },
      { key: 'read-only', name: 'Read-only', modules: ['sales'], permissions: ['app:@:staff', 'table:@deals:read', 'page:@crm-deals:view'] },
      // Opens the app's own screens and never the dashboard.
      { key: 'tablet', name: 'Showroom tablet', modules: ['sales'], screensOnly: true, permissions: ['app:@:staff', 'table:@deals:read'] },
      // Reads the app's rows in the dashboard, and may not open its staff side.
      { key: 'bookkeeper', name: 'Bookkeeper', modules: ['sales'], permissions: ['table:@deals:read', 'page:@crm-deals:view'] },
    ],
    pages: [page('crm-deals', 'deals', { module: 'sales' }), page('crm-jobs', 'jobs', { module: 'jobs' })],
    automations: [
      {
        key: 'nudge-stale',
        name: { 'en-US': 'A deal sits too long: tell its manager', 'de-DE': 'Ein Geschäft liegt zu lange: der Leitung melden' },
        description: en('Seven days with no change.'),
        enabled: false,
        module: 'sales',
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'stage', when: [{ left: { field: 'stage' }, op: 'is', right: 'lost' }] },
        graph: flow(tell('manager', 'A deal was lost')),
      },
      {
        key: 'deal-won',
        name: en('A deal is won: tell the managers'),
        enabled: true,
        module: 'sales',
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'stage', when: [{ left: { field: 'stage' }, op: 'is', right: 'won' }] },
        graph: flow(tell('manager', 'A deal was won')),
      },
      {
        key: 'job-made',
        name: en('A job is made: tell the managers'),
        enabled: true,
        module: 'jobs',
        trigger: { kind: 'record', event: 'created', table: 'jobs' },
        graph: flow(tell('manager', 'A job was made')),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

/** A second app on the same database, with a rule of its own. */
function desk(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Desk',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.desk.desc', fallback: 'A desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Desk'), order: 1 }],
    requiredSchema: { prefixed: true, tables: [{ ref: 'tickets', columns: [id, text('name', 80)] }] },
    roles: [{ key: 'agent', name: 'Agent', permissions: ['app:@:staff', 'table:@tickets:read', 'page:@desk-tickets:view'] }],
    pages: [page('desk-tickets', 'tickets')],
    automations: [
      { key: 'ticket-made', name: en('A ticket is made: tell the agents'), enabled: true, trigger: { kind: 'record', event: 'created', table: 'tickets' }, graph: flow(tell('agent', 'A ticket was made')) },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

type Rule = { key: string; name: string; on: boolean };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app’s own rules, on or off, read by its own people, on ${dialect}`, () => {
    let s: WholeServer;
    const rules = async (who: string, key = 'crm'): Promise<Rule[]> => {
      const res = await s.get(who, `/api/v1/apps/${key}/rules`);
      expect(res.statusCode, `${who}: ${res.body}`).toBe(200);
      return (res.json() as { rules: Rule[] }).rules;
    };
    const ruleId = async (key: string): Promise<string> => (await automationsRepo(s.meta).listManagedBy('crm', s.connectionId)).find((rule) => rule.templateKey === key)!.id;
    const flip = async (key: string, enabled: boolean) => expect(said(await s.send('owner', 'PATCH', `/api/v1/automations/${await ruleId(key)}`, { enabled }))).toBe('ok');

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { dana: ['rep'], ivy: ['manager'], rosa: ['read-only'], tab: ['tablet'], bea: ['bookkeeper'] } });
      // The second app, staged and installed the same way, and somebody who holds its role alone.
      const manifest = desk();
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'staff/index.html': '<!doctype html><html><body></body></html>' });
      const staged = await s.app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: s.cookie['owner']!, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
      expect(staged.statusCode, staged.body).toBe(200);
      expect(said(await s.send('owner', 'POST', '/api/v1/apps/install', { key: 'desk', version: '0.1.0', connectionId: s.connectionId }))).toBe('ok');
      const agent = await usersRepo(s.meta).create({ email: 'omar@desk.test', name: 'Omar', passwordHash: await adminPasswordHash() });
      await rolesRepo(s.meta).assignToUser(agent.id, (await rolesRepo(s.meta).findBySlug('desk-agent'))!.id);
      const signedIn = await s.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.77.0.9', payload: { email: 'omar@desk.test', password: ADMIN_PASSWORD } });
      expect(signedIn.statusCode, signedIn.body).toBe(200);
      s.cookie['omar'] = sessionCookie(signedIn.headers['set-cookie']);
      s.ids['omar'] = agent.id;
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('answers a rep, a manager and somebody who only reads each shipped rule with its real switch, before and after the owner flips one', async () => {
      const first = [
        { key: 'nudge-stale', name: 'A deal sits too long: tell its manager', on: false },
        { key: 'deal-won', name: 'A deal is won: tell the managers', on: true },
      ];
      for (const who of ['dana', 'ivy', 'rosa', 'owner']) expect(await rules(who), who).toEqual(first);
      await flip('nudge-stale', true);
      await flip('deal-won', false);
      for (const who of ['dana', 'ivy', 'rosa']) expect(await rules(who), who).toEqual([{ ...first[0]!, on: true }, { ...first[1]!, on: false }]);
      await flip('nudge-stale', false);
      await flip('deal-won', true);
      expect(await rules('dana')).toEqual(first);
    });

    it('names a rule in the reader’s own language, and by the manifest’s words whatever the rule was renamed to', async () => {
      await userPrefsRepo(s.meta).set(s.ids['rosa']!, { locale: 'de_DE' });
      expect((await rules('rosa'))[0]).toEqual({ key: 'nudge-stale', name: 'Ein Geschäft liegt zu lange: der Leitung melden', on: false });
      // A language the app does not ship: US English.
      await userPrefsRepo(s.meta).set(s.ids['rosa']!, { locale: 'da_DK' });
      expect((await rules('rosa'))[0]!.name).toBe('A deal sits too long: tell its manager');
      await userPrefsRepo(s.meta).set(s.ids['rosa']!, { locale: 'en_US' });
      // The owner types a name of their own (an address in it): the app's people still read the app's.
      expect(said(await s.send('owner', 'PATCH', `/api/v1/automations/${await ruleId('deal-won')}`, { name: 'Tell boss@harbour.dev at once' }))).toBe('ok');
      expect((await rules('dana'))[1]).toEqual({ key: 'deal-won', name: 'A deal is won: tell the managers', on: true });
    });

    it('holds a key, a name and a switch, and nothing of what a rule does', async () => {
      const res = await s.get('dana', '/api/v1/apps/crm/rules');
      const body = res.json() as { rules: Record<string, unknown>[] };
      expect(Object.keys(body)).toEqual(['rules']);
      for (const rule of body.rules) expect(Object.keys(rule).sort()).toEqual(['key', 'name', 'on']);
      // No condition, step, recipient, address, id of the rule, table or role.
      for (const word of ['secret-buyer', 'harbour.dev', 'stage', 'lost', 'notification', 'trigger', 'graph', 'record', 'crm_deals', 'auto_', await ruleId('deal-won'), 'Seven days', 'Tell']) {
        expect(res.body, word).not.toContain(word);
      }
    });

    it('lists no rule of a part that is switched off, and lists it once the part is on', async () => {
      expect((await rules('ivy')).map((rule) => rule.key)).toEqual(['nudge-stale', 'deal-won']);
      expect(said(await s.send('owner', 'PUT', '/api/v1/apps/crm/parts/jobs', { on: true }))).toBe('ok');
      expect((await rules('ivy')).map((rule) => rule.key)).toEqual(['nudge-stale', 'deal-won', 'job-made']);
      expect(said(await s.send('owner', 'PUT', '/api/v1/apps/crm/parts/jobs', { on: false }))).toBe('ok');
      expect((await rules('ivy')).map((rule) => rule.key)).toEqual(['nudge-stale', 'deal-won']);
    });

    it('lists no rule somebody made by hand on one of the app’s tables, and none the installed manifest does not ship', async () => {
      const repo = automationsRepo(s.meta);
      const [shipped] = await repo.listManagedBy('crm', s.connectionId);
      // By hand, on the app's own table, switched on.
      const byHand = await repo.create({ connectionId: s.connectionId, name: 'Mine: write to ops@harbour.dev', description: null, trigger: shipped!.trigger, graph: shipped!.graph, enabled: true, nextRunAt: null, createdBy: s.ids['owner']!, managedBy: null, templateKey: null, contentHash: null, module: null });
      // Marked as the app's, under a key the installed manifest does not ship (a rule of a later stage, or one it shipped once).
      const later = await repo.create({ connectionId: s.connectionId, name: 'Stage 2: a crew is booked', description: null, trigger: shipped!.trigger, graph: shipped!.graph, enabled: true, nextRunAt: null, createdBy: null, managedBy: 'crm', templateKey: 'crew-booked', contentHash: null, module: null });
      // A hand-made rule that borrows a shipped rule's key without being the app's.
      const borrowed = await repo.create({ connectionId: s.connectionId, name: 'Borrowed', description: null, trigger: shipped!.trigger, graph: shipped!.graph, enabled: true, nextRunAt: null, createdBy: s.ids['owner']!, managedBy: null, templateKey: 'nudge-stale', contentHash: null, module: null });
      try {
        const answer = await s.get('ivy', '/api/v1/apps/crm/rules');
        expect((answer.json() as { rules: Rule[] }).rules).toEqual([
          { key: 'nudge-stale', name: 'A deal sits too long: tell its manager', on: false },
          { key: 'deal-won', name: 'A deal is won: tell the managers', on: true },
        ]);
        for (const word of ['Mine', 'ops@', 'Stage 2', 'crew-booked', 'Borrowed']) expect(answer.body, word).not.toContain(word);
      } finally {
        for (const rule of [byHand, later, borrowed]) await repo.remove(rule.id);
      }
    });

    it('lists a shipped rule that is not there as off: it does not run', async () => {
      const repo = automationsRepo(s.meta);
      const before = (await repo.listManagedBy('crm', s.connectionId)).find((rule) => rule.templateKey === 'deal-won')!;
      await repo.remove(before.id);
      try {
        expect(await rules('dana')).toContainEqual({ key: 'deal-won', name: 'A deal is won: tell the managers', on: false });
      } finally {
        const made = await repo.create({ connectionId: s.connectionId, name: before.name, description: before.description, trigger: before.trigger, graph: before.graph, enabled: true, nextRunAt: null, createdBy: null, managedBy: 'crm', templateKey: 'deal-won', contentHash: before.contentHash, module: before.module });
        expect(made.enabled).toBe(true);
      }
    });

    it('never answers another app’s rules: each app’s people read their own app’s, and are refused the other’s', async () => {
      expect(await rules('omar', 'desk')).toEqual([{ key: 'ticket-made', name: 'A ticket is made: tell the agents', on: true }]);
      expect((await rules('dana')).map((rule) => rule.key)).not.toContain('ticket-made');
      expect(said(await s.get('omar', '/api/v1/apps/crm/rules'))).toBe('403 FORBIDDEN');
      expect(said(await s.get('dana', '/api/v1/apps/desk/rules'))).toBe('403 FORBIDDEN');
      // The owner holds every grant, and still reads one app at a time.
      expect((await rules('owner', 'desk')).map((rule) => rule.key)).toEqual(['ticket-made']);
    });

    it('refuses somebody with no staff grant on the app, somebody signed out, and an app that is not there', async () => {
      // Reads the app's rows in the dashboard; holds no staff grant.
      const refused = await s.get('bea', '/api/v1/apps/crm/rules');
      expect(said(refused)).toBe('403 FORBIDDEN');
      expect(refused.body).not.toContain('nudge-stale');
      expect((await s.app.inject({ method: 'GET', url: '/api/v1/apps/crm/rules' })).statusCode).toBe(401);
      // No grant on an app that is not installed either: refused the same, so the answer says nothing of what is installed.
      expect(said(await s.get('dana', '/api/v1/apps/billing/rules'))).toBe('403 FORBIDDEN');
      expect(said(await s.get('owner', '/api/v1/apps/billing/rules'))).toBe('404 NOT_FOUND');
      // A key that is no key.
      expect((await s.get('dana', '/api/v1/apps/CRM%2F..%2Fdesk/rules')).statusCode).toBeGreaterThanOrEqual(400);
    });

    it('answers nothing once the app is switched off, and again once it is back', async () => {
      expect(said(await s.send('owner', 'POST', '/api/v1/apps/crm/disable'))).toBe('ok');
      try {
        const res = await s.get('dana', '/api/v1/apps/crm/rules');
        expect(res.statusCode).toBeGreaterThanOrEqual(403);
        expect(res.body).not.toContain('nudge-stale');
        // The owner is told it is not installed (switched off), and reads no rule either.
        expect(said(await s.get('owner', '/api/v1/apps/crm/rules'))).toBe('404 NOT_FOUND');
      } finally {
        expect(said(await s.send('owner', 'POST', '/api/v1/apps/crm/enable'))).toBe('ok');
      }
      expect((await rules('dana')).length).toBe(2);
    });

    it('is read by somebody whose role opens only the app’s own screens, who still reads nothing of the rules’ own routes', async () => {
      expect((await rules('tab')).map((rule) => [rule.key, rule.on])).toEqual([['nudge-stale', false], ['deal-won', true]]);
      expect((await s.get('tab', '/api/v1/automations')).json().error?.code).toBe('APP_SCREENS_ONLY');
      expect((await s.get('tab', `/api/v1/automations/${await ruleId('deal-won')}`)).json().error?.code).toBe('APP_SCREENS_ONLY');
      expect((await s.get('tab', '/api/v1/apps/desk/rules')).json().error?.code).toBe('APP_SCREENS_ONLY');
      expect((await s.get('tab', '/api/v1/apps/crm/parts')).json().error?.code).toBe('APP_SCREENS_ONLY');
      // The people of the app who also use the dashboard are refused the rules' own routes as before.
      for (const who of ['dana', 'ivy', 'rosa']) expect(said(await s.get(who, '/api/v1/automations')), who).toMatch(/^403/);
    });
  });
}

describe('the screens-only list', () => {
  const allowed = (method: string, route: string, params: unknown, apps: readonly string[] = ['crm']) => allowedForScreensOnly(method, route, params, new Set(['conn_1']), apps);
  const RULES = '/api/v1/apps/:key/rules';

  it('lets a screens-only person read the rules of their own app: that route, a GET, and that app', () => {
    expect(allowed('GET', RULES, { key: 'crm' })).toBe(true);
    expect(allowed('GET', RULES, { key: 'desk' })).toBe(false);
    expect(allowed('GET', RULES, { key: 'crm' }, [])).toBe(false);
    expect(allowed('POST', RULES, { key: 'crm' })).toBe(false);
    expect(allowed('PUT', RULES, { key: 'crm' })).toBe(false);
    expect(allowed('DELETE', RULES, { key: 'crm' })).toBe(false);
    expect(allowed('GET', RULES, { key: ['crm'] })).toBe(false);
    expect(allowed('GET', RULES, null)).toBe(false);
    // Its neighbours stay closed.
    for (const route of ['/api/v1/apps/:key/parts', '/api/v1/apps/:key/settings', '/api/v1/apps/:key/overview', '/api/v1/apps/:key', '/api/v1/automations', '/api/v1/automations/:id']) {
      expect(allowed('GET', route, { key: 'crm', id: 'x' }), route).toBe(false);
    }
  });
});

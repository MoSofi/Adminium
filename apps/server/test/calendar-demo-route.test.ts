// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The built-in demo calendar exists only on a server that says it is a
 * developer's or a test's. Anywhere else its route is not there and no demo
 * account can attach, because a demo's made-up busy times would block real
 * bookings.
 */
import { readFileSync } from 'node:fs';

import { connectedAccountsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { demoCalendarFor } from '../src/calendar-sync/provider.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const KEY = 'calendar-test';
const ROUTE = '/api/v1/calendar-sync/row/demo';
const BUSY = [{ start: '2030-01-07T09:00:00.000Z', end: '2030-01-07T10:00:00.000Z' }];

function manifest(): Record<string, unknown> {
  const tables = [
    {
      ref: 'team',
      connectedAccounts: { from: [KEY], address: 'email', name: 'name', active: 'active' },
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text', maxLength: 40 },
        { ref: 'email', type: 'text', maxLength: 254, nullable: true },
        { ref: 'active', type: 'bool', default: true },
      ],
    },
  ];
  return {
    ...invoicingManifest(tables),
    compatibility: { minAdminiumVersion: '0.3.71' },
    addOns: { suggests: [{ key: KEY, range: '>=1.0.0', reason: { 'en-US': 'Calendars.' } }] },
    pages: [{ ref: 'studio-team', template: 'page-crud', title: { key: 't', fallback: 'Team' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'team' } }],
    roles: [
      { key: 'writer', name: 'Writer', permissions: ['app:@:staff', 'table:@team:read', 'table:@team:update'] },
      { key: 'reader', name: 'Reader', permissions: ['app:@:staff', 'table:@team:read'] },
    ],
  };
}

/** Composes a server with `NODE_ENV` as given, unset included, and puts it back at once. */
async function underNodeEnv<T>(value: string | undefined, make: () => Promise<T>): Promise<T> {
  const before = process.env['NODE_ENV'];
  if (value === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = value;
  try {
    return await make();
  } finally {
    process.env['NODE_ENV'] = before;
  }
}

describe('which servers get a demo calendar', () => {
  it.each(['test', 'development'])('%s does', (value) => {
    expect(demoCalendarFor(value)).not.toBeNull();
  });

  it.each([undefined, '', 'production', 'staging', 'Test', ' development', 'dev'])('%s does not', (value) => {
    expect(demoCalendarFor(value)).toBeNull();
  });

  it('is never in the published API description', () => {
    expect(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')).not.toContain('/calendar-sync/row/demo');
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the demo calendar route on ${dialect}`, () => {
    let h: InvoicingHarness;
    let served: Awaited<ReturnType<typeof servePublic>>;
    let team: string;
    const cookies: Record<string, string> = {};
    const accounts = () => connectedAccountsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
    const target = (row: number) => ({ connectionId: h.connectionId, tableName: team, rowKey: String(row) });
    const attach = (app: typeof served.composed.app, who: string, row: number) =>
      app.inject({ method: 'POST', url: ROUTE, headers: { cookie: cookies[who]! }, payload: { connection: h.connectionId, table: team, row: String(row), busy: BUSY } });

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest());
      served = await servePublic(h, null, { ADMINIUM_NETWORK_FEATURES: 'true', ADMINIUM_PUBLIC_ORIGIN: '', ADMINIUM_TRUST_PROXY: 'true' });
      const view = await loadSnapshotView(h.meta, h.connectionId);
      team = view.model.tables.find((one) => one.name === h.real('team'))!.id;
      const yes = dialect === 'postgres' ? 'TRUE' : '1';
      for (const row of [1, 2, 3]) await h.rows(`INSERT INTO ${h.real('team')} (id, name, email, active) VALUES (${String(row)}, 'P${String(row)}', 'p${String(row)}@studio.dev', ${yes})`);
      const hash = await adminPasswordHash();
      for (const who of ['writer', 'reader']) {
        const user = await usersRepo(h.meta).create({ email: `${who}-${dialect}@studio.dev`, name: who, passwordHash: hash, status: 'active' });
        await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(`studio-${who}`))!.id);
        const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: ADMIN_PASSWORD }, remoteAddress: `198.51.100.${who === 'writer' ? '1' : '2'}` });
        expect(login.statusCode, login.body).toBe(200);
        cookies[who] = sessionCookie(login.headers['set-cookie']);
      }
    });

    afterAll(async () => {
      await served?.close();
      await h?.close();
    });

    it('under test, lets a row writer attach one and refuses a reader without update', async () => {
      const app = served.composed.app;
      expect(app.hasRoute({ method: 'POST', url: ROUTE })).toBe(true);

      const refused = await attach(app, 'reader', 1);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(await accounts().forTarget(target(1))).toEqual([]);

      const taken = await attach(app, 'writer', 1);
      expect(taken.statusCode, taken.body).toBe(200);
      expect(taken.json()).toEqual({ ok: true });
      const [account] = await accounts().forTarget(target(1));
      expect(account?.subject.startsWith('demo:')).toBe(true);
    });

    it.each([['unset', undefined], ['production', 'production'], ['anything else', 'staging']] as const)('with NODE_ENV %s, the route is not there and nothing can attach', async (_name, value) => {
      const closed = await underNodeEnv(value, () => servePublic(h, null, { ADMINIUM_NETWORK_FEATURES: 'true', ADMINIUM_PUBLIC_ORIGIN: '', ADMINIUM_TRUST_PROXY: 'true' }));
      try {
        expect(closed.composed.calendarSync.demo).toBeNull();
        expect(closed.composed.app.hasRoute({ method: 'POST', url: ROUTE })).toBe(false);
        const asked = await attach(closed.composed.app, 'writer', 2);
        expect(asked.statusCode, asked.body).toBe(404);
        expect(await closed.composed.calendarSync.attachDemo(target(3))).toBeNull();
        expect(await accounts().forTarget(target(2))).toEqual([]);
        expect(await accounts().forTarget(target(3))).toEqual([]);
      } finally {
        await closed.close();
      }
    });
  });
}

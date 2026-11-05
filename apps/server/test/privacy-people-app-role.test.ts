// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOP'S OWNER FINDS, DOWNLOADS AND ERASES A CUSTOMER: `privacy:@:people`.
 *
 * An app's role may carry the one privacy right a business needs to answer a
 * customer's request: find everything the workspace keeps about an address,
 * download it, and erase the person (`system:privacy:people`). Never the
 * privacy notice, never the websites — those stay `privacy.manage`, the Super
 * Admin's. The install check names the roles that would hold it; a
 * screens-only role and an add-on's role are refused it; a version that
 * drops it takes it back.
 *
 * It reaches the apps whose roles give it, and nothing else: the clinic on
 * the same server keeps a patient with the same address, and the shop's
 * owner never finds, downloads or erases her. Nor may they look up a staff
 * account's address (their own included): erasing it would rewrite the audit
 * log. The Super Admin's search is unchanged. On every engine this run can
 * reach.
 */
import { permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { roleIssues } from '../src/apps/manifest-roles.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const ANA = 'ana@example.com';

const shop = (version = '1.0.0', ownerGrants: string[] = ['table:@customers:read', 'privacy:@:people']): Doc => ({
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'A shop.' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.47' },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'customers', keyField: 'name', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
      { ref: 'orders', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
    ],
  },
  pages: [{ ref: 'shop-customers', template: 'page-crud', title: { key: 't', fallback: 'Customers' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'customers' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  people: [{ table: 'customers', kind: 'people', email: 'email', name: 'name', copies: [{ table: 'orders', column: 'email', holds: 'email', via: 'customer_id' }] }],
  roles: [
    { key: 'owner', name: 'Owner', permissions: ownerGrants },
    { key: 'packer', name: 'Packer', screensOnly: true, permissions: ['app:@:staff', 'table:@customers:read'] },
  ],
});

/** Another app on the same database, whose people the shop's owner is nothing to. */
const clinic = (): Doc => ({
  kind: 'app',
  manifestVersion: 1,
  key: 'clinic',
  name: 'Clinic',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'A clinic.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.3.47' },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'patients', keyField: 'name', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
      { ref: 'settings', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }] },
      {
        ref: 'messages',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'kind', type: 'enum', enum: ['reminder'] },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
          { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
          { ref: 'error', type: 'text', maxLength: 200, nullable: true },
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
        ],
      },
    ],
  },
  // The clinic's own mail to its patients: never the shop owner's to find.
  outbox: {
    table: 'messages',
    columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
    links: {},
    recipient: { via: 'patient_id', table: 'patients', email: 'email', name: 'name' },
    settings: { table: 'settings', name: 'name' },
    kinds: { reminder: 'clinic-reminder' },
    classes: { reminder: 'service' },
  },
  emailTemplates: [{ key: 'clinic-reminder', name: 'clinic-reminder', locales: { 'en-US': { subject: 'Your visit', blocks: [{ block: 'email.text', data: { text: 'See you soon.' } }] } } }],
  pages: [{ ref: 'clinic-patients', template: 'page-crud', title: { key: 't', fallback: 'Patients' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'patients' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  people: [{ table: 'patients', kind: 'people', email: 'email', name: 'name' }],
  roles: [{ key: 'nurse', name: 'Nurse', permissions: ['table:@patients:read'] }],
});

/** The refusal of a staff account's address, by its code. */
const STAFF = 'olga@shop.dev';

describe.each(LEGS)("an app's role erases a customer (privacy:@:people) — %s", (dialect, available) => {
  let h: Harness;
  let served: Served;
  const cookies = new Map<string, string>();
  let at = 0;

  const signIn = async (who: string, slug: string): Promise<string> => {
    const member = await usersRepo(h.meta).create({ email: `${who}@shop.dev`, name: who, passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(member.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    at += 1;
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.6.0.${String(at)}`, payload: { email: `${who}@shop.dev`, password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    return sessionCookie(login.headers['set-cookie']);
  };
  const send = (who: string, method: string, url: string, payload?: Doc) =>
    served.composed.app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: { cookie: cookies.get(who)! }, ...(payload === undefined ? {} : { payload }) });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
    expect(planned.statusCode, planned.body).toBe(200);
    expect((planned.json() as { plan: { privacyGrants?: unknown } }).plan.privacyGrants).toEqual([{ role: 'shop-owner', roleName: 'Owner' }]);
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageApp(clinic());
    const second = await h.install('clinic', '1.0.0');
    expect(second.statusCode, second.body).toBe(200);
    await h.rows(`INSERT INTO clinic_patients (id, name, email) VALUES (1, 'Ana Lopes', '${ANA}')`);
    await h.rows(`INSERT INTO clinic_messages (id, kind, status, to_address, patient_id) VALUES (1, 'reminder', 'sent', '${ANA}', 1)`);
    await h.rows(`INSERT INTO shop_customers (id, name, email) VALUES (1, 'Ana Lopes', '${ANA}'), (2, 'Ben Other', 'ben@example.com')`);
    await h.rows(`INSERT INTO shop_orders (id, customer_id, email) VALUES (1, 1, '${ANA}'), (2, 2, 'ben@example.com')`);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    cookies.set('owner', await signIn('olga', 'shop-owner'));
    cookies.set('packer', await signIn('pat', 'shop-packer'));
    cookies.set('admin', await signIn('pia', 'super-admin'));
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('the owner holds the console key for a person\'s data, and nothing more of privacy', async () => {
    const role = (await rolesRepo(h.meta).findBySlug('shop-owner'))!;
    const rows = await permissionsRepo(h.meta).listForRole(role.id);
    expect(rows.filter((row) => row.resourceKind === 'system').map((row) => row.resourceRef)).toEqual(['privacy.people']);
    const boot = await send('owner', 'GET', '/bootstrap');
    expect(boot.statusCode, boot.body).toBe(200);
    const actions = (boot.json() as { data: { systemActions: string[] } }).data.systemActions;
    expect(actions).toContain('privacy.people');
    expect(actions).not.toContain('privacy.manage');
  });

  it.skipIf(!available)("the Super Admin's search is unchanged: the shop's customer and the clinic's patient", async () => {
    const found = await send('admin', 'POST', '/privacy/find', { address: ANA });
    expect(found.statusCode, found.body).toBe(200);
    const tables = (found.json() as { data: { sources: { table: string | null }[] } }).data.sources.map((source) => source.table ?? '');
    expect(tables.some((table) => table.endsWith('shop_customers'))).toBe(true);
    expect(tables.some((table) => table.endsWith('clinic_patients'))).toBe(true);
    expect(tables.some((table) => table.endsWith('clinic_messages'))).toBe(true);
    // …and may look up a staff account's address.
    expect((await send('admin', 'POST', '/privacy/find', { address: STAFF })).statusCode).toBe(200);
  });

  it.skipIf(!available)("the owner may not look up, download or erase a staff account's address", async () => {
    for (const [url, payload] of [
      ['/privacy/find', { address: STAFF }],
      ['/privacy/what-stays', { address: STAFF }],
      ['/privacy/exports', { address: STAFF }],
      ['/privacy/erase/preview', { address: STAFF }],
      ['/privacy/erase', { address: STAFF, confirm: STAFF }],
    ] as const) {
      const res = await send('owner', 'POST', url, payload);
      expect(res.statusCode, `${url} ${res.body}`).toBe(403);
      expect((res.json() as { error: { code: string; message: string } }).error).toMatchObject({ code: 'STAFF_ADDRESS', message: expect.stringContaining('member of staff') });
    }
    // Written nowhere: no download was asked for.
    expect((await h.meta.db.selectFrom('adminium_privacy_exports').select('id').execute()).length).toBe(0);
  });

  it.skipIf(!available)("the owner's download holds the shop's customer and nothing of the clinic", async () => {
    const asked = await send('owner', 'POST', '/privacy/exports', { address: ANA });
    expect(asked.statusCode, asked.body).toBe(202);
    const exportId = (asked.json() as { data: { id: string } }).data.id;
    while ((await served.composed.jobs.worker.runOnce()) > 0);
    const file = await send('owner', 'GET', `/privacy/exports/${exportId}/download`);
    expect(file.statusCode, file.body).toBe(200);
    const zip = unzipSync(new Uint8Array(file.rawPayload));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['people-shop-customers.json']));
    expect(Object.keys(zip).filter((name) => name.includes('clinic'))).toEqual([]);
    expect(Object.values(zip).map((bytes) => strFromU8(bytes)).join('\n')).not.toContain('clinic_');
  });

  it.skipIf(!available)("the owner finds the customer, sees what goes and erases her; Ben and the clinic's patient stay", async () => {
    const found = await send('owner', 'POST', '/privacy/find', { address: ANA });
    expect(found.statusCode, found.body).toBe(200);
    expect(JSON.stringify(found.json())).toContain('shop_orders');
    expect(JSON.stringify(found.json())).not.toContain('clinic_');
    const preview = await send('owner', 'POST', '/privacy/erase/preview', { address: ANA });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(JSON.stringify(preview.json())).not.toContain('clinic_');
    const erased = await send('owner', 'POST', '/privacy/erase', { address: ANA, confirm: ANA });
    expect(erased.statusCode, erased.body).toBe(200);
    const left = await h.rows('SELECT id, email FROM shop_customers ORDER BY id');
    expect(JSON.stringify(left)).not.toContain(ANA);
    expect(JSON.stringify(left)).toContain('ben@example.com');
    // The clinic's patient is whole, and the do-not-email list (the workspace's) was not touched.
    expect(JSON.stringify(await h.rows('SELECT email FROM clinic_patients'))).toContain(ANA);
    expect(JSON.stringify(await h.rows('SELECT to_address FROM clinic_messages'))).toContain(ANA);
    expect((erased.json() as { data: { counts: Record<string, number> } }).data.counts['stop-list']).toBeUndefined();
    // The Super Admin still finds her at the clinic.
    expect(JSON.stringify((await send('admin', 'POST', '/privacy/find', { address: ANA })).json())).toContain('clinic_patients');
  });

  it.skipIf(!available)('the owner may not change the privacy notice or the websites', async () => {
    expect((await send('owner', 'GET', '/privacy/notice')).statusCode).toBe(403);
    expect((await send('owner', 'GET', '/privacy/websites')).statusCode).toBe(403);
  });

  it.skipIf(!available)('a role of the app without it is refused the search', async () => {
    expect((await send('packer', 'POST', '/privacy/find', { address: 'ben@example.com' })).statusCode).toBe(403);
  });

  it.skipIf(!available)('a version that drops it takes it back', async () => {
    await h.stageApp(shop('1.0.1', ['table:@customers:read']));
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.1' } });
    expect(updated.statusCode, updated.body).toBe(200);
    const role = (await rolesRepo(h.meta).findBySlug('shop-owner'))!;
    expect((await permissionsRepo(h.meta).listForRole(role.id)).filter((row) => row.resourceKind === 'system')).toEqual([]);
    expect((await send('owner', 'POST', '/privacy/find', { address: 'ben@example.com' })).statusCode).toBe(403);
  });
});

describe('who may carry privacy:@:people', () => {
  it('a screens-only role and an add-on\'s role are refused it, by name', () => {
    const app = shop();
    (app['roles'] as Doc[])[1]!['permissions'] = ['app:@:staff', 'privacy:@:people'];
    expect(roleIssues(app as never).map((issue) => issue.message)).toEqual([
      'The role "packer": "privacy:@:people" is used on the dashboard\'s privacy page, which a screens-only role never opens: give it to a role that opens the dashboard.',
    ]);
    const addOn = { ...ledgerKitManifest(), roles: [{ key: 'manager', name: 'Manager', permissions: ['privacy:@:people'] }] };
    expect(roleIssues(addOn as never).map((issue) => issue.message)).toEqual(['The role "manager": "privacy:@:people" is given by an app\'s role, never an add-on\'s.']);
  });
});

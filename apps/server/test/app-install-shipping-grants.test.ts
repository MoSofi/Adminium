// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FIRST INSTALL ASKS BEFORE IT GIVES A RIGHT ON THE APP'S LABELS, on SQLite,
 * Postgres and MySQL.
 *
 * The check lists one entry per role and right, each ticked. What the
 * installer unticks is not given, by role AND right, so a packer can keep
 * booking and never cancel. It is remembered as settled: an update never hands
 * it over, and one that adds a new right still asks.
 */
import { randomBytes } from 'node:crypto';

import { rolesRepo, permissionsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { grantsFromMatrixRows } from '../src/rbac/permissions.js';
import { installAppBody } from '../src/routes/apps/schema.js';
import { addOnHarness, appManifest, ENGINES, type Dialect, type Harness } from './app-add-ons.helpers.js';

type Role = { key: string; name: string; permissions: string[] };

const ROLES: Role[] = [
  { key: 'packer', name: 'Packer', permissions: ['table:@orders:read', 'shipping:@:book', 'shipping:@:cancel'] },
  { key: 'owner', name: 'Owner', permissions: ['table:@orders:read', 'shipping:@:book', 'shipping:@:cancel', 'shipping:@:customs'] },
];

function shop(version = '1.0.0', roles: Role[] = ROLES): Record<string, unknown> {
  return appManifest('shop', {
    name: 'Shop',
    version,
    compatibility: { minAdminiumVersion: '0.3.72', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'number', type: 'text', maxLength: 40, nullable: true },
            { ref: 'ship_name', type: 'text', maxLength: 120, nullable: true },
            { ref: 'ship_line1', type: 'text', maxLength: 120, nullable: true },
            { ref: 'ship_city', type: 'text', maxLength: 120, nullable: true },
            { ref: 'ship_postcode', type: 'text', maxLength: 20, nullable: true },
            { ref: 'ship_country', type: 'text', maxLength: 40, nullable: true },
            { ref: 'tracking', type: 'text', maxLength: 64, nullable: true },
            { ref: 'carrier_name', type: 'text', maxLength: 80, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'shop-orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'shop', icon: 'home', order: 1 }, bindings: { rows: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    roles,
    shipping: {
      orders: [
        {
          table: 'orders',
          reference: 'number',
          tracking: 'tracking',
          carrier: 'carrier_name',
          address: { name: 'ship_name', lines: ['ship_line1'], city: 'ship_city', postcode: 'ship_postcode', country: 'ship_country' },
        },
      ],
    },
  });
}

/** A database of its own on the same server, whichever the engine: a second copy of the app goes there. */
async function anotherDatabase(h: Harness, dialect: Dialect): Promise<{ id: string; drop: () => Promise<void> }> {
  if (dialect === 'sqlite') return { id: await h.addConnection('Second'), drop: async () => undefined };
  const name = `adminium_tick_${randomBytes(4).toString('hex')}`;
  let dsn: string;
  let drop: () => Promise<void>;
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const base = process.env['TEST_POSTGRES_URL'] as string;
    const admin = new Client({ connectionString: base });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = new Client({ connectionString: base });
      await again.connect();
      await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await again.end();
    };
  } else {
    const mysql = await import('mysql2/promise');
    const base = process.env['TEST_MYSQL_URL'] as string;
    const admin = await mysql.createConnection(base);
    await admin.query(`CREATE DATABASE \`${name}\``);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = await mysql.createConnection(base);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    };
  }
  const made = await h.manager.connections.create({ name: 'Second', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: made.id });
  return { id: made.id, drop };
}

describe('the install body', () => {
  const body = (shippingUnticked: unknown) => installAppBody.safeParse({ key: 'shop', version: '1.0.0', shippingUnticked }).success;

  it('takes a role and one of the three rights, and refuses anything else', () => {
    expect(body([{ role: 'shop-packer', action: 'cancel' }])).toBe(true);
    expect(body([{ role: 'shop-packer', action: 'refund' }])).toBe(false);
    expect(body([{ role: 'shop-packer' }])).toBe(false);
    expect(body(['shop-packer'])).toBe(false);
    expect(body([{ role: 'shop-packer', action: 'book', extra: true }])).toBe(false);
  });
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`the install's tick card for shipping rights [${dialect}]`, () => {
    let h: Harness | null = null;
    let second: { drop: () => Promise<void> } | null = null;
    afterEach(async () => {
      await h?.close();
      h = null;
      await second?.drop();
      second = null;
    });

    /** The label rights a role holds, by action. */
    const rights = async (slug: string): Promise<string[]> => {
      const role = (await rolesRepo(h!.meta).findBySlug(slug))!;
      const grants = grantsFromMatrixRows(await permissionsRepo(h!.meta).listForRole(role.id));
      return [...grants].filter((grant) => grant.startsWith('shipping:')).map((grant) => grant.split(':')[2]!).sort();
    };
    const update = (payload: Record<string, unknown> = {}) => h!.inject({ method: 'POST', url: '/apps/shop/update', payload });

    it('lists each role and right on the check, and gives every right left ticked', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      const planned = await h.plan(shop());
      expect(planned.statusCode, planned.body).toBe(200);
      // The wizard draws its cards on a check that lists the tables: a real app's always does.
      expect((planned.json() as { plan: { tables?: unknown[] } }).plan.tables?.length).toBeGreaterThan(0);
      expect((planned.json() as { plan: { shippingGrants: unknown[] } }).plan.shippingGrants).toEqual([
        { role: 'shop-packer', roleName: 'Packer', action: 'book' },
        { role: 'shop-packer', roleName: 'Packer', action: 'cancel' },
        { role: 'shop-owner', roleName: 'Owner', action: 'book' },
        { role: 'shop-owner', roleName: 'Owner', action: 'cancel' },
        { role: 'shop-owner', roleName: 'Owner', action: 'customs' },
      ]);
      const installed = await h.install('shop', '1.0.0');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book', 'cancel']);
      expect(await rights('shop-owner')).toEqual(['book', 'cancel', 'customs']);
    });

    it('lets one role keep book and lose cancel, and an update never hands it over', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(shop());
      const installed = await h.install('shop', '1.0.0', { shippingUnticked: [{ role: 'shop-packer', action: 'cancel' }] });
      expect(installed.statusCode, installed.body).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book']);
      // The other role's same right is its own.
      expect(await rights('shop-owner')).toEqual(['book', 'cancel', 'customs']);

      await h.stageApp(shop('1.1.0'));
      const same = await update();
      expect(same.statusCode, same.body).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book']);
    });

    it('still asks when an update adds a right, and adds only that one', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(shop());
      expect((await h.install('shop', '1.0.0', { shippingUnticked: [{ role: 'shop-packer', action: 'cancel' }] })).statusCode).toBe(200);

      const more = ROLES.map((role) => (role.key === 'packer' ? { ...role, permissions: [...role.permissions, 'shipping:@:customs'] } : role));
      await h.stageApp(shop('1.2.0', more));
      const refused = await update();
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.details.shippingGrants).toEqual([{ role: 'shop-packer', roleName: 'Packer', action: 'customs' }]);
      expect(await rights('shop-packer')).toEqual(['book']);

      const allowed = await update({ roleGrants: true });
      expect(allowed.statusCode, allowed.body).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book', 'customs']);
    });

    it('changes nothing for a role or right the app does not grant', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(shop());
      const installed = await h.install('shop', '1.0.0', {
        shippingUnticked: [
          { role: 'shop-nobody', action: 'book' },
          // The packer is not given customs, so there is nothing to untick.
          { role: 'shop-packer', action: 'customs' },
        ],
      });
      expect(installed.statusCode, installed.body).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book', 'cancel']);
      expect(await rights('shop-owner')).toEqual(['book', 'cancel', 'customs']);
    });

    it('takes back a right unticked when the install is run again', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(shop());
      expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book', 'cancel']);
      const again = await h.install('shop', '1.0.0', { shippingUnticked: [{ role: 'shop-packer', action: 'cancel' }] });
      expect(again.statusCode, again.body).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book']);
    });

    it('gives a right the card left ticked on a second install, and keeps it away when nobody was asked', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(shop());
      expect((await h.install('shop', '1.0.0', { shippingUnticked: [{ role: 'shop-packer', action: 'cancel' }] })).statusCode).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book']);
      // No answer sent: the earlier untick stands.
      expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book']);
      // The card was shown with it ticked, and the person pressed Install.
      expect((await h.install('shop', '1.0.0', { shippingUnticked: [] })).statusCode).toBe(200);
      expect(await rights('shop-packer')).toEqual(['book', 'cancel']);
    });

    it('does not hand a settled right to a role an update makes again after it was deleted', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(shop());
      expect((await h.install('shop', '1.0.0', { shippingUnticked: [{ role: 'shop-packer', action: 'cancel' }] })).statusCode).toBe(200);
      const role = (await rolesRepo(h.meta).findBySlug('shop-packer'))!;
      await h.meta.db.deleteFrom('adminium_roles').where('id', '=', role.id).execute();

      await h.stageApp(shop('1.1.0'));
      const updated = await update();
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await rights('shop-packer')).not.toContain('cancel');
    });

    it("honours an untick on a later copy, whose role's slug differs from the check's", async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(shop());
      expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
      const other = await anotherDatabase(h, dialect);
      second = other;
      const installed = await h.install('shop', '1.0.0', { connectionId: other.id, shippingUnticked: [{ role: 'shop-packer', action: 'cancel' }] });
      expect(installed.statusCode, installed.body).toBe(200);
      const copy = (await rolesRepo(h.meta).list()).find((role) => role.appKey === 'shop' && role.slug !== 'shop-packer' && role.slug.endsWith('-packer'))!;
      expect(await rights(copy.slug)).toEqual(['book']);
      // The first copy's role is its own, and keeps what it was given.
      expect(await rights('shop-packer')).toEqual(['book', 'cancel']);
    });
  });
}

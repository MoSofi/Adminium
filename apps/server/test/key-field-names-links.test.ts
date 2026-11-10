// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK TO A ROW IS NAMED BY THE KEY FIELD ITS TABLE DECLARES.
 *
 * A shop's orders are named by their number (`keyField: "number"`) and also
 * keep the customer's `name`. A proof links to its order: its form's picker,
 * and every chip of the link, name the order "BR-2276", not "Iris P." (the
 * column a guess picks first, and the same for four orders of one customer).
 * A table that declares no key field keeps the guess, and so does one whose
 * key field is no name: customers keyed by their e-mail are called by name,
 * and a payment is never named by its card's last digits.
 *
 * The proofs' list page, stored once at install, names the link the same way
 * when a person of the shop reads it: its chips follow the key field as the
 * picker does.
 *
 * On every engine this run can reach.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { columnFactsFor } from '../src/routes/pages/column-facts.js';
import { addOnHarness, appManifest, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

function shop(): Record<string, unknown> {
  return appManifest('shop', {
    version: '1.0.0',
    compatibility: { minAdminiumVersion: '0.3.44', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'orders', keyField: 'number', columns: [pk, { ref: 'number', type: 'text', maxLength: 16, nullable: true, unique: true }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }] },
        { ref: 'makers', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'code', type: 'text', maxLength: 16, nullable: true, unique: true }] },
        // Keyed by their address, called by their name.
        { ref: 'customers', keyField: 'email', columns: [pk, { ref: 'email', type: 'text', maxLength: 254, nullable: true, unique: true }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }] },
        // Keyed by a card's last digits, never named by them.
        { ref: 'payments', keyField: 'card_last4', columns: [pk, { ref: 'client_key', type: 'text', maxLength: 64, nullable: true, unique: true }, { ref: 'card_last4', type: 'text', maxLength: 4, nullable: true }] },
        {
          ref: 'proofs',
          columns: [
            pk,
            { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
            { ref: 'maker_id', type: 'fk', references: 'makers', nullable: true },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'payment_id', type: 'fk', references: 'payments', nullable: true },
            { ref: 'note', type: 'text', maxLength: 80, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'shop-proofs', template: 'page-crud', title: { key: 'mft.shop.proofs', fallback: 'Proofs' }, nav: { group: 'manage', icon: 'image', order: 1 }, bindings: { rows: 'proofs' } }],
    roles: [{ key: 'owner', name: 'Owner', permissions: ['table:@proofs:read', 'table:@orders:read', 'table:@makers:read', 'page:@shop-proofs:view'] }],
  });
}

describe.each(LEGS)('a link named by its table\'s key field — %s', (dialect, available) => {
  let h: Harness;
  let proofs: string;

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect);
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    proofs = model.tables.find((table) => table.name === 'shop_proofs')!.id;
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await h?.close();
  });

  it.skipIf(!available)('names an order by its number, and a maker (no key field) by the guess', async () => {
    const facts = await columnFactsFor(h.meta, h.connectionId, proofs);
    const fk = (name: string) => facts!.columns.find((column) => column.spec['name'] === name)!.spec['fk'] as { display?: string };
    expect(fk('order_id').display).toBe('number');
    expect(fk('maker_id').display).toBe('name');
  });

  it.skipIf(!available)("names the link on the proofs' list page the same way, read by the shop's owner", async () => {
    const served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    try {
      const user = await usersRepo(h.meta).create({ email: 'owner@shop.test', name: 'Owner', passwordHash: await adminPasswordHash() });
      await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('shop-owner'))!.id);
      const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.14.0.1', payload: { email: 'owner@shop.test', password: ADMIN_PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      const page = await h.meta.db.selectFrom('adminium_pages').select('id').where('slug', '=', 'shop-proofs').executeTakeFirstOrThrow();
      const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/pages/${page.id}`, headers: { cookie: sessionCookie(login.headers['set-cookie']) } });
      expect(res.statusCode, res.body).toBe(200);
      const columns = ((res.json() as { data: { config: { columns: { name: string; fk?: { display?: string } }[] } } }).data.config.columns);
      expect(columns.find((column) => column.name === 'order_id')?.fk?.display).toBe('number');
      expect(columns.find((column) => column.name === 'maker_id')?.fk?.display).toBe('name');
    } finally {
      await served.close();
    }
  });

  it.skipIf(!available)('names a customer keyed by e-mail by name, and a payment keyed by its card digits by something else', async () => {
    const facts = await columnFactsFor(h.meta, h.connectionId, proofs);
    const fk = (name: string) => facts!.columns.find((column) => column.spec['name'] === name)!.spec['fk'] as { display?: string };
    expect(fk('customer_id').display).toBe('name');
    expect(fk('payment_id').display).not.toBe('card_last4');
  });
});

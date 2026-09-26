// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A least-privilege Postgres role — SELECT on every table, writes on some —
 * connected as the data role (live PG, Northwind).
 *
 * - the connection is NOT read-only: the role may write somewhere;
 * - a table the role may write takes the write;
 * - a table it may only read refuses up front with 403 `READ_ONLY_MODE`
 *   (`reason: 'privileges'`), and the row never reaches the database;
 * - a right revoked after the rights were read is the database's refusal,
 *   mapped to the same 403 rather than a 500;
 * - a table granted BY COLUMN (`GRANT UPDATE (territory_description)`): the
 *   granted column saves, with Adminium's own `updated_at` stamp left out rather
 *   than failing the write; a column outside the grant is refused by name; and
 *   the page's column facts say which is which.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { providerFromModule } from '../src/connections/register-adapters.js';
import { columnFactsFor } from '../src/routes/pages/column-facts.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  createNorthwindDb,
  introspectViaApi,
  PG_HOST,
  PG_PORT,
  pgAvailable,
  psql,
  type DataTestContext,
  type TestPg,
} from './connections-helpers.js';

const adapterReady = await (async () => {
  try {
    return providerFromModule(await import('@adminium/adapter-postgres')) !== null;
  } catch {
    return false;
  }
})();

describe.skipIf(!(adapterReady && pgAvailable()))('table grants of the data role (live PG, Northwind)', () => {
  let pg: TestPg;
  let t: DataTestContext;
  let connId: string;
  let role: string;

  beforeAll(async () => {
    pg = createNorthwindDb();
    role = `${pg.database}_dml`;
    psql('postgres', `CREATE ROLE ${role} LOGIN PASSWORD 'dml_secret'`);
    psql(pg.database, `GRANT CONNECT ON DATABASE ${pg.database} TO ${role}`);
    psql(pg.database, `GRANT USAGE ON SCHEMA public TO ${role}`);
    psql(pg.database, `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
    psql(pg.database, `GRANT INSERT, UPDATE, DELETE ON products, shippers TO ${role}`);
    // A column Adminium stamps on every update, on a table granted one column.
    psql(pg.database, 'ALTER TABLE territories ADD COLUMN updated_at timestamptz');
    psql(pg.database, `GRANT UPDATE (territory_description) ON territories TO ${role}`);
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, `postgres://${role}:dml_secret@${PG_HOST}:${PG_PORT}/${pg.database}`);
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true, create: true, update: true, delete: true });
  });

  afterAll(async () => {
    await t.app.close();
    pg.drop();
    psql('postgres', `DROP ROLE IF EXISTS ${role}`);
  });

  const count = (table: string) => Number(psql(pg.database, `SELECT count(*) FROM ${table}`).trim());

  it('does not mark the connection read-only', async () => {
    expect((await t.manager.mustFind(connId)).readOnly).toBe(false);
  });

  it('writes a table the role may write', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/public.products`,
      headers: asUser(t.users.admin),
      payload: { values: { product_id: 901, product_name: 'Granted Brew', discontinued: 0 } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('refuses every write to a table the role may only read, before the database', async () => {
    const before = count('categories');
    const create = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/public.categories`,
      headers: asUser(t.users.admin),
      payload: { values: { category_id: 99, category_name: 'Refused' } },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error).toMatchObject({
      code: 'READ_ONLY_MODE',
      details: { table: 'public.categories', reason: 'privileges' },
    });
    for (const method of ['PATCH', 'DELETE'] as const) {
      const res = await t.app.inject({
        method,
        url: `/api/v1/data/${connId}/public.categories/1`,
        headers: asUser(t.users.admin),
        ...(method === 'PATCH' ? { payload: { values: { category_name: 'Refused' } } } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('READ_ONLY_MODE');
    }
    expect(count('categories')).toBe(before);
  });

  it("maps the database's own refusal to the same 403", async () => {
    // The rights were read (and are trusted for a minute) while INSERT was granted.
    const first = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/public.shippers`,
      headers: asUser(t.users.admin),
      payload: { values: { shipper_id: 90, company_name: 'Before' } },
    });
    expect(first.statusCode).toBe(201);
    psql(pg.database, `REVOKE INSERT ON shippers FROM ${role}`);
    const second = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/public.shippers`,
      headers: asUser(t.users.admin),
      payload: { values: { shipper_id: 91, company_name: 'After' } },
    });
    expect(second.statusCode).toBe(403);
    expect(second.json().error).toMatchObject({ code: 'READ_ONLY_MODE', details: { reason: 'privileges' } });
  });

  it('saves a column granted by column, leaving out a stamp the role may not write', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/public.territories/01581`,
      headers: asUser(t.users.admin),
      payload: { values: { territory_description: 'Westborough' } },
    });
    expect(res.statusCode).toBe(200);
    expect(psql(pg.database, "SELECT trim(territory_description), updated_at IS NULL FROM territories WHERE territory_id = '01581'").trim()).toBe(
      'Westborough|t',
    );
  });

  it('writes nothing for a save with nothing in it', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/public.territories/01730`,
      headers: asUser(t.users.admin),
      payload: { values: {} },
    });
    expect(res.statusCode, res.body).toBe(200);
    // No stamp, no Undo of nothing.
    expect(res.json().undoToken).toBeNull();
    expect(psql(pg.database, "SELECT updated_at IS NULL FROM territories WHERE territory_id = '01730'").trim()).toBe('t');
  });

  it('refuses a column outside the grant, by name', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/public.territories/01581`,
      headers: asUser(t.users.admin),
      payload: { values: { territory_description: 'Elsewhere', region_id: 2 } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({
      code: 'READ_ONLY_MODE',
      details: { table: 'public.territories', columns: ['region_id'], reason: 'privileges' },
    });
    expect(psql(pg.database, "SELECT region_id FROM territories WHERE territory_id = '01581'").trim()).toBe('1');
  });

  it("tells the form which columns each mode may set", async () => {
    const rights = await t.manager.tablePrivileges(await t.manager.mustFind(connId));
    const block = await columnFactsFor(t.meta, connId, 'public.territories', undefined, rights);
    const facts = Object.fromEntries((block?.columns ?? []).map((column) => [column.spec['name'], column]));
    expect(facts['territory_description']).toMatchObject({ insertable: false, updatable: true });
    expect(facts['region_id']).toMatchObject({ insertable: false, updatable: false });
    // Without the grants the facts say what they always said.
    const plain = await columnFactsFor(t.meta, connId, 'public.territories');
    expect(plain?.columns.find((column) => column.spec['name'] === 'region_id')).not.toHaveProperty('updatable');
  });
});


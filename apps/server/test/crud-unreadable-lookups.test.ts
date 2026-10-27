// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A lookup into a table the connection's DATABASE role may not read (live PG,
 * Northwind) — the shape of every Supabase app, whose tables key to `auth.users`.
 *
 * - the list still loads: the refused lookup is `null` and listed in `_masked`,
 *   and a lookup the role may read still carries its value;
 * - the single-record GET does the same;
 * - a list of the refused table itself is a 403 that says READ, and names it.
 *
 * The right is taken away after the schema was read: introspection already
 * leaves out a table the role may not read (`tables-unreadable`), so this is
 * the case it cannot see — a grant revoked, or a column grant that misses the
 * looked-up column.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { providerFromModule } from '../src/connections/register-adapters.js';
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

describe.skipIf(!(adapterReady && pgAvailable()))('lookups the data role may not read (live PG, Northwind)', () => {
  let pg: TestPg;
  let t: DataTestContext;
  let connId: string;
  let role: string;

  const lookups =
    'lookup=customer_name:customer_id.company_name&lookup=employee_name:employee_id.last_name';

  beforeAll(async () => {
    pg = createNorthwindDb();
    role = `${pg.database}_app`;
    psql('postgres', `CREATE ROLE ${role} LOGIN PASSWORD 'app_secret'`);
    psql(pg.database, `GRANT CONNECT ON DATABASE ${pg.database} TO ${role}`);
    psql(pg.database, `GRANT USAGE ON SCHEMA public TO ${role}`);
    psql(pg.database, `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, `postgres://${role}:app_secret@${PG_HOST}:${PG_PORT}/${pg.database}`);
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true });
    // Read with the right; now taken away.
    psql(pg.database, `REVOKE SELECT ON customers FROM ${role}`);
  });

  afterAll(async () => {
    await t.app.close();
    pg.drop();
    psql('postgres', `DROP ROLE IF EXISTS ${role}`);
  });

  it('loads the list, with the refused lookup empty and marked, the other one filled', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.orders?limit=5&${lookups}`,
      headers: asUser(t.users.admin),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row['customer_name']).toBeNull();
      expect(row['_masked']).toContain('customer_name');
      expect(typeof row['employee_name']).toBe('string');
      expect(row['_masked']).not.toContain('employee_name');
    }
  });

  it('does the same on a keyset page', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.orders?limit=3&cursor=&${lookups}`,
      headers: asUser(t.users.admin),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3);
    expect(rows[0]?.['customer_name']).toBeNull();
  });

  it('loads one record the same way', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.orders/10248?${lookups}`,
      headers: asUser(t.users.admin),
    });
    expect(res.statusCode).toBe(200);
    const row = res.json().data as Record<string, unknown>;
    expect(row['customer_name']).toBeNull();
    expect(row['_masked']).toContain('customer_name');
    expect(typeof row['employee_name']).toBe('string');
  });

  it('answers a list of the refused table with a 403 that says read, naming it', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.customers?limit=5`,
      headers: asUser(t.users.admin),
    });
    expect(res.statusCode).toBe(403);
    const error = res.json().error as { code: string; message: string; details: unknown };
    expect(error.code).toBe('SOURCE_READ_REFUSED');
    expect(error.details).toMatchObject({ reason: 'privileges', object: { kind: 'table', name: 'customers' } });
    expect(error.message).not.toContain('change');
  });
});

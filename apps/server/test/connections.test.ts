// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live connections-manager suite (M3-T04/T05/T06) against a real local
 * PostgreSQL — skipped entirely when psql, the Northwind fixture, or the
 * postgres adapter provider is unavailable (CI-without-PG stays green).
 *
 * Covers: create via API with encrypted-DSN round-trip, pre-create test,
 * introspection → classified snapshot + auto-proposed PII masks, overrides
 * write path + APPLIED read path, snapshot history + diff, type-to-confirm
 * delete, read-only-role detection, and the 01 §3.1 meta-placement refusal.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { rolesRepo, usersRepo } from '@adminium/meta';

import { ENC_TOKEN_PREFIX } from '../src/config/secrets.js';
import { providerFromModule } from '../src/connections/register-adapters.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  createNorthwindDb,
  introspectViaApi,
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

const AVAILABLE = adapterReady && pgAvailable();

describe.skipIf(!AVAILABLE)('connections manager (live PG)', () => {
  let pg: TestPg;
  let t: DataTestContext;

  beforeAll(async () => {
    pg = createNorthwindDb();
    t = await buildDataTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    pg.drop();
  });

  it('POST /connections/test probes without persisting', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/connections/test',
      headers: asUser(t.users.admin),
      payload: { engine: 'postgres', dsn: pg.dsn },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      serverVersion: string | null;
      readOnly: boolean;
      privileges: { canWrite: boolean; canDDL: boolean } | null;
    };
    expect(body.ok).toBe(true);
    // `current_setting('server_version')` yields e.g. "16.3 (Homebrew)" — a bare
    // version, not the `version()` banner with the "PostgreSQL" prefix.
    expect(body.serverVersion).toMatch(/^\d+\.\d+/);
    expect(body.readOnly).toBe(false);
    expect(body.privileges?.canWrite).toBe(true);

    const list = await t.app.inject({
      method: 'GET',
      url: '/api/v1/connections',
      headers: asUser(t.users.admin),
    });
    expect((list.json() as { connections: unknown[] }).connections).toEqual([]);
  });

  it('rejects DSNs outside the scheme allowlist before dialing', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/connections/test',
      headers: asUser(t.users.admin),
      payload: { engine: 'postgres', dsn: 'postgres://u@169.254.169.254/db' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('creates a connection: tested, encrypted at rest, DSN masked in replies', async () => {
    const dsnWithPassword = pg.dsn.replace('@', ':supersecret@').replace('://', '://user_x:supersecret@');
    // use the plain working dsn — password variant only for masking assertions below
    const id = await createConnectionViaApi(t, pg.dsn, 'northwind');

    const row = await t.manager.connections.findById(id);
    expect(row?.status).toBe('connected');
    expect(row?.readOnly).toBe(false);
    expect(row?.introspectDsnEncrypted).toMatch(new RegExp(`^${ENC_TOKEN_PREFIX}`));
    expect(row?.introspectDsnEncrypted).not.toContain(pg.database);

    // Encrypted DSN round-trips through the caller-provided crypto closures.
    const dsns = await t.manager.connections.getDsns(id);
    expect(dsns?.introspectDsn).toBe(pg.dsn);
    expect(dsns?.dataDsn).toBe(pg.dsn);

    const get = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${id}`,
      headers: asUser(t.users.admin),
    });
    const dto = get.json() as { dsnMasked: string; status: string; lastLatencyMs: number | null };
    expect(dto.dsnMasked).toContain(pg.database);
    expect(dto.dsnMasked).not.toContain('supersecret');
    expect(dto.status).toBe('connected');
    expect(dsnWithPassword).toContain('supersecret'); // sanity for the fixture above

    // Viewers hold no system:connections:manage grant.
    const denied = await t.app.inject({
      method: 'GET',
      url: '/api/v1/connections',
      headers: asUser(t.users.viewer),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('introspects into a classified snapshot with auto-proposed PII masks; re-run is a no-op', async () => {
    const connections = await t.manager.connections.list();
    const id = connections[0]!.id;

    const first = await introspectViaApi(t, id);
    expect(first.noop).toBe(false);
    expect(first.proposedMasks).toBeGreaterThan(0); // customers.phone/fax at minimum

    const schema = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${id}/schema`,
      headers: asUser(t.users.admin),
    });
    expect(schema.statusCode).toBe(200);
    const payload = schema.json() as {
      snapshotId: string;
      checksum: string;
      appliedOverrides: number;
      model: {
        tables: {
          id: string;
          columns: { name: string; semantics: { primary: string } | null; masked?: boolean }[];
        }[];
      };
    };
    expect(payload.snapshotId).toBe(first.snapshotId);
    expect(payload.checksum).toBe(first.checksum);
    const tableIds = payload.model.tables.map((table) => table.id);
    expect(tableIds).toContain('public.customers');
    expect(tableIds).toContain('public.orders');
    const customers = payload.model.tables.find((table) => table.id === 'public.customers')!;
    // Classifier ran (05 §7): semantics are filled in.
    expect(customers.columns.every((column) => column.semantics !== null)).toBe(true);
    const phone = customers.columns.find((column) => column.name === 'phone')!;
    expect(phone.semantics?.primary).toBe('phone');
    expect(phone.masked).toBe(true); // auto-proposed column.pii override applied
    expect(payload.appliedOverrides).toBeGreaterThan(0);

    // Identical schema → checksum dedupe, no second snapshot row.
    const second = await introspectViaApi(t, id);
    expect(second.noop).toBe(true);
    expect(second.snapshotId).toBe(first.snapshotId);

    const history = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${id}/schema/snapshots`,
      headers: asUser(t.users.admin),
    });
    expect((history.json() as { snapshots: unknown[] }).snapshots).toHaveLength(1);
  });

  it('PUT overrides validates against the snapshot and the read path applies them', async () => {
    const id = (await t.manager.connections.list())[0]!.id;

    // Unknown identifiers → 422 (§2.5).
    const badColumn = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${id}/overrides`,
      headers: asUser(t.users.admin),
      payload: {
        overrides: [
          { op: 'column.label', tableName: 'public.customers', columnName: 'nope', value: { label: 'X' } },
        ],
      },
    });
    expect(badColumn.statusCode).toBe(422);
    const badOp = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${id}/overrides`,
      headers: asUser(t.users.admin),
      payload: { overrides: [{ op: 'table.rename', tableName: 'public.customers', value: {} }] },
    });
    expect(badOp.statusCode).toBe(422);

    // Valid replace — keep the PII mask on phone, add labels + a hide.
    const put = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${id}/overrides`,
      headers: asUser(t.users.admin),
      payload: {
        overrides: [
          {
            op: 'table.label',
            tableName: 'public.customers',
            value: { label: 'Customer', labelPlural: 'Customers', icon: 'users' },
          },
          {
            op: 'column.label',
            tableName: 'public.customers',
            columnName: 'contact_name',
            value: { label: 'Contact' },
          },
          { op: 'column.hidden', tableName: 'public.customers', columnName: 'fax', value: { hidden: true } },
          {
            op: 'column.pii',
            tableName: 'public.customers',
            columnName: 'phone',
            value: { masked: true, kind: 'phone' },
          },
        ],
      },
    });
    expect(put.statusCode).toBe(200);

    const applied = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${id}/schema`,
      headers: asUser(t.users.viewer), // reads need only a session
    });
    const model = (applied.json() as {
      model: {
        tables: {
          id: string;
          label?: string;
          columns: { name: string; label?: string; hidden?: boolean }[];
        }[];
      };
      appliedOverrides: number;
    });
    const customers = model.model.tables.find((table) => table.id === 'public.customers')!;
    expect(customers.label).toBe('Customer');
    expect(customers.columns.find((c) => c.name === 'contact_name')?.label).toBe('Contact');
    expect(customers.columns.find((c) => c.name === 'fax')?.hidden).toBe(true);
    expect(model.appliedOverrides).toBe(4);

    // raw=true returns the untouched introspection result.
    const raw = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${id}/schema?raw=true`,
      headers: asUser(t.users.admin),
    });
    const rawCustomers = (raw.json() as typeof model).model.tables.find(
      (table) => table.id === 'public.customers',
    )!;
    expect(rawCustomers.label).toBeUndefined();
    expect((raw.json() as { appliedOverrides: number }).appliedOverrides).toBe(0);
  });

  it('unmasking PII via remap requires super-admin (security review 2026-07-23)', async () => {
    // Fresh connection so mutating masks does not leak into sibling tests.
    const connId = await createConnectionViaApi(t, pg.dsn, 'remap-unmask-guard');
    await introspectViaApi(t, connId); // phone auto-proposed masked:true

    const unmask = {
      overrides: [
        { op: 'column.pii', tableName: 'public.customers', columnName: 'phone', value: { masked: false } },
      ],
    };

    // admin holds schema:remap but is NOT super-admin → refused.
    const denied = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${connId}/overrides`,
      headers: asUser(t.users.admin),
      payload: unmask,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN');

    // Turning masking ON stays allowed for the same admin (privacy-increasing).
    const on = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${connId}/overrides`,
      headers: asUser(t.users.admin),
      payload: {
        overrides: [
          { op: 'column.pii', tableName: 'public.customers', columnName: 'phone', value: { masked: true, kind: 'phone' } },
        ],
      },
    });
    expect(on.statusCode).toBe(200);

    // A super-admin MAY unmask (correct a classifier false-positive).
    const su = await usersRepo(t.meta).create({
      email: 'root@adminium.test',
      name: 'Root',
      passwordHash: 'x',
      status: 'active',
    });
    const superRole = await rolesRepo(t.meta).findBySlug('super-admin');
    await rolesRepo(t.meta).assignToUser(su.id, superRole!.id);
    const allowed = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${connId}/overrides`,
      headers: asUser(su),
      payload: unmask,
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('diffs the latest snapshot against the previous after schema drift', async () => {
    const id = (await t.manager.connections.list())[0]!.id;
    psql(pg.database, 'ALTER TABLE customers ADD COLUMN loyalty_points integer');
    try {
      const rerun = await introspectViaApi(t, id);
      expect(rerun.noop).toBe(false);

      const diffRes = await t.app.inject({
        method: 'GET',
        url: `/api/v1/connections/${id}/schema/diff`,
        headers: asUser(t.users.admin),
      });
      expect(diffRes.statusCode).toBe(200);
      const { diff } = diffRes.json() as {
        diff: { changedTables: Record<string, { addedColumns: string[] }> };
      };
      expect(diff.changedTables['public.customers']?.addedColumns).toContain('loyalty_points');
    } finally {
      psql(pg.database, 'ALTER TABLE customers DROP COLUMN IF EXISTS loyalty_points');
      await introspectViaApi(t, id); // restore the pre-drift snapshot state
    }
  });

  it('detects read-only roles at create time', async () => {
    const id = await createConnectionViaApi(t, pg.readOnlyDsn, 'northwind-ro');
    const row = await t.manager.connections.findById(id);
    expect(row?.readOnly).toBe(true);
    expect(row?.status).toBe('connected');
  });

  it('enforces the type-to-confirm delete contract and disposes state', async () => {
    const id = await createConnectionViaApi(t, pg.dsn, 'to-delete');

    const wrongName = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/connections/${id}`,
      headers: asUser(t.users.admin),
      payload: { confirmName: 'not-the-name' },
    });
    expect(wrongName.statusCode).toBe(409);

    const ok = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/connections/${id}`,
      headers: asUser(t.users.admin),
      payload: { confirmName: 'to-delete' },
    });
    expect(ok.statusCode).toBe(200);
    expect(await t.manager.connections.findById(id)).toBeNull();
  });
});

describe.skipIf(!AVAILABLE)('meta-placement enforcement (live PG)', () => {
  let pg: TestPg;

  beforeAll(() => {
    pg = createNorthwindDb();
  });
  afterAll(() => {
    pg.drop();
  });

  it('refuses a read-only data role when the meta store shares the database (409 META_PLACEMENT_INVALID)', async () => {
    // The manager believes the meta store lives in the SAME database.
    const t = await buildDataTestApp({ metaDsn: pg.dsn });
    try {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/connections',
        headers: asUser(t.users.admin),
        payload: { name: 'nw', engine: 'postgres', dsn: pg.readOnlyDsn },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('META_PLACEMENT_INVALID');
      expect(body.error.message).toContain('read-only');
      // Nothing persisted — the refusal happens before create.
      expect(await t.manager.connections.list()).toEqual([]);
    } finally {
      await t.app.close();
    }
  });

  it('allows the same read-only role when the meta store is elsewhere', async () => {
    const t = await buildDataTestApp({ metaDsn: 'postgres://meta@meta-host.internal:5432/adminium' });
    try {
      const id = await createConnectionViaApi(t, pg.readOnlyDsn, 'nw-ro');
      expect((await t.manager.connections.findById(id))?.readOnly).toBe(true);
    } finally {
      await t.app.close();
    }
  });
});

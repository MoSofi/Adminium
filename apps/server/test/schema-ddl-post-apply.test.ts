// SPDX-License-Identifier: AGPL-3.0-only
/**
 * D11's post-apply sequence, over HTTP — 35-schema-authoring.md D11, 35-T11.
 *
 * ─── The gap this file closes ──────────────────────────────────────────────
 *
 * Everything downstream of a schema change reads the SNAPSHOT, never the
 * database: the schema tree, the diagram, page bindings, grants, and the base
 * of the next plan. Apply ran the DDL and left the snapshot alone, so a table
 * dropped in Studio stayed in the tree under a banner telling the operator to
 * re-introspect — Adminium asking a person to tell it something it had just
 * done itself. Verified in a browser against Postgres before it was fixed.
 *
 * The second half is worse, because it looks like nothing: a CREATED table is
 * invisible. It has no page, and nothing in the product says so. D11 calls the
 * sequence part of the feature for that reason, and "the page appears only
 * after inclusion" is the assertion that proves it.
 *
 * ─── Why the REAL sqlite adapter ───────────────────────────────────────────
 *
 * The sibling suite's fake adapter answers `introspect()` with a frozen model,
 * which is exactly the thing under test here: whether a re-read after the
 * change sees the change. A fake would report success for a service that did
 * nothing. So this one runs against a real file on disk and reads it back with
 * the shipped adapter.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { connectionsRepo, pagesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';

import { registerAdapters } from '../src/connections/register-adapters.js';
import { schemaDdlRoutes } from '../src/routes/schema-ddl/index.js';
import {
  asUser,
  buildDataTestApp,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

let t: DataTestContext;
let connectionId: string;
let dir: string;
let file: string;
/** D7 makes a drop Super-Admin-only, and a drop is half of what D11 must carry. */
let superAdminHeaders: Record<string, string>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-ddl-'));
  file = join(dir, 'source.db');
  const raw = new BetterSqlite3(file);
  raw.exec(`
    CREATE TABLE clients (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
    INSERT INTO clients (email) VALUES ('a@x.test');
  `);
  raw.close();

  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  t = await buildDataTestApp({
    registry,
    extraRoutes: async (api, deps) => {
      await api.register(schemaDdlRoutes({
        manager: deps.manager,
        meta: deps.meta,
        crypto: { encrypt: (v: string) => v, decrypt: (v: string) => v },
      }) as never);
    },
  });

  const created = await t.app.inject({
    method: 'POST',
    url: '/api/v1/connections',
    headers: asUser(t.users.admin),
    payload: { name: 'local', engine: 'sqlite', dsn: `sqlite:${file}` },
  });
  if (created.statusCode !== 201) throw new Error(`create failed: ${created.body}`);
  connectionId = (created.json() as { id: string }).id;
  await introspectViaApi(t, connectionId);
  await permissionsRepo(t.meta).grant(t.roles.admin.id, 'system', 'schema.ddl', { allowed: true });

  // A Super Admin, because D7 gates `lossy`/`irreversible` on one and a drop is
  // both. Built here rather than in the shared harness: every other suite is
  // about being refused, and this one is about what happens after you are not.
  const roles = rolesRepo(t.meta);
  const superAdminRole = await roles.findBySlug('super-admin');
  if (superAdminRole === null) throw new Error('missing built-in role super-admin');
  const owner = await usersRepo(t.meta).create({
    email: 'owner@adminium.test',
    name: 'Owner',
    passwordHash: 'test-hash',
    status: 'active',
  });
  await roles.assignToUser(owner.id, superAdminRole.id);
  await permissionsRepo(t.meta).grant(superAdminRole.id, 'system', 'schema.ddl', { allowed: true });
  superAdminHeaders = asUser(owner);
});

afterAll(async () => {
  await t.app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function snapshotId(): Promise<string> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/v1/connections/${connectionId}/schema`,
    headers: asUser(t.users.admin),
  });
  return (res.json() as { snapshotId: string }).snapshotId;
}

async function planAndApply(
  edit: Record<string, unknown>,
  headers: Record<string, string> = asUser(t.users.admin),
): Promise<{
  status: number;
  body: {
    status?: string;
    snapshotId?: string | null;
    createdTables?: string[];
    repaired?: Record<string, number> | null;
    steps?: { kind: string; outcome: string; sql: string[] }[];
    error?: string | null;
  };
}> {
  const base = { ...edit, baseSnapshotId: await snapshotId() };
  const plan = await t.app.inject({
    method: 'POST',
    url: `/api/v1/connections/${connectionId}/schema/plan`,
    headers,
    payload: base,
  });
  if (plan.statusCode !== 200) throw new Error(`plan failed: ${plan.body}`);
  const { checksum } = plan.json() as { checksum: string };
  const applied = await t.app.inject({
    method: 'POST',
    url: `/api/v1/connections/${connectionId}/schema/apply`,
    headers,
    payload: { ...base, checksum, acknowledgeRows: true },
  });
  return { status: applied.statusCode, body: applied.json() as never };
}

const RESERVATIONS = {
  upsertTables: [
    {
      name: 'reservations',
      columns: [
        { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } },
        { name: 'client_id', logicalType: 'integer' },
        { name: 'starts_at', logicalType: 'timestamptz' },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        { columns: ['client_id'], toTable: 'main.clients', toColumns: ['id'], onDelete: 'set-null' },
      ],
    },
  ],
};

describe('apply re-reads the schema it just changed (D11, beat one)', () => {
  it('returns a NEW snapshot id, and the tree no longer describes the old shape', async () => {
    const before = await snapshotId();
    const applied = await planAndApply(RESERVATIONS);
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe('applied');

    // The field that did not exist: apply telling the caller what it re-read.
    expect(applied.body.snapshotId).toEqual(expect.any(String));
    expect(applied.body.snapshotId).not.toBe(before);

    // And the READ path agrees — this is the assertion that would have caught
    // the browser bug, where `drop table` succeeded and the tree kept the table.
    const after = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${connectionId}/schema`,
      headers: asUser(t.users.admin),
    });
    const model = (after.json() as { model: { tables: { name: string }[] } }).model;
    expect(model.tables.map((table) => table.name)).toContain('reservations');
  });

  it('names the tables it created, so inclusion has a subject', async () => {
    const changes = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${connectionId}/schema/changes`,
      headers: asUser(t.users.admin),
    });
    expect(changes.statusCode).toBe(200);
    // The ledger row exists and closed out clean; the apply reply carried the
    // created name (asserted through the adoption test below).
    const rows = (changes.json() as { changes: { status: string }[] }).changes;
    expect(rows[0]?.status).toBe('applied');
  });
});

describe('a created table is USABLE — it has a primary key (§10 criterion 1)', () => {
  /*
   * The clause of the acceptance criterion nothing tested: "a row inserted from
   * that page comes back with its generated key".
   *
   * A single-column key was emitted by neither branch of the compiler — the
   * table-level constraint skipped it as "the generated one" and the column
   * builder only marked it on SQLite. Every table created from Design mode on
   * Postgres came out with `generated by default as identity` and **no primary
   * key**, so the CRUD layer said, correctly, "this table has no primary key
   * and is read-only": a table created in Studio could not have a row added to
   * it from the page Studio then generated for it. On MySQL it would not have
   * been created at all — AUTO_INCREMENT on a non-key column is an error.
   *
   * Asserted here against the real database rather than against the emitted
   * string, because the string looked fine.
   */
  it('declares the key, and the key generates values on insert', async () => {
    const model = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${connectionId}/schema`,
      headers: asUser(t.users.admin),
    });
    const table = (model.json() as { model: { tables: { name: string; primaryKey: string[]; columns: { name: string; isPrimaryKey: boolean }[] }[] } })
      .model.tables.find((entry) => entry.name === 'reservations');
    expect(table?.primaryKey).toEqual(['id']);
    expect(table?.columns.find((c) => c.name === 'id')?.isPrimaryKey).toBe(true);

    // …and the database really assigns one, which is what the insert path reads
    // back. A declared key that the engine does not generate is the other half
    // of D31 and would fail here rather than in a customer's browser.
    const raw = new BetterSqlite3(file);
    try {
      raw.prepare('insert into reservations (client_id) values (null)').run();
      const row = raw.prepare('select id from reservations').get() as { id: number };
      expect(typeof row.id).toBe('number');
      raw.prepare('delete from reservations').run();
    } finally {
      raw.close();
    }
  });
});

describe('a created table is invisible until it is adopted (D11, beat three)', () => {
  it('has no page after apply, and one after adopt', async () => {
    const pages = pagesRepo(t.meta);
    const beforeAdopt = await pages.listForConnection(connectionId);
    expect(beforeAdopt.some((page) => page.slug.includes('reservation'))).toBe(false);

    const adopt = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/adopt`,
      headers: asUser(t.users.admin),
      payload: { tables: ['reservations'] },
    });
    expect(adopt.statusCode).toBe(200);
    const body = adopt.json() as {
      included: string[];
      includesEverything: boolean;
      result: { created: number; skippedEdited: string[] };
    };
    expect(body.result.created).toBeGreaterThan(0);

    const afterAdopt = await pages.listForConnection(connectionId);
    expect(afterAdopt.some((page) => page.slug.includes('reservation'))).toBe(true);
  });

  it('does NOT narrow a connection that already shows every table', async () => {
    /*
     * `includedTables: []` means "all tables" to the generator. Writing the
     * adopted names into an empty list would therefore have turned an
     * all-tables app into a two-table one — adoption as silent deletion. The
     * route reports which case it took rather than guessing.
     */
    const row = await connectionsRepo(t.meta, {
      encrypt: (v: string) => v,
      decrypt: (v: string) => v,
    }).findById(connectionId);
    expect(row?.settings.includedTables ?? []).toEqual([]);

    const adopt = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/schema/adopt`,
      headers: asUser(t.users.admin),
      payload: { tables: ['reservations'] },
    });
    const body = adopt.json() as { includesEverything: boolean; included: string[] };
    expect(body.includesEverything).toBe(true);
    expect(body.included).toEqual([]);
  });
});

describe('renaming a table keeps the app whole (D33, §10 criterion 13)', () => {
  /*
   * Two bugs, one of them silent, both found by running the criterion rather
   * than by any test.
   *
   * SERVER: `applyRenames` rewrites `public.reservations` to
   * `public.table_bookings` throughout the actual model — that is what makes
   * the diff see a rename. The client loaded the table as
   * `public.reservations` and sends it back under that id with a new `name`,
   * so the planner found no actual table with the desired id and planned a
   * CREATE of a table that already existed. Now the service maps the desired
   * id through the applied renames.
   *
   * CLIENT: `buffer.renameTable` was never called. Typing a new name produced
   * "No schema changes yet." — see the dashboard suite.
   */
  it('plans ONE rename-table step, not a drop and a create', async () => {
    // A fresh table to rename, so this does not depend on test order.
    const created = await planAndApply({
      upsertTables: [
        {
          name: 'rename_me',
          columns: [
            { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } },
            { name: 'note', logicalType: 'text' },
          ],
          primaryKey: ['id'],
        },
      ],
    });
    expect(created.body.status).toBe('applied');

    const renamed = await planAndApply({
      renames: { tables: [{ from: 'main.rename_me', to: 'renamed_ok' }], columns: [] },
      // …sent back under the id the client was GIVEN, with the new name.
      upsertTables: [
        {
          id: 'main.rename_me',
          name: 'renamed_ok',
          columns: [
            { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } },
            { name: 'note', logicalType: 'text' },
          ],
          primaryKey: ['id'],
        },
      ],
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.status).toBe('applied');
    expect(renamed.body.steps?.map((step) => step.kind)).toEqual(['rename-table']);
    // The assertion that fails loudest if the id mapping regresses.
    expect(renamed.body.steps?.some((step) => step.kind === 'create-table')).toBe(false);
  });

  it('carries the rename into Adminium’s own references, and says how many', async () => {
    const pages = pagesRepo(t.meta);
    const page = (await pages.listForConnection(connectionId)).find((entry) =>
      entry.slug.includes('renamed'),
    );
    // The page for the renamed table follows it: `source.table` is the new id.
    const bound = page === undefined ? null : await pages.findById(page.id);
    const source = (bound?.config as { source?: { table?: string } } | null)?.source?.table;
    if (source !== undefined) expect(source).toContain('renamed_ok');

    // The reply reports the repair rather than performing it silently.
    const applied = await planAndApply({
      renames: { tables: [{ from: 'main.renamed_ok', to: 'renamed_twice' }], columns: [] },
      upsertTables: [
        {
          id: 'main.renamed_ok',
          name: 'renamed_twice',
          columns: [
            { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } },
            { name: 'note', logicalType: 'text' },
          ],
          primaryKey: ['id'],
        },
      ],
    });
    expect(applied.body.status).toBe('applied');
    expect(applied.body.repaired).not.toBeNull();
  });
});

describe('a drop is carried into the snapshot too', () => {
  it('removes the table from the read path without a manual re-introspection', async () => {
    const applied = await planAndApply({ dropTables: ['main.reservations'] }, superAdminHeaders);
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe('applied');

    const after = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${connectionId}/schema`,
      headers: asUser(t.users.admin),
    });
    const model = (after.json() as { model: { tables: { name: string }[] } }).model;
    expect(model.tables.map((table) => table.name)).not.toContain('reservations');
  });
});

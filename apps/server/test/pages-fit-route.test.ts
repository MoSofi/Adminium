// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/pages/fit` and the refusal it rewrote.
 *
 * Two things are on trial here, and they are the same thing seen from both
 * sides of the create:
 *
 *   BEFORE — the create screen asks what a template needs from a table and
 *   gets an answer it can act on: which required area is empty, which column
 *   would fill it if tagged, and which OTHER table already fits (remedy 0).
 *
 *   AFTER  — a create that still fails carries a sentence about the operator's
 *   table instead of `Required slot 'calendar' of 'page-calendar' has no
 *   accepted candidate`, with the structured report alongside it (D6: the
 *   field name is kept, the wording is rebuilt, the data is added).
 *
 * The route is also a static path sitting under `/pages/:pageId`, so one test
 * exists purely to prove the router does not swallow it as a page id.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  overridesRepo,
  rolesRepo,
  snapshotsRepo,
  usersRepo,
  type DsnCrypto,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { pagesRoutes } from '../src/routes/pages/index.js';
import { makeEnv } from './helpers.js';
import { withoutDefaultDataGrants } from './builtin-grants.js';

/** `adminium_connections` rows are FK targets here; the DSN is never read. */
const TEST_CRYPTO: DsnCrypto = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (token) => token.slice('enc:'.length),
};

/**
 * `appointments` carries a timestamp named `date` — the right type under a name
 * `r12-event-timestamp` does not tag, which is the common real case. `shifts`
 * carries `starts_at`, which it does.
 */
const SCHEMA_IR = {
  dialect: 'postgres',
  name: 'clinic',
  defaultSchema: 'public',
  schemas: ['public'],
  tables: [
    {
      schema: 'public',
      name: 'appointments',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'title', logicalType: 'text' },
        { name: 'date', logicalType: 'timestamptz' },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'shifts',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'name', logicalType: 'text' },
        { name: 'starts_at', logicalType: 'timestamptz' },
      ],
      primaryKey: ['id'],
    },
  ],
};

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  superAdmin: User;
  connectionId: string;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildHarness(schema: Record<string, unknown> = SCHEMA_IR): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await withoutDefaultDataGrants(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const role = await roles.findBySlug('super-admin');
  if (role === null) throw new Error('missing built-in role super-admin');
  const superAdmin = await users.create({
    email: 'ava@adminium.test',
    name: 'ava',
    passwordHash: 'h',
    status: 'active',
  });
  await roles.assignToUser(superAdmin.id, role.id);

  const connection = await connectionsRepo(meta, TEST_CRYPTO).create({
    name: 'clinic',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@localhost/clinic',
  });
  await snapshotsRepo(meta).create({
    connectionId: connection.id,
    source: 'introspection',
    schema,
    checksum: 'sha-clinic-1',
  });

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        const req = request as unknown as { user: unknown; session: unknown };
        req.user = user;
        req.session = { id: 'test-session', userId: user.id };
      }
    }
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(pagesRoutes({ meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, superAdmin, connectionId: connection.id };
}

describe('GET /pages/fit', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  const fit = (query: Record<string, string>) =>
    t.app.inject({
      method: 'GET',
      url: '/api/v1/pages/fit',
      query: { connectionId: t.connectionId, ...query },
      headers: asUser(t.superAdmin),
    });

  it('is not swallowed by /pages/:pageId', async () => {
    // A static segment under a param route. If the router ever prefers the
    // param, this returns a 404 for the page id "fit" and every test below
    // would be asserting against the wrong handler.
    const res = await fit({ table: 'public.appointments', template: 'page-calendar' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.template).toBe('page-calendar');
  });

  it('names the unfilled area and the column that would fix it', async () => {
    const res = await fit({ table: 'public.appointments', template: 'page-calendar' });
    const data = res.json().data as {
      satisfied: boolean;
      unfilled: { slot: string }[];
      requirements: {
        role: string;
        satisfiedBy: string | null;
        taggable: { column: string }[];
        wants: { suggestedNames: string[] };
      }[];
    };

    expect(data.satisfied).toBe(false);
    expect(data.unfilled.map((s) => s.slot)).toEqual(['calendar']);

    const date = data.requirements.find((r) => r.role === 'event-date');
    expect(date?.satisfiedBy).toBeNull();
    expect(date?.taggable.map((c) => c.column)).toEqual(['date']);
    expect(date?.wants.suggestedNames[0]).toBe('event_date');
  });

  it('says a fitting table fits (the control)', async () => {
    const res = await fit({ table: 'public.shifts', template: 'page-calendar' });
    const data = res.json().data as { satisfied: boolean; unfilled: unknown[] };
    // Without this, "unsatisfied" could be this route's only possible answer.
    expect(data.satisfied).toBe(true);
    expect(data.unfilled).toEqual([]);
  });

  it('withholds the alternatives unless they were asked for', async () => {
    const quiet = await fit({ table: 'public.appointments', template: 'page-calendar' });
    expect(quiet.json().data.alternatives).toBeUndefined();

    const asked = await fit({
      table: 'public.appointments',
      template: 'page-calendar',
      alternatives: 'true',
    });
    const offered = asked.json().data.alternatives as { tableId: string; reasons: string[] }[];
    // Remedy 0: the table the operator should have picked, named before any
    // repair is offered and without writing anything.
    expect(offered.map((o) => o.tableId)).toEqual(['public.shifts']);
    expect(offered[0]?.reasons.join(' ')).toMatch(/starts_at/);
  });

  it('answers about the same model the create route composes from', async () => {
    // An operator who has already tagged the column must not be told to tag it
    // again. The overlay has to be on BOTH paths or the report is about a
    // schema nothing composes from.
    await overridesRepo(t.meta).create(
      {
        connectionId: t.connectionId,
        op: 'column.semanticType',
        tableName: 'public.appointments',
        columnName: 'date',
        value: { semanticType: 'event-timestamp' },
      },
      1_000,
    );
    const res = await fit({ table: 'public.appointments', template: 'page-calendar' });
    expect(res.json().data.satisfied).toBe(true);
  });

  it('reports a non-table-bound template as unbindable', async () => {
    const res = await fit({ table: 'public.appointments', template: 'page-dashboard' });
    expect(res.json().data).toMatchObject({ bindable: false, satisfied: false });
  });
});

describe('the create refusal (D6)', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  it('explains the table, not the composer, and carries the report', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: asUser(t.superAdmin),
      payload: {
        slug: 'appointments-calendar',
        title: 'Appointments',
        template: 'page-calendar',
        navGroup: 'planning',
        connectionId: t.connectionId,
        table: 'public.appointments',
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { message: string; details?: Record<string, unknown> } };

    // The old text was `Required slot 'calendar' of 'page-calendar' has no
    // accepted candidate` — true about the composer, useless about the table.
    expect(body.error.message).toContain('a date on each row');
    expect(body.error.message).not.toMatch(/required slot/i);

    // The structured half, for a caller that can do something with it.
    const fit = body.error.details?.['fit'] as { requirements: { role: string }[] } | undefined;
    expect(fit?.requirements.map((r) => r.role)).toContain('event-date');
  });

  it('still creates the page when the table fits (the control)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: asUser(t.superAdmin),
      payload: {
        slug: 'shifts-calendar',
        title: 'Shifts',
        template: 'page-calendar',
        navGroup: 'planning',
        connectionId: t.connectionId,
        table: 'public.shifts',
      },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /pages/fit/new-table', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  const draft = (query: Record<string, string>) =>
    t.app.inject({
      method: 'GET',
      url: '/api/v1/pages/fit/new-table',
      query: { connectionId: t.connectionId, ...query },
      headers: asUser(t.superAdmin),
    });

  it('proposes a table that composes, skipping a name the connection already uses', async () => {
    // `appointments` exists in this schema, so the first suggestion is taken.
    const res = await draft({ template: 'page-calendar' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data.draft as {
      bindTableId: string;
      composes: boolean;
      nameProblem: string | null;
      tables: { name: string; columns: { name: string }[] }[];
    };
    expect(data.bindTableId).toBe('public.bookings');
    expect(data.composes).toBe(true);
    expect(data.nameProblem).toBeNull();
    expect(data.tables.at(-1)?.columns.map((c) => c.name)).toEqual(['id', 'title', 'event_date']);
  });

  it('echoes the operator’s name back with the verdict on it', async () => {
    const res = await draft({ template: 'page-calendar', name: 'appointments' });
    const data = res.json().data.draft as { nameProblem: string | null; composes: boolean };
    expect(data.nameProblem).toBe('taken');
    expect(data.composes).toBe(false);
  });

  it('answers null for a template with no repair descriptors (D4)', async () => {
    const res = await draft({ template: 'page-directory' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.draft).toBeNull();
  });

  it('a scheduler with no people table brings its own, created first', async () => {
    const res = await draft({ template: 'page-scheduler' });
    const data = res.json().data.draft as {
      tables: { name: string }[];
      composes: boolean;
      peopleTarget: string | null;
    };
    // `shifts` is taken here, so the table takes the next suggestion.
    expect(data.tables.map((table) => table.name)).toEqual(['staff', 'staff_shifts']);
    expect(data.peopleTarget).toBeNull();
    expect(data.composes).toBe(true);
  });
});

/**
 * Remedy 2 on the wire. `patients` has no date; `visits` has one and no text
 * column of its own — so neither backs a calendar alone, and the FK between
 * them is the only way to one that writes nothing to the database.
 */
const RELATED_IR = {
  dialect: 'postgres',
  name: 'clinic',
  defaultSchema: 'public',
  schemas: ['public'],
  tables: [
    {
      schema: 'public',
      name: 'patients',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'full_name', logicalType: 'text' },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'visits',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        {
          name: 'patient_id',
          logicalType: 'integer',
          references: { tableId: 'public.patients', column: 'id' },
        },
        { name: 'starts_at', logicalType: 'timestamptz' },
      ],
      primaryKey: ['id'],
    },
  ],
};

describe('remedy 2 — the related table, titled through the key', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness(RELATED_IR);
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  const create = (payload: Record<string, unknown>) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: asUser(t.superAdmin),
      payload: {
        slug: 'visits-calendar',
        title: 'Visits',
        template: 'page-calendar',
        navGroup: 'planning',
        connectionId: t.connectionId,
        table: 'public.visits',
        ...payload,
      },
    });

  it('offers the related table beside the alternatives', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/pages/fit',
      query: {
        connectionId: t.connectionId,
        table: 'public.patients',
        template: 'page-calendar',
        alternatives: 'true',
      },
      headers: asUser(t.superAdmin),
    });
    const data = res.json().data as { alternatives: unknown[]; related: unknown[] };
    expect(data.alternatives).toEqual([]);
    expect(data.related).toEqual([
      {
        tableId: 'public.visits',
        label: null,
        via: 'patient_id',
        titleColumn: 'full_name',
        dateColumn: 'starts_at',
      },
    ]);
  });

  it('creates the calendar titled through the key', async () => {
    const res = await create({ titleThrough: 'patient_id' });
    expect(res.statusCode).toBe(200);
    const id = (res.json() as { data: { id: string } }).data.id;
    const row = await t.meta.db
      .selectFrom('adminium_pages')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    const stored = typeof row.config === 'string' ? row.config : JSON.stringify(row.config);
    expect(stored).toContain('patient_id__display:patient_id.full_name');
    expect(stored).toContain('"titleLookup"');
  });

  it('refuses the same table without it (the control)', async () => {
    expect((await create({})).statusCode).toBe(422);
  });

  it('rebinds an existing page titled through the key (the edit screen\'s PATCH)', async () => {
    // Born unbound — the page `EmptyLayoutNotice` sends people to fix.
    const created = await create({ table: null });
    expect(created.statusCode).toBe(200);
    const id = (created.json() as { data: { id: string } }).data.id;

    const plain = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${id}`,
      headers: asUser(t.superAdmin),
      payload: { connectionId: t.connectionId, table: 'public.visits' },
    });
    // Alone, the linked table cannot carry the calendar…
    expect(plain.statusCode).toBe(422);

    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${id}`,
      headers: asUser(t.superAdmin),
      payload: { connectionId: t.connectionId, table: 'public.visits', titleThrough: 'patient_id' },
    });
    // …titled through the key, it can.
    expect(res.statusCode, res.body).toBe(200);
    const row = await t.meta.db
      .selectFrom('adminium_pages')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    const stored = typeof row.config === 'string' ? row.config : JSON.stringify(row.config);
    expect(stored).toContain('patient_id__display:patient_id.full_name');
  });

  it('refuses a column that is not a key, with the engine’s reason', async () => {
    const res = await create({ titleThrough: 'starts_at' });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { message: string } }).error.message).toMatch(/not a foreign key/);
  });
});

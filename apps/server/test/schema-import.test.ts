/**
 * POST /api/v1/schema-import/parse (M5-T01 schema-file source mode):
 * guard, sql-ddl + json-ir fallback parsing, preview summary counts,
 * unsupported-format and parse-failure 422s. Offline — no database needed.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { makeEnv } from './helpers.js';
import { schemaImportRoutes } from '../src/routes/schema-import/index.js';
import { fallbackParseSchemaFile, sniffFormat, SchemaParseError } from '../src/routes/schema-import/fallback-parser.js';

const NORTHWIND_ISH_SQL = `
-- a comment the parser must ignore
CREATE TABLE customers (
  id serial PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  full_name text NOT NULL,
  is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.orders (
  id bigserial,
  customer_id integer NOT NULL REFERENCES customers (id),
  total numeric(10, 2),
  placed_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);
`;

interface TestContext {
  app: AdminiumServer;
  meta: MetaDb;
  admin: User;
  viewer: User;
}

async function buildTestApp(): Promise<TestContext> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const roles = rolesRepo(meta);
  const users = usersRepo(meta);

  async function makeUser(name: string, roleSlug: string): Promise<User> {
    const role = await roles.findBySlug(roleSlug);
    if (role === null) throw new Error(`missing built-in role ${roleSlug}`);
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const admin = await makeUser('Ava', 'admin');
  const viewer = await makeUser('Liam', 'viewer');

  const app = await buildServer({ env: makeEnv(), logger: false });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(schemaImportRoutes());
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return { app, meta, admin, viewer };
}

describe('POST /api/v1/schema-import/parse', () => {
  let t: TestContext;

  beforeEach(async () => {
    t = await buildTestApp();
  });

  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  function parse(payload: unknown, user: User = t.admin) {
    return t.app.inject({
      method: 'POST',
      url: '/api/v1/schema-import/parse',
      headers: { 'x-test-user-id': user.id },
      payload: payload as Record<string, unknown>,
    });
  }

  it('requires system:connections:manage (viewer → 403, anonymous → 401)', async () => {
    const forbidden = await parse({ content: 'CREATE TABLE t (id int);' }, t.viewer);
    expect(forbidden.statusCode).toBe(403);
    const anonymous = await t.app.inject({
      method: 'POST',
      url: '/api/v1/schema-import/parse',
      payload: { content: 'CREATE TABLE t (id int);' },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('parses SQL DDL: tables, columns, PK, FK mirror, summary counts', async () => {
    const res = await parse({ content: NORTHWIND_ISH_SQL, fileName: 'acme_schema.sql' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      model: DatabaseModel;
      format: string;
      warnings: string[];
      summary: { tables: number; columns: number };
    };
    expect(body.format).toBe('sql-ddl');
    expect(body.summary.tables).toBe(2);
    expect(body.summary.columns).toBe(8);

    const customers = body.model.tables.find((table) => table.name === 'customers');
    expect(customers?.primaryKey).toEqual(['id']);
    expect(customers?.columns.find((c) => c.name === 'email')?.isUnique).toBe(true);
    expect(customers?.columns.find((c) => c.name === 'is_active')?.logicalType).toBe('boolean');

    const orders = body.model.tables.find((table) => table.name === 'orders');
    expect(orders?.id).toBe('public.orders');
    expect(orders?.primaryKey).toEqual(['id']);
    expect(orders?.columns.find((c) => c.name === 'customer_id')?.references).toEqual({
      tableId: 'public.customers',
      column: 'id',
    });
    expect(orders?.columns.find((c) => c.name === 'total')?.logicalType).toBe('decimal');
    expect(orders?.columns.find((c) => c.name === 'placed_at')?.logicalType).toBe('timestamptz');
    // Import provenance is recorded on the model.
    expect(body.model.source).toEqual({ kind: 'import', format: 'sql-ddl', fileName: 'acme_schema.sql' });
  });

  it("accepts the wizard alias format 'sql'", async () => {
    const res = await parse({ format: 'sql', content: 'CREATE TABLE notes (id int PRIMARY KEY, body text);' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { format: string }).format).toBe('sql-ddl');
  });

  it('parses a JSON model fragment (defaults dialect/name) and validates it', async () => {
    const fragment = {
      tables: [
        {
          name: 'projects',
          columns: [
            { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
            { name: 'title', logicalType: 'text' },
          ],
          primaryKey: ['id'],
        },
      ],
    };
    const res = await parse({ format: 'json', content: JSON.stringify(fragment), fileName: 'app.json' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { model: DatabaseModel; format: string; summary: { tables: number } };
    expect(body.format).toBe('json-ir');
    expect(body.summary.tables).toBe(1);
    expect(body.model.name).toBe('app');
    expect(body.model.tables[0]?.id).toBe('public.projects');
  });

  it('parses Prisma through the installed @adminium/schema-import package', async () => {
    // Pre-M9 this format 422'd via the fallback parser (its unit tests still
    // cover that path); with the package installed the full matrix works.
    const res = await parse({
      format: 'prisma',
      content: 'model User {\n  id Int @id\n  email String @unique\n}',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { format: string; summary: { tables: number } };
    expect(body.format).toBe('prisma');
    expect(body.summary.tables).toBe(1);
  });

  it('unknown format value → 422 body validation', async () => {
    const res = await parse({ format: 'xml', content: '<schema/>' });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('garbage input → 422 PARSE_FAILED, never a 500', async () => {
    const sql = await parse({ format: 'sql', content: 'this is not DDL at all' });
    expect(sql.statusCode).toBe(422);
    const json = await parse({ format: 'json', content: '{ definitely broken' });
    expect(json.statusCode).toBe(422);
  });
});

describe('fallbackParseSchemaFile unit behavior', () => {
  it('sniffs formats from content and file name', () => {
    expect(sniffFormat('{"tables": []}')).toBe('json-ir');
    expect(sniffFormat('CREATE TABLE a (id int);')).toBe('sql-ddl');
    expect(sniffFormat('gibberish', 'dump.sql')).toBe('sql-ddl');
    expect(sniffFormat('model User {}', 'schema.prisma')).toBe('prisma');
    expect(sniffFormat('gibberish')).toBeNull();
  });

  it('drops FK references pointing outside the file with a warning', () => {
    const result = fallbackParseSchemaFile(
      'CREATE TABLE items (id int PRIMARY KEY, owner_id int REFERENCES users (id));',
    );
    expect(result.model.tables[0]?.columns.find((c) => c.name === 'owner_id')?.references).toBeNull();
    expect(result.warnings.some((w) => w.includes('outside the file'))).toBe(true);
  });

  it('quoted/qualified identifiers and composite constraints parse', () => {
    const result = fallbackParseSchemaFile(`
      CREATE TABLE "app"."memberships" (
        "user_id" integer NOT NULL,
        "team_id" integer NOT NULL,
        CONSTRAINT memberships_pk PRIMARY KEY ("user_id", "team_id"),
        CONSTRAINT memberships_unique UNIQUE ("user_id", "team_id")
      );
    `);
    const table = result.model.tables[0];
    expect(table?.id).toBe('app.memberships');
    expect(table?.primaryKey).toEqual(['user_id', 'team_id']);
    expect(table?.uniques[0]?.columns).toEqual(['user_id', 'team_id']);
  });

  it('throws typed errors for empty DDL', () => {
    expect(() => fallbackParseSchemaFile('SELECT 1;', { format: 'sql-ddl' })).toThrowError(SchemaParseError);
  });
});

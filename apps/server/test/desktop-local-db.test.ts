// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /desktop/local-database` — 11-electron.md §6 step 2 card 1, task 11-T07.
 *
 * ─── THE CRITERION THIS SUITE IS BUILT AROUND ────────────────────────────────
 *
 * §Acceptance: "All four first-run paths work: new local SQLite (blank **and from
 * a Prisma schema file with placeholder rows**) …".
 *
 * "Works" cannot be checked by asserting that `emitSqliteDdl` returned some
 * strings. The strings are not the product — what the user gets is a GENERATED
 * APP, and every interesting way this feature can fail is invisible at the DDL
 * level and fatal at the app level:
 *
 *  - a `status` column emitted as `TEXT` applies perfectly, introspects with
 *    `maxLength: null`, fails candidate rule r07, and silently produces a CRUD
 *    grid where the schema described a kanban board (11-T08 hit exactly this);
 *  - a `PRIMARY KEY` clause that is not the rowid-alias spelling creates fine and
 *    then rejects every insert;
 *  - an FK emitted before its target table creates fine and rejects at seed time.
 *
 * All three pass a unit test of the emitter. So this suite runs the real thing
 * end to end — real Prisma file → real parser → real DDL → real `better-sqlite3`
 * → real introspector → real generator → the pages actually persisted in the meta
 * store — and asserts on the far end. The harness injects a temp directory and
 * nothing else.
 */

import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pagesRepo, type MetaDb } from '@adminium/meta';
import { adapterRegistry } from '@adminium/engine/adapter';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { connectionsRoutes } from '../src/routes/connections/index.js';
import { desktopLocalDbRoutes } from '../src/routes/desktop-local-db/index.js';
import { generateRoutes } from '../src/routes/generate/index.js';
import { localDatabaseFile, slugFor } from '../src/routes/desktop-local-db/handlers.js';
import { emitSqliteDdl } from '../src/routes/desktop-local-db/sqlite-ddl.js';
import { login, makeMeta } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

/**
 * A Prisma schema, because the acceptance criterion names Prisma specifically.
 *
 * Shaped like something a person would actually have: a self-referential
 * `manager` FK (org chart), a status enum (kanban), a money column, dates, and a
 * child table with a real FK. That mix is not decoration — each one exercises a
 * different branch of the emitter, and the assertions below name which.
 */
const PRISMA_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum TaskStatus {
  backlog
  in_progress
  review
  done
}

model Employee {
  id        Int       @id @default(autoincrement())
  fullName  String    @db.VarChar(120)
  email     String    @unique @db.VarChar(160)
  managerId Int?
  manager   Employee? @relation("reports", fields: [managerId], references: [id])
  reports   Employee[] @relation("reports")
  tasks     Task[]
  createdAt DateTime  @default(now())
}

model Task {
  id         Int        @id @default(autoincrement())
  title      String     @db.VarChar(200)
  status     TaskStatus @default(backlog)
  estimate   Decimal?   @db.Decimal(10, 2)
  ownerId    Int
  owner      Employee   @relation(fields: [ownerId], references: [id])
  dueDate    DateTime?
  createdAt  DateTime   @default(now())
}
`;

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  dataDir: string;
  cookie: string;
}

let t: Harness | null = null;

afterEach(async () => {
  if (t === null) return;
  await t.app.close();
  await t.meta.db.destroy();
  rmSync(t.dataDir, { recursive: true, force: true });
  t = null;
});

/**
 * The local-db route + the two routes the wizard calls after it. Not
 * `composeServer` — compose does not register this route yet (a later assembly
 * stage wires it; see the task report), so this registers the same factory
 * compose will, with the same deps and the same RBAC plugin in front.
 */
async function harness(): Promise<Harness> {
  const { meta } = await makeMeta();
  const dataDir = mkdtempSync(join(tmpdir(), 'adminium-localdb-'));
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    metaDsn: `sqlite:${join(dataDir, 'meta.db')}`,
    blockLoopback: false,
  });

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(desktopLocalDbRoutes({ manager, dataDir }));
      await api.register(connectionsRoutes({ manager, meta }));
      await api.register(generateRoutes({ manager, meta }));
    },
    { prefix: '/api/v1' },
  );
  app.addHook('onClose', async () => {
    await manager.disposeAll();
  });
  await app.ready();

  const session = await login(app);
  if (session.cookie === null) throw new Error('login failed');
  return { app, meta, manager, dataDir, cookie: session.cookie };
}

interface CreateReply {
  connectionId: string;
  name: string;
  slug: string;
  file: string;
  tables: string[];
  rows: Record<string, number>;
  warnings: { code: string; message: string; tableId: string | null }[];
}

async function create(
  h: Harness,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: CreateReply }> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/desktop/local-database',
    headers: { cookie: h.cookie },
    payload,
  });
  return { status: res.statusCode, body: (res.json() as { data: CreateReply }).data };
}

/** The page set the generator persisted, as `{ type, slug, widgets }`. */
async function generatedPages(
  h: Harness,
  connectionId: string,
): Promise<{ type: string; slug: string; widgets: string[] }[]> {
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/v1/connections/${connectionId}/generate`,
    headers: { cookie: h.cookie },
  });
  expect(res.statusCode).toBe(200);
  const pages = await pagesRepo(h.meta).listForConnection(connectionId);
  return pages.map((page) => {
    const config = (page.config as { config?: { layout?: { items?: { widget: string }[] } } }).config;
    return {
      type: page.type,
      slug: page.slug,
      widgets: (config?.layout?.items ?? []).map((item) => item.widget),
    };
  });
}

beforeAll(async () => {
  await registerAdapters(adapterRegistry);
});

describe('POST /desktop/local-database — blank', () => {
  it('creates <dataDir>/databases/<slug>.sqlite in WAL and registers sqlite:<abs path>', async () => {
    t = await harness();
    const { status, body } = await create(t, { name: 'My Shop' });

    expect(status).toBe(201);
    // §6 names this path exactly, and §9's backup format ("databases/<slug>.sqlite")
    // depends on it staying this.
    expect(body.slug).toBe('my-shop');
    expect(body.file).toBe(localDatabaseFile(t.dataDir, 'my-shop'));
    expect(body.file).toBe(join(t.dataDir, 'databases', 'my-shop.sqlite'));
    expect(existsSync(body.file)).toBe(true);
    expect(body.tables).toEqual([]);

    // §9's first pragma. Read from the FILE with an independent handle: the
    // journal mode is the one setting that persists in the header, so this is
    // the only one an assertion can prove was actually applied to the database
    // rather than to some connection that has since closed.
    const db = new BetterSqlite3(body.file, { readonly: true });
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();

    const dsns = await t.manager.connections.getDsns(body.connectionId);
    expect(dsns?.introspectDsn).toBe(`sqlite:${body.file}`);
  });

  it('refuses a name whose file already exists rather than overwriting it', async () => {
    t = await harness();
    await create(t, { name: 'Ledger' });

    // §9's ethos: the app never destroys data. A second "Ledger" must not be
    // able to silently replace the first one's file — which, on the wizard's
    // own path, is a user retrying after a typo in step 3.
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/desktop/local-database',
      headers: { cookie: t.cookie },
      payload: { name: 'Ledger' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
  });
});

describe('POST /desktop/local-database — from a Prisma schema file', () => {
  it('applies the schema, seeds placeholders, and GENERATES A KANBAN from the status enum', async () => {
    t = await harness();
    const { status, body } = await create(t, {
      name: 'Team Ops',
      schemaFile: { content: PRISMA_SCHEMA, format: 'prisma', fileName: 'schema.prisma' },
      placeholderRows: true,
    });

    expect(status).toBe(201);
    expect(body.tables).toContain('Employee');
    expect(body.tables).toContain('Task');
    // Parents before children — `Employee` carries `Task`'s FK target.
    expect(body.tables.indexOf('Employee')).toBeLessThan(body.tables.indexOf('Task'));

    // The comp's promise: "Seed each table with realistic sample data so your
    // dashboards and charts render immediately."
    expect(body.rows['Employee']).toBeGreaterThan(0);
    expect(body.rows['Task']).toBeGreaterThan(0);

    // ── THE ASSERTION THIS WHOLE TASK TURNS ON ──
    //
    // A `status TEXT` column introspects with `maxLength: null`, fails candidate
    // rule r07's `<= 32` gate, and generates a CRUD grid. `VARCHAR(n)` + `CHECK
    // (status IN (…))` is what keeps it recognisable across emit → introspect,
    // and the only proof of that is the page the REAL generator produced from
    // the file this route actually wrote.
    const pages = await generatedPages(t, body.connectionId);
    const board = pages.find((page) => page.widgets.some((widget) => widget.startsWith('kanban')));
    expect(
      board,
      `expected a kanban page from Task.status; got:\n${pages.map((p) => `  ${p.slug}: ${p.widgets.join(', ')}`).join('\n')}`,
    ).toBeDefined();

    // Self-referential FK → org chart (§3.1's trigger; `Employee.managerId`).
    const org = pages.find((page) => page.widgets.includes('org-chart'));
    expect(org).toBeDefined();
  });

  it('spreads the placeholder rows so a board has more than one occupied lane', async () => {
    t = await harness();
    const { body } = await create(t, {
      name: 'Spread',
      schemaFile: { content: PRISMA_SCHEMA, format: 'prisma', fileName: 'schema.prisma' },
      placeholderRows: true,
    });

    const db = new BetterSqlite3(body.file, { readonly: true });
    const lanes = db.prepare('SELECT DISTINCT status FROM "Task"').all() as { status: string }[];
    db.close();

    // One occupied lane is a kanban that looks broken on the screenshot the
    // wizard lands on. All four of the enum's values must be present.
    expect(lanes.map((lane) => lane.status).sort()).toEqual(['backlog', 'done', 'in_progress', 'review']);
  });

  it('writes FK values that point at rows that exist', async () => {
    t = await harness();
    const { body } = await create(t, {
      name: 'Fks',
      schemaFile: { content: PRISMA_SCHEMA, format: 'prisma', fileName: 'schema.prisma' },
      placeholderRows: true,
    });

    // `foreign_keys = ON` was set for the seeding connection, so a dangling id
    // would already have thrown. This asserts the database is still clean when
    // re-opened — i.e. that the constraints are IN THE FILE, not just honoured
    // by the handle that wrote it.
    const db = new BetterSqlite3(body.file, { readonly: true });
    db.pragma('foreign_keys = ON');
    const violations = db.pragma('foreign_key_check') as unknown[];
    db.close();
    expect(violations).toEqual([]);
  });

  it('leaves no file behind when the schema cannot be applied', async () => {
    t = await harness();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/desktop/local-database',
      headers: { cookie: t.cookie },
      // A CHECK in Postgres dialect SQLite rejects — the realistic failure, and
      // the one `sqlite-ddl.ts` deliberately does not try to translate.
      payload: {
        name: 'Doomed',
        schemaFile: {
          content: 'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT CHECK (v ~ \'^a\'));',
          format: 'sql',
        },
      },
    });

    expect(res.statusCode).toBe(422);
    // The dead end this prevents: a half-created file makes the user's RETRY hit
    // the 409 above, with nothing in the product able to clear it.
    expect(existsSync(localDatabaseFile(t.dataDir, 'doomed'))).toBe(false);

    const retry = await create(t, { name: 'Doomed' });
    expect(retry.status).toBe(201);
  });

  it("surfaces the PARSER's gaps, not just the emitter's", async () => {
    t = await harness();
    const { body } = await create(t, {
      name: 'Warned',
      schemaFile: {
        content: `
          CREATE TABLE orders (id INTEGER PRIMARY KEY, total NUMERIC(10,2));
          CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100;
        `,
        format: 'sql',
      },
    });

    // The view never reaches `emitSqliteDdl` at all — the SQL parser drops it
    // upstream ("skipped CREATE VIEW without column list") because it does not
    // model views without one. So the emitter's `view-skipped` cannot fire, and
    // a reply carrying only the emitter's warnings would tell the user nothing:
    // their view would have vanished between their file and their database in
    // silence. §8.2's rule is never hide, always explain — which means the two
    // warning sources have to be merged before they reach the wizard.
    expect(body.tables).toEqual(['orders']);
    const messages = body.warnings.map((warning) => warning.message);
    expect(body.warnings.map((warning) => warning.code)).toContain('source-not-translated');
    expect(messages.join('\n')).toMatch(/VIEW/i);
  });

  it('reports a view that DOES reach the emitter', async () => {
    t = await harness();
    // The JSON IR is the one format that can state `kind: 'view'` outright, so
    // it is the only way to exercise the emitter's own branch. A view has
    // columns but no query text in the IR (`schema-model.ts` has no
    // `definition` field), so there is nothing to CREATE VIEW from.
    const { body } = await create(t, {
      name: 'Ir',
      schemaFile: {
        format: 'json',
        fileName: 'model.json',
        content: JSON.stringify({
          irVersion: 1,
          dialect: 'postgres',
          name: 'ir',
          tables: [
            {
              schema: 'public',
              name: 'orders',
              columns: [{ name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true }],
              primaryKey: ['id'],
            },
            {
              schema: 'public',
              name: 'big_orders',
              kind: 'view',
              columns: [{ name: 'id', logicalType: 'integer' }],
            },
          ],
        }),
      },
    });

    expect(body.tables).toEqual(['orders']);
    expect(body.warnings.some((warning) => warning.code === 'view-skipped')).toBe(true);
  });
});

describe('slugFor', () => {
  it('confines the file name to <dataDir>/databases whatever the name says', () => {
    // The name is user input and it lands in a path join. The alphabet is the
    // defence, so these are the assertions that matter more than the pretty ones.
    expect(slugFor('../../etc/passwd')).toBe('etc-passwd');
    expect(slugFor('C:\\evil\\thing')).toBe('c-evil-thing');
    expect(slugFor('a/b\0c')).toBe('a-b-c');
    expect(slugFor('Café Sales')).toBe('cafe-sales');
    // A name of only non-Latin characters slugs to nothing; rejecting it would
    // make the wizard's first field refuse a good name in 3 of the 8 locales.
    expect(slugFor('日本語')).toBe('database');
    expect(slugFor('  My  Shop!!  ')).toBe('my-shop');
  });
});

describe('emitSqliteDdl', () => {
  it('keeps a status enum recognisable to the classifier', () => {
    // The unit-level statement of the round-trip test above. It is here because
    // when that end-to-end test goes red, this is the line that says why.
    const ddl = emitSqliteDdl({
      irVersion: 1,
      dialect: 'postgres',
      name: 'x',
      defaultSchema: 'public',
      schemas: ['public'],
      introspectedAt: '2026-01-01T00:00:00.000Z',
      source: { kind: 'import', format: 'prisma' },
      capabilities: {
        hasEnums: true,
        hasFKs: true,
        hasSchemas: true,
        hasComments: false,
        hasChecks: true,
        hasRLS: false,
        hasMaterializedViews: false,
        hasRowEstimates: false,
        supportsStatementTimeout: false,
        supportsReturning: true,
        maxIdentifierLength: 63,
      },
      enums: [{ id: 'public.status', name: 'status', values: ['open', 'closed'], source: 'native' }],
      tables: [
        {
          id: 'public.t',
          schema: 'public',
          name: 't',
          kind: 'table',
          comment: null,
          primaryKey: ['id'],
          uniques: [],
          checks: [],
          indexes: [],
          rowCountEstimate: null,
          rowCountExact: false,
          sizeBytes: null,
          activity: null,
          rls: null,
          system: false,
          semantics: null,
          columns: [
            {
              name: 'id',
              ordinal: 1,
              dbType: 'integer',
              logicalType: 'integer',
              nullable: false,
              default: { kind: 'autoincrement' },
              isPrimaryKey: true,
              isUnique: false,
              isGenerated: false,
              enumRef: null,
              maxLength: null,
              numericPrecision: null,
              numericScale: null,
              isArray: false,
              comment: null,
              references: null,
              semantics: null,
            },
            {
              name: 'status',
              ordinal: 2,
              dbType: 'status',
              logicalType: 'enum',
              nullable: false,
              default: null,
              isPrimaryKey: false,
              isUnique: false,
              isGenerated: false,
              enumRef: 'public.status',
              maxLength: null,
              numericPrecision: null,
              numericScale: null,
              isArray: false,
              comment: null,
              references: null,
              semantics: null,
            },
          ],
        },
      ],
      relations: [],
      warnings: [],
      stats: { tableCount: 1, columnCount: 2, relationCount: 0, durationMs: 0 },
    });

    const create = ddl.statements[0] ?? '';
    // Not TEXT: `maxLength: null` on introspect fails candidate rule r07.
    expect(create).toContain('"status" VARCHAR(6)');
    // The CHECK is what `adapter-sqlite` lifts back into an EnumDef.
    expect(create).toContain(`CHECK ("status" IN ('open', 'closed'))`);
    // The rowid-alias spelling — the only one SQLite auto-assigns.
    expect(create).toContain('"id" INTEGER PRIMARY KEY');
    expect(create).not.toMatch(/PRIMARY KEY \("id"\)/);
  });
});

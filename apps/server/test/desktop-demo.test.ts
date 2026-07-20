/**
 * The demo database (11-electron.md §6 step 2 card 4, task 11-T08) — and, above
 * everything else here, its ACCEPTANCE CRITERION:
 *
 *   "the demo DB generates kanban, calendar, gantt, org-chart, and shift pages
 *    from its schema (research/ia-mapping.md §3.1 triggers)"
 *
 * ─── WHY THIS SUITE IS SHAPED THE WAY IT IS ──────────────────────────────────
 *
 * A demo database that does not trigger those page types is a FAILED TASK, not a
 * cosmetic regression — the card's entire purpose is to show Ava what Adminium
 * does with a real schema, and a demo that generates nine CRUD grids shows her
 * nothing. That claim can only be checked one way: seed the real file with the
 * real script, point the real introspector at it, run the real generator, and
 * read the pages it persisted. Every layer is production code; the only thing
 * this file injects is a temp directory.
 *
 * So there are no unit tests of the seed script's row shapes here. Those would
 * pass while the demo was boring. The schema is a fixture FOR THE GENERATOR, and
 * the generator is the only thing whose opinion counts.
 */

import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pagesRepo, type MetaDb } from '@adminium/meta';
import { adapterRegistry } from '@adminium/engine/adapter';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { connectionsRoutes } from '../src/routes/connections/index.js';
import { desktopDemoRoutes, type DesktopDemoRoutesDeps } from '../src/routes/desktop-demo/index.js';
import { generateRoutes } from '../src/routes/generate/index.js';
import { demoDatabaseFile } from '../src/routes/desktop-demo/handlers.js';
import { login, makeMeta } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

/**
 * The REAL script the desktop shell ships — resolved the same way
 * `bundledDemoSeedScript()` resolves it, from this file rather than from `out/`.
 * Pointing the suite at a copy would let the two drift, which is the one failure
 * this test exists to prevent.
 */
const SEED_SCRIPT = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  'desktop',
  'resources',
  'demo',
  'demo-seed.mjs',
);

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
 * The demo route + the two routes the wizard calls after it. Not `composeServer`
 * — compose does not register the demo route yet (a later assembly stage wires
 * it; see the task report), so this harness registers the same factory compose
 * will, with the same deps.
 */
async function harness(overrides: { loadSeeder?: DesktopDemoRoutesDeps['loadSeeder'] } = {}): Promise<Harness> {
  // Real auth: seeded super admin + session cookie, so the RBAC grant on the
  // demo route and the generate route run the production paths.
  const { meta } = await makeMeta();
  const dataDir = mkdtempSync(join(tmpdir(), 'adminium-demo-'));
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    // The demo file must not be able to BE the meta store — assert placement
    // against a real meta DSN under the same dataDir rather than disabling it.
    metaDsn: `sqlite:${join(dataDir, 'meta.db')}`,
    blockLoopback: false,
  });

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(
        desktopDemoRoutes({
          manager,
          dataDir,
          seedScriptPath: SEED_SCRIPT,
          ...(overrides.loadSeeder === undefined ? {} : { loadSeeder: overrides.loadSeeder }),
        }),
      );
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

/** `POST /desktop/demo-database` → the created connection id. */
async function createDemo(h: Harness): Promise<string> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/desktop/demo-database',
    headers: { cookie: h.cookie },
    payload: {},
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { data: { connectionId: string } }).data.connectionId;
}

/** The page set the generator persisted, as `{ type, slug, title, widgets }`. */
async function generatedPages(
  h: Harness,
  connectionId: string,
): Promise<{ type: string; slug: string; title: string; widgets: string[] }[]> {
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
      title: page.title,
      widgets: (config?.layout?.items ?? []).map((item) => item.widget),
    };
  });
}

beforeAll(async () => {
  await registerAdapters(adapterRegistry);
});

describe('POST /desktop/demo-database', () => {
  it('seeds <dataDir>/databases/demo.sqlite and registers it as sqlite:<abs path>', async () => {
    t = await harness();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/desktop/demo-database',
      headers: { cookie: t.cookie },
      payload: { name: 'Demo' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { connectionId: string; file: string; seeded: boolean; rows: Record<string, number> };
    };
    // §6 names both halves of this path; the wizard and the backup format (§9,
    // "databases/<slug>.sqlite") both depend on it being exactly this.
    expect(body.data.file).toBe(demoDatabaseFile(t.dataDir));
    expect(body.data.file).toBe(join(t.dataDir, 'databases', 'demo.sqlite'));
    expect(existsSync(body.data.file)).toBe(true);
    expect(body.data.seeded).toBe(true);
    expect(body.data.rows.employees).toBeGreaterThan(0);

    const dsns = await t.manager.connections.getDsns(body.data.connectionId);
    expect(dsns?.introspectDsn).toBe(`sqlite:${body.data.file}`);
  });

  it('creates a connection that Data Connections can delete like any other', async () => {
    t = await harness();
    const connectionId = await createDemo(t);

    // §6: "Deletable afterwards from Data Connections (i.e. nothing special)."
    // Driven through the REAL delete route — the claim is about that route
    // accepting this connection, which a repo call would not prove.
    const connection = await t.manager.connections.findById(connectionId);
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/connections/${connectionId}`,
      headers: { cookie: t.cookie },
      payload: { confirmName: connection?.name },
    });
    expect(res.statusCode).toBe(200);
    expect(await t.manager.connections.findById(connectionId)).toBeNull();
  });

  it('refuses a second demo while one is connected, and says which', async () => {
    t = await harness();
    const connectionId = await createDemo(t);

    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/desktop/demo-database',
      headers: { cookie: t.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { connectionId } },
    });
  });

  it('adopts an orphaned demo file instead of dead-ending, and does not re-seed it', async () => {
    t = await harness();
    const first = await createDemo(t);
    const file = demoDatabaseFile(t.dataDir);

    // Delete the CONNECTION; the file stays (nothing removes it, by design).
    const connection = await t.manager.connections.findById(first);
    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/connections/${first}`,
      headers: { cookie: t.cookie },
      payload: { confirmName: connection?.name },
    });
    expect(deleted.statusCode).toBe(200);

    // A row only a user could have written. If the route re-seeded the file, it
    // would be gone — and so would anything they had done in the demo.
    const db = new BetterSqlite3(file);
    db.prepare("INSERT INTO projects (id, name, status, owner_id, budget_amount, health_score, created_at, updated_at) VALUES (99, 'Ava edited this', 'active', 1, 0, 50, '2026-06-01 00:00:00', '2026-06-01 00:00:00')").run();
    db.close();

    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/desktop/demo-database',
      headers: { cookie: t.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { data: { seeded: boolean } }).data.seeded).toBe(false);

    const reopened = new BetterSqlite3(file, { readonly: true });
    const kept = reopened.prepare('SELECT name FROM projects WHERE id = 99').get() as
      | { name: string }
      | undefined;
    reopened.close();
    expect(kept?.name).toBe('Ava edited this');
  });

  it('leaves NO demo.sqlite behind when the seed fails, so the card is not a permanent no-op', async () => {
    // ── The interaction between "state 2 adopts the file as-is" and
    // better-sqlite3's `new Database(file)` CREATING the file on open, before
    // the schema and before the rows.
    //
    // Any failure in the ~800 ms after that — the disk fills, or
    // `journal_mode = WAL` fails because dataDir is on a synced share (the exact
    // placement 11-T03's detector warns about) — used to leave an empty
    // demo.sqlite that nothing removed. State 2 then claimed it on every
    // subsequent click, forever: 201 `{seeded:false, rows:{}}`, `testDsn` ok (an
    // empty file is a valid 0-table SQLite database), status 'connected', and
    // `generate` producing 0 pages from 0 tables. A success-returning no-op, and
    // the dead end state 2 exists to prevent.
    t = await harness({
      loadSeeder: () =>
        Promise.resolve({
          createDemoDatabase: ({ file: target }): Record<string, number> => {
            // Exactly what better-sqlite3 does first: create the file. Then die.
            writeFileSync(target, '');
            throw new Error('ENOSPC: no space left on device');
          },
        }),
    });

    const failed = await t.app.inject({
      method: 'POST',
      url: '/api/v1/desktop/demo-database',
      headers: { cookie: t.cookie },
      payload: {},
    });
    expect(failed.statusCode).toBe(500);

    // The claim: the wizard's next click must be able to succeed. Nothing was
    // published, so state 3 (seed) still applies rather than state 2 (adopt).
    expect(existsSync(demoDatabaseFile(t.dataDir))).toBe(false);
    // And no wreckage was left lying around under any name.
    const dir = join(t.dataDir, 'databases');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('requires the connections manage grant', async () => {
    t = await harness();
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/desktop/demo-database', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('seeds no value that would make the demo reach the network (§7)', async () => {
    t = await harness();
    await createDemo(t);

    // §7: "fully functional with the network cable unplugged, forever". The demo
    // is the first thing Ava opens, and `contacts.avatar_url` is rendered by a
    // card-gallery — a plausible-looking `https://…/avatar.png` would be sixty
    // failed requests on that page and sixty entries in the offline smoke test's
    // blocked-request log, which §7 requires to be empty.
    //
    // Asserted against the SEEDED FILE rather than the script's source, because
    // the file is what the app actually reads, and a URL could arrive by any
    // number of routes the source-level grep in `check-offline-assets.mjs` does
    // not cover (it scans build output; `resources/` is not build output).
    const db = new BetterSqlite3(demoDatabaseFile(t.dataDir), { readonly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const offenders: string[] = [];
    for (const { name } of tables) {
      for (const row of db.prepare(`SELECT * FROM ${name}`).all() as Record<string, unknown>[]) {
        for (const [column, value] of Object.entries(row)) {
          // A `data:` URI may legally CONTAIN an XML namespace; a fetchable URL
          // may not appear at the start of a value.
          if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
            offenders.push(`${name}.${column} = ${value.slice(0, 60)}`);
          }
        }
      }
    }
    db.close();
    expect(offenders).toEqual([]);
  });
});

describe('the demo database earns its §3.1 page types (acceptance criterion #2)', () => {
  it('generates kanban, calendar, gantt, org-chart and shift pages', async () => {
    t = await harness();
    const connectionId = await createDemo(t);
    const pages = await generatedPages(t, connectionId);

    const bySlug = new Map(pages.map((page) => [page.slug, page]));
    const widgetsOn = (slug: string): string[] => bySlug.get(slug)?.widgets ?? [];

    // ── §3.1 row 6 — kanban, WITH swimlanes (the second categorical column).
    const board = bySlug.get('tasks-board');
    expect(board?.type).toBe('page-board');
    expect(board?.widgets).toContain('kanban-swimlane-grid');

    // ── §3.1 row 7 — calendar (date + title + category enum).
    const calendar = bySlug.get('releases-calendar');
    expect(calendar?.type).toBe('page-calendar');
    expect(calendar?.widgets).toContain('calendar-month');

    // ── §3.1 row 8 — gantt (start + end + progress + parent grouping).
    const gantt = bySlug.get('project-phases-detail');
    expect(gantt?.type).toBe('page-master-detail');
    expect(gantt?.widgets).toContain('gantt-chart');

    // ── §3.1 row 12 — org chart (self-referential manager_id).
    const orgChart = bySlug.get('employees-directory');
    expect(orgChart?.type).toBe('page-directory');
    expect(orgChart?.widgets).toContain('org-chart');

    // ── §3.1 row 9 — shifts (people x dates x shift-type).
    const shifts = bySlug.get('shifts-schedule');
    expect(shifts?.type).toBe('page-scheduler');
    expect(shifts?.widgets).toContain('schedule-matrix');

    // The five the acceptance criterion names, as one assertion whose failure
    // message lists what actually got generated.
    expect({
      kanban: widgetsOn('tasks-board').includes('kanban-swimlane-grid'),
      calendar: widgetsOn('releases-calendar').includes('calendar-month'),
      gantt: widgetsOn('project-phases-detail').includes('gantt-chart'),
      orgChart: widgetsOn('employees-directory').includes('org-chart'),
      shifts: widgetsOn('shifts-schedule').includes('schedule-matrix'),
    }).toEqual({ kanban: true, calendar: true, gantt: true, orgChart: true, shifts: true });
  }, 60_000);

  it('covers the rest of the §3.1 triggers the task enumerates', async () => {
    t = await harness();
    const connectionId = await createDemo(t);
    const pages = await generatedPages(t, connectionId);
    const bySlug = new Map(pages.map((page) => [page.slug, page]));

    // row 10 — ticket queue (workflow enum + requester/assignee FK + timestamps).
    expect(bySlug.get('tickets-queue')?.type).toBe('page-queue-inbox');
    // row 11 — directory cards (people-like table with an avatar).
    expect(bySlug.get('contacts-directory')?.widgets).toContain('card-gallery');
    // row 13 — capacity/allocation (people + hours + project FK).
    expect(bySlug.get('allocations-schedule')?.widgets).toContain('capacity-board');
    // row 5 — dashboard/analytics off the numeric + timestamp columns.
    expect(pages.filter((page) => page.type === 'page-dashboard').length).toBeGreaterThanOrEqual(1);
    // row 4 — the hub record: every child table keeps its own CRUD page, which is
    // what the projects detail view builds its related-record tabs from.
    for (const slug of ['projects', 'tasks', 'project-phases', 'allocations']) {
      expect(bySlug.get(slug)?.type).toBe('page-crud');
    }
  }, 60_000);

  it('keeps the desktop E2E nav contract — one page titled exactly "Employees", the CRUD grid', async () => {
    // apps/e2e/tests-desktop/helpers/flow.ts#openEmployeesGrid clicks the
    // Primary-nav link named EXACTLY "Employees" and then waits for data-grid
    // rows (role=rowgroup > row). That walk only works while
    //   (a) the employees CRUD page keeps that exact title (nav serves the
    //       stored title — apps/server/src/generate/run.ts), and
    //   (b) no other page claims it. The demo also generates "Employees
    //       Dashboard" (Workspace section, listed BEFORE People) and
    //       "Employees Directory" — which is why the helper cannot use a
    //       substring match: /Employees/.first() resolves to the dashboard,
    //       a page with no grid (the CI failure this test pins).
    t = await harness();
    const connectionId = await createDemo(t);
    const pages = await generatedPages(t, connectionId);

    const employeesTitled = pages.filter((page) => page.title === 'Employees');
    expect(employeesTitled).toHaveLength(1);
    expect(employeesTitled[0]).toMatchObject({ slug: 'employees', type: 'page-crud' });

    // The ambiguity sources the exact match exists to dodge. If a rename ever
    // retires these titles, update flow.ts's comment — not just this test.
    const titles = pages.map((page) => page.title);
    expect(titles).toContain('Employees Dashboard');
    expect(titles).toContain('Employees Directory');
  }, 60_000);

  it('is deterministic — a re-seeded file generates a byte-identical page set', async () => {
    // The seed's whole reason for having a fixed PRNG and a fixed epoch. Two
    // independent seeds, two independent generations, one page set.
    const first = await harness();
    const firstPages = await generatedPages(first, await createDemo(first));
    await first.app.close();
    await first.meta.db.destroy();
    rmSync(first.dataDir, { recursive: true, force: true });

    t = await harness();
    const secondPages = await generatedPages(t, await createDemo(t));

    expect(secondPages).toEqual(firstPages);
  }, 90_000);
});

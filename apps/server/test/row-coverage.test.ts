// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NO DOOR FORGOTTEN.
 *
 * A role can be held to some rows of a table. That is worth as much as the
 * least careful route: one that reads a table without asking whose its rows
 * are shows a rep every colleague's deal. So every `/api` route and every
 * job kind is named in `rbac/row-coverage-table.ts` with how it treats a
 * person held to some rows — or with why it touches no source row.
 *
 * This suite composes the real server, in its widest shape, and fails when
 * a route or a job is registered that the table does not name, when a mark
 * says nothing, and when the table names a door that is gone. What each door
 * really does is proved beside it (`row-limit-*.test.ts`); what is proved
 * here is that nobody added one without deciding.
 */
import { tmpdir } from 'node:os';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { createRowCoverageRegistry, noRows, rowCoverageProblems, rowRouteKey, rows } from '../src/rbac/row-coverage.js';
import { JOB_ROW_COVERAGE, ROW_COVERAGE } from '../src/rbac/row-coverage-table.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

/**
 * The widest topology, as the audit coverage sweep composes it: desktop
 * runtime, a bridge origin, a relocation host, a project folder and an LLM
 * vocabulary, so every conditionally-registered route is there. A narrower
 * one would let a route past by not being registered in the suite.
 */
async function composeEverything(meta: MetaDb): Promise<ComposedServer> {
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ ADMINIUM_RUNTIME: 'desktop', ADMINIUM_BOOT_TOKEN: 'a'.repeat(64), ADMINIUM_BRIDGE_ORIGINS: 'https://adminium.dev' }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root: tmpdir(), mode: 'server', log: () => undefined, warn: () => undefined },
  });
  await composed.app.ready();
  return composed;
}

let open: { close: () => Promise<void> } | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe('row-limit coverage — every door of the real server is named', () => {
  it('no route and no job is unmarked, no mark is empty, and no mark outlives its door', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const composed = await composeEverything(meta);
    open = {
      close: async () => {
        await composed.app.close();
        await meta.db.destroy();
      },
    };
    const routes = composed.app.rowCoverage.rows().map((row) => rowRouteKey(row.method, row.url));
    // The sweep sees the server: a regex that matched nothing would pass everything.
    expect(routes.length).toBeGreaterThan(400);
    expect(routes).toContain('GET /api/v1/data/:connectionId/:table');
    expect(rowCoverageProblems(routes, ROW_COVERAGE, 'route')).toEqual([]);

    const jobs = composed.jobs.registry.kinds();
    expect(jobs).toContain('export-run');
    expect(rowCoverageProblems(jobs, JOB_ROW_COVERAGE, 'job')).toEqual([]);
  });

  it('the doors that read rows each name a rule, and the ones that read a table by name are among them', () => {
    const reading = Object.entries(ROW_COVERAGE).filter(([, mark]) => mark.kind === 'rows');
    expect(reading.length).toBeGreaterThan(120);
    // Every route under /data reads or writes rows: none of them may be marked as touching none.
    const data = Object.entries(ROW_COVERAGE).filter(([key]) => key.includes(' /api/v1/data/'));
    expect(data.length).toBe(25);
    expect(data.filter(([, mark]) => mark.kind !== 'rows')).toEqual([]);
    for (const key of ['GET /api/v1/search', 'POST /api/v1/widget-data/query', 'POST /api/v1/exports', 'POST /api/v1/imports/:id/run', 'POST /api/v1/documents/render', 'GET /api/v1/audit', 'GET /api/v1/events', 'POST /api/v1/roles/rows/preview']) {
      expect(ROW_COVERAGE[key]?.kind, key).toBe('rows');
    }
  });
});

describe('row-limit coverage — the check itself', () => {
  const table = { 'GET /api/v1/deals': rows('list', 'The row test is in the list and its count.'), 'GET /api/v1/healthz': noRows('Liveness, and nothing else.') };

  it('a route added without a mark fails, by name; the same route with one passes', () => {
    const registered = ['GET /api/v1/deals', 'GET /api/v1/healthz', 'GET /api/v1/deals/all-of-them'];
    const problems = rowCoverageProblems(registered, table, 'route');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('route "GET /api/v1/deals/all-of-them" has no row-limit mark');
    expect(rowCoverageProblems(registered, { ...table, 'GET /api/v1/deals/all-of-them': rows('all', 'Needs every row, or is refused.') }, 'route')).toEqual([]);
  });

  it('a mark that says nothing, a reader with no rule, and a mark for a door that is gone each fail', () => {
    expect(rowCoverageProblems(['GET /api/v1/x'], { 'GET /api/v1/x': noRows('none') }, 'route')[0]).toContain('says too little');
    expect(rowCoverageProblems(['GET /api/v1/x'], { 'GET /api/v1/x': rows([], 'Reads its rows as their reader.') }, 'route')[0]).toContain('names at least one rule');
    expect(rowCoverageProblems([], { 'GET /api/v1/gone': noRows('It was a route once.') }, 'route')[0]).toContain('no longer registered');
    expect(rowCoverageProblems(['export-run'], {}, 'job')[0]).toContain('job "export-run" has no row-limit mark');
  });

  it('the registry records every method of an /api route but HEAD and OPTIONS, and nothing outside /api', () => {
    const registry = createRowCoverageRegistry(table);
    registry.record({ method: ['GET', 'HEAD'], url: '/api/v1/deals' });
    registry.record({ method: 'OPTIONS', url: '/api/v1/deals' });
    registry.record({ method: 'POST', url: '/api/v1/deals' });
    registry.record({ method: 'GET', url: '/surface/crm' });
    expect(registry.rows().map((row) => rowRouteKey(row.method, row.url))).toEqual(['GET /api/v1/deals', 'POST /api/v1/deals']);
    expect(registry.unmarked().map((row) => rowRouteKey(row.method, row.url))).toEqual(['POST /api/v1/deals']);
  });
});

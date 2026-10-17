// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EACH CHANGE OF A ROW IS ITS OWN OCCURRENCE OF A RULE, also when several
 * changes of one row carry the same moment (MySQL keeps whole seconds),
 * against the whole server on SQLite, Postgres and MySQL:
 *
 *  - three moves of one deal within one second are three runs, each with the
 *    row as it was before its own move;
 *  - a table with an `updated_at` column: the same, and the poller reading the
 *    row afterwards adds no fourth run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { jobsRepo } from '@adminium/meta';

import { pollWatchedTables } from '../src/automations/watch.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const action = (key: string, body: Record<string, unknown>) => ({ id: key, kind: 'action', title: key, action: body });

function crm(): Record<string, unknown> {
  const deals = (ref: string, stamped: boolean) => ({
    ref,
    columns: [
      id,
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'stage', type: 'enum', enum: ['lead', 'quote', 'won'], default: 'lead' },
      { ref: 'moved_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { columns: ['stage'] } } } },
      // The engine stamps an `updated_at` at every change: the change's moment, the third part of its key.
      ...(stamped ? [{ ref: 'updated_at', type: 'timestamptz', nullable: true }] : []),
    ],
  });
  const moved = (table: string) => ({
    key: `${table}-moved`,
    name: en(`A ${table} row moves: a line`),
    enabled: true,
    trigger: { kind: 'record', event: 'updated', table, changedColumn: 'stage' },
    graph: flow(action('line', { kind: 'record.create', table: 'moves', values: { deal: `${table}:{{record.id}}`, left: '{{was.stage}}' } })),
  });
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crm.desc', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        deals('deals', false),
        deals('jobs', true),
        { ref: 'moves', columns: [id, { ref: 'deal', type: 'text', maxLength: 40 }, { ref: 'left', type: 'text', maxLength: 40, nullable: true }] },
      ],
    },
    roles: [{ key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'table:@deals:update', 'page:@crm-deals:view'] }],
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    automations: [moved('deals'), moved('jobs')],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`each change of a row is its own occurrence, on ${dialect}`, () => {
    let s: WholeServer;
    const lines = async (deal: string): Promise<string[]> =>
      (await s.rows(`SELECT ${dialect === 'mysql' ? '`left`' : '"left"'} AS was FROM crm_moves WHERE deal = '${deal}'`)).map((row) => String(row['was'])).sort();

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { mia: ['manager'] } });
      await s.rows(`INSERT INTO crm_deals (id, name, stage) VALUES (1, 'Atrium', 'lead')`);
      await s.rows(`INSERT INTO crm_jobs (id, name, stage) VALUES (1, 'Fit-out', 'lead')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    /** Three moves of row 1 of `table` within one second (on MySQL, one moment of change). */
    const threeMoves = async (table: string): Promise<void> => {
      // From the start of a second, so the three land within it.
      while (Date.now() % 1000 > 150) await new Promise((done) => setTimeout(done, 20));
      const started = Date.now();
      expect(said(await s.change('owner', table, 1, { stage: 'quote' }))).toBe('ok');
      expect(said(await s.change('owner', table, 1, { stage: 'won' }))).toBe('ok');
      expect(said(await s.change('owner', table, 1, { stage: 'lead' }))).toBe('ok');
      expect(Date.now() - started).toBeLessThan(850);
    };
    const runsOf = async (key: string) => {
      const [rule] = await s.meta.db.selectFrom('adminium_automations').select('id').where('templateKey', '=', key).execute();
      return s.meta.db.selectFrom('adminium_automation_runs').select(['dedupeKey', 'origin']).where('automationId', '=', (rule as { id: string }).id).execute();
    };

    it('three moves of a row with no moment of change within one second are three runs, each with the row as it was', async () => {
      await threeMoves('deals');
      expect(await runsOf('deals-moved')).toHaveLength(3);
      await s.jobs();
      expect(await lines('deals:1')).toEqual(['lead', 'quote', 'won']);
    });

    it('three moves of a row with an `updated_at` within one second are three runs too, and the poller reading the row adds none', async () => {
      // The rule also watches its table (writes made outside Adminium): its first tick only marks where it starts.
      const [rule] = await s.meta.db.selectFrom('adminium_automations').select(['id', 'trigger']).where('templateKey', '=', 'jobs-moved').execute();
      const trigger = typeof rule!.trigger === 'string' ? JSON.parse(rule!.trigger) : rule!.trigger;
      await s.meta.db.updateTable('adminium_automations').set({ trigger: JSON.stringify({ ...trigger, watch: true }) } as never).where('id', '=', rule!.id).execute();
      const poll = () => pollWatchedTables({ meta: s.meta, manager: s.manager, enqueue: (input) => jobsRepo(s.meta).enqueue(input) });
      expect((await poll()).runsStarted).toBe(0);
      await threeMoves('jobs');
      const runs = await runsOf('jobs-moved');
      expect(runs.map((run) => run.origin)).toEqual(['dashboard', 'dashboard', 'dashboard']);
      expect(new Set(runs.map((run) => run.dedupeKey)).size).toBe(3);
      // The poller sees the row once, at its last moment: that change is already claimed.
      await new Promise((done) => setTimeout(done, 1100));
      expect(await poll()).toMatchObject({ rowsSeen: 1, runsStarted: 0 });
      expect(await runsOf('jobs-moved')).toHaveLength(3);
      await s.jobs();
      expect(await lines('jobs:1')).toEqual(['lead', 'quote', 'won']);
    });
  });
}

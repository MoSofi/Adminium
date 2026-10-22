// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW DELETED OUTSIDE ADMINIUM, AND THE NEXT ROW GIVEN ITS KEY, against the
 * whole server on SQLite, Postgres and MySQL, with the watch poller (the job
 * that notices rows written outside Adminium) reading a table with a
 * `created_at`:
 *
 *  - the row deleted in the database itself and a new row made with the same
 *    key: its `created` rule runs (SQLite hands the deleted top rowid out
 *    again by itself; on Postgres and MySQL the key is written by hand, as an
 *    import or a restore does);
 *  - the claim is the key PLUS the row's `created_at`: a row changed since,
 *    read again, runs nothing twice;
 *  - a row made through Adminium and then read by the poller is still one
 *    run (both producers spell the same claim);
 *  - a plain claim (the key alone, as a server before this spelled it) made
 *    within the hour is the row's: the poller leaves it; an older one is not.
 *
 * Before this, the poller saw no deletes and the claim was `<rule>:<pk>` for
 * good: the second row never ran its rule.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { automationRunsRepo, jobsRepo } from '@adminium/meta';

import { plainCreatedKey } from '../src/automations/events.js';
import { pollWatchedTables } from '../src/automations/watch.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });

function crm(): Record<string, unknown> {
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
        { ref: 'signups', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'created_at', type: 'timestamptz', nullable: true }] },
        { ref: 'marks', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
      ],
    },
    roles: [{ key: 'manager', name: 'Manager', permissions: ['table:@signups:read', 'page:@crm-signups:view'] }],
    pages: [{ ref: 'crm-signups', template: 'page-crud', title: { key: 't.signups', fallback: 'Sign-ups' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'signups' } }],
    automations: [
      {
        key: 'signed-up',
        name: en('Somebody signs up: a mark'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'signups' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            { id: 'mark', kind: 'action', title: 'mark', action: { kind: 'record.create', table: 'marks', values: { name: '{{record.name}}' } } },
          ],
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a row deleted outside Adminium and its key given again, on ${dialect}`, () => {
    let s: WholeServer;
    let ruleId = '';
    const poll = () => pollWatchedTables({ meta: s.meta, manager: s.manager, enqueue: (input) => jobsRepo(s.meta).enqueue(input) });
    const marks = async (): Promise<string[]> => (await s.rows('SELECT name FROM crm_marks ORDER BY id')).map((row) => String(row['name']));
    const runs = () => s.meta.db.selectFrom('adminium_automation_runs').select(['origin', 'dedupeKey']).where('automationId', '=', ruleId).execute();

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { mia: ['manager'] } });
      // The rule also watches its table (writes made outside Adminium); its first tick only marks where it starts.
      const [rule] = await s.meta.db.selectFrom('adminium_automations').select(['id', 'trigger']).where('templateKey', '=', 'signed-up').execute();
      ruleId = rule!.id;
      const trigger = typeof rule!.trigger === 'string' ? JSON.parse(rule!.trigger) : rule!.trigger;
      await s.meta.db.updateTable('adminium_automations').set({ trigger: JSON.stringify({ ...trigger, watch: true }) } as never).where('id', '=', ruleId).execute();
      expect((await poll()).runsStarted).toBe(0);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a row made outside Adminium runs its rule once; changed and read again, it runs nothing more', async () => {
      await s.rows(`INSERT INTO crm_signups (id, name, created_at) VALUES (1, 'Atrium', '2020-01-01 10:00:00')`);
      expect(await poll()).toMatchObject({ rowsSeen: 1, runsStarted: 1 });
      await s.jobs();
      expect(await marks()).toEqual(['Atrium']);

      // Changed in the database, and read again from the start (a rewound cursor): already claimed.
      await s.rows(`UPDATE crm_signups SET name = 'Atrium Hall' WHERE id = 1`);
      await s.meta.db.updateTable('adminium_automations').set({ watchCursor: JSON.stringify({ column: 'created_at', value: null, frontierPk: null }) } as never).where('id', '=', ruleId).execute();
      expect(await poll()).toMatchObject({ rowsSeen: 1, runsStarted: 0 });
      expect(await runs()).toHaveLength(1);
    });

    it('deleted in the database and its key given to the next row: the next row runs its rule', async () => {
      await s.rows('DELETE FROM crm_signups WHERE id = 1');
      if (dialect === 'sqlite') {
        // No AUTOINCREMENT: SQLite gives the deleted top rowid to the next insert.
        await s.rows(`INSERT INTO crm_signups (name, created_at) VALUES ('Bayside', '2020-01-02 10:00:00')`);
        expect((await s.rows(`SELECT id FROM crm_signups WHERE name = 'Bayside'`))[0]!['id']).toBe(1);
      } else {
        await s.rows(`INSERT INTO crm_signups (id, name, created_at) VALUES (1, 'Bayside', '2020-01-02 10:00:00')`);
      }
      expect(await poll()).toMatchObject({ rowsSeen: 1, runsStarted: 1 });
      await s.jobs();
      expect(await marks()).toEqual(['Atrium', 'Bayside']);
      // Two claims of key 1, each with its own moment; the first run kept its history.
      const held = (await runs()).map((run) => run.dedupeKey);
      expect(new Set(held).size).toBe(2);
      expect(held.every((key) => key !== null && key.startsWith(`${ruleId}:`) && key.includes(':c'))).toBe(true);
    });

    it('a row made through Adminium, then read by the poller: one run', async () => {
      expect(said(await s.make('owner', 'signups', { name: 'Cedar' }))).toBe('ok');
      expect(await poll()).toMatchObject({ rowsSeen: 1, runsStarted: 0 });
      const all = await runs();
      expect(all.map((run) => run.origin).sort()).toEqual(['dashboard', 'watch', 'watch']);
      await s.jobs();
      expect(await marks()).toEqual(['Atrium', 'Bayside', 'Cedar']);
    });

    it('a plain claim made within the hour is the row\'s; an older one is a deleted row\'s, and holds nothing', async () => {
      const view = await loadSnapshotView(s.meta, s.connectionId, { forOthers: true });
      const signups = view.table(s.t('signups'));
      await s.rows(`INSERT INTO crm_signups (id, name, created_at) VALUES (90, 'Dunmore', '2099-01-01 10:00:00'), (91, 'Elm', '2099-01-02 10:00:00')`);
      // Each key as the driver hands it back, as both producers read it.
      const keyOf = async (name: string) => ({ id: (await s.rows(`SELECT id FROM crm_signups WHERE name = '${name}'`))[0]!['id'] });
      const claim = async (name: string, at: number) => {
        const pk = await keyOf(name);
        return automationRunsRepo(s.meta).begin(
          {
            automationId: ruleId,
            dedupeKey: plainCreatedKey({ ruleId, table: signups, pk }),
            origin: 'dashboard',
            triggerEvent: { event: 'record.created', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: s.connectionId, table: signups.id, pk, label: name }, snapshot: {}, occurredAt: at },
          },
          at,
        );
      };
      expect(await claim('Dunmore', Date.now() - 60_000)).not.toBeNull();
      expect(await claim('Elm', Date.now() - 2 * 60 * 60 * 1000)).not.toBeNull();
      expect(await poll()).toMatchObject({ rowsSeen: 2, runsStarted: 1 });
      const started = await s.meta.db.selectFrom('adminium_automation_runs').select('triggerEvent').where('automationId', '=', ruleId).where('origin', '=', 'watch').orderBy('startedAt', 'desc').limit(1).execute();
      const event = typeof started[0]!.triggerEvent === 'string' ? JSON.parse(started[0]!.triggerEvent) : started[0]!.triggerEvent;
      expect(String(event.record.pk.id)).toBe('91');
    });
  });
}

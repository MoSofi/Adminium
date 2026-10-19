// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW GIVEN A DELETED ROW'S KEY IS MADE AGAIN, and its `created` rules run,
 * against the whole server on SQLite, Postgres and MySQL.
 *
 * SQLite hands a deleted top rowid to the next insert (no AUTOINCREMENT: the
 * install's DDL), and a `created` claim is `<rule>:<pk>`. Before the fix the
 * second deal 1 got no mark: its occurrence read as handled (the Sales CRM's
 * deal room lost its first history line this way in CI).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
        { ref: 'deals', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        { ref: 'marks', columns: [id, { ref: 'deal', type: 'int' }, { ref: 'name', type: 'text', maxLength: 80 }] },
      ],
    },
    roles: [{ key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'page:@crm-deals:view'] }],
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    automations: [
      {
        key: 'deal-made',
        name: en('A deal is made: its mark'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'deals' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            { id: 'mark', kind: 'action', title: 'mark', action: { kind: 'record.create', table: 'marks', values: { deal: '{{record.id}}', name: '{{record.name}}' } } },
          ],
        },
      },
      {
        key: 'deal-renamed',
        name: en('A deal is renamed: a mark'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'name' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            { id: 'mark', kind: 'action', title: 'mark', action: { kind: 'record.create', table: 'marks', values: { deal: '{{record.id}}', name: 'renamed {{record.name}}' } } },
          ],
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a row given a deleted row's key runs its created rules, on ${dialect}`, () => {
    let s: WholeServer;
    const marks = async (): Promise<string[]> => (await s.rows('SELECT name FROM crm_marks ORDER BY id')).map((row) => String(row['name']));

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { mia: ['manager'] } });
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a deal renamed and removed inside the undo window: the waiting run is dropped, and never acts on the next deal given its key', async () => {
      const made = await s.make('owner', 'deals', { name: 'Cedar' });
      const key = (made.json() as { data: { id: number } }).data.id;
      await s.jobs();
      expect(said(await s.change('owner', 'deals', key, { name: 'Cedar Hall' }))).toBe('ok');
      // Removed before the rename's run is due; the next deal is made with the same key on SQLite.
      expect(said(await s.send('owner', 'DELETE', `/api/v1/data/${s.connectionId}/${s.t('deals')}/${String(key)}`))).toBe('ok');
      const next = await s.make('owner', 'deals', { name: 'Dunmore' });
      if (dialect === 'sqlite') expect((next.json() as { data: { id: number } }).data.id).toBe(key);
      await s.jobs();
      expect((await marks()).filter((name) => name.startsWith('renamed'))).toEqual([]);
      const skipped = await s.meta.db.selectFrom('adminium_automation_runs').select(['status', 'error']).where('error', '=', 'record-removed').execute();
      expect(skipped).toHaveLength(1);
      // The next deal's own rename still runs.
      expect(said(await s.change('owner', 'deals', (next.json() as { data: { id: number } }).data.id, { name: 'Dunmore Yard' }))).toBe('ok');
      await s.jobs();
      expect((await marks()).filter((name) => name.startsWith('renamed'))).toEqual(['renamed Dunmore Yard']);
      // Taken away again, so the next test starts from the deals it expects.
      for (const id of [(next.json() as { data: { id: number } }).data.id]) expect(said(await s.send('owner', 'DELETE', `/api/v1/data/${s.connectionId}/${s.t('deals')}/${String(id)}`))).toBe('ok');
      await s.rows('DELETE FROM crm_marks');
      await s.meta.db.deleteFrom('adminium_automation_runs').execute();
    });

    it('the newest deal deleted, the next one made: each deal gets its mark', async () => {
      const first = await s.make('owner', 'deals', { name: 'Atrium' });
      expect(said(first)).toBe('ok');
      const firstId = (first.json() as { data: { id: number } }).data.id;
      await s.jobs();
      expect(await marks()).toEqual(['Atrium']);

      expect(said(await s.send('owner', 'DELETE', `/api/v1/data/${s.connectionId}/${s.t('deals')}/${String(firstId)}`))).toBe('ok');
      const second = await s.make('owner', 'deals', { name: 'Bayside' });
      expect(said(second)).toBe('ok');
      const secondId = (second.json() as { data: { id: number } }).data.id;
      // The case itself: SQLite gives the deleted key again; the others never do.
      if (dialect === 'sqlite') expect(secondId).toBe(firstId);
      await s.jobs();
      expect(await marks()).toEqual(['Atrium', 'Bayside']);

      // The first run is kept, with its history; only its key was let go.
      const runs = await s.meta.db.selectFrom('adminium_automation_runs').select(['status', 'dedupeKey']).orderBy('startedAt').execute();
      expect(runs.map((run) => run.status)).toEqual(['succeeded', 'succeeded']);
      expect(runs[0]!.dedupeKey).toBeNull();
      expect(runs[1]!.dedupeKey).not.toBeNull();
    });
  });
}

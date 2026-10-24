// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE'S WRITE FROM A SAMPLE ROW, against the whole server on SQLite,
 * Postgres and MySQL, with the sample added and removed through its routes:
 *
 *  - a rule's write may name a sample person when the row that started it is
 *    a sample row, by the settings row and by the record's own person
 *    (`else`); never on a real row, where it names nobody (or the real person
 *    `else` falls back to), and the run's log says so;
 *  - the rows a rule made from sample rows are listed with the sample, and
 *    "Remove sample data" takes them too (the sample job they hang off with
 *    them); a rule-made row a real person wrote a row under stays, with its
 *    job; a row a rule made from a real row is never listed nor taken.
 *
 * Before this, every sample person was turned into nobody (the Sales CRM's
 * sample sign-off booked no aftercare call: its owner is required), and the
 * rule-made rows stayed, keeping their sample job with them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { usersRepo } from '@adminium/meta';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.29' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });

function firm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'firm',
    name: 'Firm',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.firm.desc', fallback: 'A firm.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.29', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'work', label: en('Work'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, { ref: 'aftercare_owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }] },
        {
          ref: 'jobs',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'state', type: 'enum', enum: ['open', 'signed-off'], default: 'open' },
            { ref: 'seller_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
          ],
        },
        {
          ref: 'follow_ups',
          columns: [id, { ref: 'job_id', type: 'fk', references: 'jobs' }, { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }, { ref: 'text', type: 'text', maxLength: 80, nullable: true }],
        },
        // What a real person writes under a follow-up.
        { ref: 'notes', columns: [id, { ref: 'follow_up_id', type: 'fk', references: 'follow_ups' }, { ref: 'text', type: 'text', maxLength: 80 }] },
      ],
    },
    roles: [{ key: 'office', name: 'Office', permissions: ['table:@jobs:read', 'table:@follow_ups:read', 'page:@firm-jobs:view'] }],
    pages: [{ ref: 'firm-jobs', template: 'page-crud', title: { key: 't.jobs', fallback: 'Jobs' }, nav: { group: 'work', icon: 'list', order: 1 }, bindings: { rows: 'jobs' } }],
    sampleData: { file: 'seeds/firm.sample.json', people: [{ key: 'sid', name: 'Sid Sample', role: 'office' }] },
    automations: [
      {
        key: 'aftercare',
        name: en('A job signed off: an aftercare call'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'jobs', changedColumn: 'state', when: [{ left: { field: 'state' }, op: 'is', right: 'signed-off' }] },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            {
              id: 'call',
              kind: 'action',
              title: 'call',
              action: {
                kind: 'record.create',
                table: 'follow_ups',
                values: { job_id: '{{record.id}}', owner_id: { setting: { table: 'settings', column: 'aftercare_owner_id' }, else: { staff: 'seller_id' } }, text: 'aftercare {{record.name}}' },
              },
            },
          ],
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'firm',
  tables: [
    {
      ref: 'jobs',
      rows: [
        { name: 'Sample one', seller_id: { '@person': 'sid' } },
        { name: 'Sample two', seller_id: { '@person': 'sid' } },
        { name: 'Sample three', seller_id: { '@person': 'sid' } },
      ],
    },
  ],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a rule's write from a sample row, on ${dialect}`, () => {
    let s: WholeServer;
    let sid = '';
    const jobId = async (name: string): Promise<number> => Number((await s.rows(`SELECT id FROM firm_jobs WHERE name = '${name}'`))[0]!['id']);
    const followUp = async (job: number): Promise<Record<string, unknown> | undefined> => (await s.rows(`SELECT id, owner_id FROM firm_follow_ups WHERE job_id = ${String(job)}`))[0];
    const signOff = async (job: number): Promise<void> => {
      expect(said(await s.change('owner', 'jobs', job, { state: 'signed-off' }))).toBe('ok');
      await s.jobs();
    };
    const lastLog = async (): Promise<string> => {
      const [run] = await s.meta.db.selectFrom('adminium_automation_runs').select(['trace', 'status']).orderBy('startedAt', 'desc').limit(1).execute();
      expect(run?.status).toBe('succeeded');
      return typeof run!.trace === 'string' ? run!.trace : JSON.stringify(run!.trace);
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, firm(), { people: { mia: ['office'] }, files: { 'seeds/firm.sample.json': JSON.stringify(BUNDLE) } });
      expect(said(await s.send('owner', 'POST', '/api/v1/apps/firm/sample-data', {}))).toBe('ok');
      await s.jobs();
      const sample = await usersRepo(s.meta).list({ status: 'sample', limit: 10 });
      expect(sample.map((user) => user.name)).toEqual(['Sid Sample']);
      sid = sample[0]!.id;
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a sample job signed off: its call is for the sample person who sold it; a real job sold by the same person: for nobody, and the log says so', async () => {
      const sampleJob = await jobId('Sample one');
      await signOff(sampleJob);
      expect((await followUp(sampleJob))?.['owner_id']).toBe(sid);

      // A real row naming a sample person (the owner may name one): the rule hands it to nobody.
      expect(said(await s.make('owner', 'jobs', { name: 'Real one', seller_id: sid }))).toBe('ok');
      const realJob = await jobId('Real one');
      await signOff(realJob);
      const made = await followUp(realJob);
      expect(made).toBeDefined();
      expect(made!['owner_id']).toBeNull();
      expect(await lastLog()).toContain('seller_id');
    });

    it('the settings row names the sample person: a sample job\'s call is hers; a real job\'s is not, and falls to its real seller', async () => {
      await s.rows(`INSERT INTO firm_settings (id, aftercare_owner_id) VALUES (1, '${sid}')`);
      const sampleJob = await jobId('Sample two');
      await signOff(sampleJob);
      expect((await followUp(sampleJob))?.['owner_id']).toBe(sid);

      expect(said(await s.make('owner', 'jobs', { name: 'Real two', seller_id: s.ids['mia'] }))).toBe('ok');
      const realJob = await jobId('Real two');
      await signOff(realJob);
      expect((await followUp(realJob))?.['owner_id']).toBe(s.ids['mia']);
    });

    it('lists the calls made from sample jobs with the sample, never one made from a real job', async () => {
      const ledger = await s.rows(`SELECT table_ref, pk FROM firm_sample_data WHERE table_ref = 'follow_ups' ORDER BY seq`);
      const calls = [await followUp(await jobId('Sample one')), await followUp(await jobId('Sample two'))].map((row) => Number(row!['id']));
      expect(ledger.map((entry) => Number((JSON.parse(String(entry['pk'])) as { id: unknown }).id))).toEqual(calls);
    });

    it('Remove sample data takes the calls a rule made from sample jobs, and their jobs; keeps one a real person wrote under, and every real row', async () => {
      const kept = await followUp(await jobId('Sample two'));
      // A real person's note under the second call: hers, so the call and its job stay.
      await s.rows(`INSERT INTO firm_notes (id, follow_up_id, text) VALUES (1, ${String(kept!['id'])}, 'Called, all good')`);
      const removed = await s.send('owner', 'POST', '/api/v1/apps/firm/sample-data/remove', { keepChanged: false });
      expect(said(removed)).toBe('ok');

      const jobs = (await s.rows('SELECT name FROM firm_jobs ORDER BY id')).map((row) => String(row['name']));
      expect(jobs).toEqual(['Sample two', 'Real one', 'Real two']);
      const calls = (await s.rows('SELECT text FROM firm_follow_ups ORDER BY id')).map((row) => String(row['text']));
      expect(calls).toEqual(['aftercare Real one', 'aftercare Sample two', 'aftercare Real two']);
      expect(await s.rows('SELECT text FROM firm_notes')).toEqual([{ text: 'Called, all good' }]);
    });
  });
}

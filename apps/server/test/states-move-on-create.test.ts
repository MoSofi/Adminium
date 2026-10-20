// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A NEW CHILD ROW MOVES ITS PARENT (`states.children.<table>.moveOnCreate`),
 * against the whole server on SQLite, Postgres and MySQL.
 *
 * A field crew member, whose role makes sign-offs and reads no job, signs a
 * job off on his phone by making a `sign_offs` row. The job moves to
 * signed-off by its own listed move, judged with the new sign-off counted
 * (`requires.children`), its stamp written, and the rule that runs on a job
 * signed off runs. A correction made later moves nothing; a sign-off while a
 * snag still blocks, or on a job with no listed move there, is refused whole.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.30' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });

/** A job's columns: its state, what blocks its sign-off, and the stamp its sign-off writes. */
const jobColumns = [
  id,
  { ref: 'name', type: 'text', maxLength: 80 },
  { ref: 'state', type: 'enum', enum: ['open', 'installed', 'signed-off'], default: 'open' },
  { ref: 'blocking_snags', type: 'int', default: 0 },
  { ref: 'signed_off_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'state', values: ['signed-off'] } } } },
];

const signOffColumns = (parent: string) => [
  id,
  { ref: 'job_id', type: 'fk', references: parent },
  { ref: 'signer_name', type: 'text', maxLength: 80 },
  { ref: 'corrects_id', type: 'fk', references: parent === 'jobs' ? 'sign_offs' : 'quick_sign_offs', nullable: true },
  { ref: 'retry_key', type: 'text', maxLength: 64, nullable: true, unique: true, rules: { retryKey: true } },
];

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
    compatibility: { minAdminiumVersion: '0.3.30', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'jobs', label: en('Jobs'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'jobs',
          columns: jobColumns,
          states: {
            column: 'state',
            initial: 'open',
            moves: {
              open: ['installed'],
              installed: [{ to: 'signed-off', requires: { children: { sign_offs: 1 }, where: [{ column: 'blocking_snags', eq: 0 }] } }],
            },
            children: { sign_offs: { via: 'job_id', createIn: ['open', 'installed', 'signed-off'], moveOnCreate: 'signed-off' } },
          },
        },
        { ref: 'sign_offs', columns: signOffColumns('jobs') },
        {
          // A small job signed off straight from open: the move is listed.
          ref: 'quick_jobs',
          columns: jobColumns,
          states: {
            column: 'state',
            initial: 'open',
            moves: { open: ['installed', { to: 'signed-off', requires: { children: { quick_sign_offs: 1 } } }], installed: ['signed-off'] },
            children: { quick_sign_offs: { via: 'job_id', moveOnCreate: 'signed-off' } },
          },
        },
        { ref: 'quick_sign_offs', columns: signOffColumns('quick_jobs') },
        { ref: 'follow_ups', columns: [id, { ref: 'job', type: 'int' }, { ref: 'note', type: 'text', maxLength: 80 }] },
      ],
    },
    roles: [
      {
        key: 'crew',
        name: 'Field crew',
        permissions: ['table:@sign_offs:read', 'table:@sign_offs:create', 'table:@quick_sign_offs:read', 'table:@quick_sign_offs:create', 'page:@crm-sign-offs:view'],
      },
    ],
    pages: [{ ref: 'crm-sign-offs', template: 'page-crud', title: { key: 't.so', fallback: 'Sign-offs' }, nav: { group: 'jobs', icon: 'list', order: 1 }, bindings: { rows: 'sign_offs' } }],
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
            { id: 'call', kind: 'action', title: 'call', action: { kind: 'record.create', table: 'follow_ups', values: { job: '{{record.id}}', note: 'aftercare {{record.name}}' } } },
          ],
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a new sign-off moves its job, on ${dialect}`, () => {
    let s: WholeServer;
    const keyOf = (res: Awaited<ReturnType<WholeServer['make']>>): number => (res.json() as { data: { id: number } }).data.id;
    const job = async (table: string, key: number): Promise<{ state: string; signed: unknown }> => {
      const [row] = await s.rows(`SELECT state, signed_off_at FROM crm_${table} WHERE id = ${String(key)}`);
      return { state: String(row!['state']), signed: row!['signed_off_at'] };
    };
    const count = async (table: string, where = '1 = 1'): Promise<number> => Number((await s.rows(`SELECT COUNT(*) AS n FROM crm_${table} WHERE ${where}`))[0]!['n']);
    /** A job made and moved by the office (Super Admin). */
    const installedJob = async (name: string, snags = 0): Promise<number> => {
      const key = keyOf(await s.make('owner', 'jobs', { name }));
      expect(said(await s.change('owner', 'jobs', key, { state: 'installed', blocking_snags: snags }))).toBe('ok');
      return key;
    };
    /** A sign-off as the crew sends it from the phone: with a retry key, so a lost answer can be sent again. */
    const signOff = (ref: string, values: Record<string, unknown>, clientKey?: string) =>
      s.send('crew', 'POST', `/api/v1/data/${s.connectionId}/${s.t(ref)}`, { values, ...(clientKey === undefined ? {} : { clientKey }) });

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { crew: ['crew'] } });
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('the crew reads no job: their sign-off moves it to signed-off, stamped, and the aftercare rule runs once', async () => {
      const key = await installedJob('Bay window');
      // The crew may not read the job, nor move it themselves.
      expect(said(await s.get('crew', `/api/v1/data/${s.connectionId}/${s.t('jobs')}/${String(key)}`))).not.toBe('ok');
      expect(said(await s.change('crew', 'jobs', key, { state: 'signed-off' }))).not.toBe('ok');
      expect((await job('jobs', key)).state).toBe('installed');

      const made = await signOff('sign_offs', { job_id: key, signer_name: 'Ada' }, 'phone-1-sign-off-from-the-site');
      expect(said(made), made.body).toBe('ok');
      expect((made.json() as { undoToken?: unknown }).undoToken ?? null).toBeNull();
      const after = await job('jobs', key);
      expect(after.state).toBe('signed-off');
      expect(after.signed).not.toBeNull();
      expect(await count('sign_offs', `job_id = ${String(key)}`)).toBe(1);

      // Announced as a change of the job by the crew member: audited, and the rule that runs on it runs.
      const audited = await s.meta.db.selectFrom('adminium_audit_log').select(['actorId', 'entityId']).where('action', '=', 'record.update').where('entityTable', '=', s.t('jobs')).execute();
      // The office's move to installed, then the crew member's sign-off moving it on.
      expect(audited.filter((row) => row.entityId === String(key)).map((row) => row.actorId).sort()).toEqual([s.ids['owner'], s.ids['crew']].sort());
      await s.jobs();
      expect(await count('follow_ups', `job = ${String(key)}`)).toBe(1);

      // The same send again (an answer lost on the way): the sign-off it made is answered, nothing moves again.
      const again = await signOff('sign_offs', { job_id: key, signer_name: 'Ada' }, 'phone-1-sign-off-from-the-site');
      expect(again.statusCode, again.body).toBe(200);
      expect(await count('sign_offs', `job_id = ${String(key)}`)).toBe(1);

      // A correction: a new sign-off naming the one it corrects, on a job signed off already. Made; nothing moves.
      const first = keyOf(made);
      const correction = await signOff('sign_offs', { job_id: key, signer_name: 'Ada Lovelace', corrects_id: first }, 'phone-2-sign-off-from-the-site');
      expect(said(correction), correction.body).toBe('ok');
      expect(await job('jobs', key)).toEqual(after);
      expect(await count('sign_offs', `job_id = ${String(key)}`)).toBe(2);
      await s.jobs();
      expect(await count('follow_ups', `job = ${String(key)}`)).toBe(1);
      // …and a plain one, through the single-row door, the same.
      expect(said(await s.make('crew', 'sign_offs', { job_id: key, signer_name: 'Ada', corrects_id: keyOf(correction) }))).toBe('ok');
      expect(await job('jobs', key)).toEqual(after);
    });

    it('a sign-off while a snag still blocks is refused whole, and tells the crew nothing of the job', async () => {
      const key = await installedJob('Porch door', 2);
      const refused = await signOff('sign_offs', { job_id: key, signer_name: 'Ada' }, 'phone-3-sign-off-from-the-site');
      expect(said(refused)).toBe('409 STATE_MOVE_REFUSED');
      expect(refused.body).not.toContain('blocking_snags');
      expect(refused.body).not.toContain('installed');
      expect(await count('sign_offs', `job_id = ${String(key)}`)).toBe(0);
      expect((await job('jobs', key)).state).toBe('installed');
      // The snag put right, the same key goes through.
      expect(said(await s.change('owner', 'jobs', key, { blocking_snags: 0 }))).toBe('ok');
      expect(said(await signOff('sign_offs', { job_id: key, signer_name: 'Ada' }, 'phone-3-sign-off-from-the-site'))).toBe('ok');
      expect((await job('jobs', key)).state).toBe('signed-off');
    });

    it('a job still open, with no listed move to signed-off, refuses the sign-off; where the move is listed, it moves', async () => {
      const open = keyOf(await s.make('owner', 'jobs', { name: 'Garage' }));
      const refused = await s.make('crew', 'sign_offs', { job_id: open, signer_name: 'Ada' });
      expect(said(refused)).toBe('409 STATE_MOVE_REFUSED');
      expect(await count('sign_offs', `job_id = ${String(open)}`)).toBe(0);
      expect((await job('jobs', open)).state).toBe('open');

      const quick = keyOf(await s.make('owner', 'quick_jobs', { name: 'Letterbox' }));
      const made = await s.make('crew', 'quick_sign_offs', { job_id: quick, signer_name: 'Ada' });
      expect(said(made), made.body).toBe('ok');
      const after = await job('quick_jobs', quick);
      expect(after.state).toBe('signed-off');
      expect(after.signed).not.toBeNull();
    });
  });
}

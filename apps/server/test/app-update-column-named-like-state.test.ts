// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPDATE ADDS A COLUMN NAMED LIKE ONE OF ITS TABLE'S STATES.
 *
 * A print works' proofs move through the states `sent`, `approved` and
 * `change_asked`. 0.1.1 adds a column `change_asked` (1 when the customer
 * asked for a change, worked out from the state) and a total of it on the
 * job. The update fills both for the rows already there, on SQLite, Postgres
 * and MySQL: the column's name is never read as the state, nor the state as
 * the column.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.50' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const STATES = ['sent', 'approved', 'change_asked'];

function works(version: '0.1.0' | '0.1.1'): Record<string, unknown> {
  const next = version === '0.1.1';
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'works',
    name: 'Works',
    version,
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.works.desc', fallback: 'A print works.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'work', label: { 'en-US': 'Work' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'jobs',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            ...(next ? [{ ref: 'changes', type: 'int', nullable: true, rules: { rollup: { from: 'proofs', via: 'job_id', sum: 'change_asked' } } }] : []),
          ],
        },
        {
          ref: 'proofs',
          columns: [
            id,
            { ref: 'job_id', type: 'fk', references: 'jobs' },
            { ref: 'state', type: 'enum', enum: STATES, default: 'sent' },
            { ref: 'answered_at', type: 'timestamptz', nullable: true },
            ...(next
              ? [{ ref: 'change_asked', type: 'int', nullable: true, rules: { formula: { if: [{ or: [{ isNull: 'answered_at' }, { eq: ['state', 'approved'] }] }, 0, 1] } } }]
              : []),
          ],
          states: {
            column: 'state',
            initial: 'sent',
            moves: { sent: ['approved', 'change_asked'], change_asked: [] },
          },
        },
      ],
    },
    pages: [{ ref: 'works-proofs', template: 'page-crud', title: { key: 't.proofs', fallback: 'Proofs' }, nav: { group: 'work', icon: 'list', order: 1 }, bindings: { rows: 'proofs' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an update adds a column named like a state, on ${dialect}`, () => {
    let s: WholeServer;
    let updated: { statusCode: number; body: string };

    beforeAll(async () => {
      s = await wholeServer(dialect, works('0.1.0'), { people: {} });
      await s.rows(`INSERT INTO works_jobs (id, name) VALUES (1, 'Cards'), (2, 'Flyers')`);
      const at = dialect === 'sqlite' ? `'2026-11-09T10:00:00.000Z'` : `'2026-11-09 10:00:00'`;
      await s.rows(`INSERT INTO works_proofs (id, job_id, state, answered_at) VALUES (1, 1, 'sent', NULL), (2, 1, 'change_asked', ${at}), (3, 2, 'approved', ${at})`);
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(works('0.1.1')), 'staff/index.html': '<!doctype html><html><body></body></html>' });
      const staged = await s.app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: s.cookie['owner']!, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
      expect(staged.statusCode, staged.body).toBe(200);
      updated = await s.send('owner', 'POST', '/api/v1/apps/works/update', {});
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('takes the update and fills the new column and its total for the rows already there', async () => {
      expect(updated.statusCode, updated.body).toBe(200);
      const proofs = await s.rows('SELECT id, state, change_asked FROM works_proofs ORDER BY id');
      expect(proofs.map((row) => [Number(row['id']), row['state'], Number(row['change_asked'])])).toEqual([
        [1, 'sent', 0],
        [2, 'change_asked', 1],
        [3, 'approved', 0],
      ]);
      const jobs = await s.rows('SELECT id, changes FROM works_jobs ORDER BY id');
      expect(jobs.map((row) => [Number(row['id']), Number(row['changes'])])).toEqual([
        [1, 1],
        [2, 0],
      ]);
    });
  });
}

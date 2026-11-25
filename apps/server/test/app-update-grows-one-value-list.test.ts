// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPDATE GROWS A LIST THAT HELD ONE VALUE.
 *
 * A till's outbox starts with one kind of message, `receipt`. Postgres keeps
 * `kind IN ('receipt')` as `kind = 'receipt'`, MySQL as `` `kind` = 'receipt' ``:
 * no list at all. Read that way, the update saw nothing to add to, widened
 * nothing, and every write of a new kind was refused, by Adminium and by the
 * database. 0.1.1 adds three kinds; the update widens the list on all three
 * engines with no question asked, each new kind is taken, and a value on no
 * list is still refused.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.76' }));

const KINDS_BEFORE = ['receipt'];
const KINDS_AFTER = ['receipt', 'pickup_ready', 'table_reminder', 'receipt_text'];

function till(version: '0.1.0' | '0.1.1'): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'till',
    name: 'Till',
    version,
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.till.desc', fallback: 'A till.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.20', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'till', label: { 'en-US': 'Till' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'messages',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'kind', type: 'enum', enum: version === '0.1.0' ? KINDS_BEFORE : KINDS_AFTER, default: 'receipt' },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent'], default: 'queued' },
          ],
        },
      ],
    },
    pages: [{ ref: 'till-messages', template: 'page-crud', title: { key: 't.messages', fallback: 'Messages' }, nav: { group: 'till', icon: 'list', order: 1 }, bindings: { rows: 'messages' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an update grows a list that held one value, on ${dialect}`, () => {
    let s: WholeServer;
    let planned: { tables: { ref: string; edits: { kind: string; column: string; values?: string[] }[] }[] };
    let updated: { statusCode: number; body: string };

    beforeAll(async () => {
      s = await wholeServer(dialect, till('0.1.0'));
      expect(said(await s.make('owner', 'messages', { id: 1, kind: 'receipt', status: 'queued' }))).toBe('ok');
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(till('0.1.1')), 'staff/index.html': '<!doctype html><html><body></body></html>' });
      const staged = await s.app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: s.cookie['owner']!, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
      expect(staged.statusCode, staged.body).toBe(200);
      const plan = await s.send('owner', 'POST', '/api/v1/apps/plan', { key: 'till', version: '0.1.1', connectionId: s.connectionId });
      expect(plan.statusCode, plan.body).toBe(200);
      planned = (plan.json() as { plan: typeof planned }).plan;
      updated = await s.send('owner', 'POST', '/api/v1/apps/till/update', {});
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('plans the new values as an addition to the list, and nothing else', () => {
      expect(planned.tables.find((t) => t.ref === 'messages')?.edits).toEqual([{ kind: 'enum-values', column: 'kind', values: ['pickup_ready', 'table_reminder', 'receipt_text'] }]);
    });

    it('takes the update with no question asked, and each new kind after it', async () => {
      expect(updated.statusCode, updated.body).toBe(200);
      let id = 2;
      for (const kind of KINDS_AFTER) {
        const made = await s.make('owner', 'messages', { id, kind, status: 'queued' });
        expect([kind, made.statusCode], made.body).toEqual([kind, 201]);
        id += 1;
      }
      const kept = await s.rows(`SELECT id, kind FROM till_messages ORDER BY id`);
      expect(kept.map((row) => [Number(row['id']), row['kind']])).toEqual([[1, 'receipt'], ...KINDS_AFTER.map((kind, at) => [at + 2, kind])]);
    });

    it('still refuses a kind on no list, in Adminium and in the database', async () => {
      expect(said(await s.make('owner', 'messages', { id: 50, kind: 'postcard', status: 'queued' }))).toBe('422 VALIDATION_FAILED');
      await expect(s.rows(`INSERT INTO till_messages (id, kind, status) VALUES (51, 'postcard', 'queued')`)).rejects.toThrow();
    });
  });
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LISTING RULE, FOR EVERY WRITER, on SQLite, Postgres and MySQL.
 *
 * The people on a deal are a way to read it: a deal's `belongs` reads it
 * through `deal_members.user_id`. So that column holds only somebody who can
 * open the deal they are listed on (`assertListedCanOpen`). The data routes
 * have always asked it of what a person sends; here every other writer is
 * asked it too, each with a person who reads no deal (Kim, at the desk) and
 * one who does once listed (Ana, a rep who reads her own deals):
 *
 *  - a rule's write step (`record.create`);
 *  - an effect: a nomination done moves its seat to "on", and the seat's
 *    stamp copies the proposed person into `user_id` (a second listing,
 *    `deal_seats`, whose person only Adminium writes);
 *  - a timed move of a seat to "on", with the same stamp;
 *  - an import by somebody nothing limits (the Super Admin);
 *  - the owner's code (`db.table(...).insert/update`).
 *
 * The person door is tried beside them, as it always answered.
 */
import { Readable } from 'node:stream';

import { filesRepo, importsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWriteService, type WriteContext } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import type { FileStore } from '../src/files/store.js';
import { registerImportRunHandler } from '../src/jobs/import-run.js';
import { createProjectDb } from '../src/project/code/db.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const person = (ref: string, staff = true) => ({ ref, type: 'text', maxLength: 36, nullable: true, ...(staff ? { rules: { staff: true } } : {}) });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });

function lists(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'lists',
    name: 'Lists',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.lists.desc', fallback: 'Lists.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'lists', label: en('Lists'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'notes', columns: [id, { ref: 'text', type: 'text', maxLength: 120 }] },
        {
          ref: 'deals',
          belongs: [
            { column: 'owner_id', set: 'anyone' },
            { through: { table: 'deal_members', link: 'deal_id', user: 'user_id' } },
            { through: { table: 'deal_seats', link: 'deal_id', user: 'user_id' } },
          ],
          columns: [id, { ref: 'name', type: 'text', maxLength: 120 }, person('owner_id')],
        },
        // A listing: whoever its user_id names reads the deal.
        { ref: 'deal_members', columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, person('user_id')] },
        {
          // Another, whose person is Adminium's to write: a seat made "on" (by a move, an effect, the clock) takes the person proposed.
          ref: 'deal_seats',
          columns: [
            id,
            { ref: 'deal_id', type: 'fk', references: 'deals' },
            { ...person('user_id'), rules: { staff: true, stamp: { set: { copy: 'proposed_id' }, on: { column: 'state', values: ['on'] } } } },
            person('proposed_id', false),
            { ref: 'state', type: 'enum', enum: ['asked', 'on'], default: 'asked' },
            { ref: 'due_at', type: 'timestamptz', nullable: true },
          ],
          states: { column: 'state', initial: 'asked', moves: { asked: ['on'] }, timed: [{ from: 'asked', to: 'on', at: { column: 'due_at' } }] },
        },
        {
          // Done, a nomination puts its seat on (an effect).
          ref: 'nominations',
          columns: [id, { ref: 'seat_id', type: 'fk', references: 'deal_seats', nullable: true }, { ref: 'state', type: 'enum', enum: ['open', 'done'], default: 'open' }],
          states: { column: 'state', initial: 'open', moves: { open: ['done'] }, effects: [{ on: { to: 'done' }, via: 'seat_id', set: { state: 'on' } }] },
        },
        // Made, an invite has a rule list its person on its deal.
        { ref: 'invites', columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, person('person', false)] },
      ],
    },
    roles: [
      { key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'table:@deal_members:read', 'page:@lists-deals:view'], limits: { deals: { rows: { read: { reach: 'own' } } } } },
      { key: 'desk', name: 'Desk', permissions: ['table:@notes:read', 'page:@lists-notes:view'] },
    ],
    pages: [
      { ref: 'lists-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'lists', icon: 'list', order: 1 }, bindings: { rows: 'deals' } },
      { ref: 'lists-notes', template: 'page-crud', title: { key: 't.notes', fallback: 'Notes' }, nav: { group: 'lists', icon: 'list', order: 2 }, bindings: { rows: 'notes' } },
    ],
    automations: [
      {
        key: 'invite-lists',
        name: en('An invite lists its person on the deal'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'invites' },
        graph: flow({ id: 'add', kind: 'action', title: 'add', action: { kind: 'record.create', table: 'deal_members', values: { deal_id: '{{record.deal_id}}', user_id: '{{record.person}}' } } }),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`the listing rule holds for every writer [${dialect}]`, () => {
    let s: WholeServer;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);
    const one = async (statement: string): Promise<Record<string, unknown> | undefined> => (await s.rows(statement))[0];
    const member = (key: number) => one(`SELECT user_id FROM ${real('deal_members')} WHERE id = ${String(key)}`);
    const seat = (key: number) => one(`SELECT user_id, state FROM ${real('deal_seats')} WHERE id = ${String(key)}`);
    const membersOf = async (user: string): Promise<number> => Number((await one(`SELECT COUNT(*) AS n FROM ${real('deal_members')} WHERE user_id = '${user}'`))!['n']);
    const field = (res: { body: string }, column: string): unknown => (JSON.parse(res.body) as { error?: { details?: { fields?: Record<string, { code?: unknown }> } } }).error?.details?.fields?.[column]?.code;

    beforeAll(async () => {
      s = await wholeServer(dialect, lists(), { people: { ana: ['rep'], kim: ['desk'] } });
      await s.rows(`INSERT INTO ${real('deals')} (id, name, owner_id) VALUES (1, 'Harbour', '${s.ids['owner']!}')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('the person door, as it always answered: nobody lists Kim, whoever writes', async () => {
      const refused = await s.make('owner', 'deal_members', { id: 1, deal_id: 1, user_id: s.ids['kim'] });
      expect(said(refused), refused.body).toBe('422 VALIDATION_FAILED');
      expect(field(refused, 'user_id')).toBe('cannot-open');
      const listed = await s.make('owner', 'deal_members', { id: 1, deal_id: 1, user_id: s.ids['ana'] });
      expect(said(listed), listed.body).toBe('ok');
      await s.rows(`DELETE FROM ${real('deal_members')} WHERE id = 1`);
    });

    it("a rule's write step lists nobody who cannot open the deal", async () => {
      expect(said(await s.make('owner', 'invites', { id: 1, deal_id: 1, person: s.ids['kim'] }))).toBe('ok');
      await s.jobs();
      expect(await membersOf(s.ids['kim']!)).toBe(0);
      const runs = await s.meta.db.selectFrom('adminium_automation_runs').select(['status', 'error', 'trace']).execute();
      expect(runs.map((run) => run.status)).toEqual(['failed']);
      expect(JSON.stringify(runs[0])).toContain('Some values were refused.');
      // Ana reads the deals she is on: listed, she opens this one.
      expect(said(await s.make('owner', 'invites', { id: 2, deal_id: 1, person: s.ids['ana'] }))).toBe('ok');
      await s.jobs();
      expect(await membersOf(s.ids['ana']!)).toBe(1);
      await s.rows(`DELETE FROM ${real('deal_members')}`);
    });

    it('an effect moves no seat on whose stamp lists somebody who cannot open the deal', async () => {
      await s.rows(`INSERT INTO ${real('deal_seats')} (id, deal_id, proposed_id, state) VALUES (10, 1, '${s.ids['kim']!}', 'asked'), (11, 1, '${s.ids['ana']!}', 'asked')`);
      await s.rows(`INSERT INTO ${real('nominations')} (id, seat_id, state) VALUES (1, 10, 'open'), (2, 11, 'open')`);
      const refused = await s.change('owner', 'nominations', 1, { state: 'done' });
      expect(said(refused), refused.body).toBe('422 VALIDATION_FAILED');
      expect(field(refused, 'user_id')).toBe('cannot-open');
      expect(await one(`SELECT state FROM ${real('nominations')} WHERE id = 1`)).toEqual({ state: 'open' });
      expect(await seat(10)).toEqual({ user_id: null, state: 'asked' });
      const moved = await s.change('owner', 'nominations', 2, { state: 'done' });
      expect(said(moved), moved.body).toBe('ok');
      expect(await seat(11)).toEqual({ user_id: s.ids['ana'], state: 'on' });
      await s.rows(`DELETE FROM ${real('nominations')}`);
      await s.rows(`DELETE FROM ${real('deal_seats')}`);
    });

    it('a timed move moves no seat on whose stamp lists somebody who cannot open the deal', async () => {
      const past = dialect === 'mysql' ? '2026-01-01 08:00:00' : '2026-01-01T08:00:00Z';
      await s.rows(`INSERT INTO ${real('deal_seats')} (id, deal_id, proposed_id, state, due_at) VALUES (20, 1, '${s.ids['kim']!}', 'asked', '${past}'), (21, 1, '${s.ids['ana']!}', 'asked', '${past}')`);
      await runTimedMoves({ meta: s.meta, manager: s.manager, app: s.app }, s.connectionId, {}, new Date('2026-06-01T08:00:00Z'));
      expect(await seat(20)).toEqual({ user_id: null, state: 'asked' });
      expect(await seat(21)).toEqual({ user_id: s.ids['ana'], state: 'on' });
      await s.rows(`DELETE FROM ${real('deal_seats')}`);
    });

    it('an import by somebody nothing limits lists nobody who cannot open the deal', async () => {
      const csv = `deal_id,user_id\n1,${s.ids['kim']!}\n1,${s.ids['ana']!}\n`;
      let report = '';
      const storage = {
        read: async () => Promise.resolve(Readable.from([csv])),
        write: async (input: { bytes: string }) => {
          report = input.bytes;
          return Promise.resolve({ storageKey: 'report', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' });
        },
      } as unknown as FileStore;
      const file = await filesRepo(s.meta).create({ filename: 'members.csv', mime: 'text/csv', sizeBytes: csv.length, sha256: 'x', kind: 'upload' });
      const imports = importsRepo(s.meta);
      const job = await imports.create({
        connectionId: s.connectionId,
        tableName: s.t('deal_members'),
        requestedBy: s.ids['owner']!,
        fileId: file.id,
        mapping: { columns: [{ from: 'deal_id', to: 'deal_id' }, { from: 'user_id', to: 'user_id' }] },
        options: { mode: 'insert', skipInvalid: true },
      });
      await imports.markReady(job.id, { total: 2 });
      let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | null = null;
      registerImportRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, { meta: s.meta, manager: s.manager, storage });
      await handler!({ importId: job.id }, { jobId: 'job_1', signal: new AbortController().signal, progress: () => {}, log: () => {} });
      expect(await membersOf(s.ids['kim']!)).toBe(0);
      expect(await membersOf(s.ids['ana']!)).toBe(1);
      // Refused as the limited importer's lines are: the first line, Kim's, and only it.
      expect(report.trim().split('\n')).toHaveLength(2);
      expect(report).toContain(`1,,DB_ERROR,Some values were refused.,"1,${s.ids['kim']!}"`);
      await s.rows(`DELETE FROM ${real('deal_members')}`);
    });

    it("the owner's code lists nobody who cannot open the deal, by an insert or an update", async () => {
      await s.meta.db.updateTable('adminium_connections').set({ projectKey: 'main' } as never).where('id', '=', s.connectionId).execute();
      const handle = await s.manager.data(s.connectionId);
      const context: WriteContext = { origin: 'action', hops: 0, actor: { kind: 'user', id: s.ids['owner']!, label: 'Owner' }, request: null };
      const writes = createWriteService(writeStores(s.meta));
      const db = createProjectDb({ app: s.app, meta: s.meta, manager: s.manager, writes: () => writes }, { database: 'main', raw: handle.db, dialect: handle.dialect, context });
      const members = db.table(real('deal_members'));
      await expect(members.insert({ id: 30, deal_id: 1, user_id: s.ids['kim'] })).rejects.toThrow('Some values were refused.');
      expect(await member(30)).toBeUndefined();
      await members.insert({ id: 30, deal_id: 1, user_id: s.ids['ana'] });
      expect(await member(30)).toEqual({ user_id: s.ids['ana'] });
      await expect(members.update(30, { user_id: s.ids['kim'] })).rejects.toThrow('Some values were refused.');
      expect(await member(30)).toEqual({ user_id: s.ids['ana'] });
      await s.rows(`DELETE FROM ${real('deal_members')}`);
    });
  });
}

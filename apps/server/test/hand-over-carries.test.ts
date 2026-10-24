// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A HAND-OVER THAT CARRIES CHILD ROWS, and THE LISTING RULE ON THE ROW AS ITS
 * RULES FILL IT, on SQLite, Postgres and MySQL.
 *
 * A deal's "Hand over" button asks for its new owner and carries along, in
 * the same write, the old owner's booked visits, open follow-ups and the
 * deal's watcher row that names them. A visit already made, and a
 * colleague's rows, stay as they are. Each carried row is an update of its
 * own: its audit row, and the rule that watches visits. A carried row the new
 * owner could not be listed on refuses the whole hand-over. A hand-over has
 * no Undo.
 *
 * Ana and Sam are reps; Kim is a rep who helps on Ana's deals; Lea is a rep
 * who also reads the deal notes the watchers' and followers' listings open.
 *
 * Then the person door: a follower row whose person a stamp fills with its
 * writer lists only somebody who can open what it lists them on, on a create
 * and on a change, as every other writer has been held to since the listing
 * rule was asked of them all.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { normalizeWriteValue } from '../src/crud/write-values.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

// The manifest uses words read from 0.3.35 on (`rows.via`, `states.carries`); until the release this server says 0.3.34.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.35' }));

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const person = (ref: string, rules: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength: 36, nullable: true, rules: { staff: true, ...rules } });
const deal = { ref: 'deal_id', type: 'fk', references: 'deals' };
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const grants = (table: string, ...actions: string[]) => actions.map((action) => `table:@${table}:${action}`);

function handing(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'handing',
    name: 'Handing',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.handing.desc', fallback: 'Handing over.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.35', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'handing', label: en('Handing'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          belongs: [{ column: 'owner_id', set: 'team' }, { through: { table: 'deal_members', link: 'deal_id', user: 'user_id' } }],
          columns: [id, { ref: 'name', type: 'text', maxLength: 120 }, person('owner_id'), { ref: 'state', type: 'enum', enum: ['open', 'won'], default: 'open' }],
          states: {
            column: 'state',
            initial: 'open',
            moves: { open: ['won'] },
            actions: [
              {
                id: 'hand-over',
                label: en('Hand over'),
                set: {},
                in: ['open'],
                ask: ['owner_id'],
                handOver: true,
                carries: [
                  { table: 'site_visits', via: 'deal_id', column: 'rep_id', where: [{ column: 'state', in: ['booked'] }] },
                  { table: 'follow_ups', via: 'deal_id', column: 'owner_id', where: [{ column: 'done', eq: false }] },
                  { table: 'deal_watchers', via: 'deal_id', column: 'user_id' },
                ],
              },
            ],
          },
        },
        // A helper on a deal reads it.
        { ref: 'deal_members', columns: [id, deal, person('user_id')] },
        {
          ref: 'site_visits',
          belongs: [{ column: 'rep_id', set: 'team' }, { via: 'deal_id' }],
          // A rep is at one visit at a time: a booked visit takes its rep for its minutes (a visit with no time yet takes nothing).
          occupies: { resource: 'rep_id', start: 'starts_at', minutes: 'minutes', countWhere: { column: 'state', values: ['booked'] } },
          columns: [
            id,
            deal,
            person('rep_id'),
            { ref: 'state', type: 'enum', enum: ['booked', 'done'], default: 'booked' },
            { ref: 'note', type: 'text', maxLength: 120, nullable: true },
            { ref: 'starts_at', type: 'timestamptz', nullable: true },
            { ref: 'minutes', type: 'int', nullable: true },
          ],
        },
        { ref: 'follow_ups', belongs: [{ column: 'owner_id', set: 'team' }], columns: [id, deal, person('owner_id'), { ref: 'done', type: 'bool', default: false }] },
        // Two listings the deal notes are read through: who watches a deal, and who follows it (its person is whoever wrote it last).
        { ref: 'deal_watchers', columns: [id, deal, person('user_id')] },
        { ref: 'deal_followers', columns: [id, deal, person('user_id', { stamp: { set: 'user-id', on: ['create', { columns: ['reason'] }] } }), { ref: 'reason', type: 'text', maxLength: 80, nullable: true }] },
        {
          ref: 'deal_notes',
          belongs: [{ through: { table: 'deal_watchers', link: 'deal_id', on: 'deal_id', user: 'user_id' } }, { through: { table: 'deal_followers', link: 'deal_id', on: 'deal_id', user: 'user_id' } }],
          columns: [id, deal, { ref: 'text', type: 'text', maxLength: 120 }],
        },
        // What the rule that watches visits writes: one line per change of a visit.
        { ref: 'visit_log', columns: [id, { ref: 'visit_id', type: 'int', nullable: true }, { ref: 'rep_id', type: 'text', maxLength: 36, nullable: true }] },
      ],
    },
    roles: [
      {
        key: 'rep',
        name: 'Rep',
        permissions: [
          ...grants('deals', 'read', 'update'),
          ...grants('deal_members', 'read'),
          ...grants('site_visits', 'read', 'create', 'update'),
          ...grants('follow_ups', 'read', 'create', 'update'),
          ...grants('deal_watchers', 'read', 'update'),
          ...grants('deal_followers', 'read', 'create', 'update'),
          'page:@handing-deals:view',
        ],
        limits: {
          deals: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } },
          // A rep never writes a visit's rep by hand: only a hand-over moves it.
          site_visits: { writable: ['note', 'state'], rows: { read: { reach: 'own' }, update: { reach: 'own', by: 'rep_id' } } },
          follow_ups: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } },
        },
      },
      { key: 'notes', name: 'Notes', permissions: [...grants('deal_notes', 'read'), 'page:@handing-notes:view'] },
    ],
    pages: [
      { ref: 'handing-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'handing', icon: 'list', order: 1 }, bindings: { rows: 'deals' } },
      { ref: 'handing-notes', template: 'page-crud', title: { key: 't.notes', fallback: 'Notes' }, nav: { group: 'handing', icon: 'list', order: 2 }, bindings: { rows: 'deal_notes' } },
    ],
    automations: [
      {
        key: 'visit-log',
        name: en('A changed visit is logged'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'site_visits' },
        graph: flow({ id: 'log', kind: 'action', title: 'log', action: { kind: 'record.create', table: 'visit_log', values: { visit_id: '{{record.id}}', rep_id: '{{record.rep_id}}' } } }),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a hand-over carries the old owner's child rows [${dialect}]`, () => {
    let s: WholeServer;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);
    const rows = (statement: string) => s.rows(statement);
    const field = (res: Reply, column: string): unknown => (JSON.parse(res.body) as { error?: { details?: { fields?: Record<string, { code?: unknown }> } } }).error?.details?.fields?.[column]?.code;
    const handOver = (who: string, key: number, to: string) => s.send(who, 'POST', `/api/v1/data/${s.connectionId}/${s.t('deals')}/${String(key)}/actions/hand-over`, { from: 'open', values: { owner_id: to } });
    const people = async (table: string, column: string, keys: number[]): Promise<(string | null)[]> =>
      (await rows(`SELECT ${column} AS who FROM ${real(table)} WHERE id IN (${keys.join(', ')}) ORDER BY id`)).map((row) => (row['who'] === null ? null : String(row['who'])));
    const who = (name: string): string => s.ids[name]!;

    beforeAll(async () => {
      s = await wholeServer(dialect, handing(), { people: { ana: ['rep'], sam: ['rep'], kim: ['rep'], lea: ['rep', 'notes'] } });
      const [ana, kim] = [who('ana'), who('kim')];
      await rows(`INSERT INTO ${real('deals')} (id, name, owner_id, state) VALUES (1, 'Harbour', '${ana}', 'open'), (2, 'Northfield', '${ana}', 'open')`);
      await rows(`INSERT INTO ${real('deal_members')} (id, deal_id, user_id) VALUES (1, 1, '${kim}')`);
      // Deal 1: Ana's booked visit and the one she made, and Kim's booked one as a helper.
      await rows(`INSERT INTO ${real('site_visits')} (id, deal_id, rep_id, state) VALUES (1, 1, '${ana}', 'booked'), (2, 1, '${ana}', 'done'), (3, 1, '${kim}', 'booked'), (4, 2, '${ana}', 'booked')`);
      // …Ana's open follow-up and her done one, and Kim's open one.
      const no = dialect === 'postgres' ? 'false' : '0';
      const yes = dialect === 'postgres' ? 'true' : '1';
      await rows(`INSERT INTO ${real('follow_ups')} (id, deal_id, owner_id, done) VALUES (1, 1, '${ana}', ${no}), (2, 1, '${ana}', ${yes}), (3, 1, '${kim}', ${no})`);
      // Ana watches deal 2: whoever deal 2 goes to is listed on its notes.
      await rows(`INSERT INTO ${real('deal_watchers')} (id, deal_id, user_id) VALUES (1, 2, '${ana}')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('moves the old owner\'s booked visits and open follow-ups in one write, and leaves made visits and other people\'s rows', async () => {
      const res = await handOver('ana', 1, who('sam'));
      expect(said(res), res.body).toBe('ok');
      // No Undo: no move back would take the carried rows back.
      expect((JSON.parse(res.body) as { undoToken?: unknown }).undoToken ?? null).toBeNull();
      expect(await people('deals', 'owner_id', [1])).toEqual([who('sam')]);
      expect(await people('site_visits', 'rep_id', [1, 2, 3])).toEqual([who('sam'), who('ana'), who('kim')]);
      expect(await people('follow_ups', 'owner_id', [1, 2, 3])).toEqual([who('sam'), who('ana'), who('kim')]);
      // Another deal's rows are not this hand-over's.
      expect(await people('site_visits', 'rep_id', [4])).toEqual([who('ana')]);
    });

    it('each carried row is an update of its own: its audit row and the rule that watches it', async () => {
      const audited = await s.meta.db.selectFrom('adminium_audit_log').select(['action', 'entity']).where('action', '=', 'record.update').execute();
      const tables = audited.map((row) => (JSON.parse(String(row.entity)) as { table: string; pk: Record<string, unknown> })).map((entity) => `${entity.table.slice(entity.table.lastIndexOf('.') + 1)}:${String(Object.values(entity.pk)[0])}`);
      expect(tables.filter((one) => !one.startsWith(real('visit_log'))).sort()).toEqual([`${real('deals')}:1`, `${real('follow_ups')}:1`, `${real('site_visits')}:1`].sort());
      await s.jobs();
      expect(await rows(`SELECT visit_id, rep_id FROM ${real('visit_log')} ORDER BY id`)).toEqual([{ visit_id: 1, rep_id: who('sam') }]);
    });

    it('a carried row the new owner could not be listed on refuses the whole hand-over', async () => {
      // Sam reads no deal notes: listed as deal 2's watcher he would be named against notes he cannot open.
      const refused = await handOver('ana', 2, who('sam'));
      expect(said(refused), refused.body).toBe('422 VALIDATION_FAILED');
      expect(field(refused, 'user_id')).toBe('cannot-open');
      expect(await people('deals', 'owner_id', [2])).toEqual([who('ana')]);
      expect(await people('site_visits', 'rep_id', [4])).toEqual([who('ana')]);
      expect(await people('deal_watchers', 'user_id', [1])).toEqual([who('ana')]);
      // Lea reads them: the deal goes to her with its booked visit and its watcher row.
      expect(said(await handOver('ana', 2, who('lea')))).toBe('ok');
      expect(await people('deals', 'owner_id', [2])).toEqual([who('lea')]);
      expect(await people('site_visits', 'rep_id', [4])).toEqual([who('lea')]);
      expect(await people('deal_watchers', 'user_id', [1])).toEqual([who('lea')]);
    });

    it('a helper cannot hand the deal over, and nothing of hers moves', async () => {
      const res = await handOver('kim', 1, who('kim'));
      expect(said(res)).not.toBe('ok');
      expect(await people('site_visits', 'rep_id', [3])).toEqual([who('kim')]);
    });

    it('a carried visit with a time is placed as a single change is: the new rep\'s clash refuses the hand-over, by name', async () => {
      const at = (iso: string): string => (dialect === 'postgres' ? iso : dialect === 'mysql' ? iso.slice(0, 19).replace('T', ' ') : String(normalizeWriteValue({ logicalType: 'timestamp' } as never, iso)));
      await rows(`INSERT INTO ${real('deals')} (id, name, owner_id, state) VALUES (3, 'Quayside', '${who('ana')}', 'open')`);
      // Ana's booked visit on deal 3 at ten for an hour; Kim is already booked from half past ten (on deal 1, as a helper).
      await rows(`INSERT INTO ${real('site_visits')} (id, deal_id, rep_id, state, starts_at, minutes) VALUES (5, 3, '${who('ana')}', 'booked', '${at('2027-03-01T10:00:00.000Z')}', 60), (6, 1, '${who('kim')}', 'booked', '${at('2027-03-01T10:30:00.000Z')}', 30)`);
      const clash = await handOver('ana', 3, who('kim'));
      expect(said(clash), clash.body).toBe('409 BOOKING_TAKEN');
      // Nothing moved: not the deal, not the visit.
      expect(await people('deals', 'owner_id', [3])).toEqual([who('ana')]);
      expect(await people('site_visits', 'rep_id', [5, 6])).toEqual([who('ana'), who('kim')]);
      // Sam is free at ten: the deal goes to him with its visit.
      const free = await handOver('ana', 3, who('sam'));
      expect(said(free), free.body).toBe('ok');
      expect(await people('deals', 'owner_id', [3])).toEqual([who('sam')]);
      expect(await people('site_visits', 'rep_id', [5])).toEqual([who('sam')]);
    });
  });

  describe.skipIf(!available)(`the listing rule judges the row as a person's write leaves it [${dialect}]`, () => {
    let s: WholeServer;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);
    const field = (res: Reply, column: string): unknown => (JSON.parse(res.body) as { error?: { details?: { fields?: Record<string, { code?: unknown }> } } }).error?.details?.fields?.[column]?.code;
    const follower = async (key: number): Promise<Record<string, unknown> | undefined> => (await s.rows(`SELECT user_id, reason FROM ${real('deal_followers')} WHERE id = ${String(key)}`))[0];

    beforeAll(async () => {
      s = await wholeServer(dialect, handing(), { people: { kim: ['rep'], lea: ['rep', 'notes'] } });
      await s.rows(`INSERT INTO ${real('deals')} (id, name, owner_id, state) VALUES (1, 'Harbour', '${s.ids['lea']!}', 'open')`);
      // Kim helps on Lea's deal: he reads it, so a row he hangs on it names a deal he reaches.
      await s.rows(`INSERT INTO ${real('deal_members')} (id, deal_id, user_id) VALUES (1, 1, '${s.ids['kim']!}')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a new follower row stamped with its writer: refused for somebody who cannot open the notes, made for somebody who can', async () => {
      // Kim sends no person at all: the stamp names him, and he reads no deal notes.
      const refused = await s.make('kim', 'deal_followers', { id: 1, deal_id: 1, reason: 'Kim follows' });
      expect(said(refused), refused.body).toBe('422 VALIDATION_FAILED');
      expect(field(refused, 'user_id')).toBe('cannot-open');
      expect(await follower(1)).toBeUndefined();
      const made = await s.make('lea', 'deal_followers', { id: 1, deal_id: 1, reason: 'Lea follows' });
      expect(said(made), made.body).toBe('ok');
      expect(await follower(1)).toEqual({ user_id: s.ids['lea'], reason: 'Lea follows' });
    });

    it('a change that the stamp turns into a listing of its writer: refused the same', async () => {
      const refused = await s.change('kim', 'deal_followers', 1, { reason: 'Now Kim' });
      expect(said(refused), refused.body).toBe('422 VALIDATION_FAILED');
      expect(field(refused, 'user_id')).toBe('cannot-open');
      expect(await follower(1)).toEqual({ user_id: s.ids['lea'], reason: 'Lea follows' });
      expect(said(await s.change('lea', 'deal_followers', 1, { reason: 'Still Lea' }))).toBe('ok');
      expect(await follower(1)).toEqual({ user_id: s.ids['lea'], reason: 'Still Lea' });
    });
  });
}

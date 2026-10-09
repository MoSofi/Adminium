// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Milo reads as the person who asked, column limits included, on every engine.
 *
 * A role that is shown three columns of a table gets those three from every
 * reading tool and nothing else: the others are absent from what the schema
 * tool describes, refused by name as a filter, a sort, a group or a measure,
 * absent from the rows and from a sample, and absent from what the turn
 * stores. Each tool is run the way a turn runs it (`setUpTurn(...).execute`),
 * as that role, never as an admin.
 *
 * Also here, because they are the same promise: a drafted rule is checked
 * against what its AUTHOR reads and may write, and the assistant answers a
 * signed-in person, not an API key.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { automationContext } from '../src/assistant/contexts/automation.js';
import type { TurnSetup } from '../src/assistant/turn-setup.js';
import { legs, person, signIn, stack, turnAs, type Stack } from './assistant-lodge.helpers.js';

// What the role is not shown. Keys stay readable under a limit (the row's own, and the one to its room): the grid needs them too.
const HIDDEN = ['guest_name', 'note', 'total', 'status', 'checked_in_by'];
const SHOWN = ['arrive', 'depart', 'id', 'late_until', 'room_id'];
const SECRETS = ['Nia Obi', 'VIP', '480', 'Olga Owner'];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`Milo reads as the person, column limits included — ${dialect}`, () => {
    let s: Stack;
    let owner: string;
    let hk: { cookie: string; id: string };
    let night: { cookie: string; id: string };
    let planner: { cookie: string; id: string };
    let schemaOf: { stays: string; rooms: string };

    /** A turn's tools, as this person, on the page that offers every reading tool. */
    const turn = (userId: string, context: 'report' | 'automation' = 'report') => turnAs(s, userId, context);
    const run = async (setup: TurnSetup, tool: string, args: Record<string, unknown>) => setup.execute({ id: 'c1', tool, args: { connectionId: s.connectionId, ...args } });
    const source = () => {
      const [schema, name] = schemaOf.stays.split('.') as [string, string];
      return { schema, name };
    };
    const expectNoSecret = (value: unknown) => {
      const text = JSON.stringify(value);
      for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
    };

    beforeAll(async () => {
      s = await stack(dialect);
      schemaOf = s.table;
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('101')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, note, total, late_until, status, checked_in_by) VALUES (1, '2026-11-05', '2026-11-08', 'Nia Obi', 'VIP', 480, '12:00', 'in_house', 'Olga Owner')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, note, total, late_until, status) VALUES (1, '2026-11-09', '2026-11-11', 'Nia Obi', 'VIP', 480, '14:00', 'booked')`);
      owner = await signIn(s.app, 'owner@lodge.dev');
      hk = await person(s, 'hk@lodge.dev', ['housekeeping']);
      night = await person(s, 'night@lodge.dev', ['night']);
      planner = await person(s, 'planner@lodge.dev', ['planner']);
    }, 180_000);
    afterAll(async () => s?.close());

    it('describes only the columns the role is shown, and no key over a hidden one', async () => {
      const setup = await turn(hk.id);
      const out = await run(setup, 'describe_schema', {});
      const tables = (out.result as { tables: { id: string; columns: { name: string }[]; foreignKeys: { columns: string[] }[] }[] }).tables;
      const stays = tables.find((table) => table.id === s.table.stays)!;
      expect(stays.columns.map((column) => column.name).sort()).toEqual(SHOWN);
      // Exactly the columns the grid's own route gives this person: Milo is shown what the screen shows.
      const listed = await s.app.inject({ method: 'GET', url: `/api/v1/data/${s.connectionId}/${s.table.stays}`, headers: { cookie: hk.cookie } });
      expect(listed.statusCode, listed.body).toBe(200);
      expect(Object.keys((listed.json() as { data: Record<string, unknown>[] }).data[0]!).sort()).toEqual(SHOWN);
      // Limits are per table: rooms is read whole.
      expect(tables.find((table) => table.id === s.table.rooms)!.columns.map((column) => column.name).sort()).toEqual(['id', 'number']);
      // The page's own count is the role's.
      expect((setup.facts as { tables?: number }).tables).toBe(2);
      expect(setup.system).not.toContain('guest_name');
    });

    it('reads rows without the hidden columns, and refuses one named as a column, a filter or a sort', async () => {
      const setup = await turn(hk.id);
      const rows = await run(setup, 'read_rows', { table: s.table.stays });
      expect(rows.error, JSON.stringify(rows.error)).toBeUndefined();
      const data = (rows.result as { rows: Record<string, unknown>[]; total: number }).rows;
      expect(data).toHaveLength(2);
      for (const row of data) expect(Object.keys(row).sort()).toEqual(SHOWN);
      expectNoSecret(rows);

      for (const args of [
        { columns: ['arrive', 'total'] },
        { where: { column: 'guest_name', op: 'eq', value: 'Nia Obi' } },
        { where: { and: [{ column: 'arrive', op: 'gte', value: '2026-01-01' }, { column: 'total', op: 'gt', value: 100 }] } },
        { sort: 'total.desc' },
      ]) {
        const refused = await run(setup, 'read_rows', { table: s.table.stays, ...args });
        expect(refused.error?.code, JSON.stringify({ args, refused })).toBe('COLUMN_FORBIDDEN');
        expect(refused.result).toBeUndefined();
        expectNoSecret(refused);
      }
    });

    it('answers no figure over a hidden column: as a measure, a group, a filter or an order', async () => {
      const setup = await turn(hk.id);
      const ok = await run(setup, 'aggregate', { descriptor: { shape: 'single-metric', source: source(), aggregations: [{ fn: 'count', alias: 'stays' }] } });
      expect(ok.error, JSON.stringify(ok.error)).toBeUndefined();
      for (const descriptor of [
        { shape: 'single-metric', source: source(), aggregations: [{ fn: 'sum', column: 'total', alias: 'money' }] },
        { shape: 'categorical', source: source(), groupBy: ['guest_name'], aggregations: [{ fn: 'count', alias: 'n' }] },
        { shape: 'single-metric', source: source(), aggregations: [{ fn: 'count', alias: 'n' }], filters: { column: 'total', op: 'gt', value: 100 } },
        { shape: 'categorical', source: source(), groupBy: ['arrive'], aggregations: [{ fn: 'count', alias: 'n' }], orderBy: [{ column: 'total', dir: 'desc' }] },
        { shape: 'timeseries', source: source(), bucket: { column: 'arrive', unit: 'month' }, aggregations: [{ fn: 'max', column: 'total', alias: 'top' }] },
      ]) {
        const refused = await run(setup, 'aggregate', { descriptor });
        expect(refused.error, JSON.stringify({ descriptor, refused })).toBeDefined();
        expect(refused.result).toBeUndefined();
        expectNoSecret(refused);
      }
    });

    it('samples a record without the hidden columns, and refuses a pick by one', async () => {
      // The rules page offers the sample tool; the report page does not.
      const setup = await turn(hk.id, 'automation');
      const sample = await run(setup, 'sample_record', { table: s.table.stays });
      expect(Object.keys((sample.result as { record: Record<string, unknown> }).record).sort()).toEqual(SHOWN);
      expectNoSecret(sample);
      const refused = await run(setup, 'sample_record', { table: s.table.stays, where: { column: 'note', op: 'eq', value: 'VIP' } });
      expect(refused.error?.code).toBe('COLUMN_FORBIDDEN');
      expectNoSecret(refused);
    });

    it('counts the table for the connection, since the role does read it', async () => {
      const setup = await turn(hk.id);
      const listed = await run(setup, 'list_connections', {});
      expect((listed.result as { connections: { readableTables: number }[] }).connections[0]?.readableTables).toBe(2);
    });

    it('keeps limits to their own table and their own role', async () => {
      // Reads all of stays, nothing of rooms.
      const setup = await turn(night.id);
      const rows = await run(setup, 'read_rows', { table: s.table.stays, columns: ['guest_name', 'total'] });
      expect((rows.result as { rows: Record<string, unknown>[] }).rows[0]).toMatchObject({ total: 480 });
      const rooms = await run(setup, 'read_rows', { table: s.table.rooms });
      expect(rooms.error?.code).toBe('TABLE_FORBIDDEN');
      // The owner reads every column.
      const all = await run(await turn((await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!.id), 'describe_schema', { tables: [s.table.stays] });
      const names = (all.result as { tables: { columns: { name: string }[] }[] }).tables[0]!.columns.map((column) => column.name);
      for (const hidden of HIDDEN) expect(names).toContain(hidden);
    });

    it('checks a drafted rule against what its author reads and may write', async () => {
      const setup = await turn(planner.id, 'automation');
      const rule = (changed: string, values: Record<string, unknown> = { late_until: '12:00' }) => ({
        name: 'Late leavers',
        trigger: { kind: 'record', event: 'updated', connectionId: s.connectionId, table: s.table.stays, watch: true, changedColumn: changed, when: [{ left: { field: changed }, op: 'not_empty' }] },
        graph: {
          version: 1,
          nodes: [
            { id: 'n1', kind: 'trigger', title: 'A stay changes' },
            { id: 'n2', kind: 'action', title: 'Set the late leaving', onError: false, action: { kind: 'record.update', values } },
          ],
        },
      });
      const accept = (who: TurnSetup, artefact: Record<string, unknown>) => automationContext.document!.acceptArtefact(artefact, who.deps);
      // What the planner reads and may change: accepted.
      const fine = await accept(setup, rule('late_until'));
      expect(fine.ok, JSON.stringify(fine)).toBe(true);
      // A column the planner is not shown: refused, and nothing of it is told.
      const hidden = await accept(setup, rule('total'));
      expect(hidden.ok).toBe(false);
      expect(JSON.stringify(hidden)).toMatch(/total/);
      expectNoSecret(hidden);
      // The same draft from someone who reads stays whole and may not change them: the step's table is not theirs to write.
      const reader = await turn(night.id, 'automation');
      const unwritable = await accept(reader, rule('late_until'));
      expect(unwritable.ok).toBe(false);
      expect(JSON.stringify(unwritable)).toMatch(/do not have access/);
      // And the owner, who reads the column, may watch it.
      const ownerTurn = await turn((await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!.id, 'automation');
      expect((await accept(ownerTurn, rule('total'))).ok).toBe(true);
    });

    it('answers a signed-in person, and tells an API key so', async () => {
      const role = (await rolesRepo(s.meta).findBySlug('admin'))!;
      const made = await s.app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: { cookie: owner }, payload: { name: 'milo key', roleId: role.id } });
      expect(made.statusCode, made.body).toBe(201);
      const auth = { authorization: `Bearer ${String(made.json().key)}` };
      const res = await s.app.inject({ method: 'GET', url: '/api/v1/assistant/availability', headers: auth });
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().error.details).toMatchObject({ reason: 'api-key' });
      const person = await s.app.inject({ method: 'GET', url: '/api/v1/assistant/availability', headers: { cookie: owner } });
      expect(person.statusCode, person.body).toBe(200);
    });
  });
}

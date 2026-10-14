// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A file brought in runs the table's stamps, on a real database of each
 * engine: a line that becomes a new row is a create by the person who brought
 * the file, and a line that changes a stored row is a change by them.
 *
 *  - A column Adminium stamps when a row is made (`received_at`, who made it,
 *    where it came from) is stamped for a line that leaves it out, so a role
 *    that may not write the column still brings a list in.
 *  - A value the file carries is kept (the day an old enquiry really came),
 *    and is held to what the importer may give a new row: a file that carries
 *    a column she may not write is refused whole, by the preview and the run.
 *  - A line that changes a stored row stamps what a person's change would
 *    (when it was closed, and by whom), once: the same file again stamps
 *    nothing again.
 *  - The preview says of each line what the run then does.
 *  - A parent's kept total follows the rows a file brings.
 */
import { overridesRepo, permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { parseCsv } from '../src/data-io/csv.js';
import { ENGINES, world, type Dialect, type PersonName, type World } from './row-limit-world.js';

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string };
type PreviewLine = { row: number; status: 'new' | 'here' | 'refused'; code?: string; column?: string; message?: string };
type Preview = { counts: { new: number; here: number; refused: number }; lines: PreviewLine[] };
type Ran = { status: string; stats: { total: number; inserted?: number; updated?: number; skipped?: number } | null; refused: [number, string, string][] };
type Refusal = { error: { code: string; message: string; details?: Record<string, unknown> } };

const moment = (dialect: Dialect): string => (dialect === 'postgres' ? 'TIMESTAMPTZ' : 'TIMESTAMP');
const key = (dialect: Dialect): string => (dialect === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY');

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a file brought in runs the table's stamps [${dialect}]`, () => {
    let w: World;
    let enquiries = '';
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;

    /** Make an import of a CSV and leave it ready to run: its id, or the refusal. */
    const readyImport = async (who: Who, csv: string, table: string, options: Record<string, unknown> = {}): Promise<{ id: string; statusCode: number; body: string }> => {
      const uploaded = await call(who, 'POST', 'imports/upload?filename=lines.csv', csv, { 'content-type': 'text/csv' });
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const header = csv.split('\n')[0]!.split(',');
      const made = await call(who, 'POST', 'imports', { fileId: json<{ data: { fileId: string } }>(uploaded).data.fileId, connectionId: w.connectionId, table, mapping: { columns: header.map((name) => ({ from: name, to: name })) }, options: { skipInvalid: true, ...options } });
      return { id: made.statusCode === 201 ? json<{ data: { import: { id: string } } }>(made).data.import.id : '', statusCode: made.statusCode, body: made.body };
    };
    const previewOf = async (who: Who, id: string): Promise<Preview> => {
      const res = await call(who, 'GET', `imports/${id}/preview`);
      expect(res.statusCode, res.body).toBe(200);
      return json<{ data: Preview }>(res).data;
    };
    /** Run a ready import: its figures, and the lines its report says it refused as [line, code, message]. */
    const ranImport = async (who: Who, id: string): Promise<Ran> => {
      expect((await call(who, 'POST', `imports/${id}/run`, {})).statusCode).toBe(202);
      await w.jobs();
      const view = json<{ data: { status: string; stats: Ran['stats']; errorReportFileId: string | null } }>(await call(who, 'GET', `imports/${id}`)).data;
      const refused: Ran['refused'] = [];
      if (view.errorReportFileId !== null) {
        for (const line of parseCsv((await call(who, 'GET', `imports/${id}/error-report`)).body).slice(1)) if (line.length > 1) refused.push([Number(line[0]), line[2]!, line[3]!]);
      }
      return { status: view.status, stats: view.stats, refused: refused.sort((a, b) => a[0] - b[0]) };
    };
    /** Preview, then run: the two say the same of every line. */
    const broughtIn = async (who: Who, csv: string, table: string, options: Record<string, unknown> = {}): Promise<{ preview: Preview; ran: Ran }> => {
      const made = await readyImport(who, csv, table, options);
      expect(made.statusCode, made.body).toBe(201);
      const preview = await previewOf(who, made.id);
      const ran = await ranImport(who, made.id);
      expect(ran.status).toBe('succeeded');
      expect(preview.lines.filter((line) => line.status === 'refused').map((line) => line.row)).toEqual(ran.refused.map((line) => line[0]));
      expect(ran.stats?.inserted ?? 0, JSON.stringify(ran)).toBe(preview.counts.new);
      expect(ran.stats?.updated ?? 0, JSON.stringify(ran)).toBe(preview.counts.here);
      return { preview, ran };
    };
    const stored = (where: string): Promise<Record<string, unknown>[]> => w.rows(`SELECT * FROM enquiries WHERE ${where} ORDER BY id`);
    const at = (value: unknown): number => {
      if (value instanceof Date) return value.getTime();
      const text = String(value);
      // A time kept with no zone is the server's wall clock (`crud/write-values.ts`).
      return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : text.replace(' ', 'T'));
    };
    const recent = (value: unknown, since: number): boolean => at(value) >= since - 2000 && at(value) <= Date.now() + 2000;
    const grant = async (slug: string, actions: Record<string, unknown>): Promise<void> => {
      const role = (await rolesRepo(w.meta).findBySlug(slug)) ?? (await rolesRepo(w.meta).create({ slug, name: slug }));
      await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${enquiries}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
    };
    /** What the marketer may give a new enquiry: who it is and how to reach them. */
    const MARKETER = { read: true, create: true, import: true, createLimit: { writable: ['name', 'email'] } };

    beforeAll(async () => {
      w = await world(dialect);
      await w.run(
        `CREATE TABLE enquiries (id ${key(dialect)}, name VARCHAR(80) NOT NULL, email VARCHAR(120), status VARCHAR(10) NOT NULL DEFAULT 'new', received_at ${moment(dialect)} NOT NULL, made_by VARCHAR(40), origin VARCHAR(10), closed_at ${moment(dialect)}, closed_by VARCHAR(80))`,
      );
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      enquiries = (await w.model()).tables.find((table) => table.name === 'enquiries')!.id;
      const rule = (column: string, value: Record<string, unknown>) => overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.stamp', tableName: enquiries, columnName: column, value, origin: 'user' } as never);
      await rule('received_at', { set: 'now', on: 'create' });
      await rule('made_by', { set: 'user-id', on: 'create' });
      await rule('origin', { set: { byOrigin: { public: 'web', staff: 'desk' } }, on: 'create' });
      await rule('closed_at', { set: 'now', on: { column: 'status', values: ['closed'] } });
      await rule('closed_by', { set: 'user-name', on: { column: 'status', values: ['closed'] } });
      // A quote's total is the sum of its lines.
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.rollup', tableName: w.id('quotes'), columnName: 'total', value: { from: w.id('quote_lines'), via: 'quote_id', sum: 'amount' }, origin: 'user' } as never);
      await grant('marketer', MARKETER);
      await w.give('kim', 'marketer');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    it('stamps each new row of a list from somebody who may not write the stamped columns', async () => {
      const since = Date.now();
      const { preview, ran } = await broughtIn('kim', 'name,email\nAda,ada@a.test\nBen,ben@b.test\nCy,cy@c.test', enquiries);
      expect(preview.counts).toEqual({ new: 3, here: 0, refused: 0 });
      expect(ran.stats).toMatchObject({ total: 3, inserted: 3, skipped: 0 });
      const rows = await stored(`email IN ('ada@a.test', 'ben@b.test', 'cy@c.test')`);
      expect(rows.map((row) => row['name'])).toEqual(['Ada', 'Ben', 'Cy']);
      for (const row of rows) {
        expect(recent(row['received_at'], since), String(row['received_at'])).toBe(true);
        // Who made it is who brought the file; where it came from is the staff side's word.
        expect(row['made_by']).toBe(w.people.kim);
        expect(row['origin']).toBe('desk');
        expect(row['status']).toBe('new');
        // Nothing that did not happen: nobody closed it.
        expect(row['closed_at'] ?? null).toBeNull();
        expect(row['closed_by'] ?? null).toBeNull();
      }
    });

    it('refuses a file that carries a stamped column from somebody who may not write it: when it is made, and in the preview and the run', async () => {
      const csv = 'name,received_at\nDee,2024-01-05T10:00:00Z';
      const made = await readyImport('kim', csv, enquiries);
      expect(made.statusCode, made.body).toBe(403);
      expect(json<Refusal>(made).error).toMatchObject({ code: 'COLUMN_FORBIDDEN', details: { column: 'received_at', reason: 'create-limit' } });
      // Made while she might, previewed and run after she may not: both ask again.
      await grant('marketer', { read: true, create: true, import: true });
      const before = await readyImport('kim', csv, enquiries);
      expect(before.statusCode, before.body).toBe(201);
      await grant('marketer', MARKETER);
      const preview = await call('kim', 'GET', `imports/${before.id}/preview`);
      expect(preview.statusCode, preview.body).toBe(403);
      expect(json<Refusal>(preview).error).toMatchObject({ code: 'COLUMN_FORBIDDEN', message: 'Your role may not give a new row received_at on this table, so it is not imported.' });
      await call('kim', 'POST', `imports/${before.id}/run`, {});
      await w.jobs();
      expect(await stored(`name = 'Dee'`)).toEqual([]);
    });

    it('keeps the value a file carries, and stamps the line that leaves the cell empty', async () => {
      const since = Date.now();
      const { preview } = await broughtIn('owner', 'name,received_at,made_by,origin\nEve,2024-01-05T10:00:00Z,usr_old,fair\nFay,,,', enquiries);
      expect(preview.counts).toEqual({ new: 2, here: 0, refused: 0 });
      const [eve] = await stored(`name = 'Eve'`);
      expect(new Date(at(eve!['received_at'])).toISOString()).toBe('2024-01-05T10:00:00.000Z');
      expect([eve!['made_by'], eve!['origin']]).toEqual(['usr_old', 'fair']);
      const [fay] = await stored(`name = 'Fay'`);
      expect(recent(fay!['received_at'], since), String(fay!['received_at'])).toBe(true);
      expect([fay!['made_by'], fay!['origin']]).toEqual([w.owner.id, 'desk']);
    });

    it('stamps a new row that arrives already closed, unless the file says when', async () => {
      const since = Date.now();
      await broughtIn('owner', 'name,status,closed_at\nGus,closed,\nHal,closed,2023-03-04T08:00:00Z', enquiries);
      const [gus] = await stored(`name = 'Gus'`);
      expect(recent(gus!['closed_at'], since), String(gus!['closed_at'])).toBe(true);
      expect(gus!['closed_by']).toBe('Owner');
      const [hal] = await stored(`name = 'Hal'`);
      expect(new Date(at(hal!['closed_at'])).toISOString()).toBe('2023-03-04T08:00:00.000Z');
    });

    it('stamps a stored row a file changes as a person’s change would, and not again for the same file', async () => {
      await w.run(`INSERT INTO enquiries (id, name, status, received_at) VALUES (900, 'Ivo', 'new', '2025-02-02 09:00:00'), (901, 'Jo', 'new', '2025-02-02 09:00:00')`);
      const received = at((await stored('id = 900'))[0]!['received_at']);
      const since = Date.now();
      const csv = 'id,status\n900,closed\n901,new';
      const { preview, ran } = await broughtIn('owner', csv, enquiries, { mode: 'upsert', matchColumn: 'id' });
      expect(preview.counts).toEqual({ new: 0, here: 2, refused: 0 });
      expect(ran.stats).toMatchObject({ updated: 2 });
      const [ivo] = await stored('id = 900');
      expect(recent(ivo!['closed_at'], since), String(ivo!['closed_at'])).toBe(true);
      expect(ivo!['closed_by']).toBe('Owner');
      // The row was made long ago: a change stamps nothing a create stamps.
      expect(at(ivo!['received_at'])).toBe(received);
      expect(ivo!['made_by'] ?? null).toBeNull();
      // A row whose status the file leaves as it was is stamped nothing.
      const [jo] = await stored('id = 901');
      expect(jo!['closed_at'] ?? null).toBeNull();
      // The same file again: closed already, so no new moment.
      await w.run(`UPDATE enquiries SET closed_at = '2025-03-03 03:00:00' WHERE id = 900`);
      const closed = at((await stored('id = 900'))[0]!['closed_at']);
      await broughtIn('owner', csv, enquiries, { mode: 'upsert', matchColumn: 'id' });
      expect(at((await stored('id = 900'))[0]!['closed_at'])).toBe(closed);
    });

    it('makes a held importer’s rows her own by the stamp, and never somebody else’s by the file', async () => {
      // A deal is its maker's (`owner_id` stamped on create), and a rep reaches her own deals only.
      await w.stamp('deals', 'owner_id', { set: 'user-id', on: 'create' });
      await w.role('rep', { deals: { actions: ['read', 'create', 'import'], rows: { read: { reach: 'own' }, update: { reach: 'own' } } } });
      await w.give('dana', 'rep');
      const { preview, ran } = await broughtIn('dana', 'id,title,state,amount,big\n50,Brought A,open,10,false\n51,Brought B,open,20,false', w.id('deals'));
      expect(preview.counts, JSON.stringify(preview.lines)).toEqual({ new: 2, here: 0, refused: 0 });
      expect(ran.stats).toMatchObject({ inserted: 2 });
      expect((await w.rows('SELECT owner_id FROM deals WHERE id IN (50, 51) ORDER BY id')).map((row) => row['owner_id'])).toEqual([w.people.dana, w.people.dana]);
      // A file that names a colleague as the owner is hers to bring no more than a save is: the line is refused, in the preview and the run.
      const theirs = await broughtIn('dana', `id,title,state,amount,big,owner_id\n52,Brought C,open,30,false,${w.people.sam}`, w.id('deals'));
      expect(theirs.preview.counts).toEqual({ new: 0, here: 0, refused: 1 });
      expect(await w.rows('SELECT id FROM deals WHERE id = 52')).toEqual([]);
      // Nor by a rule that writes the owner from another column of the line: such a row says nobody's until the rule runs, and is not hers to bring.
      await w.stamp('deals', 'owner_id', { set: { copy: 'title' }, on: 'create' });
      const copied = await broughtIn('dana', `id,title,state,amount,big\n53,${w.people.sam},open,30,false`, w.id('deals'));
      expect(copied.preview.counts, JSON.stringify(copied.preview.lines)).toEqual({ new: 0, here: 0, refused: 1 });
      expect(await w.rows('SELECT id FROM deals WHERE id = 53')).toEqual([]);
      await w.stamp('deals', 'owner_id', null);
    });

    it('moves a parent’s kept total with the rows a file brings and changes', async () => {
      const total = async (): Promise<number> => Number((await w.rows('SELECT total FROM quotes WHERE id = 4'))[0]!['total']);
      await broughtIn('owner', 'id,quote_id,amount\n40,4,25\n41,4,30', w.id('quote_lines'));
      expect(await total()).toBe(55);
      await broughtIn('owner', 'id,quote_id,amount\n40,4,5\n42,4,1', w.id('quote_lines'), { mode: 'upsert', matchColumn: 'id' });
      expect(await total()).toBe(36);
    });
  });
}

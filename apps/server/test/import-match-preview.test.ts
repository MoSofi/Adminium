// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an import's preview and its run say of a line, on a real database of
 * each engine: the two are the same judge, and here they are held to the
 * same answer where the database compares values its own way.
 *
 *  - Matching lines against the rows already there tells which values exist,
 *    so it needs the right to READ the table, when the import is made and
 *    again when it is previewed or run; and a column the requester sees
 *    masked is no column to match on, as it is none to filter by.
 *  - A line whose key is already taken is refused before it is written, and
 *    the preview says so.
 *  - Two values the database holds to be one (`ABC` and `abc` on MySQL) are
 *    one to the preview too.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseCsv } from '../src/data-io/csv.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string };
type PreviewLine = { row: number; status: 'new' | 'here' | 'refused'; code?: string; column?: string; message?: string; earlierLine?: number; label?: string };
type Preview = { total: number; judged: number; capped: boolean; counts: { new: number; here: number; refused: number }; hooksNotRun: boolean; lines: PreviewLine[] };
type Ran = { status: string; stats: { total: number; inserted?: number; updated?: number; skipped?: number; alreadyHere?: number } | null; refused: [number, string][] };
type Refusal = { error: { code: string; message: string; details?: Record<string, unknown> } };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`an import's preview and its run [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const get = (who: Who, url: string) => call(who, 'GET', url);
    const post = (who: Who, url: string, payload: unknown = {}) => call(who, 'POST', url, payload);
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const deals = (): string => w.id('deals');

    /** Make an import of a CSV and leave it ready to run: its id, or the refusal. */
    const readyImport = async (who: Who, csv: string, options: Record<string, unknown>, table: string = deals()): Promise<{ id: string; statusCode: number; body: string }> => {
      const uploaded = await call(who, 'POST', 'imports/upload?filename=lines.csv', csv, { 'content-type': 'text/csv' });
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const header = csv.split('\n')[0]!.split(',');
      const made = await post(who, 'imports', { fileId: json<{ data: { fileId: string } }>(uploaded).data.fileId, connectionId: w.connectionId, table, mapping: { columns: header.map((name) => ({ from: name, to: name })) }, options: { skipInvalid: true, ...options } });
      return { id: made.statusCode === 201 ? json<{ data: { import: { id: string } } }>(made).data.import.id : '', statusCode: made.statusCode, body: made.body };
    };
    const previewOf = async (who: Who, id: string, query = ''): Promise<Preview> => {
      const res = await get(who, `imports/${id}/preview${query}`);
      expect(res.statusCode, res.body).toBe(200);
      return json<{ data: Preview }>(res).data;
    };
    /** Run a ready import, and answer its figures and the lines its report says it refused, as [line, code]. */
    const ranImport = async (who: Who, id: string): Promise<Ran> => {
      expect((await post(who, `imports/${id}/run`)).statusCode).toBe(202);
      await w.jobs();
      const view = json<{ data: { status: string; stats: Ran['stats']; errorReportFileId: string | null } }>(await get(who, `imports/${id}`)).data;
      const refused = new Map<number, string>();
      if (view.errorReportFileId !== null) {
        for (const line of parseCsv((await get(who, `imports/${id}/error-report`)).body).slice(1)) if (line.length > 1 && !refused.has(Number(line[0]))) refused.set(Number(line[0]), line[2]!);
      }
      // In the file's order: the report lists a chunk's lines as they were refused, which is not always that.
      return { status: view.status, stats: view.stats, refused: [...refused.entries()].sort((a, b) => a[0] - b[0]) };
    };
    /** A preview and the run that followed it say the same of every line. */
    const expectAgreed = (preview: Preview, ran: Ran, mode: 'skip' | 'upsert' | 'insert'): void => {
      expect(ran.status).toBe('succeeded');
      expect(preview.lines.filter((line) => line.status === 'refused').map((line) => [line.row, line.code])).toEqual(ran.refused);
      expect(ran.stats?.inserted ?? 0).toBe(preview.counts.new);
      expect(mode === 'skip' ? (ran.stats?.alreadyHere ?? 0) : (ran.stats?.updated ?? 0)).toBe(preview.counts.here);
      expect((ran.stats?.skipped ?? 0) - (ran.stats?.alreadyHere ?? 0)).toBe(preview.counts.refused);
      expect(ran.stats?.total).toBe((ran.stats?.inserted ?? 0) + (ran.stats?.updated ?? 0) + (ran.stats?.skipped ?? 0));
    };
    const countOf = async (statement: string): Promise<number> => Number(Object.values((await w.rows(statement))[0]!)[0]);
    const statuses = (preview: Preview) => preview.lines.map((line) => [line.row, line.status, line.code ?? null, line.earlierLine ?? null]);

    beforeAll(async () => {
      w = await world(dialect);
      // Brings rows in and reads none of them; reads and writes the whole table; and a rep, held to their own rows.
      await w.role('bringer', { deals: { actions: ['create', 'import'] } });
      await w.role('desk', { deals: { actions: ['read', 'create', 'update', 'import'] }, companies: { actions: ['read'] } });
      await w.role('rep', { deals: { actions: ['read', 'create', 'update', 'import'], rows: { read: OWN, update: OWN } }, companies: { actions: ['read'] } });
      await w.give('kim', 'bringer');
      for (const person of ['sam', 'mara', 'lena'] as const) await w.give(person, 'desk');
      await w.give('dana', 'rep');
    }, 180_000);
    afterAll(async () => w?.close());

    it('matches lines against the rows already there only for somebody who reads the table', async () => {
      const read = `table:${w.connectionId}:${deals()}:read`;
      // Deal 3 is here and 401 is not: told apart, that is one fact about the table for each line.
      const csv = 'id,title,state,amount,big\n3,Is three here?,open,1,0\n401,Kim one,open,1,0\n';
      for (const mode of ['skip', 'upsert'] as const) {
        const refused = await readyImport('kim', csv, { mode, matchColumn: 'id' });
        expect(refused.statusCode, refused.body).toBe(403);
        expect(json<Refusal>(refused).error).toMatchObject({ code: 'TABLE_FORBIDDEN', message: 'Matching lines against the rows already there needs the right to read this table.', details: { permission: read } });
      }
      // Bringing rows in as new ones is still hers to do.
      const plain = await readyImport('kim', csv, { mode: 'insert' });
      expect(plain.statusCode, plain.body).toBe(201);

      // Made while she read the table; her read is then taken away, and the import says no more of the table to her.
      const made = await readyImport('sam', csv, { mode: 'skip', matchColumn: 'id' });
      expect(made.statusCode, made.body).toBe(201);
      expect(statuses(await previewOf('sam', made.id))).toEqual([
        [1, 'here', null, null],
        [2, 'new', null, null],
      ]);
      await w.take('sam', 'desk');
      await w.give('sam', 'bringer');
      try {
        const before = await countOf('SELECT COUNT(*) FROM deals');
        const preview = await get('sam', `imports/${made.id}/preview`);
        expect(preview.statusCode, preview.body).toBe(403);
        expect(json<Refusal>(preview).error).toMatchObject({ code: 'TABLE_FORBIDDEN', details: { permission: read } });
        expect(preview.body).not.toContain('"lines"');
        expect(preview.body).not.toContain('"counts"');
        // The run is refused whole: no line is counted as here or as new.
        const ran = await ranImport('sam', made.id);
        expect([ran.status, ran.stats?.inserted ?? null, ran.stats?.alreadyHere ?? null]).toEqual(['failed', null, null]);
        expect(await countOf('SELECT COUNT(*) FROM deals')).toBe(before);
      } finally {
        await w.take('sam', 'bringer');
        await w.give('sam', 'desk');
      }
    });

    it('says which line each one is: the match value as the file has it, else its first mapped cell', async () => {
      const long = 'x'.repeat(300);
      // Matched on the id: each line is named by the id typed in the file, a refused one too.
      const csv = `title,id,state,amount,big\n  Is three here?  ,3,open,1,0\nNew one,411,open,1,0\nBad amount,412,open,twelve,0\n`;
      const matched = await readyImport('sam', csv, { mode: 'skip', matchColumn: 'id' });
      expect(matched.statusCode, matched.body).toBe(201);
      expect((await previewOf('sam', matched.id)).lines.map((line) => [line.row, line.status, line.label])).toEqual([
        [1, 'here', '3'],
        [2, 'new', '411'],
        [3, 'refused', '412'],
      ]);
      // Matched on nothing: the first mapped cell of the line, trimmed, and no longer than 120 characters.
      const plain = await readyImport('sam', `title,state,amount,big\n  Spaced out  ,open,1,0\n${long},open,1,0\n,open,1,0\n`, { mode: 'insert' });
      expect(plain.statusCode, plain.body).toBe(201);
      const lines = (await previewOf('sam', plain.id)).lines;
      expect(lines[0]!.label).toBe('Spaced out');
      expect(lines[1]!.label).toHaveLength(120);
      expect(lines[1]!.label).toBe('x'.repeat(120));
      // A line whose cell is empty has no label, rather than an empty one.
      expect('label' in lines[2]!).toBe(false);
      // A column the mapping leaves out is not what a line is named by.
      const uploaded = await call('sam', 'POST', 'imports/upload?filename=lines.csv', 'note,title,state,amount,big\nnot this,This one,open,1,0\n', { 'content-type': 'text/csv' });
      const made = await post('sam', 'imports', {
        fileId: json<{ data: { fileId: string } }>(uploaded).data.fileId,
        connectionId: w.connectionId,
        table: deals(),
        mapping: { columns: [{ from: 'note', to: null }, ...['title', 'state', 'amount', 'big'].map((name) => ({ from: name, to: name }))] },
        options: { skipInvalid: true, mode: 'insert' },
      });
      expect(made.statusCode, made.body).toBe(201);
      expect((await previewOf('sam', json<{ data: { import: { id: string } } }>(made).data.import.id)).lines[0]!.label).toBe('This one');
    });

    it('matches on no column its requester sees masked, as a filter by one is refused', async () => {
      const csv = 'id,title,state,amount,big\n402,Deal 3,open,1,0\n';
      // Made before the title was personal data: it is refused from then on, preview and run.
      const early = await readyImport('mara', csv, { mode: 'skip', matchColumn: 'title' });
      expect(early.statusCode, early.body).toBe(201);
      const rule = await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.pii', tableName: deals(), columnName: 'title', value: { masked: true }, origin: 'user' } as never);
      try {
        // The rule this follows: the list refuses the same person a filter by the column.
        const filtered = await get('mara', `data/${w.connectionId}/${encodeURIComponent(deals())}?where=${encodeURIComponent(JSON.stringify({ column: 'title', op: 'eq', value: 'Deal 3' }))}`);
        expect(filtered.statusCode, filtered.body).toBe(403);
        expect(json<Refusal>(filtered).error.code).toBe('COLUMN_FORBIDDEN');

        for (const mode of ['skip', 'upsert'] as const) {
          const refused = await readyImport('mara', csv, { mode, matchColumn: 'title' });
          expect(refused.statusCode, refused.body).toBe(403);
          expect(json<Refusal>(refused).error).toMatchObject({ code: 'COLUMN_FORBIDDEN', details: { column: 'title' } });
        }
        const preview = await get('mara', `imports/${early.id}/preview`);
        expect(preview.statusCode, preview.body).toBe(403);
        expect(json<Refusal>(preview).error.code).toBe('COLUMN_FORBIDDEN');
        expect((await ranImport('mara', early.id)).status).toBe('failed');
        expect(await countOf('SELECT COUNT(*) FROM deals WHERE id = 402')).toBe(0);

        // Writing the column is not matching on it; and somebody who reads it in clear matches on it.
        const written = await readyImport('mara', csv, { mode: 'insert' });
        expect(written.statusCode, written.body).toBe(201);
        const clear = await readyImport('owner', csv, { mode: 'skip', matchColumn: 'title' });
        expect(clear.statusCode, clear.body).toBe(201);
        expect((await previewOf('owner', clear.id)).counts).toEqual({ new: 0, here: 1, refused: 0 });
      } finally {
        await overridesRepo(w.meta).delete(rule.id);
      }
    });

    it('says before it runs that a line’s key is already taken, and the run refuses it in the same words', async () => {
      // Nothing is matched: every line would be a new row. Deals 1 and 3 are here, and 501 comes twice.
      const lines = (owner: string): string => `id,title,owner_id,state,amount,big\n1,Dup of one,${owner},open,1,0\n501,New,${owner},open,1,0\n501,Twice,${owner},open,2,0\n3,Dup of three,${owner},open,1,0\n502,Also new,${owner},open,1,0\n`;
      // Lena reads everything (one INSERT a chunk); Dana is held to her own rows (a row at a time), and deal 3 is not hers.
      for (const who of ['lena', 'dana'] as const) {
        const made = await readyImport(who, lines(w.people[who]), { mode: 'insert' });
        expect(made.statusCode, made.body).toBe(201);
        const preview = await previewOf(who, made.id);
        expect(statuses(preview), who).toEqual([
          [1, 'refused', 'ALREADY_EXISTS', null],
          [2, 'new', null, null],
          [3, 'refused', 'ALREADY_EXISTS', null],
          [4, 'refused', 'ALREADY_EXISTS', null],
          [5, 'new', null, null],
        ]);
        for (const line of preview.lines.filter((one) => one.status === 'refused')) expect([line.column, line.message]).toEqual(['id', 'A row with this value already exists.']);
        // Whoever's the row is, nothing of it is told.
        expect(JSON.stringify(preview)).not.toMatch(/Deal 3|8000/);
        const ran = await ranImport(who, made.id);
        expectAgreed(preview, ran, 'insert');
        expect(ran.refused).toEqual([[1, 'ALREADY_EXISTS'], [3, 'ALREADY_EXISTS'], [4, 'ALREADY_EXISTS']]);
        expect((await w.rows('SELECT id, title FROM deals WHERE id IN (1, 3, 501, 502) ORDER BY id')).map((row) => [Number(row['id']), row['title']])).toEqual([[1, 'Deal 1'], [3, 'Deal 3'], [501, 'New'], [502, 'Also new']]);
        await w.run('DELETE FROM deals WHERE id > 400');
      }

      // And when lines are matched on another column: a line that matches nothing, with a key that is taken.
      const made = await readyImport('lena', 'id,title,state,amount,big\n1,No such title,open,1,0\n503,Another new,open,1,0\n', { mode: 'upsert', matchColumn: 'title' });
      expect(made.statusCode, made.body).toBe(201);
      const preview = await previewOf('lena', made.id);
      expect(statuses(preview)).toEqual([
        [1, 'refused', 'ALREADY_EXISTS', null],
        [2, 'new', null, null],
      ]);
      expectAgreed(preview, await ranImport('lena', made.id), 'upsert');
      expect((await w.rows('SELECT title FROM deals WHERE id = 1'))[0]!['title']).toBe('Deal 1');
      await w.run('DELETE FROM deals WHERE id > 400');
    });

    it('holds two values to be one where the database does, so the preview and the run agree', async () => {
      // MySQL compares a name without its case; Postgres and SQLite with it.
      const loose = dialect === 'mysql';
      const companies = w.id('companies');
      const reset = async (): Promise<void> => {
        await w.run('DELETE FROM companies WHERE id > 2');
        await w.run(`UPDATE companies SET name = 'Harbour Hotels' WHERE id = 1`);
      };
      try {
        // "Harbour Hotels" is here. Both spellings of it come, and both spellings of a name that is not here.
        const skipped = await readyImport('owner', 'id,name\n11,Harbour Hotels\n12,HARBOUR HOTELS\n13,Brand New\n14,BRAND NEW\n15,Other\n', { mode: 'skip', matchColumn: 'name' }, companies);
        expect(skipped.statusCode, skipped.body).toBe(201);
        const first = await previewOf('owner', skipped.id);
        expect(statuses(first)).toEqual(
          loose
            ? [[1, 'here', null, null], [2, 'here', null, null], [3, 'new', null, null], [4, 'here', null, 3], [5, 'new', null, null]]
            : [[1, 'here', null, null], [2, 'new', null, null], [3, 'new', null, null], [4, 'new', null, null], [5, 'new', null, null]],
        );
        expectAgreed(first, await ranImport('owner', skipped.id), 'skip');
        expect(await countOf('SELECT COUNT(*) FROM companies')).toBe(loose ? 4 : 6);
        await reset();

        // The same as updates. Where the two spellings are two names, the second is a new row whose key is taken.
        const upserted = await readyImport('owner', 'id,name\n1,Harbour Hotels\n1,HARBOUR HOTELS\n13,Brand New\n13,BRAND NEW\n15,Other\n', { mode: 'upsert', matchColumn: 'name' }, companies);
        expect(upserted.statusCode, upserted.body).toBe(201);
        const second = await previewOf('owner', upserted.id);
        expect(statuses(second)).toEqual(
          loose
            ? [[1, 'here', null, null], [2, 'here', null, null], [3, 'new', null, null], [4, 'here', null, 3], [5, 'new', null, null]]
            : [[1, 'here', null, null], [2, 'refused', 'ALREADY_EXISTS', null], [3, 'new', null, null], [4, 'refused', 'ALREADY_EXISTS', null], [5, 'new', null, null]],
        );
        expectAgreed(second, await ranImport('owner', upserted.id), 'upsert');
        expect((await w.rows('SELECT id, name FROM companies WHERE id IN (1, 13) ORDER BY id')).map((row) => [Number(row['id']), row['name']])).toEqual(loose ? [[1, 'HARBOUR HOTELS'], [13, 'BRAND NEW']] : [[1, 'Harbour Hotels'], [13, 'Brand New']]);
        await reset();

        // One spelling alone, which is not the stored one.
        const alone = await readyImport('owner', 'id,name\n21,NORTHFIELD DENTAL\n22,Fresh\n23,Fresher\n', { mode: 'skip', matchColumn: 'name' }, companies);
        expect(alone.statusCode, alone.body).toBe(201);
        const third = await previewOf('owner', alone.id);
        expect(third.lines.map((line) => line.status)).toEqual(loose ? ['here', 'new', 'new'] : ['new', 'new', 'new']);
        expectAgreed(third, await ranImport('owner', alone.id), 'skip');
      } finally {
        await reset();
      }
    });

    it('answers a long file’s lines as the run does, a few questions to the database for hundreds of lines', async () => {
      // Four hundred and fifty lines over three lookups: deals 1 to 9 are here, the rest are not.
      const csv = `id,title,state,amount,big\n${Array.from({ length: 450 }, (_, at) => `${String(at + 1)},Line ${String(at + 1)},open,1,0`).join('\n')}\n`;
      const made = await readyImport('lena', csv, { mode: 'skip', matchColumn: 'id' });
      expect(made.statusCode, made.body).toBe(201);
      const preview = await previewOf('lena', made.id, '?limit=200');
      expect(preview.counts).toEqual({ new: 441, here: 9, refused: 0 });
      expect(preview.lines.filter((line) => line.status === 'here').map((line) => line.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expectAgreed(preview, await ranImport('lena', made.id), 'skip');
      expect(await countOf('SELECT COUNT(*) FROM deals')).toBe(450);
      await w.run('DELETE FROM deals WHERE id > 9');
    });
  });
}

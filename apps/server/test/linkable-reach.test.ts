// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A link that may name only some rows (`column.linkable`), for people who
 * reach only some of the rows it names: a quote names only an open deal.
 *
 *  - The rule is data integrity, not a permission: the owner, who reaches
 *    every deal, is refused a closed one as a rep is.
 *  - It tells nothing of a row its writer cannot reach. A deal outside a
 *    rep's reach is refused as a deal that is not there, whether it is open
 *    or closed: the same status and the same words, so the rule cannot be
 *    asked whether a colleague's deal is lost.
 *  - A quote already naming a deal that has closed since keeps it while the
 *    rep changes its other columns, or sends its deal back as it stands.
 *  - An import's preview and its run say the same of every line, whose rule
 *    refusal names the field and nothing of the deal.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseCsv } from '../src/data-io/csv.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string };
type PreviewLine = { row: number; status: 'new' | 'here' | 'refused'; code?: string; column?: string; message?: string };
type Preview = { counts: { new: number; here: number; refused: number }; lines: PreviewLine[] };
type Ran = { status: string; stats: { total: number; inserted?: number; updated?: number; skipped?: number; alreadyHere?: number } | null; refused: [number, string][] };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a link that names only an open deal, for people who reach some deals [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const quotes = (): string => `data/${w.connectionId}/${encodeURIComponent(w.id('quotes'))}`;
    const create = (who: Who, values: Record<string, unknown>) => call(who, 'POST', quotes(), { values });
    const change = (who: Who, key: number, values: Record<string, unknown>) => call(who, 'PATCH', `${quotes()}/${String(key)}`, { values });
    const refused = { code: 'VALIDATION_FAILED', details: { fields: { deal_id: { code: 'not-allowed' } } } };
    /** A refusal as the caller reads it, its request's own id left out. */
    const told = (res: Reply) => ({ status: res.statusCode, body: res.body.replace(/"requestId":"[^"]*",?/, '') });

    const readyImport = async (who: Who, csv: string, options: Record<string, unknown>): Promise<string> => {
      const uploaded = await call(who, 'POST', 'imports/upload?filename=quotes.csv', csv, { 'content-type': 'text/csv' });
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const header = csv.split('\n')[0]!.split(',');
      const made = await call(who, 'POST', 'imports', { fileId: json<{ data: { fileId: string } }>(uploaded).data.fileId, connectionId: w.connectionId, table: w.id('quotes'), mapping: { columns: header.map((name) => ({ from: name, to: name })) }, options: { skipInvalid: true, ...options } });
      expect(made.statusCode, made.body).toBe(201);
      return json<{ data: { import: { id: string } } }>(made).data.import.id;
    };
    const previewOf = async (who: Who, id: string): Promise<Preview> => {
      const res = await call(who, 'GET', `imports/${id}/preview`);
      expect(res.statusCode, res.body).toBe(200);
      return json<{ data: Preview }>(res).data;
    };
    const ranImport = async (who: Who, id: string): Promise<Ran> => {
      expect((await call(who, 'POST', `imports/${id}/run`)).statusCode).toBe(202);
      await w.jobs();
      const view = json<{ data: { status: string; stats: Ran['stats']; errorReportFileId: string | null } }>(await call(who, 'GET', `imports/${id}`)).data;
      const refusedLines = new Map<number, string>();
      if (view.errorReportFileId !== null) {
        for (const line of parseCsv((await call(who, 'GET', `imports/${id}/error-report`)).body).slice(1)) if (line.length > 1 && !refusedLines.has(Number(line[0]))) refusedLines.set(Number(line[0]), line[2]!);
      }
      return { status: view.status, stats: view.stats, refused: [...refusedLines.entries()].sort((a, b) => a[0] - b[0]) };
    };
    const reset = async (): Promise<void> => {
      await w.run('DELETE FROM quotes WHERE id > 100');
      await w.run(`UPDATE deals SET state = 'open' WHERE id = 1`);
      await w.run('UPDATE quotes SET deal_id = 3, total = 200 WHERE id = 2');
      await w.run('UPDATE quotes SET total = 100 WHERE id = 1');
    };

    beforeAll(async () => {
      w = await world(dialect);
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.linkable', tableName: w.id('quotes'), columnName: 'deal_id', value: { where: [{ column: 'state', in: ['open'] }] }, origin: 'user' });
      // A rep reads their own deals, and reads, makes, changes and brings in the quotes on them.
      await w.role('rep', { deals: { actions: ['read'], rows: { read: OWN } }, quotes: { actions: ['read', 'create', 'update', 'import'], rows: { read: OWN, update: OWN } } });
      await w.give('dana', 'rep');
    }, 180_000);
    afterAll(async () => w?.close());

    it('refuses a closed deal to everybody, the owner too, and takes an open one', async () => {
      try {
        // Dana's own deals: 1 is open, 2 is won.
        expect((await create('dana', { id: 101, deal_id: 1, total: 1 })).statusCode).toBe(201);
        const won = await create('dana', { id: 102, deal_id: 2, total: 1 });
        expect(won.statusCode, won.body).toBe(422);
        expect(json<{ error: unknown }>(won).error).toMatchObject(refused);
        // The owner reaches every deal, and is held to the rule all the same: deal 4 is lost.
        const lost = await create('owner', { id: 103, deal_id: 4, total: 1 });
        expect(lost.statusCode, lost.body).toBe(422);
        expect(json<{ error: unknown }>(lost).error).toMatchObject(refused);
        expect((await create('owner', { id: 104, deal_id: 3, total: 1 })).statusCode).toBe(201);
        expect((await w.rows('SELECT id FROM quotes WHERE id > 100 ORDER BY id')).map((row) => Number(row['id']))).toEqual([101, 104]);
      } finally {
        await reset();
      }
    });

    it('answers a deal its writer does not reach as a deal that is not there, open or closed', async () => {
      try {
        // Omar's deal 3 is open and his deal 4 is lost; deal 999 is nobody's. To Dana the three are one answer.
        const open = await create('dana', { id: 111, deal_id: 3, total: 1 });
        const lost = await create('dana', { id: 112, deal_id: 4, total: 1 });
        const missing = await create('dana', { id: 113, deal_id: 999, total: 1 });
        expect([open.statusCode, lost.statusCode, missing.statusCode]).toEqual([409, 409, 409]);
        expect(json<{ error: { code: string } }>(lost).error.code).toBe('FK_VIOLATION');
        expect(told(lost)).toEqual(told(open));
        expect(told(missing)).toEqual(told(open));
        // A change that moves her quote to either: the same again.
        const movedOpen = await change('dana', 1, { deal_id: 3 });
        const movedLost = await change('dana', 1, { deal_id: 4 });
        expect(movedOpen.statusCode).toBe(409);
        expect(told(movedLost)).toEqual(told(movedOpen));
        expect(await w.rows('SELECT id FROM quotes WHERE id > 100')).toEqual([]);
      } finally {
        await reset();
      }
    });

    it('keeps a quote on a deal that has closed since while its other columns change', async () => {
      try {
        await w.run(`UPDATE deals SET state = 'won' WHERE id = 1`);
        // Quote 1 is on deal 1, won since: its total changes, and its deal sent back as it stands is no change.
        expect((await change('dana', 1, { total: 150 })).statusCode).toBe(200);
        const back = await change('dana', 1, { deal_id: 1, total: 175 });
        expect(back.statusCode, back.body).toBe(200);
        expect(Number((await w.rows('SELECT total FROM quotes WHERE id = 1'))[0]!['total'])).toBe(175);
        // Moving it onto another closed deal of hers is refused.
        const moved = await change('dana', 1, { deal_id: 2 });
        expect(moved.statusCode, moved.body).toBe(422);
        expect(json<{ error: unknown }>(moved).error).toMatchObject(refused);
      } finally {
        await reset();
      }
    });

    it('holds an import to it, preview and run alike, and says nothing of a deal out of reach', async () => {
      try {
        // Dana brings in four quotes: on her open deal, her won deal, Omar's open deal and Omar's lost deal.
        const made = await readyImport('dana', 'id,deal_id,total\n121,1,1\n122,2,1\n123,3,1\n124,4,1\n', { mode: 'insert' });
        const preview = await previewOf('dana', made);
        expect(preview.lines.map((line) => [line.row, line.status, line.code ?? null])).toEqual([
          [1, 'new', null],
          [2, 'refused', 'REFUSED'],
          [3, 'refused', 'DB_ERROR'],
          [4, 'refused', 'DB_ERROR'],
        ]);
        expect(preview.lines[1]).toMatchObject({ column: 'deal_id', message: 'deal_id: not-allowed' });
        // The two deals out of her reach are told alike, and nothing of either is said.
        expect({ ...preview.lines[3], row: 3, label: '123' }).toEqual(preview.lines[2]);
        expect(JSON.stringify(preview)).not.toMatch(/Deal [34]|lost|8000|5000/);
        const ran = await ranImport('dana', made);
        expect(ran.status).toBe('succeeded');
        expect(ran.refused).toEqual([[2, 'REFUSED'], [3, 'DB_ERROR'], [4, 'DB_ERROR']]);
        expect(ran.stats?.inserted).toBe(1);
        await w.run('DELETE FROM quotes WHERE id > 100');

        // The owner changes the quotes a file matches: quote 1's deal is won since and sent back as it stands, quote 2 moves to a lost deal.
        await w.run(`UPDATE deals SET state = 'won' WHERE id = 1`);
        const upserted = await readyImport('owner', 'id,deal_id,total\n1,1,150\n2,4,250\n', { mode: 'upsert', matchColumn: 'id' });
        const second = await previewOf('owner', upserted);
        expect(second.lines.map((line) => [line.row, line.status, line.code ?? null])).toEqual([
          [1, 'here', null],
          [2, 'refused', 'REFUSED'],
        ]);
        const again = await ranImport('owner', upserted);
        expect([again.status, again.stats?.updated, again.refused]).toEqual(['succeeded', 1, [[2, 'REFUSED']]]);
        expect((await w.rows('SELECT id, deal_id, total FROM quotes WHERE id IN (1, 2) ORDER BY id')).map((row) => [Number(row['id']), Number(row['deal_id']), Number(row['total'])])).toEqual([
          [1, 1, 150],
          [2, 3, 200],
        ]);
      } finally {
        await reset();
      }
    });
  });
}

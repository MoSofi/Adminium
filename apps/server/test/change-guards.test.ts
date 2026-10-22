// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A WRITE THE PERSON A COLUMN NAMES MAY NOT MAKE, on every door: a change on
 * a page (PATCH), a bulk edit, a file brought in, a record's button.
 *
 *  - A reach's `notBy`: Mara leads North (Dana, Omar) and changes her team's
 *    targets, never her own; she changes any starter's goal but her own (the
 *    starter read through a link). Nor does she name herself into a row: a
 *    target made for her, or moved onto her, is refused.
 *  - A column's guard (`column.changes`): a quote's approval becomes approved
 *    or refused only from asked, never by the person who asked nor by the
 *    deal's owner; an enquiry's deal is set only while it is claimed, and only
 *    by its claimer (the Super Admin is held to it too).
 *  - Each refused as the person it limits, and let through for the person
 *    allowed; a record page offers the buttons with who they are hidden for.
 */
import { overridesRepo, permissionsRepo, rowLimitSchema, validateOverrideInput } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { opsForRules } from '../src/apps/manifest-rules.js';
import { storedRowLimit } from '../src/apps/manifest-roles.js';
import { renamedInRule } from '../src/schema-ddl/rename-repair.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { parseCsv } from '../src/data-io/csv.js';
import { stateActionFacts } from '../src/routes/pages/state-actions.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string };
type PreviewLine = { row: number; status: 'new' | 'here' | 'refused'; code?: string; column?: string; message?: string };
type Ran = { status: string; refused: [number, string][]; stats: { inserted?: number; updated?: number } | null };

const EXTRA: readonly string[] = [
  `CREATE TABLE targets (id INTEGER PRIMARY KEY, rep_id VARCHAR(36) NOT NULL, amount INTEGER NOT NULL, status VARCHAR(10) NOT NULL)`,
  `CREATE TABLE starters (id INTEGER PRIMARY KEY, user_id VARCHAR(36), name VARCHAR(40) NOT NULL)`,
  `CREATE TABLE starter_goals (id INTEGER PRIMARY KEY, starter_id INTEGER NOT NULL, amount INTEGER NOT NULL, FOREIGN KEY (starter_id) REFERENCES starters(id))`,
  `CREATE TABLE enquiries (id INTEGER PRIMARY KEY, state VARCHAR(10) NOT NULL, claimed_by_id VARCHAR(36), deal_id INTEGER, FOREIGN KEY (deal_id) REFERENCES deals(id))`,
  `ALTER TABLE quotes ADD COLUMN approval VARCHAR(10)`,
  `ALTER TABLE quotes ADD COLUMN asked_by_id VARCHAR(36)`,
  `ALTER TABLE quotes ADD COLUMN stage VARCHAR(10)`,
];

describe('the two words as an install stores them', () => {
  it('keeps a column\'s guards as one rule, which the store takes and a rename follows', () => {
    const guards = [{ to: ['approved', 'refused'], from: ['asked'], notBy: ['asked_by_id', 'deal_id.owner_id'] }, { while: { column: 'state', isNull: false }, by: 'claimed_by_id' }];
    const ops = opsForRules('crm', { changes: guards } as never);
    expect(ops).toEqual([{ op: 'column.changes', value: { guards } }]);
    expect(() => validateOverrideInput({ connectionId: 'c', op: 'column.changes', tableName: 'public.quotes', columnName: 'approval', value: ops[0]!.value })).not.toThrow();
    expect(() => validateOverrideInput({ connectionId: 'c', op: 'column.changes', tableName: 'public.quotes', columnName: 'approval', value: { guards: [{ to: ['approved'] }] } })).toThrow();
    expect(renamedInRule('column.changes', ops[0]!.value, 'deal_id', 'deal')).toEqual({ guards: [{ ...guards[0], notBy: ['asked_by_id', 'deal.owner_id'] }, guards[1]] });
    expect(renamedInRule('column.changes', ops[0]!.value, 'state', 'stage')).toEqual({ guards: [guards[0], { ...guards[1], while: { column: 'stage', isNull: false } }] });
  });

  it('keeps a reach\'s notBy on the role\'s grant', () => {
    const stored = storedRowLimit({ read: { reach: 'team' }, update: [{ reach: 'team', notBy: 'rep_id' }, { reach: 'all', notBy: 'starter_id.user_id' }] } as never);
    expect(stored).toEqual({ read: { reach: 'team' }, update: [{ reach: 'team', notBy: 'rep_id' }, { reach: 'all', notBy: 'starter_id.user_id' }] });
    expect(rowLimitSchema.safeParse(stored).success).toBe(true);
  });
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a write the person a column names may not make [${dialect}]`, () => {
    let w: World;
    const ids = new Map<string, string>();
    const tid = (name: string): string => ids.get(name)!;
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const data = (table: string): string => `data/${w.connectionId}/${encodeURIComponent(tid(table))}`;
    const patch = (who: Who, table: string, key: number, values: Record<string, unknown>) => call(who, 'PATCH', `${data(table)}/${String(key)}`, { values });
    const create = (who: Who, table: string, values: Record<string, unknown>) => call(who, 'POST', data(table), { values });
    const bulk = (who: Who, table: string, keys: number[], values: Record<string, unknown>) => call(who, 'POST', `${data(table)}/bulk`, { action: 'update', ids: keys.map(String), values });
    const press = (who: Who, table: string, key: number, action: string, from: string, values?: Record<string, unknown>) =>
      call(who, 'POST', `${data(table)}/${String(key)}/actions/${action}`, { from, ...(values === undefined ? {} : { values }) });
    /** A refusal's code and what it says of the column. */
    const refusal = (res: Reply) => {
      const error = json<{ error: { code: string; details?: { column?: string; reason?: string } } }>(res).error;
      return { status: res.statusCode, code: error.code, column: error.details?.column, reason: error.details?.reason };
    };
    const one = async (statement: string): Promise<Record<string, unknown>> => (await w.rows(statement))[0]!;

    const readyImport = async (who: Who, table: string, csv: string, options: Record<string, unknown>): Promise<string> => {
      const uploaded = await call(who, 'POST', `imports/upload?filename=${table}.csv`, csv, { 'content-type': 'text/csv' });
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const header = csv.split('\n')[0]!.split(',');
      const made = await call(who, 'POST', 'imports', { fileId: json<{ data: { fileId: string } }>(uploaded).data.fileId, connectionId: w.connectionId, table: tid(table), mapping: { columns: header.map((name) => ({ from: name, to: name })) }, options: { skipInvalid: true, ...options } });
      expect(made.statusCode, made.body).toBe(201);
      return json<{ data: { import: { id: string } } }>(made).data.import.id;
    };
    const previewOf = async (who: Who, id: string): Promise<PreviewLine[]> => {
      const res = await call(who, 'GET', `imports/${id}/preview`);
      expect(res.statusCode, res.body).toBe(200);
      return json<{ data: { lines: PreviewLine[] } }>(res).data.lines;
    };
    const ranImport = async (who: Who, id: string): Promise<Ran> => {
      expect((await call(who, 'POST', `imports/${id}/run`)).statusCode).toBe(202);
      await w.jobs();
      const view = json<{ data: { status: string; stats: Ran['stats']; errorReportFileId: string | null } }>(await call(who, 'GET', `imports/${id}`)).data;
      const refused = new Map<number, string>();
      if (view.errorReportFileId !== null) {
        for (const line of parseCsv((await call(who, 'GET', `imports/${id}/error-report`)).body).slice(1)) if (line.length > 1 && !refused.has(Number(line[0]))) refused.set(Number(line[0]), line[2]!);
      }
      return { status: view.status, stats: view.stats, refused: [...refused.entries()].sort((a, b) => a[0] - b[0]) };
    };

    const resetTargets = async (): Promise<void> => {
      await w.run('DELETE FROM targets WHERE id > 4');
      await w.run(`UPDATE targets SET amount = 100, status = 'draft'`);
      await w.run(`UPDATE targets SET rep_id = '${w.people.dana}' WHERE id = 2`);
      await w.run('UPDATE starter_goals SET amount = 10, starter_id = id');
    };
    const resetQuotes = async (): Promise<void> => {
      await w.run('DELETE FROM quotes WHERE id > 100');
      await w.run(`UPDATE quotes SET approval = 'none', asked_by_id = NULL, stage = 'draft'`);
      await w.run(`UPDATE quotes SET approval = 'asked', asked_by_id = '${w.people.omar}' WHERE id IN (1, 3)`);
    };
    const resetEnquiries = async (): Promise<void> => {
      await w.run(`UPDATE enquiries SET deal_id = NULL`);
      await w.run(`UPDATE enquiries SET state = 'open', claimed_by_id = NULL WHERE id = 1`);
    };

    beforeAll(async () => {
      w = await world(dialect);
      for (const statement of EXTRA) await w.run(statement);
      const { people } = w;
      await w.run(`INSERT INTO targets (id, rep_id, amount, status) VALUES (1, '${people.mara}', 100, 'draft'), (2, '${people.dana}', 100, 'draft'), (3, '${people.omar}', 100, 'draft'), (4, '${people.lena}', 100, 'draft')`);
      await w.run(`INSERT INTO starters (id, user_id, name) VALUES (1, '${people.mara}', 'Mara'), (2, '${people.dana}', 'Dana')`);
      await w.run(`INSERT INTO starter_goals (id, starter_id, amount) VALUES (1, 1, 10), (2, 2, 10)`);
      await w.run(`INSERT INTO enquiries (id, state, claimed_by_id, deal_id) VALUES (1, 'open', NULL, NULL), (2, 'claimed', '${people.dana}', NULL), (3, 'claimed', '${people.omar}', NULL)`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      for (const table of (await w.model()).tables) ids.set(table.name, table.id);
      await resetQuotes();

      const overrides = overridesRepo(w.meta);
      const rule = (op: string, table: string, columnName: string | null, value: Record<string, unknown>) =>
        overrides.create({ connectionId: w.connectionId, op, tableName: tid(table), ...(columnName === null ? {} : { columnName }), value, origin: 'user' } as never);
      for (const [table, column] of [['targets', 'rep_id'], ['starters', 'user_id'], ['enquiries', 'claimed_by_id'], ['quotes', 'asked_by_id']] as const) await rule('column.staff', table, column, { staff: true });
      await rule('table.belongs', 'targets', null, { ways: [{ column: 'rep_id', set: 'team' }] });
      await rule('table.belongs', 'enquiries', null, { ways: [{ column: 'claimed_by_id' }] });
      await rule('column.changes', 'quotes', 'approval', { guards: [{ to: ['approved', 'refused'], from: ['asked'], notBy: ['asked_by_id', 'deal_id.owner_id'] }] });
      await rule('column.changes', 'enquiries', 'deal_id', { guards: [{ while: { column: 'state', in: ['claimed'] }, by: 'claimed_by_id' }] });
      await rule('table.states', 'targets', null, { column: 'status', initial: 'draft', moves: { draft: ['agreed'] }, actions: [{ id: 'agree', label: 'Agree', move: { to: 'agreed' } }] });
      await rule('table.states', 'quotes', null, { column: 'stage', initial: 'draft', moves: { draft: ['sent'] }, actions: [{ id: 'approve', label: 'Approve', set: { approval: 'approved' }, in: ['draft'] }] });
      await rule('table.states', 'enquiries', null, { column: 'state', initial: 'open', moves: { open: ['claimed'] }, actions: [{ id: 'tie', label: 'Tie to a deal', set: {}, in: ['open', 'claimed'], ask: ['deal_id'] }] });

      /** A grant on a table this test made (the world's own helper knows the world's tables only). */
      const grant = async (roleId: string, table: string, actions: string[], rowLimit?: Record<string, unknown>): Promise<void> => {
        const given = { read: false, create: false, update: false, delete: false, export: false, import: false, ...Object.fromEntries(actions.map((action) => [action, true])) };
        await permissionsRepo(w.meta).grant(roleId, 'table', `${w.connectionId}/${tid(table)}`, { ...given, ...(rowLimit === undefined ? {} : { rowLimit }) } as never);
      };
      // A sales manager: her team's targets, never her own; any starter's goal, never her own; the quotes and the enquiries.
      const manager = await w.role('manager', { quotes: { actions: ['read', 'create', 'update', 'import'] }, deals: { actions: ['read'] } });
      await grant(manager, 'targets', ['read', 'create', 'update', 'import'], { read: { reach: 'team' }, update: { reach: 'team', notBy: 'rep_id' } });
      await grant(manager, 'starters', ['read']);
      await grant(manager, 'starter_goals', ['read', 'update'], { update: { reach: 'all', notBy: 'starter_id.user_id' } });
      await grant(manager, 'enquiries', ['read', 'update', 'import']);
      // A rep: the quotes, and the enquiries they claimed or nobody did.
      const rep = await w.role('rep', { quotes: { actions: ['read', 'update', 'import'] }, deals: { actions: ['read'] } });
      await grant(rep, 'enquiries', ['read', 'update', 'import'], { read: { reach: 'own', unowned: true }, update: { reach: 'own', unowned: true } });
      await w.give('mara', 'manager');
      await w.give('dana', 'rep');
      await w.give('omar', 'rep');
    }, 240_000);
    afterAll(async () => w?.close());

    describe('a reach that leaves out the person a column names (notBy)', () => {
      it('PATCH: her team\'s target, never her own, nor one she names herself into', async () => {
        try {
          const own = await patch('mara', 'targets', 1, { amount: 900 });
          expect(own.statusCode, own.body).toBe(404);
          const dana = await patch('mara', 'targets', 2, { amount: 250 });
          expect(dana.statusCode, dana.body).toBe(200);
          expect(Number((await one('SELECT amount FROM targets WHERE id = 1'))['amount'])).toBe(100);
          expect(Number((await one('SELECT amount FROM targets WHERE id = 2'))['amount'])).toBe(250);
          // Moved onto herself, or made for herself: the row as the write leaves it names her.
          const moved = await patch('mara', 'targets', 2, { rep_id: w.people.mara });
          expect(refusal(moved)).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'rep_id', reason: 'not-by' });
          const made = await create('mara', 'targets', { id: 5, rep_id: w.people.mara, amount: 1, status: 'draft' });
          expect(refusal(made)).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'rep_id', reason: 'not-by' });
          expect((await create('mara', 'targets', { id: 6, rep_id: w.people.omar, amount: 1, status: 'draft' })).statusCode).toBe(201);
          expect((await w.rows('SELECT id FROM targets WHERE id > 4')).map((row) => Number(row['id']))).toEqual([6]);
        } finally {
          await resetTargets();
        }
      });

      it('a person read through a link: any starter\'s goal but her own', async () => {
        try {
          expect((await patch('mara', 'starter_goals', 1, { amount: 99 })).statusCode).toBe(404);
          expect((await patch('mara', 'starter_goals', 2, { amount: 99 })).statusCode).toBe(200);
          const moved = await patch('mara', 'starter_goals', 2, { starter_id: 1 });
          expect(refusal(moved)).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'starter_id', reason: 'not-by' });
          expect((await w.rows('SELECT id, amount, starter_id FROM starter_goals ORDER BY id')).map((row) => [Number(row['id']), Number(row['amount']), Number(row['starter_id'])])).toEqual([
            [1, 10, 1],
            [2, 99, 2],
          ]);
        } finally {
          await resetTargets();
        }
      });

      it('bulk edit: her own target is a row that is not there; her rep\'s is changed', async () => {
        try {
          const res = await bulk('mara', 'targets', [1, 2], { amount: 300 });
          expect(res.statusCode, res.body).toBe(200);
          expect(json<{ results: { id: string; ok: boolean; error?: string }[] }>(res).results).toEqual([
            { id: '1', ok: false, error: 'NOT_FOUND' },
            { id: '2', ok: true },
          ]);
          expect((await w.rows('SELECT id, amount FROM targets WHERE id IN (1, 2) ORDER BY id')).map((row) => Number(row['amount']))).toEqual([100, 300]);
        } finally {
          await resetTargets();
        }
      });

      it('a record\'s button: refused on her own target, made on her rep\'s, and hidden from her', async () => {
        try {
          expect((await press('mara', 'targets', 1, 'agree', 'draft')).statusCode).toBe(404);
          const agreed = await press('mara', 'targets', 2, 'agree', 'draft');
          expect(agreed.statusCode, agreed.body).toBe(200);
          expect((await w.rows('SELECT id, status FROM targets WHERE id IN (1, 2) ORDER BY id')).map((row) => row['status'])).toEqual(['draft', 'agreed']);
          const facts = await stateActionFacts(w.meta, { can: async () => true, permissions: await w.setOf('mara') }, await loadSnapshotView(w.meta, w.connectionId), tid('targets'));
          expect(facts?.find((fact) => fact.id === 'agree')?.notBy).toEqual(['rep_id']);
          // Somebody whose reach says nothing of the kind is offered it with nobody left out.
          const owner = await stateActionFacts(w.meta, { can: async () => true, permissions: { superAdmin: true, roleIds: [], updateLimits: undefined, createLimits: undefined, readLimits: undefined } as never }, await loadSnapshotView(w.meta, w.connectionId), tid('targets'));
          expect(owner?.find((fact) => fact.id === 'agree')?.notBy).toBeUndefined();
        } finally {
          await resetTargets();
        }
      });

      it('import: her own target is refused, one made for her is refused, her reps\' go in', async () => {
        try {
          const { mara, dana, omar } = w.people;
          const made = await readyImport('mara', 'targets', `id,rep_id,amount,status\n1,${mara},5,draft\n2,${dana},6,draft\n9,${mara},7,draft\n10,${omar},8,draft\n`, { mode: 'upsert', matchColumn: 'id' });
          const preview = await previewOf('mara', made);
          expect(preview.map((line) => [line.row, line.status, line.code ?? null])).toEqual([
            [1, 'refused', 'ALREADY_EXISTS'],
            [2, 'here', null],
            [3, 'refused', 'COLUMN_FORBIDDEN'],
            [4, 'new', null],
          ]);
          expect(preview[2]).toMatchObject({ column: 'rep_id' });
          const ran = await ranImport('mara', made);
          expect(ran.status).toBe('succeeded');
          expect(ran.refused.map(([row]) => row)).toEqual([1, 3]);
          expect((await w.rows('SELECT id, amount FROM targets ORDER BY id')).map((row) => [Number(row['id']), Number(row['amount'])])).toEqual([
            [1, 100],
            [2, 6],
            [3, 100],
            [4, 100],
            [10, 8],
          ]);
        } finally {
          await resetTargets();
        }
      });
    });

    describe('when, and by whom, a column may change (changes)', () => {
      it('PATCH: approved only from asked, never by the asker nor the deal\'s owner', async () => {
        try {
          // Quote 1 is on Dana's deal 1, asked for by Omar.
          expect(refusal(await patch('omar', 'quotes', 1, { approval: 'approved' }))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'approval', reason: 'change-not-by' });
          expect(refusal(await patch('dana', 'quotes', 1, { approval: 'refused' }))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'approval', reason: 'change-not-by' });
          // Naming somebody else as the asker in the same write changes nothing.
          expect(refusal(await patch('omar', 'quotes', 1, { approval: 'approved', asked_by_id: w.people.mara }))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'approval', reason: 'change-not-by' });
          // Quote 2 was never asked about: approved from nothing is no approval.
          const unasked = await patch('mara', 'quotes', 2, { approval: 'approved' });
          expect(refusal(unasked)).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'approval', reason: 'change-from' });
          expect(json<{ error: { message: string } }>(unasked).error.message).toBe('approval may change to "approved" or "refused" only from "asked".');
          expect((await w.rows('SELECT approval FROM quotes WHERE id IN (1, 2) ORDER BY id')).map((row) => row['approval'])).toEqual(['asked', 'none']);
          // Mara is neither: she approves it. A change the guard does not hold (back to asking) is anybody's.
          const approved = await patch('mara', 'quotes', 1, { approval: 'approved' });
          expect(approved.statusCode, approved.body).toBe(200);
          expect((await one('SELECT approval FROM quotes WHERE id = 1'))['approval']).toBe('approved');
          expect((await patch('dana', 'quotes', 2, { approval: 'asked' })).statusCode).toBe(200);
          // A new quote is never made approved.
          expect(refusal(await create('mara', 'quotes', { id: 101, deal_id: 1, total: 1, approval: 'approved', stage: 'draft' }))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'approval', reason: 'change-from' });
        } finally {
          await resetQuotes();
        }
      });

      it('bulk edit and a record\'s button: the same refusal, and the same approval for Mara', async () => {
        try {
          expect(refusal(await bulk('dana', 'quotes', [3, 1], { approval: 'approved' }))).toMatchObject({ status: 403, code: 'COLUMN_FORBIDDEN', reason: 'change-not-by' });
          expect(refusal(await press('omar', 'quotes', 1, 'approve', 'draft'))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'approval', reason: 'change-not-by' });
          expect((await w.rows('SELECT approval FROM quotes WHERE id IN (1, 3) ORDER BY id')).map((row) => row['approval'])).toEqual(['asked', 'asked']);
          const bulked = await bulk('mara', 'quotes', [3], { approval: 'refused' });
          expect(bulked.statusCode, bulked.body).toBe(200);
          const pressed = await press('mara', 'quotes', 1, 'approve', 'draft');
          expect(pressed.statusCode, pressed.body).toBe(200);
          expect((await w.rows('SELECT approval FROM quotes WHERE id IN (1, 3) ORDER BY id')).map((row) => row['approval'])).toEqual(['approved', 'refused']);
          // The button is offered with the asker left out (the deal's owner is read through a link: the save refuses her).
          const facts = await stateActionFacts(w.meta, { can: async () => true, permissions: await w.setOf('omar') }, await loadSnapshotView(w.meta, w.connectionId), tid('quotes'));
          expect(facts?.find((fact) => fact.id === 'approve')?.notBy).toEqual(['asked_by_id']);
        } finally {
          await resetQuotes();
        }
      });

      it('import: the asker\'s line is refused by name, Mara\'s goes in', async () => {
        try {
          const omar = await readyImport('omar', 'quotes', 'id,approval\n1,approved\n2,asked\n', { mode: 'upsert', matchColumn: 'id' });
          const preview = await previewOf('omar', omar);
          expect(preview.map((line) => [line.row, line.status, line.code ?? null, line.column ?? null])).toEqual([
            [1, 'refused', 'COLUMN_FORBIDDEN', 'approval'],
            [2, 'here', null, null],
          ]);
          const ran = await ranImport('omar', omar);
          expect(ran.refused.map(([row]) => row)).toEqual([1]);
          expect((await w.rows('SELECT approval FROM quotes WHERE id IN (1, 2) ORDER BY id')).map((row) => row['approval'])).toEqual(['asked', 'asked']);
          const mara = await readyImport('mara', 'quotes', 'id,approval\n1,approved\n', { mode: 'upsert', matchColumn: 'id' });
          expect((await previewOf('mara', mara)).map((line) => line.status)).toEqual(['here']);
          expect((await ranImport('mara', mara)).refused).toEqual([]);
          expect((await one('SELECT approval FROM quotes WHERE id = 1'))['approval']).toBe('approved');
        } finally {
          await resetQuotes();
        }
      });

      it('an enquiry\'s deal: only while it is claimed, only by its claimer, the Super Admin held too', async () => {
        try {
          // Enquiry 1 is nobody's yet; 2 is Dana's claim.
          expect(refusal(await patch('dana', 'enquiries', 1, { deal_id: 1 }))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'deal_id', reason: 'change-while' });
          expect(refusal(await patch('mara', 'enquiries', 2, { deal_id: 1 }))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'deal_id', reason: 'change-by' });
          expect(refusal(await patch('owner', 'enquiries', 2, { deal_id: 1 }))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'deal_id', reason: 'change-by' });
          const tied = await patch('dana', 'enquiries', 2, { deal_id: 1 });
          expect(tied.statusCode, tied.body).toBe(200);
          expect((await w.rows('SELECT id, deal_id FROM enquiries ORDER BY id')).map((row) => (row['deal_id'] === null ? null : Number(row['deal_id'])))).toEqual([null, 1, null]);
        } finally {
          await resetEnquiries();
        }
      });

      it('an enquiry\'s deal by bulk edit, by its button and by import', async () => {
        try {
          expect(refusal(await bulk('dana', 'enquiries', [1, 2], { deal_id: 1 }))).toMatchObject({ status: 403, code: 'COLUMN_FORBIDDEN', reason: 'change-while' });
          expect(refusal(await press('dana', 'enquiries', 1, 'tie', 'open', { deal_id: 1 }))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'deal_id', reason: 'change-while' });
          expect(refusal(await press('mara', 'enquiries', 2, 'tie', 'claimed', { deal_id: 1 }))).toEqual({ status: 403, code: 'COLUMN_FORBIDDEN', column: 'deal_id', reason: 'change-by' });
          expect((await w.rows('SELECT deal_id FROM enquiries WHERE deal_id IS NOT NULL')).length).toBe(0);
          expect((await bulk('dana', 'enquiries', [2], { deal_id: 1 })).statusCode).toBe(200);
          const pressed = await press('omar', 'enquiries', 3, 'tie', 'claimed', { deal_id: 3 });
          expect(pressed.statusCode, pressed.body).toBe(200);
          const made = await readyImport('dana', 'enquiries', 'id,deal_id\n1,2\n2,2\n', { mode: 'upsert', matchColumn: 'id' });
          const preview = await previewOf('dana', made);
          expect(preview.map((line) => [line.row, line.status, line.code ?? null, line.column ?? null])).toEqual([
            [1, 'refused', 'COLUMN_FORBIDDEN', 'deal_id'],
            [2, 'here', null, null],
          ]);
          expect((await ranImport('dana', made)).refused.map(([row]) => row)).toEqual([1]);
          expect((await w.rows('SELECT id, deal_id FROM enquiries ORDER BY id')).map((row) => (row['deal_id'] === null ? null : Number(row['deal_id'])))).toEqual([null, 2, 3]);
          // The button is offered to the claimer alone.
          const facts = await stateActionFacts(w.meta, { can: async () => true, permissions: await w.setOf('dana') }, await loadSnapshotView(w.meta, w.connectionId), tid('enquiries'));
          expect(facts?.find((fact) => fact.id === 'tie')?.by).toBe('claimed_by_id');
        } finally {
          await resetEnquiries();
        }
      });
    });
  });
}

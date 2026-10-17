// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A private table,
 * against the whole server on every engine: read on the screen by the people
 * its rows belong to, and by nothing else — not a file out or in, a report,
 * a document, a rule, an owner's code or a public door, and not the Super
 * Admin.
 *
 * The one-to-ones are private: 1 is Mara's with Dana, 2 Lena's with Sam,
 * 3 Mara's with Omar.
 */
import { automationRunsRepo, documentProfilesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDocumentPipeline, documentReads } from '../src/documents/compose.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a private table [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) });
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const notes = (): string => w.id('one_to_ones');
    const refusal = (res: Reply) => {
      const error = json<{ error: { code: string; details?: { reason?: string } } }>(res).error;
      return [res.statusCode, error.code, error.details?.reason];
    };
    const PRIVATE = [403, 'TABLE_FORBIDDEN', 'private'];

    beforeAll(async () => {
      w = await world(dialect);
      // The pair's own role holds everything a role can hold there; the keeper looks after the workspace.
      await w.role('pair', { one_to_ones: { actions: ['read', 'create', 'update', 'delete', 'export', 'import'], rows: { read: OWN, update: OWN, delete: OWN } }, deals: { actions: ['read', 'export'] } });
      await w.system('keeper', ['exports.manage', 'imports.manage', 'automations.manage', 'manifests.manage', 'reports.manage']);
      for (const person of ['mara', 'dana'] as const) {
        await w.give(person, 'pair');
        await w.give(person, 'keeper');
      }
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    it('is read on the screen by its two people, and by nobody else', async () => {
      const listed = async (who: Who): Promise<number[]> => json<{ data: { id: number }[] }>(await call(who, 'GET', `data/${w.connectionId}/${encodeURIComponent(notes())}?order=id.asc`)).data.map((row) => Number(row.id));
      expect(await listed('mara')).toEqual([1, 3]);
      expect(await listed('dana')).toEqual([1]);
      expect(await listed('owner')).toEqual([]);
    });

    it('is not written to a file, by its own people or the Super Admin', async () => {
      for (const who of ['mara', 'owner'] as const) {
        expect(refusal(await call(who, 'POST', 'exports', { connectionId: w.connectionId, source: { kind: 'table', table: notes() }, format: 'csv' })), who).toEqual(PRIVATE);
        expect(refusal(await call(who, 'POST', 'exports/preview', { connectionId: w.connectionId, source: { kind: 'table', table: notes() }, format: 'csv', sampleRows: 5 })), who).toEqual(PRIVATE);
        const offered = json<{ data: { tables: { id: string }[] } }>(await call(who, 'GET', `exports/sources?connectionId=${w.connectionId}`)).data.tables.map((table) => table.id);
        expect(offered, who).not.toContain(notes());
        expect(offered, who).toContain(w.id('deals'));
      }
      // Any other table is exported as it always was.
      expect((await call('mara', 'POST', 'exports', { connectionId: w.connectionId, source: { kind: 'table', table: w.id('deals') }, format: 'csv' })).statusCode).toBe(202);
      await w.jobs();
    });

    it('takes no file brought in', async () => {
      const uploaded = await call('mara', 'POST', 'imports/upload?filename=notes.csv', 'id,note\n1,x\n', { 'content-type': 'text/csv' });
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const made = await call('mara', 'POST', 'imports', { fileId: json<{ data: { fileId: string } }>(uploaded).data.fileId, connectionId: w.connectionId, table: notes(), mapping: { columns: [{ from: 'id', to: 'id' }, { from: 'note', to: 'note' }] }, options: { mode: 'upsert', matchColumn: 'id' } });
      expect(refusal(made)).toEqual(PRIVATE);
      expect((await w.rows('SELECT note FROM one_to_ones WHERE id = 1'))[0]!['note']).toBe('Dana, August');
    });

    it('is the record of no document, and listed in none', async () => {
      const about = { addOnKey: 'invoices', kind: 'invoice', name: 'A note, printed', connectionId: w.connectionId, table: notes(), mapping: { customerName: { column: 'note' } } };
      const listing = { addOnKey: 'invoices', kind: 'quote', name: 'A deal with its notes', connectionId: w.connectionId, table: w.id('deals'), mapping: { customerName: { column: 'title' }, items: { collection: { table: notes(), fkColumn: 'id', columns: {} } } } };
      for (const body of [about, listing]) expect(refusal(await call('mara', 'POST', 'documents/profiles', body)), body.name).toEqual(PRIVATE);
      // A mapping written before the table was marked draws nothing, for a rule or for one of its own two people.
      const old = await documentProfilesRepo(w.meta).create(about);
      const pipeline = createDocumentPipeline({ meta: w.meta, manager: w.manager, storage: {} as never, runtime: () => null });
      expect(await pipeline.readSource({ profile: old, pk: { id: 1 }, tables: [], at: Date.now() })).toBeNull();
      expect(await pipeline.readSource({ profile: old, pk: { id: 1 }, tables: [], at: Date.now(), reader: w.people.mara })).toBeNull();
      // …and one changed to draw from it is refused where it is written.
      const plain = await documentProfilesRepo(w.meta).create({ ...about, name: 'A deal', table: w.id('deals'), mapping: { customerName: { column: 'title' } } });
      expect(refusal(await call('mara', 'PUT', `documents/profiles/${plain.id}`, { mapping: { customerName: { column: 'title' }, items: { collection: { table: notes(), fkColumn: 'id', columns: {} } } } }))).toEqual(PRIVATE);
      expect((await documentProfilesRepo(w.meta).findById(plain.id))!.mapping).toEqual({ customerName: { column: 'title' } });
    });

    it('sets off no rule, is read by none, and none is written over it', async () => {
      const rule = { name: 'Mail me every note', connectionId: w.connectionId, trigger: { kind: 'record', event: 'updated', connectionId: w.connectionId, table: notes(), watch: true }, graph: { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'When a note changes' }, { id: 'n2', kind: 'action', title: 'Send email', onError: false, action: { kind: 'email', templateKey: null, to: null, vars: {} } }] }, enabled: false };
      for (const who of ['mara', 'owner'] as const) expect(refusal(await call(who, 'POST', 'automations', rule)), who).toEqual(PRIVATE);
      // What a rule reads through has no such table: one saved before the table was marked finds no record.
      const forOthers = await loadSnapshotView(w.meta, w.connectionId, { forOthers: true });
      expect(() => forOthers.table(notes())).toThrow();
      expect(forOthers.linkTable(notes())).toBeNull();
      expect(forOthers.model.relations.filter((relation) => relation.from.tableId === notes() || relation.to.tableId === notes())).toEqual([]);
      // Nothing was started by the pair's own change of a note.
      expect((await call('mara', 'PATCH', `data/${w.connectionId}/${encodeURIComponent(notes())}/1`, { values: { note: 'Dana, August' } })).statusCode).toBe(200);
      expect(await automationRunsRepo(w.meta).list({ since: 0 })).toEqual([]);
    });

    it('is behind no public door: a customer\'s key and a screen\'s key read through a view that has no such table', async () => {
      const view = (await createPublicViews(w.meta).viewFor(w.connectionId))!;
      expect(() => view.table(notes())).toThrow();
      expect(view.linkTable(notes())).toBeNull();
      expect(view.table(w.id('deals')).id).toBe(w.id('deals'));
    });

    it('keeps its mark, and whose its rows are, through a save of the schema\'s rules by anybody', async () => {
      type Rule = { op: string; tableName: string; columnName: string | null; value: unknown; status: string };
      const stored = json<{ overrides: Rule[] }>(await call('owner', 'GET', `connections/${w.connectionId}/overrides`)).overrides;
      const send = (rules: Rule[]) => call('owner', 'PUT', `connections/${w.connectionId}/overrides`, { overrides: rules.map(({ op, tableName, columnName, value, status }) => ({ op, tableName, ...(columnName === null ? {} : { columnName }), value, status })) });
      const ofNotes = (rule: Rule) => rule.tableName === notes();
      // The mark left out; the mark switched off; a way taken away; a column of its people unmarked.
      const without = (drop: (rule: Rule) => boolean) => stored.filter((rule) => !drop(rule));
      for (const [what, rules] of [
        ['the mark left out', without((rule) => ofNotes(rule) && rule.op === 'table.private')],
        ['the mark switched off', stored.map((rule) => (ofNotes(rule) && rule.op === 'table.private' ? { ...rule, status: 'disabled' } : rule))],
        ['its ways left out', without((rule) => ofNotes(rule) && rule.op === 'table.belongs')],
        ['a staff column unmarked', without((rule) => ofNotes(rule) && rule.op === 'column.staff' && rule.columnName === 'rep_id')],
      ] as const) {
        expect(refusal(await send([...rules])), what).toEqual(PRIVATE);
      }
      // Everything as it was is saved, and so is a change to any other table.
      expect((await send(stored)).statusCode).toBe(200);
      expect((await send(without((rule) => rule.tableName === w.id('followups') && rule.op === 'table.belongs'))).statusCode).toBe(200);
      expect((await send(stored)).statusCode).toBe(200);
      expect((await w.model()).tables.find((table) => table.id === notes())!.private).toBe(true);
    });

    it('is offered to no rule, and a document is judged by the table its link really points at', async () => {
      const offered = json<{ connections: { id: string; tables: { id: string }[] }[] }>(await call('owner', 'GET', 'automations/sources')).connections.find((one) => one.id === w.connectionId)!.tables.map((table) => table.id);
      expect(offered).toContain(w.id('deals'));
      expect(offered).not.toContain(notes());
      // A mapping that reads a quote's deal and says the column is a company's: the deal's table is what it reads.
      const view = await loadSnapshotView(w.meta, w.connectionId);
      const lying = { connectionId: w.connectionId, table: w.id('quotes'), mapping: { customerName: { ref: 'deal_id', column: 'title', table: w.id('companies') } }, options: {} };
      expect(await documentReads(lying as never, async () => view)).toEqual(expect.arrayContaining([w.id('quotes'), w.id('deals')]));
    });

    it('is an ordinary table again when the mark is taken off', async () => {
      await w.private('one_to_ones', false);
      try {
        expect((await loadSnapshotView(w.meta, w.connectionId, { forOthers: true })).table(notes()).id).toBe(notes());
        const res = await call('owner', 'POST', 'exports', { connectionId: w.connectionId, source: { kind: 'table', table: notes() }, format: 'csv' });
        expect(res.statusCode, res.body).toBe(202);
        await w.jobs();
      } finally {
        await w.private('one_to_ones', true);
      }
    });
  });
}

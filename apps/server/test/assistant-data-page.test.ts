// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant on a data page, on every engine, as the people who use it.
 *
 * - Which table a page shows is the PAGE's, read by the server after the
 *   page's own view check. The request names a page, never a table.
 * - "These rows" is the page's own selection, open record or filters,
 *   applied by the server as a predicate a tool call can narrow and never
 *   widen, and only on the page's own table.
 * - A row read says how many rows came back of how many there are.
 * - The page drafts nothing: its prompt has no document in it.
 */
import { ASSISTANT_SCHEMA_VERSION } from '@adminium/llm';
import { assistantSessionsRepo, pagesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dataPageOf } from '../src/assistant/data-page.js';
import { executeAssistantTurn } from '../src/jobs/assistant-turn.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import type { TurnSetup } from '../src/assistant/turn-setup.js';
import { legs, person, stack, turnAs, type Stack } from './assistant-lodge.helpers.js';
import { makeScriptedClient } from './llm-fixtures.js';

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`the assistant on a data page — ${dialect}`, () => {
    let s: Stack;
    let pageId: string;
    let night: { cookie: string; id: string };
    let hk: { cookie: string; id: string };
    let reader: { cookie: string; id: string };

    const run = (setup: TurnSetup, tool: string, args: Record<string, unknown>) => setup.execute({ id: 'c1', tool, args: { connectionId: s.connectionId, ...args } });
    /** A turn on the app's page; `page: null` is a turn that names no page at all. */
    const on = (userId: string, view: Record<string, unknown> = {}, page: string | null = pageId) =>
      turnAs(s, userId, 'data', { ...(page === null ? {} : { pageId: page }), view });
    const rowsOf = (out: { result?: unknown }) => (out.result as { rows: Record<string, unknown>[]; returned: number; total: number | null }).rows;
    const idsOf = (out: { result?: unknown }) => rowsOf(out).map((row) => Number(row.id)).sort((a, b) => a - b);

    beforeAll(async () => {
      s = await stack(dialect);
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('101')`);
      const stays: [string, string, string, number][] = [
        ['2026-11-01', 'Ana', 'booked', 100],
        ['2026-11-02', 'Ben', 'in_house', 200],
        ['2026-11-03', 'Cy', 'booked', 300],
        ['2026-11-04', 'Di', 'departed', 400],
        ['2026-11-05', 'Eli', 'booked', 500],
      ];
      for (const [arrive, guest, status, total] of stays) {
        await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, total, status) VALUES (1, '${arrive}', '2026-12-01', '${guest}', ${String(total)}, '${status}')`);
      }
      const page = (await pagesRepo(s.meta).listAll()).find((row) => row.title === 'Stays');
      expect(page, 'the app`s page').toBeDefined();
      pageId = page!.id;
      night = await person(s, 'night@lodge.dev', ['night']);
      hk = await person(s, 'hk@lodge.dev', ['housekeeping']);
      // Reads the table and holds no grant on the page.
      reader = await person(s, 'reader@lodge.dev', [], [`table:${s.connectionId}:${s.table.stays}:read`]);
    }, 180_000);
    afterAll(async () => s?.close());

    it('knows the page`s table from the page, after the page`s own view check', async () => {
      const setup = await on(night.id);
      expect(await dataPageOf(setup.deps)).toMatchObject({ id: pageId, title: 'Stays', kind: 'page-crud', table: s.table.stays, connectionId: s.connectionId });
      expect(setup.system).toContain(`the page "Stays", which shows the table ${s.table.stays}`);
      expect(setup.facts).toMatchObject({ page: 'Stays', table: s.table.stays });

      // Someone who may not view the page is told nothing of it, though they read its table.
      const outsider = await on(reader.id);
      expect(await dataPageOf(outsider.deps)).toBeNull();
      expect(outsider.system).not.toContain('"Stays"');
      expect(outsider.facts).not.toHaveProperty('table');
      // A page that is not there, and no page at all.
      expect(await dataPageOf((await on(night.id, {}, 'page_does_not_exist')).deps)).toBeNull();
      expect(await dataPageOf((await on(night.id, {}, null)).deps)).toBeNull();
    });

    it('drafts nothing: the prompt has no document in it and the contract no result', async () => {
      const setup = await on(night.id);
      expect(setup.adapter.document).toBeUndefined();
      expect(setup.system).not.toContain('== The document format ==');
      expect(setup.system).not.toContain('"result"');
      expect(setup.system).toContain('This page has no document');
      expect(setup.specs.map((spec) => spec.name)).toEqual(['list_connections', 'describe_schema', 'read_rows', 'aggregate', 'sample_record', 'list_add_ons']);
    });

    it('holds "the rows shown" to the grid`s own filter, which a call can narrow and never widen', async () => {
      const where = JSON.stringify({ column: 'status', op: 'eq', value: 'booked' });
      const setup = await on(night.id, { where });
      const shown = await run(setup, 'read_rows', { table: s.table.stays, scope: 'page' });
      expect(shown.error, JSON.stringify(shown.error)).toBeUndefined();
      expect(idsOf(shown)).toEqual([1, 3, 5]);
      expect(shown.result).toMatchObject({ returned: 3, total: 3, scope: 'page' });
      expect(shown.read).toMatchObject({ tool: 'read_rows', returned: 3, total: 3, scope: 'page' });

      // Narrowed by the call's own filter.
      const narrowed = await run(setup, 'read_rows', { table: s.table.stays, scope: 'page', where: { column: 'total', op: 'gte', value: 300 } });
      expect(idsOf(narrowed)).toEqual([3, 5]);
      // An "or" that would reach every row reaches only the shown ones.
      const widened = await run(setup, 'read_rows', { table: s.table.stays, scope: 'page', where: { or: [{ column: 'status', op: 'eq', value: 'departed' }, { column: 'total', op: 'gte', value: 0 }] } });
      expect(idsOf(widened)).toEqual([1, 3, 5]);
      // Without the scope the call reads the table, as before.
      expect(idsOf(await run(setup, 'read_rows', { table: s.table.stays }))).toEqual([1, 2, 3, 4, 5]);
      // The prompt says the grid shows a part.
      expect(setup.system).toContain('The grid shows a part of the table: filters');
    });

    it('decides which rows are on screen as the person does: a search that matched through a personal column finds the same rows, and their values stay masked', async () => {
      await s.run(`UPDATE lodge_stays SET phone = '555-0142' WHERE guest_name = 'Ana'`);
      await s.run(`UPDATE lodge_stays SET phone = '555-0199' WHERE guest_name = 'Ben'`);
      // The grid's own answer for a person, through the list route they are looking at.
      const gridIds = async (who: { cookie: string }, q: string) => {
        const res = await s.app.inject({ method: 'GET', url: `/api/v1/data/${s.connectionId}/${s.table.stays}?q=${q}&limit=50`, headers: { cookie: who.cookie } });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: { id: number }[] }).data.map((row) => Number(row.id)).sort((x, y) => x - y);
      };
      // Sees phone numbers in clear: their search finds a stay by one.
      const desk = await person(s, 'desk@lodge.dev', ['night'], [`table:${s.connectionId}:${s.table.stays}:read_pii`]);
      expect(await gridIds(desk, '0142')).toEqual([1]);
      const shown = await run(await on(desk.id, { q: '0142' }), 'read_rows', { table: s.table.stays, scope: 'page' });
      expect(shown.error, JSON.stringify(shown.error)).toBeUndefined();
      expect(idsOf(shown)).toEqual([1]);
      expect(shown.result).toMatchObject({ returned: 1, total: 1 });
      // The row is theirs to ask about; the number still does not travel to the model.
      expect(JSON.stringify(shown.result)).not.toContain('0142');

      // Without that right the grid finds nothing by a phone number, and neither does the assistant.
      expect(await gridIds(night, '0142')).toEqual([]);
      const none = await run(await on(night.id, { q: '0142' }), 'read_rows', { table: s.table.stays, scope: 'page' });
      expect(idsOf(none)).toEqual([]);
      expect(none.result).toMatchObject({ returned: 0, total: 0 });

      // A filter over a personal column is the same: the person's, when they may read it.
      const where = JSON.stringify({ column: 'phone', op: 'eq', value: '555-0199' });
      const filtered = await run(await on(desk.id, { where }), 'read_rows', { table: s.table.stays, scope: 'page' });
      expect(filtered.error, JSON.stringify(filtered.error)).toBeUndefined();
      expect(idsOf(filtered)).toEqual([2]);
      // And the model's OWN filter over that column is still refused: it reads masked.
      const own = await run(await on(desk.id), 'read_rows', { table: s.table.stays, where: { column: 'phone', op: 'eq', value: '555-0199' } });
      expect(own.error).toBeDefined();
    });

    it('holds a total to the same rows', async () => {
      const [schema, name] = s.table.stays.split('.') as [string, string];
      const descriptor = { shape: 'single-metric', source: { schema, name }, aggregations: [{ fn: 'sum', column: 'total', alias: 'money' }] };
      const setup = await on(night.id, { where: JSON.stringify({ column: 'status', op: 'eq', value: 'booked' }) });
      const all = await run(setup, 'aggregate', { descriptor });
      const shown = await run(setup, 'aggregate', { descriptor, scope: 'page' });
      expect(shown.error, JSON.stringify(shown.error)).toBeUndefined();
      expect(JSON.stringify(all.result)).toContain('1500');
      expect(JSON.stringify(shown.result)).toContain('900');
      expect(JSON.stringify(shown.result)).not.toContain('1500');
      // The call's own condition is kept beside the page's.
      const both = await run(setup, 'aggregate', { descriptor: { ...descriptor, filters: [{ column: 'total', op: 'gte', value: 300 }] }, scope: 'page' });
      expect(JSON.stringify(both.result)).toContain('800');
      // A text search cannot be applied to a total: said, not answered over every row.
      const searching = await on(night.id, { q: 'Ana' });
      const refused = await run(searching, 'aggregate', { descriptor, scope: 'page' });
      expect(refused.error?.code).toBe('SCOPE_HAS_SEARCH');
      expect(refused.result).toBeUndefined();
    });

    it('means the rows that are ticked, or the record that is open', async () => {
      const setup = await on(night.id, { selectedIds: ['2', '4'], recordId: '5', where: JSON.stringify({ column: 'status', op: 'eq', value: 'booked' }) });
      expect(idsOf(await run(setup, 'read_rows', { table: s.table.stays, scope: 'selection' }))).toEqual([2, 4]);
      expect(idsOf(await run(setup, 'read_rows', { table: s.table.stays, scope: 'record' }))).toEqual([5]);
      expect(setup.system).toContain('2 rows selected');
      expect(setup.system).toContain('they most likely mean scope "selection"');
      expect(setup.facts).toMatchObject({ selected: 2 });
      // Nothing ticked, nothing open: said, not guessed.
      const bare = await on(night.id);
      expect((await run(bare, 'read_rows', { table: s.table.stays, scope: 'selection' })).error?.code).toBe('NOTHING_SELECTED');
      expect((await run(bare, 'read_rows', { table: s.table.stays, scope: 'record' })).error?.code).toBe('NO_OPEN_RECORD');
      expect((await run(bare, 'read_rows', { table: s.table.stays, scope: 'everything' })).error?.code).toBe('BAD_ARGS');
    });

    it('is about the page`s own table only, and only where there is a page', async () => {
      const setup = await on(night.id, { where: JSON.stringify({ column: 'status', op: 'eq', value: 'booked' }) });
      // The owner reads rooms; the scope still says nothing about them.
      const owner = await on((await person(s, `o-${dialect}@lodge.dev`, [], [`table:${s.connectionId}:${s.table.rooms}:read`, `page:${pageId}:view`])).id, {});
      expect((await run(owner, 'read_rows', { table: s.table.rooms, scope: 'page' })).error?.code).toBe('SCOPE_OTHER_TABLE');
      // No page the person may view: no scope.
      expect((await run(await on(reader.id), 'read_rows', { table: s.table.stays, scope: 'page' })).error?.code).toBe('NO_PAGE_SCOPE');
      expect(setup.system).toContain(s.table.stays);
    });

    it('refuses a page filter over a column the role is not shown, and one it cannot read at all', async () => {
      // Housekeeping is not shown `total`: a filter on it cannot have come from their grid.
      const hidden = await on(hk.id, { where: JSON.stringify({ column: 'total', op: 'gte', value: 300 }) });
      const out = await run(hidden, 'read_rows', { table: s.table.stays, scope: 'page' });
      expect(out.error?.code).toBe('COLUMN_FORBIDDEN');
      expect(out.result).toBeUndefined();
      // Not a filter at all: "the rows shown" is then not known, and every row is not read in its place.
      const broken = await on(night.id, { where: '{not json' });
      const refused = await run(broken, 'read_rows', { table: s.table.stays, scope: 'page' });
      expect(refused.error?.code).toBe('PAGE_VIEW_UNREADABLE');
      expect(refused.result).toBeUndefined();
    });

    it('says how many rows came back of how many there are, and reads on from an offset', async () => {
      const setup = await on(night.id);
      const first = await run(setup, 'read_rows', { table: s.table.stays, limit: 2, sort: 'id.asc' });
      expect(first.result).toMatchObject({ returned: 2, total: 5 });
      expect(idsOf(first)).toEqual([1, 2]);
      const next = await run(setup, 'read_rows', { table: s.table.stays, limit: 2, offset: 2, sort: 'id.asc' });
      expect(next.result).toMatchObject({ returned: 2, total: 5, offset: 2 });
      expect(idsOf(next)).toEqual([3, 4]);
      expect(first.read).toMatchObject({ returned: 2, total: 5 });
    });

    it('stores beside an answer what its tools really read: the tables, and how much of each', async () => {
      const repo = assistantSessionsRepo(s.meta);
      const session = await repo.create({ context: 'data', host: { connectionIds: [s.connectionId], pageId }, createdBy: night.id });
      const turn = await repo.createTurn({ sessionId: session.id, askText: 'Who stays longest?' });
      await repo.setTurnStatus(turn.id, 'queued', { jobId: 'job_test' });
      const call = (id: string, tool: string, args: Record<string, unknown>) => ({ id, tool, args: { connectionId: s.connectionId, ...args }, step: { icon: 'database', label: 'Read', detail: '' } });
      const scripted = makeScriptedClient([
        { text: JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say: '', calls: [call('c1', 'read_rows', { table: s.table.stays, limit: 2 }), call('c2', 'read_rows', { table: s.table.stays, scope: 'page' })] }) },
        // The model may claim what it likes; what is stored is what happened.
        { text: JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say: 'Ana, from every table there is.' }) },
      ]);
      await executeAssistantTurn(
        { turnId: turn.id, userId: night.id },
        { jobId: 'job_test', kind: 'assistant.turn', attempt: 1, maxAttempts: 3, signal: new AbortController().signal, progress: () => undefined, log: () => undefined },
        {
          meta: s.meta,
          manager: s.manager,
          resolveClient: () => Promise.resolve({ client: scripted.client, provider: 'anthropic', model: 'm', baseUrl: null }),
          can: async (userId, permission) => (userId === null ? false : permissionSetAllows(await resolvePermissionSet(s.meta, { kind: 'user', id: userId, label: userId }), permission)),
        },
      );
      const stored = (await repo.findTurn(turn.id))!;
      expect(stored.status, JSON.stringify(stored.error)).toBe('done');
      const answer = stored.answer as { sources: string[]; reads: { table: string; tool: string; returned: number; total: number; scope?: string }[]; truncated: boolean };
      expect(answer.sources).toEqual([`Lodge.${s.table.stays}`]);
      expect(answer.reads).toEqual([
        { table: `Lodge.${s.table.stays}`, tool: 'read_rows', returned: 2, total: 5 },
        { table: `Lodge.${s.table.stays}`, tool: 'read_rows', returned: 5, total: 5, scope: 'page' },
      ]);
      // One read came back short of what there is: the answer is about a part of the rows.
      expect(answer.truncated).toBe(true);
    });

    it('lists the add-ons this server has and could have, and keeps only a suggestion its own list confirms', async () => {
      const addOns = () =>
        Promise.resolve([
          { key: 'offers', name: 'Offers & gift cards', line: 'Discounts, codes, vouchers, packs and gift cards.', state: 'listed' as const },
          { key: 'inventory', name: 'Inventory', line: 'Stock by place and by batch.', state: 'installed' as const },
        ]);
      // The tool answers the list, and says which are installed.
      const setup = await turnAs(s, night.id, 'data', { pageId });
      const withList = await (async () => {
        const again = await import('../src/assistant/turn-setup.js');
        return again.setUpTurn({ meta: s.meta, manager: s.manager, context: 'data', host: { connectionIds: [s.connectionId], pageId }, userId: night.id, can: () => Promise.resolve(true), addOns });
      })();
      const listed = await withList.execute({ id: 'c1', tool: 'list_add_ons', args: {} });
      expect((listed.result as { addOns: unknown[] }).addOns).toEqual([
        { key: 'offers', name: 'Offers & gift cards', what: 'Discounts, codes, vouchers, packs and gift cards.', installed: false },
        { key: 'inventory', name: 'Inventory', what: 'Stock by place and by batch.', installed: true },
      ]);
      // Where there is no list, it says so and tells the model to suggest nothing.
      const none = await setup.execute({ id: 'c1', tool: 'list_add_ons', args: {} });
      expect(none.result).toMatchObject({ addOns: [] });
      expect(JSON.stringify(none.result)).toContain('Do not suggest one');

      const repo = assistantSessionsRepo(s.meta);
      const answered = async (suggest: string[], list: typeof addOns | undefined) => {
        const session = await repo.create({ context: 'data', host: { connectionIds: [s.connectionId], pageId }, createdBy: night.id });
        const turn = await repo.createTurn({ sessionId: session.id, askText: 'Can I give customers a discount code?' });
        await repo.setTurnStatus(turn.id, 'queued', { jobId: 'job_test' });
        const scripted = makeScriptedClient([{ text: JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say: 'Not here yet.', suggest }) }]);
        await executeAssistantTurn(
          { turnId: turn.id, userId: night.id },
          { jobId: 'job_test', kind: 'assistant.turn', attempt: 1, maxAttempts: 3, signal: new AbortController().signal, progress: () => undefined, log: () => undefined },
          {
            meta: s.meta,
            manager: s.manager,
            resolveClient: () => Promise.resolve({ client: scripted.client, provider: 'anthropic', model: 'm', baseUrl: null }),
            can: () => Promise.resolve(true),
            ...(list === undefined ? {} : { addOns: list }),
          },
        );
        const stored = (await repo.findTurn(turn.id))!;
        expect(stored.status, JSON.stringify(stored.error)).toBe('done');
        return stored.answer as { suggest?: { key: string }[] };
      };
      // One that is listed and not installed is kept, once; an installed one and a made-up one are not.
      expect((await answered(['offers', 'inventory', 'made-up-by-the-model'], addOns)).suggest).toEqual([{ key: 'offers' }]);
      expect((await answered(['offers', 'offers'], addOns)).suggest).toEqual([{ key: 'offers' }]);
      expect(await answered(['inventory', 'nothing-like-this'], addOns)).not.toHaveProperty('suggest');
      // No list on this server: nothing the model names is passed on.
      expect(await answered(['offers'], undefined)).not.toHaveProperty('suggest');
    });
  });
}

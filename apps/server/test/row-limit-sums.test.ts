// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A role whose rows are limited, held to it where a figure or a name is
 * taken from a table rather than a row listed (plan 67, A1; the matrix's D1
 * projections, D5, D6, D11, D12–D14, D16, S1, W1, M1, M2), against the whole
 * server on every engine: a value looked up through a link, a count and a
 * sum over the rows that point at a record, the rows a record is linked to,
 * which days are taken, the search box, a dashboard card and its cache, and
 * what the assistant reads.
 *
 * The clock is the real one: Dana reaches deals 1, 2, 5 and 9 (her own two,
 * and Lena's two that she covers); Mara, who leads Dana and Omar, reaches
 * 1, 2, 3, 4, 5 and 9.
 */
import { teamsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`figures and names over a limited table [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName | 'owner', string>();
    const as = async (who: PersonName | 'owner'): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    type Reply = { statusCode: number; body: string };
    const get = async (who: PersonName | 'owner', url: string): Promise<Reply> => w.app.inject({ method: 'GET', url: `/api/v1/${url}`, headers: { cookie: await as(who) } });
    const post = async (who: PersonName | 'owner', url: string, payload: Record<string, unknown>): Promise<Reply> => w.app.inject({ method: 'POST', url: `/api/v1/${url}`, headers: { cookie: await as(who) }, payload });
    const data = (path: string): string => `data/${w.connectionId}/${path}`;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const rowsOf = (res: Reply): Record<string, unknown>[] => json<{ data: Record<string, unknown>[] }>(res).data;
    const source = (table: Parameters<World['id']>[0]) => ({ name: table, ...(w.id(table).includes('.') && dialect === 'postgres' ? { schema: 'public' } : {}) });
    const card = async (who: PersonName | 'owner', descriptor: Record<string, unknown>) => post(who, 'widget-data/query', { descriptor: { connectionId: w.connectionId, ...descriptor } });
    const sumOf = async (who: PersonName | 'owner'): Promise<number> => {
      const res = await card(who, { source: source('deals'), shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }] });
      expect(res.statusCode, res.body).toBe(200);
      return Number(json<{ result: { value: number } }>(res).result.value);
    };
    const AMOUNT = { 1: 12000, 2: 30000, 3: 8000, 4: 5000, 5: 20000, 6: 15000, 7: 9000, 8: 7000, 9: 40000 } as const;
    const total = (...keys: (keyof typeof AMOUNT)[]): number => keys.reduce((sum, key) => sum + AMOUNT[key], 0);

    beforeAll(async () => {
      w = await world(dialect);
      await w.role('rep', {
        deals: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } },
        quotes: { actions: ['read'], rows: { read: OWN } },
        followups: { actions: ['read'], rows: { read: OWN } },
        tickets: { actions: ['read'], rows: { read: OWN } },
        deal_tickets: { actions: ['read', 'create', 'delete'] },
        companies: { actions: ['read'] },
      });
      await w.role('manager', { deals: { actions: ['read'], rows: { read: TEAM } }, followups: { actions: ['read'], rows: { read: TEAM } }, companies: { actions: ['read'] } });
      await w.role('reader', { deals: { actions: ['read', 'update'] }, quotes: { actions: ['read'] }, followups: { actions: ['read'] }, tickets: { actions: ['read'] }, deal_tickets: { actions: ['read', 'create', 'delete'] }, companies: { actions: ['read'] } });
      for (const person of ['dana', 'omar'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
      await w.give('lena', 'reader');
      await w.page('deals', ['rep', 'manager', 'reader']);
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('a value looked up through a link', () => {
      it('is empty when the row it points at is out of the reader\'s reach, and there for whoever reaches it', async () => {
        // Follow-up 4 is Dana's, under Omar's deal 3; follow-up 1 is hers under her own deal 1.
        const list = (who: PersonName) => get(who, data(`followups?order=id.asc&lookup=${encodeURIComponent('deal_title:deal_id.title')}`));
        const hers = rowsOf(await list('dana'));
        expect(hers.map((row) => [Number(row['id']), row['deal_title']])).toEqual([[1, 'Deal 1'], [4, null]]);
        expect(rowsOf(await list('lena')).map((row) => [Number(row['id']), row['deal_title']])).toEqual([[1, 'Deal 1'], [2, 'Deal 1'], [3, 'Deal 3'], [4, 'Deal 3']]);
        // One record, the same.
        const one = await get('dana', data(`followups/4?lookup=${encodeURIComponent('deal_title:deal_id.title')}`));
        expect(json<{ data: Record<string, unknown> }>(one).data['deal_title']).toBeNull();
        // Two links away: a follow-up's deal's company is read through the deal.
        const far = rowsOf(await get('dana', data(`followups?order=id.asc&lookup=${encodeURIComponent('company:deal_id.company_id.name')}`)));
        expect(far.map((row) => row['company'])).toEqual(['Harbour Hotels', null]);
      });
    });

    describe('a count and a sum over the rows that point at a record', () => {
      it('are over the rows the reader reaches', async () => {
        // Company 1 has deals 1, 3, 5, 7, 9; company 2 has 2, 4, 6, 8.
        const spec = encodeURIComponent('deals:deals.company_id:count');
        const counts = async (who: PersonName) => rowsOf(await get(who, data(`companies?order=id.asc&agg=${spec}`))).map((row) => Number(row['deals']));
        expect(await counts('dana')).toEqual([3, 1]);
        expect(await counts('mara')).toEqual([4, 2]);
        expect(await counts('lena')).toEqual([5, 4]);
        const compute = encodeURIComponent(JSON.stringify({ measures: [{ id: 'worth', table: w.id('deals'), fkColumn: 'company_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['amount'] }] } }] }));
        const sums = async (who: PersonName): Promise<number[]> => {
          const res = await get(who, data(`companies?order=id.asc&compute=${compute}`));
          expect(res.statusCode, res.body).toBe(200);
          return rowsOf(res).map((row) => Number(row['worth']));
        };
        expect(await sums('dana')).toEqual([total(1, 5, 9), total(2)]);
        expect(await sums('mara')).toEqual([total(1, 3, 5, 9), total(2, 4)]);
        expect(await sums('lena')).toEqual([total(1, 3, 5, 7, 9), total(2, 4, 6, 8)]);
        // Ordered by the figure: by the figure its reader is shown, not by the whole one.
        const ranked = rowsOf(await get('omar', data(`companies?agg=${spec}&order=deals.desc`))).map((row) => [Number(row['id']), Number(row['deals'])]);
        expect(ranked).toEqual([[1, 1], [2, 1]].sort((a, b) => b[1]! - a[1]! || a[0]! - b[0]!));
        // One record: its measures, and what points at it.
        const record = json<{ data: Record<string, unknown>; inboundCounts: { table: string; count: number }[] }>(await get('dana', data(`companies/1?agg=${spec}&include=inboundCounts`)));
        expect(Number(record.data['deals'])).toBe(3);
        expect(record.inboundCounts.find((count) => count.table === w.id('deals'))?.count).toBe(3);
        const whole = json<{ inboundCounts: { table: string; count: number }[] }>(await get('lena', data('companies/1?include=inboundCounts')));
        expect(whole.inboundCounts.find((count) => count.table === w.id('deals'))?.count).toBe(5);
        const references = json<{ references: { table: string; count: number }[] }>(await get('dana', data('companies/1/references'))).references;
        expect(references.find((count) => count.table === w.id('deals'))?.count).toBe(3);
      });
    });

    describe('the rows a record is linked to', () => {
      const relation = async (): Promise<string> => {
        const model = await w.model();
        return model.relations.find((one) => one.through !== null && one.from.tableId === w.id('deals') && one.to.tableId === w.id('tickets'))!.id;
      };

      it('are the linked rows the reader reaches: another is neither listed nor counted as "more"', async () => {
        const res = await get('dana', data(`deals/1/links/${encodeURIComponent(await relation())}`));
        expect(res.statusCode, res.body).toBe(200);
        const body = json<{ data: { key: string }[]; hasMore: boolean }>(res);
        // Deal 1 is linked to ticket 1 (hers) and ticket 2 (Omar's).
        expect(body.data.map((row) => row.key)).toEqual(['1']);
        expect(body.hasMore).toBe(false);
        expect(json<{ data: { key: string }[] }>(await get('lena', data(`deals/1/links/${encodeURIComponent(await relation())}`))).data.map((row) => row.key)).toEqual(['1', '2']);
      });

      it('and the record\'s history leaves out the keys of the others', async () => {
        const id = await relation();
        // Somebody nothing limits unlinks ticket 2 and links it again: two changes of the set, each keeping both keys.
        expect((await w.app.inject({ method: 'PATCH', url: `/api/v1/${data('deals/1')}`, headers: { cookie: await as('lena') }, payload: { values: {}, links: { [id]: [1] } } })).statusCode).toBe(200);
        expect((await w.app.inject({ method: 'PATCH', url: `/api/v1/${data('deals/1')}`, headers: { cookie: await as('lena') }, payload: { values: {}, links: { [id]: [1, 2] } } })).statusCode).toBe(200);
        const keysSeen = async (who: PersonName): Promise<string[][]> => {
          const entries = json<{ entries: { action: string; changes: { before?: { keys?: string[] }; after?: { keys?: string[] } } }[] }>(await get(who, data('deals/1/history'))).entries;
          return entries.filter((entry) => entry.action === 'record.links').flatMap((entry) => [entry.changes.before?.keys ?? [], entry.changes.after?.keys ?? []]);
        };
        expect((await keysSeen('lena')).some((keys) => keys.includes('2'))).toBe(true);
        const hers = await keysSeen('dana');
        expect(hers.length).toBeGreaterThan(0);
        expect(hers.every((keys) => !keys.includes('2'))).toBe(true);
        expect(hers.every((keys) => keys.includes('1'))).toBe(true);
      });
    });

    describe('which days are taken', () => {
      it('over a date column that is no booking rule\'s: the reader\'s own rows, and a colleague\'s key to leave out changes nothing', async () => {
        const days = async (who: PersonName, extra = ''): Promise<number[]> => {
          const res = await get(who, data(`deals/availability?column=close_on&from=2026-11-01&to=2026-12-01${extra}`));
          expect(res.statusCode, res.body).toBe(200);
          return json<{ taken: string[] }>(res).taken.map((instant) => Number(String(instant).slice(8, 10))).sort((a, b) => a - b);
        };
        expect(await days('dana')).toEqual([1, 2, 5, 9]);
        expect(await days('lena')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        // Leaving out Omar's deal 3 tells her nothing: it was never there for her.
        expect(await days('dana', '&exclude=3')).toEqual([1, 2, 5, 9]);
        expect(await days('dana', '&exclude=999')).toEqual([1, 2, 5, 9]);
        // Her own key is left out as asked.
        expect(await days('dana', '&exclude=2')).toEqual([1, 5, 9]);
        // An equality test on another column finds no colleague's row either.
        expect(await days('dana', `&resource=owner_id&resourceValue=${w.people.omar}`)).toEqual([]);
        expect(await days('dana', '&resource=amount&resourceValue=8000')).toEqual([]);
        expect(await days('lena', '&resource=amount&resourceValue=8000')).toEqual([3]);
      });
    });

    describe('which days are taken, by a rule of the table', () => {
      it('is asked of every row only for the rule\'s own columns: any other column, or any other column to test, is the reader\'s rows', async () => {
        const { availabilityIsOfRule } = await import('../src/crud/availability.js');
        const booked = { table: { booking: { start: 'starts_at', minutes: 'minutes', resource: 'clinician_id', kind: 'kind_id', countWhere: { column: 'status', values: ['booked'] }, closures: { table: 'public.closures', from: 'from_on', to: 'to_on' } } } } as never;
        expect(availabilityIsOfRule(booked, { instant: 'starts_at', resource: null })).toBe(true);
        expect(availabilityIsOfRule(booked, { instant: 'starts_at', resource: 'clinician_id' })).toBe(true);
        // A column the rule only mentions — the one it counts by, a closure's — is no reason to read every row.
        expect(availabilityIsOfRule(booked, { instant: 'starts_at', resource: 'status' })).toBe(false);
        expect(availabilityIsOfRule(booked, { instant: 'starts_at', resource: 'kind_id' })).toBe(false);
        expect(availabilityIsOfRule(booked, { instant: 'from_on', resource: null })).toBe(false);
        expect(availabilityIsOfRule(booked, { instant: 'created_at', resource: 'clinician_id' })).toBe(false);
        const slotted = { table: { capacity: { slot: 'slot_at', amount: 'guests', perSlot: 4, slotMinutes: 30, resource: 'room_id' }, capacityRules: [{ kind: 'slot', slot: 'slot_at', resource: 'room_id' }, { kind: 'parent' }] } } as never;
        expect(availabilityIsOfRule(slotted, { instant: 'slot_at', resource: 'room_id' })).toBe(true);
        expect(availabilityIsOfRule(slotted, { instant: 'slot_at', resource: 'guests' })).toBe(false);
        expect(availabilityIsOfRule({ table: {} } as never, { instant: 'close_on', resource: null })).toBe(false);
      });
    });

    describe('the search box', () => {
      it('finds the rows the searcher reaches', async () => {
        const found = async (who: PersonName, q: string): Promise<string[]> => {
          const res = await get(who, `search?q=${encodeURIComponent(q)}&types=record&limit=10`);
          expect(res.statusCode, res.body).toBe(200);
          return [...res.body.matchAll(/"label":"(Deal \d+)"/g)].map((match) => match[1]!).sort();
        };
        expect(await found('dana', 'Deal')).toEqual(['Deal 1', 'Deal 2', 'Deal 5', 'Deal 9']);
        expect(await found('dana', 'Deal 3')).toEqual([]);
        expect(await found('lena', 'Deal 3')).toEqual(['Deal 3']);
        expect(await found('mara', 'Deal')).toEqual(['Deal 1', 'Deal 2', 'Deal 3', 'Deal 4', 'Deal 5', 'Deal 9']);
      });
    });

    describe('a dashboard card', () => {
      it('adds up the rows its reader reaches, and two people of one role never share an answer', async () => {
        // Dana and Omar hold the same role: a cache kept by role would hand one the other's figure.
        expect(await sumOf('dana')).toBe(total(1, 2, 5, 9));
        expect(await sumOf('omar')).toBe(total(3, 4));
        expect(await sumOf('dana')).toBe(total(1, 2, 5, 9));
        expect(await sumOf('lena')).toBe(total(1, 2, 3, 4, 5, 6, 7, 8, 9));
        expect(await sumOf('owner')).toBe(total(1, 2, 3, 4, 5, 6, 7, 8, 9));
      });

      it('a change of team shows at the next request, not when the kept answer runs out', async () => {
        expect(await sumOf('mara')).toBe(total(1, 2, 3, 4, 5, 9));
        const north = (await teamsRepo(w.meta).findByName('North'))!;
        await teamsRepo(w.meta).removeMember(north.id, w.people.omar);
        expect(await sumOf('mara')).toBe(total(1, 2, 5, 9));
        await teamsRepo(w.meta).setMember(north.id, w.people.omar, false);
        expect(await sumOf('mara')).toBe(total(1, 2, 3, 4, 5, 9));
      });

      it('a plain grant taken from another of her roles is a new answer at once', async () => {
        // Dana also holds a role that reads every deal: nothing limits her.
        await w.role('wide', { deals: { actions: ['read'] } });
        await w.give('dana', 'wide');
        expect(await sumOf('dana')).toBe(total(1, 2, 3, 4, 5, 6, 7, 8, 9));
        // The same role ids, with the plain read taken off the role: her limit holds again, at the next request.
        const { permissionsRepo, rolesRepo } = await import('@adminium/meta');
        await permissionsRepo(w.meta).revoke((await rolesRepo(w.meta).findBySlug('wide'))!.id, 'table', `${w.connectionId}/${w.id('deals')}`);
        expect(await sumOf('dana')).toBe(total(1, 2, 5, 9));
        await w.take('dana', 'wide');
      });

      it('a key with a limited role adds up nothing, and finds nothing in the search box', async () => {
        const { apiKeysRepo, rolesRepo } = await import('@adminium/meta');
        const { generateApiKey } = await import('../src/rbac/api-keys.js');
        const token = generateApiKey();
        await apiKeysRepo(w.meta).create({ name: 'rep', tokenHash: token.tokenHash, prefix: token.prefix, roleId: (await rolesRepo(w.meta).findBySlug('rep'))!.id, createdBy: w.owner.id });
        const headers = { authorization: `Bearer ${token.key}` };
        const summed = await w.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers, payload: { descriptor: { connectionId: w.connectionId, source: source('deals'), shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }] } } });
        expect(summed.statusCode, summed.body).toBe(200);
        expect(Number(json<{ result: { value: number } }>(summed).result.value)).toBe(0);
        const searched = await w.app.inject({ method: 'GET', url: '/api/v1/search?q=Deal&types=record&limit=10', headers });
        expect(searched.body).not.toContain('"label":"Deal');
      });

      it('lists and counts her rows, groups them, and filters through a link she reaches', async () => {
        const list = json<{ result: { rows: { id: number }[]; total?: number } }>(await card('dana', { source: source('deals'), shape: 'record-list', select: ['id', 'title'], orderBy: [{ column: 'id', dir: 'asc' }] }));
        expect(list.result.rows.map((row) => Number(row.id))).toEqual([1, 2, 5, 9]);
        if (list.result.total !== undefined) expect(list.result.total).toBe(4);
        const grouped = await card('dana', { source: source('deals'), shape: 'categorical', groupBy: ['state'], aggregations: [{ fn: 'count', alias: 'n' }] });
        expect(grouped.statusCode, grouped.body).toBe(200);
        // Two open (1, 5) and two won (2, 9); none lost — Omar's deal 4 is the only lost one.
        expect(grouped.body).not.toContain('lost');
        // Follow-ups whose deal is open: follow-up 4 hangs off Omar's open deal 3, which is not hers to filter through.
        const through = await card('dana', { source: source('followups'), shape: 'record-list', select: ['id'], filters: [{ column: 'deal_id.state', op: 'eq', value: 'open' }], orderBy: [{ column: 'id', dir: 'asc' }] });
        expect(through.statusCode, through.body).toBe(200);
        expect(json<{ result: { rows: { id: number }[] } }>(through).result.rows.map((row) => Number(row.id))).toEqual([1]);
        const whole = await card('lena', { source: source('followups'), shape: 'record-list', select: ['id'], filters: [{ column: 'deal_id.state', op: 'eq', value: 'open' }], orderBy: [{ column: 'id', dir: 'asc' }] });
        expect(json<{ result: { rows: { id: number }[] } }>(whole).result.rows.map((row) => Number(row.id))).toEqual([1, 2, 3, 4]);
      });
    });

    describe('the assistant', () => {
      it('reads, samples and adds up the rows of the person it answers', async () => {
        const { readRowsTool, sampleRecordTool } = (await import('../src/assistant/tools/rows.js')) as unknown as Record<string, { run: (args: Record<string, unknown>, deps: unknown) => Promise<{ result?: { rows?: Record<string, unknown>[]; total?: number; record?: Record<string, unknown> | null }; error?: unknown }> }>;
        const { aggregateTool } = (await import('../src/assistant/tools/aggregate.js')) as unknown as Record<string, { run: (args: Record<string, unknown>, deps: unknown) => Promise<{ result?: unknown; error?: unknown }> }>;
        const { resolvePermissionSet, permissionSetAllows } = await import('../src/rbac/resolver.js');
        const depsFor = async (who: PersonName) => {
          const set = await resolvePermissionSet(w.meta, { kind: 'user', id: w.people[who], label: who });
          return {
            meta: w.meta,
            manager: w.manager,
            userId: w.people[who],
            rowData: true,
            locale: 'en_US',
            t: (key: string) => key,
            context: 'general',
            host: 'dashboard',
            can: async (permission: string) => permissionSetAllows(set, permission),
            canReadTable: async (connectionId: string) => async (tableId: string) => permissionSetAllows(set, `table:${connectionId}:${tableId}:read`),
          };
        };
        const read = readRowsTool ?? Object.values(await import('../src/assistant/tools/rows.js')).find((tool) => (tool as { name?: string }).name === 'read_rows');
        const sample = sampleRecordTool ?? Object.values(await import('../src/assistant/tools/rows.js')).find((tool) => (tool as { name?: string }).name === 'sample_record');
        const aggregate = aggregateTool ?? Object.values(await import('../src/assistant/tools/aggregate.js')).find((tool) => (tool as { name?: string }).name === 'aggregate');
        expect(read, 'read_rows').toBeDefined();
        const run = (tool: unknown, args: Record<string, unknown>, deps: unknown) => (tool as { run: (a: unknown, d: unknown) => Promise<{ result?: Record<string, unknown>; error?: unknown }> }).run(args, deps);
        const listed = await run(read, { connectionId: w.connectionId, table: w.id('deals'), columns: ['id', 'title'], sort: 'id.asc' }, await depsFor('dana'));
        expect(listed.error, JSON.stringify(listed.error)).toBeUndefined();
        expect(JSON.stringify(listed.result)).toContain('Deal 1');
        for (const hidden of ['Deal 3', 'Deal 4', 'Deal 6', 'Deal 7', 'Deal 8']) expect(JSON.stringify(listed.result)).not.toContain(hidden);
        expect(JSON.stringify(listed.result)).toMatch(/"total":4\b|"of":4\b|4 rows|"count":4\b/);
        const whole = await run(read, { connectionId: w.connectionId, table: w.id('deals'), columns: ['id', 'title'], sort: 'id.asc' }, await depsFor('lena'));
        expect(JSON.stringify(whole.result)).toContain('Deal 3');
        // A sample of a filter that names a colleague's row finds no row.
        const sampled = await run(sample, { connectionId: w.connectionId, table: w.id('deals'), where: { column: 'id', op: 'eq', value: 3 } }, await depsFor('dana'));
        expect((sampled.result as { record: unknown }).record).toBeNull();
        const own = await run(sample, { connectionId: w.connectionId, table: w.id('deals'), where: { column: 'id', op: 'eq', value: 1 } }, await depsFor('dana'));
        expect((own.result as { record: { title: string } }).record.title).toBe('Deal 1');
        const descriptor = { source: source('deals'), shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }] };
        const summed = await run(aggregate, { connectionId: w.connectionId, descriptor }, await depsFor('dana'));
        expect(summed.error, JSON.stringify(summed.error)).toBeUndefined();
        expect(JSON.stringify(summed.result)).toContain(String(total(1, 2, 5, 9)));
        const wholeSum = await run(aggregate, { connectionId: w.connectionId, descriptor }, await depsFor('lena'));
        expect(JSON.stringify(wholeSum.result)).toContain(String(total(1, 2, 3, 4, 5, 6, 7, 8, 9)));
        // Nobody behind the turn: no row of any table, said outright.
        const { rowsForAsker } = await import('../src/assistant/tools/row-reach.js');
        const { rowLimitFor } = await import('../src/crud/row-limit.js');
        const nobody = await rowsForAsker({ meta: w.meta, userId: null }, w.connectionId, await w.model());
        expect(nobody).not.toBeNull();
        const none = rowLimitFor(nobody!, w.id('companies'), 'read')!;
        expect(await w.db.selectFrom(w.id('companies')).select('id').where(none(w.db, 'companies')).execute()).toEqual([]);
      });
    });
  });
}

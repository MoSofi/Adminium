// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A board's headings and cards, and a chart grouped by a person, tell a
 * reader nothing their own rows do not: proved against the whole server on
 * every engine, in the row-limit world.
 *
 * The clock is the real one. Dana (a rep, her own rows) reaches deals 1, 2,
 * 5 and 9: her own two, and Lena's two that she covers. Mara (a manager, her
 * team's rows) reaches 1, 2, 3, 4, 5 and 9. Lena reads every deal.
 *
 *   deals       1 Dana open 12,000   2 Dana won 30,000   3 Omar open 8,000
 *               4 Omar lost 5,000    5 Lena open 20,000  6 Sam won 15,000
 *               7 nobody open 9,000  8 Sam open 7,000    9 Lena won 40,000
 *   companies   1 Harbour Hotels (odd deals)   2 Northfield Dental (even deals)
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a board and a chart name and count the reader's own reach [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName | 'owner', string>();
    const as = async (who: PersonName | 'owner'): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    type Reply = { statusCode: number; body: string };
    const get = async (who: PersonName | 'owner', url: string): Promise<Reply> => w.app.inject({ method: 'GET', url: `/api/v1/${url}`, headers: { cookie: await as(who) } });
    const post = async (who: PersonName | 'owner', url: string, payload: Record<string, unknown>): Promise<Reply> => w.app.inject({ method: 'POST', url: `/api/v1/${url}`, headers: { cookie: await as(who) }, payload });
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const source = (table: string) => ({ name: table, ...(dialect === 'postgres' ? { schema: 'public' } : {}) });
    const card = async (who: PersonName | 'owner', descriptor: Record<string, unknown>) => post(who, 'widget-data/query', { descriptor: { connectionId: w.connectionId, ...descriptor } });
    interface Group {
      key: string;
      label: string;
      value: number;
    }
    const byOwner = async (who: PersonName | 'owner'): Promise<{ groups: Group[]; body: string }> => {
      const res = await card(who, { source: source('deals'), shape: 'categorical', aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }], groupBy: ['owner_id'], limit: 50 });
      expect(res.statusCode, res.body).toBe(200);
      return { groups: json<{ result: { items: Group[] } }>(res).result.items, body: res.body };
    };
    const labels = (groups: Group[]): Record<string, number> => Object.fromEntries(groups.map((group) => [group.label, Number(group.value)]));
    /**
     * The day `n` days before today, where the business is. This world sets no zone of its own, so that is the zone the
     * server runs in: the calendar day here, not UTC's (the two differ for an hour or two around midnight, and a count
     * taken from UTC's day was then one short).
     */
    const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');

    beforeAll(async () => {
      w = await world(dialect);
      // When each deal entered its stage: a time, kept as each engine keeps one.
      await w.run(`ALTER TABLE deals ADD COLUMN staged_at ${dialect === 'postgres' ? 'TIMESTAMPTZ' : 'DATETIME'}`);
      await w.run(`ALTER TABLE deals ADD COLUMN staged_on DATE`);
      await w.run(`ALTER TABLE companies ADD COLUMN odds DECIMAL(4,2)`);
      await w.run(`UPDATE companies SET odds = 0.25 WHERE id = 1`);
      await w.run(`UPDATE companies SET odds = 0.9 WHERE id = 2`);
      for (const key of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        // Deal n entered its stage n × 3 days ago, at noon: a day no zone moves.
        const stamp = `${daysAgo(key * 3)} 12:00:00`;
        await w.run(`UPDATE deals SET staged_at = '${dialect === 'postgres' ? `${stamp}+00` : stamp}', staged_on = '${daysAgo(key * 3)}' WHERE id = ${String(key)}`);
      }
      await w.run(`UPDATE deals SET staged_at = NULL, staged_on = NULL WHERE id = 9`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      await w.role('rep', { deals: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } }, companies: { actions: ['read'] } });
      await w.role('manager', { deals: { actions: ['read'], rows: { read: TEAM } }, companies: { actions: ['read'] } });
      await w.role('reader', { deals: { actions: ['read'] }, companies: { actions: ['read'] } });
      await w.role('blind', { deals: { actions: ['read'] } });
      for (const person of ['dana', 'omar'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
      await w.give('lena', 'reader');
      await w.give('kim', 'blind');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('a group keyed by a staff column', () => {
      it('is called by the person\'s name for somebody no row limit holds, and never by an id', async () => {
        const { groups, body } = await byOwner('lena');
        expect(labels(groups)).toEqual({ Dana: 42000, Omar: 13000, Lena: 60000, Sam: 22000, '—': 9000 });
        // The key stays the id (a widget tells its groups apart by it); no label is one.
        for (const id of Object.values(w.people)) expect(groups.some((group) => group.label === id), body).toBe(false);
        expect(groups.find((group) => group.label === 'Dana')?.key).toBe(w.people.dana);
      });

      it('names only the people whose rows a rep reaches, with her own sums of them', async () => {
        const { groups, body } = await byOwner('dana');
        expect(labels(groups)).toEqual({ Dana: 42000, Lena: 60000 });
        for (const word of ['Omar', 'Sam', w.people.omar, w.people.sam, '13000', '22000', '9000']) expect(body, word).not.toContain(word);
      });

      it('names a manager\'s team and whoever else she reaches, and nobody of the other team she does not', async () => {
        const { groups, body } = await byOwner('mara');
        expect(labels(groups)).toEqual({ Dana: 42000, Omar: 13000, Lena: 60000 });
        for (const word of ['Sam', w.people.sam, '22000']) expect(body, word).not.toContain(word);
      });

      it('calls somebody the people list does not name "Unnamed person", not by their id and not by their name', async () => {
        await w.meta.db.updateTable('adminium_users').set({ status: 'suspended' } as never).where('id', '=', w.people.sam).execute();
        try {
          // A new answer, not the kept one: asked with another limit.
          const res = await card('lena', { source: source('deals'), shape: 'categorical', aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }], groupBy: ['owner_id'], limit: 49 });
          const groups = json<{ result: { items: Group[] } }>(res).result.items;
          expect(labels(groups)).toEqual({ Dana: 42000, Omar: 13000, Lena: 60000, 'Unnamed person': 22000, '—': 9000 });
          expect(res.body).not.toContain('"label":"Sam"');
          expect(groups.some((group) => group.label === w.people.sam)).toBe(false);
        } finally {
          await w.meta.db.updateTable('adminium_users').set({ status: 'active' } as never).where('id', '=', w.people.sam).execute();
        }
      });

      it('speaks the reader\'s language for the unnamed', async () => {
        await w.meta.db.updateTable('adminium_users').set({ status: 'invited' } as never).where('id', '=', w.people.omar).execute();
        try {
          const prefs = await w.app.inject({ method: 'PATCH', url: '/api/v1/me/prefs', headers: { cookie: await as('lena') }, payload: { locale: 'de-DE' } });
          // Where the preferences route is not this one, the word stays English: the claim is "never the id".
          const res = await card('lena', { source: source('deals'), shape: 'categorical', aggregations: [{ fn: 'count', alias: 'n' }], groupBy: ['owner_id'], limit: 48 });
          const groups = json<{ result: { items: Group[] } }>(res).result.items;
          const unnamed = groups.find((group) => group.key === w.people.omar);
          expect(unnamed?.label).toBe(prefs.statusCode === 200 ? 'Unbenannte Person' : 'Unnamed person');
        } finally {
          await w.meta.db.updateTable('adminium_users').set({ status: 'active' } as never).where('id', '=', w.people.omar).execute();
          await w.app.inject({ method: 'PATCH', url: '/api/v1/me/prefs', headers: { cookie: await as('lena') }, payload: { locale: 'en-US' } });
        }
      });

      it('still takes a link\'s own label, and refuses one asked of a staff column', async () => {
        const res = await card('lena', { source: source('deals'), shape: 'categorical', aggregations: [{ fn: 'count', alias: 'n' }], groupBy: ['owner_id'], groupLabel: 'owner_id.name' });
        expect(res.statusCode, res.body).toBe(422);
        const linked = await card('lena', { source: source('deals'), shape: 'categorical', aggregations: [{ fn: 'count', alias: 'n' }], groupBy: ['company_id'], groupLabel: 'company_id.name' });
        expect(json<{ result: { items: Group[] } }>(linked).result.items.map((group) => group.label).sort()).toEqual(['Harbour Hotels', 'Northfield Dental']);
      });
    });

    describe('the rows of a board\'s cards', () => {
      const cards = async (who: PersonName | 'owner', more: Record<string, unknown> = {}) =>
        card(who, {
          source: source('deals'),
          shape: 'record-list',
          select: ['id', 'title', 'owner_id', 'company_id', 'amount', 'staged_at', 'staged_on', 'close_on'],
          lookups: ['adm_card_link:company_id.name'],
          people: ['owner_id'],
          daysSince: ['adm_card_days:staged_at', 'days_on:staged_on'],
          orderBy: [{ column: 'id', dir: 'asc' }],
          limit: 50,
          ...more,
        });
      interface Listed {
        result: { rows: Record<string, unknown>[]; people?: Record<string, string> };
      }

      it('carry the name of each person in them and nobody else\'s', async () => {
        const all = json<Listed>(await cards('lena')).result;
        expect(all.people).toEqual({ [w.people.dana]: 'Dana', [w.people.omar]: 'Omar', [w.people.lena]: 'Lena', [w.people.sam]: 'Sam' });
        const hers = await cards('dana');
        expect(hers.statusCode, hers.body).toBe(200);
        expect(json<Listed>(hers).result.people).toEqual({ [w.people.dana]: 'Dana', [w.people.lena]: 'Lena' });
        expect(json<Listed>(hers).result.rows.map((row) => Number(row['id']))).toEqual([1, 2, 5, 9]);
        for (const word of ['Omar', 'Sam', 'Mara', 'Kim', w.people.omar, w.people.sam]) expect(hers.body, word).not.toContain(word);
        const team = json<Listed>(await cards('mara')).result;
        expect(Object.values(team.people ?? {}).sort()).toEqual(['Dana', 'Lena', 'Omar']);
      });

      it('count the days by the server\'s clock, from a time and from a day alike', async () => {
        const rows = json<Listed>(await cards('lena')).result.rows;
        expect(rows.map((row) => [Number(row['id']), row['adm_card_days'], row['days_on']])).toEqual([
          [1, 3, 3],
          [2, 6, 6],
          [3, 9, 9],
          [4, 12, 12],
          [5, 15, 15],
          [6, 18, 18],
          [7, 21, 21],
          [8, 24, 24],
          // No date: no figure, never a zero.
          [9, null, null],
        ]);
        // A day still to come counts none.
        const ahead = json<Listed>(await cards('lena', { daysSince: ['until:close_on'], select: ['id', 'close_on', 'owner_id', 'company_id'] })).result.rows;
        expect(new Set(ahead.map((row) => row['until']))).toEqual(new Set([0]));
      });

      it('give a name looked up through a link only to whoever reads that table', async () => {
        expect(json<Listed>(await cards('lena')).result.rows[0]?.['adm_card_link']).toBe('Harbour Hotels');
        // Kim's role reads deals and not companies: the card's company is empty, and the board is still hers.
        const blind = await cards('kim');
        expect(blind.statusCode, blind.body).toBe(200);
        expect(new Set(json<Listed>(blind).result.rows.map((row) => row['adm_card_link']))).toEqual(new Set([null]));
        expect(blind.body).not.toContain('Harbour');
      });

      it('refuse a name of a column that holds no staff member, days of a column that is no date, and either on another shape', async () => {
        expect((await cards('lena', { people: ['title'] })).statusCode).toBe(422);
        expect((await cards('lena', { people: ['nope'] })).statusCode).toBe(422);
        expect((await cards('lena', { daysSince: ['d:title'] })).statusCode).toBe(422);
        expect((await cards('lena', { daysSince: ['amount:staged_at'] })).statusCode).toBe(422);
        expect((await cards('lena', { select: ['id', 'title'], lookups: undefined, daysSince: undefined })).statusCode).toBe(422);
        const chart = await card('lena', { source: source('deals'), shape: 'categorical', aggregations: [{ fn: 'count', alias: 'n' }], groupBy: ['state'], people: ['owner_id'] });
        expect(chart.statusCode, chart.body).toBe(422);
      });

      it('give no name of a staff column the reader\'s role does not show', async () => {
        const roleId = (await rolesRepo(w.meta).findBySlug('blind'))!.id;
        const deals = w.id('deals');
        const all = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema).tables.find((one) => one.id === deals)!.columns.map((column) => column.name);
        await permissionsRepo(w.meta).grant(roleId, 'table', `${w.connectionId}/${deals}`, { read: true, create: false, update: false, delete: false, export: false, import: false, readLimit: { readable: all.filter((name) => name !== 'owner_id') } } as never);
        const res = await cards('kim', { lookups: undefined, daysSince: undefined });
        // Refused by name, as any read of a column a role does not show is: no row, no person.
        expect([403, 422]).toContain(res.statusCode);
        expect(res.body).not.toContain('Dana');
      });
    });

    describe('a board\'s headings', () => {
      const compute = JSON.stringify({
        measures: [
          { id: 'board_count', table: 'deals', fkColumn: 'company_id', fn: 'count', where: [{ column: 'state', in: ['open'] }] },
          { id: 'board_total_0', table: 'deals', fkColumn: 'company_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['amount'] }] }, where: [{ column: 'state', in: ['open'] }] },
          { id: 'board_total_1', table: 'deals', fkColumn: 'company_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['amount'] }] } },
        ],
      });
      const headings = async (who: PersonName) => {
        const res = await get(who, `data/${w.connectionId}/companies?select=id,name,odds&order=id.asc&compute=${encodeURIComponent(compute.replace(/"table":"deals"/g, `"table":"${w.id('deals')}"`))}`);
        expect(res.statusCode, res.body).toBe(200);
        return json<{ data: Record<string, unknown>[] }>(res).data.map((row) => [Number(row['id']), Number(row['odds']), Number(row['board_count']), Number(row['board_total_0'] ?? 0), Number(row['board_total_1'] ?? 0)]);
      };

      it('hold a count, a total and a second total of the cards the reader reaches, beside the badge read from the column\'s own row', async () => {
        // Everything: Harbour has the odd deals (open 1, 3, 5, 7), Northfield the even (open 8).
        expect(await headings('lena')).toEqual([
          [1, 0.25, 4, 49000, 89000],
          [2, 0.9, 1, 7000, 57000],
        ]);
        // Dana: 1 and 5 open at Harbour, 9 won there; 2 won at Northfield.
        expect(await headings('dana')).toEqual([
          [1, 0.25, 2, 32000, 72000],
          [2, 0.9, 0, 0, 30000],
        ]);
        // Mara: 1, 3, 5 open and 9 won at Harbour; 2 won and 4 lost at Northfield.
        expect(await headings('mara')).toEqual([
          [1, 0.25, 3, 40000, 80000],
          [2, 0.9, 0, 0, 35000],
        ]);
      });
    });

    describe('a whole team\'s figures', () => {
      const year = new Date().getUTCFullYear();
      let targets: string;
      const team = (more: Record<string, unknown> = {}) => ({
        owner: 'owner_id',
        figures: [
          { key: 'open', fn: 'count', where: [{ column: 'state', in: ['open'] }] },
          { key: 'pipeline', fn: 'sum', column: 'amount', where: [{ column: 'state', in: ['open'] }] },
          { key: 'booked', fn: 'sum', column: 'amount', where: [{ column: 'state', in: ['won'] }], thisYear: 'close_on' },
        ],
        target: { table: targets, owner: 'rep_id', column: 'amount', year: 'year' },
        cover: ['pipeline', 'booked'],
        ...more,
      });
      const figures = (who: PersonName | 'owner', shape: 'single-metric' | 'record-list', more: Record<string, unknown> = {}, descriptor: Record<string, unknown> = {}) =>
        card(who, { kind: 'team-figures', source: source('deals'), shape, team: team(more), ...descriptor });
      /** Nothing of the team in a refusal: no amount, no target, no cover, nobody's name. */
      const SECRETS = ['84000', '52000', '100000', '44000', '280000', '56000', '55000', '111000', '12000', '0.39', '0.6', 'Dana', 'Omar', 'Lena', 'Sam'];
      const refusedWhole = (res: Reply): void => {
        expect(res.statusCode, res.body).toBe(403);
        expect(json<{ error: { code: string } }>(res).error.code).toBe('TEAM_FIGURE_WHOLE_ONLY');
        for (const word of SECRETS) expect(res.body, word).not.toContain(word);
      };

      beforeAll(async () => {
        await w.run(`CREATE TABLE targets (id INTEGER PRIMARY KEY, rep_id VARCHAR(36), year INTEGER NOT NULL, amount INTEGER NOT NULL)`);
        const goals: [number, PersonName, number, number][] = [
          [1, 'dana', year, 84000],
          [2, 'omar', year, 52000],
          [3, 'lena', year, 100000],
          [4, 'sam', year, 44000],
          // Last year's is not this year's target.
          [5, 'dana', year - 1, 1],
        ];
        for (const [key, who, of, amount] of goals) await w.run(`INSERT INTO targets (id, rep_id, year, amount) VALUES (${String(key)}, '${w.people[who]}', ${String(of)}, ${String(amount)})`);
        // Every deal closes this June, but Dana's won deal 2, which closed last year.
        for (const key of [1, 3, 4, 5, 6, 7, 8, 9]) await w.run(`UPDATE deals SET close_on = '${String(year)}-06-0${String(key)}' WHERE id = ${String(key)}`);
        await w.run(`UPDATE deals SET close_on = '${String(year - 1)}-06-02' WHERE id = 2`);
        await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
        targets = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema).tables.find((one) => one.name === 'targets')!.id;
        await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.staff', tableName: targets, columnName: 'rep_id', value: { staff: true }, origin: 'user' });
        await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'table.belongs', tableName: targets, value: { ways: [{ column: 'rep_id', set: 'team' }] }, origin: 'user' });
        const grant = async (slug: string, rowLimit?: Record<string, unknown>): Promise<void> => {
          const role = (await rolesRepo(w.meta).findBySlug(slug)) ?? (await rolesRepo(w.meta).create({ slug, name: slug }));
          await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${targets}`, { read: true, create: false, update: false, delete: false, export: false, import: false, ...(rowLimit === undefined ? {} : { rowLimit }) } as never);
        };
        await grant('rep', { read: OWN });
        await grant('manager', { read: TEAM });
        await grant('reader');
        // Reads every deal, and of the targets only their own.
        await w.role('half', { deals: { actions: ['read'] } });
        await grant('half', { read: OWN });
        await w.give('sam', 'half');
      }, 120_000);

      it('are answered whole to somebody no row limit holds: a line a person, the team\'s line, and the cover', async () => {
        const res = await figures('lena', 'record-list');
        expect(res.statusCode, res.body).toBe(200);
        const { rows, totals, total } = json<{ result: { rows: Record<string, unknown>[]; totals: Record<string, number | null>; total: number } }>(res).result;
        const lines = rows.map((row) => [row['name'], Number(row['open']), Number(row['pipeline']), Number(row['booked']), row['target'] === null ? null : Number(row['target']), row['cover'] === null ? null : Number(Number(row['cover']).toFixed(4))]);
        expect(lines).toEqual([
          // Deal 2 closed last year: it is not booked this year. Last year's target is not this year's.
          ['Dana', 1, 12000, 0, 84000, 0.1429],
          ['Lena', 1, 20000, 40000, 100000, 0.6],
          ['Omar', 1, 8000, 0, 52000, 0.1538],
          ['Sam', 1, 7000, 15000, 44000, 0.5],
          // Nobody's deal 7 is a line of its own, so the lines add up to the team's.
          ['—', 1, 9000, 0, null, null],
        ]);
        expect(total).toBe(5);
        expect({ ...totals, cover: Number(Number(totals['cover']).toFixed(4)) }).toEqual({ open: 5, pipeline: 56000, booked: 55000, target: 280000, cover: 0.3964 });
        // No line is called by an id.
        for (const id of Object.values(w.people)) expect(rows.some((row) => row['name'] === id)).toBe(false);
        const one = await figures('lena', 'single-metric');
        expect(Number(json<{ result: { value: number } }>(one).result.value.toFixed(4))).toBe(0.3964);
        expect(json<{ result: { value: number } }>(await figures('lena', 'single-metric', { metric: 'pipeline' })).result.value).toBe(56000);
        expect(json<{ result: { value: number } }>(await figures('owner', 'single-metric', { metric: 'target' })).result.value).toBe(280000);
      });

      it('are refused to a rep held to her own rows, with nothing of the team in the refusal', async () => {
        refusedWhole(await figures('dana', 'record-list'));
        refusedWhole(await figures('dana', 'single-metric'));
        refusedWhole(await figures('dana', 'single-metric', { metric: 'pipeline' }));
        // Not her own figure under the team's name either: there is no figure at all.
        expect((await figures('dana', 'single-metric')).body).not.toContain('"value"');
      });

      it('are refused to a manager held to her team\'s rows', async () => {
        refusedWhole(await figures('mara', 'record-list'));
        refusedWhole(await figures('mara', 'single-metric'));
      });

      it('are refused to somebody who reads every deal and only their own target, and with no target asked are theirs to have', async () => {
        refusedWhole(await figures('sam', 'record-list'));
        refusedWhole(await figures('sam', 'single-metric', { metric: 'target' }));
        // The deals alone are a table no limit holds for them: the same sums any list of theirs adds up to.
        const deals = await figures('sam', 'single-metric', { target: undefined, cover: undefined, metric: 'pipeline' });
        expect(json<{ result: { value: number } }>(deals).result.value).toBe(56000);
      });

      it('are refused to somebody whose role does not read the targets at all', async () => {
        const res = await figures('kim', 'record-list');
        expect(res.statusCode, res.body).toBe(403);
        expect(json<{ error: { code: string } }>(res).error.code).toBe('TABLE_FORBIDDEN');
        for (const word of SECRETS) expect(res.body, word).not.toContain(word);
      });

      it('are never served from another reader\'s kept answer, and a batch refuses the one card alone', async () => {
        // Lena's answer is kept for thirty seconds; Dana asks the very same thing.
        expect((await figures('lena', 'single-metric')).statusCode).toBe(200);
        refusedWhole(await figures('dana', 'single-metric'));
        const batch = await post('dana', 'widget-data/batch', {
          requests: [
            { instanceId: 'cover', descriptor: { connectionId: w.connectionId, kind: 'team-figures', source: source('deals'), shape: 'single-metric', team: team() } },
            { instanceId: 'mine', descriptor: { connectionId: w.connectionId, source: source('deals'), shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }] } },
          ],
        });
        const results = json<{ results: Record<string, { ok: boolean; error?: { code: string }; result?: { value: number } }> }>(batch).results;
        expect(results['cover']).toMatchObject({ ok: false, error: { code: 'TEAM_FIGURE_WHOLE_ONLY', statusCode: 403 } });
        // Her own card beside it is still hers: deals 1, 2, 5 and 9.
        expect(Number(results['mine']?.result?.value)).toBe(102000);
      });

      it('give no cover where there is no target, and no figure where a column is not a number or the owner no staff column', async () => {
        const none = await figures('lena', 'single-metric', { target: { table: targets, owner: 'rep_id', column: 'amount', year: 'id' } });
        // Nobody's target is kept under a "year" that is a row number: no target, so no cover, and that is no zero.
        expect(json<{ result: { value: number | null } }>(none).result.value).toBeNull();
        expect((await figures('lena', 'record-list', { owner: 'title' })).statusCode).toBe(422);
        expect((await figures('lena', 'record-list', { figures: [{ key: 'bad', fn: 'sum', column: 'title' }], cover: undefined })).statusCode).toBe(422);
        expect((await figures('lena', 'record-list', { figures: [{ key: 'bad', fn: 'count', thisYear: 'staged_at' }], cover: undefined })).statusCode).toBe(422);
        expect((await figures('lena', 'record-list', {}, { filters: [{ column: 'state', op: 'eq', value: 'open' }] })).statusCode).toBe(422);
        expect((await card('lena', { kind: 'team-figures', source: source('deals'), shape: 'categorical', team: team() })).statusCode).toBe(422);
        expect((await card('lena', { kind: 'team-figures', source: source('deals'), shape: 'record-list' })).statusCode).toBe(422);
      });

      it('name nobody the people list does not name', async () => {
        await w.meta.db.updateTable('adminium_users').set({ status: 'suspended' } as never).where('id', '=', w.people.omar).execute();
        try {
          const res = await figures('lena', 'record-list', {}, { limit: 199 });
          const names = json<{ result: { rows: Record<string, unknown>[] } }>(res).result.rows.map((row) => row['name']);
          expect(names).toEqual(['Dana', 'Lena', 'Sam', 'Unnamed person', '—']);
          expect(res.body).not.toContain('"name":"Omar"');
        } finally {
          await w.meta.db.updateTable('adminium_users').set({ status: 'active' } as never).where('id', '=', w.people.omar).execute();
        }
      });
    });

    it('keeps the staff column marked after the tables are read again', async () => {
      // The world marks its staff columns by override; the extra columns above must not have cost that.
      const deals = w.id('deals');
      const marked = (await overridesRepo(w.meta).listForConnection(w.connectionId, { status: 'active' })).some((one) => one.op === 'column.staff' && one.tableName === deals && one.columnName === 'owner_id');
      expect(marked).toBe(true);
    });
  });
}

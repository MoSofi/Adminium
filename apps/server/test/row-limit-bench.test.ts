// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a row limit costs a list: the 14-deal list and
 * a 50,000-row one, read through the whole server as somebody nothing limits
 * ("before": the query the server has always run) and as a rep, a manager
 * and a reader of a table that hangs off the limited one ("after").
 *
 * Not a test of right and wrong: it runs only when ROW_LIMIT_BENCH is set,
 * prints its table, and asserts nothing but that every request answered.
 *
 *   ROW_LIMIT_BENCH=1 pnpm exec vitest run test/row-limit-bench.test.ts
 */
import { usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const BENCH = process.env.ROW_LIMIT_BENCH === '1';
const ROWS = 50_000;
/** A new filter value for every card asked, in the whole run: no answer is a kept one. */
let asked = 0;
const RUNS = 15;
const OWN = { reach: 'own' } as const;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!BENCH || !available)(`what a row limit costs a list [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<string, string>();
    const as = async (who: PersonName | 'owner'): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    /** Median milliseconds of a GET, after one warm-up. */
    const time = async (who: PersonName | 'owner', path: string): Promise<{ ms: number; rows: number; total: number | null }> => {
      const cookie = await as(who);
      const once = () => w.app.inject({ method: 'GET', url: `/api/v1/${path}`, headers: { cookie } });
      const first = await once();
      expect(first.statusCode, first.body.slice(0, 300)).toBe(200);
      const took: number[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        const at = performance.now();
        await once();
        took.push(performance.now() - at);
      }
      took.sort((a, b) => a - b);
      const body = JSON.parse(first.body) as { data: unknown[]; page?: { total: number | null } };
      return { ms: took[Math.floor(RUNS / 2)]!, rows: body.data.length, total: body.page?.total ?? null };
    };
    const lines: string[] = [];
    const say = (what: string, who: string, result: { ms: number; rows: number; total: number | null }) => lines.push(`| ${what} | ${who} | ${result.ms.toFixed(1)} | ${String(result.rows)} | ${String(result.total)} |`);

    beforeAll(async () => {
      w = await world(dialect);
    }, 120_000);
    afterAll(async () => {
      console.log(`\n### ${dialect}\n\n| List | As | Median ms | Rows | Total |\n|---|---|---|---|---|\n${lines.join('\n')}\n`);
      await w?.close();
    });

    it('measures', async () => {
      // Five more deals: the sample's board is fourteen.
      for (let key = 10; key <= 14; key += 1) await w.run(`INSERT INTO deals (id, title, owner_id, state, amount, big, company_id) VALUES (${String(key)}, 'Deal ${String(key)}', '${w.people.dana}', 'open', 1000, ${dialect === 'postgres' ? 'false' : '0'}, 1)`);
      // Fifty thousand deals among fifty people, each with a quote; Dana owns a fiftieth, and Mara's team of twenty a good part.
      const users = usersRepo(w.meta);
      const owners = [w.people.dana, w.people.omar];
      for (let i = 0; i < 48; i += 1) owners.push((await users.create({ email: `p${String(i)}@firm.test`, name: `P${String(i)}`, passwordHash: 'x' })).id);
      const { teamsRepo } = await import('@adminium/meta');
      const north = (await teamsRepo(w.meta).findByName('North'))!;
      for (const id of owners.slice(2, 20)) await teamsRepo(w.meta).setMember(north.id, id, false);
      await w.run(`CREATE TABLE big_deals (id INTEGER PRIMARY KEY, title VARCHAR(80) NOT NULL, owner_id VARCHAR(36), state VARCHAR(10) NOT NULL, amount INTEGER NOT NULL)`);
      await w.run(`CREATE TABLE big_quotes (id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL, total INTEGER NOT NULL, FOREIGN KEY (deal_id) REFERENCES big_deals(id))`);
      for (let at = 0; at < ROWS; at += 1000) {
        const deals: string[] = [];
        const quotes: string[] = [];
        for (let i = at + 1; i <= at + 1000; i += 1) {
          deals.push(`(${String(i)}, 'Deal ${String(i)}', '${owners[i % owners.length]!}', '${i % 3 === 0 ? 'won' : 'open'}', ${String(1000 + (i % 977))})`);
          quotes.push(`(${String(i)}, ${String(i)}, ${String(i % 500)})`);
        }
        await w.run(`INSERT INTO big_deals (id, title, owner_id, state, amount) VALUES ${deals.join(', ')}`);
        await w.run(`INSERT INTO big_quotes (id, deal_id, total) VALUES ${quotes.join(', ')}`);
      }
      await w.run('CREATE INDEX big_quotes_deal ON big_quotes (deal_id)');
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      const { overridesRepo } = await import('@adminium/meta');
      const id = (name: string) => (dialect === 'sqlite' ? `main.${name}` : dialect === 'postgres' ? `public.${name}` : w.id('deals').replace(/deals$/, name));
      const overrides = overridesRepo(w.meta);
      await overrides.create({ connectionId: w.connectionId, op: 'column.staff', tableName: id('big_deals'), columnName: 'owner_id', value: { staff: true }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'table.belongs', tableName: id('big_deals'), value: { ways: [{ column: 'owner_id' }] }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'table.belongs', tableName: id('big_quotes'), value: { ways: [{ via: 'deal_id' }] }, origin: 'user' });
      const { permissionsRepo, rolesRepo } = await import('@adminium/meta');
      const grant = async (slug: string, table: string, rowLimit?: unknown) => {
        const role = (await rolesRepo(w.meta).findBySlug(slug)) ?? (await rolesRepo(w.meta).create({ slug, name: slug }));
        await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${id(table)}`, { read: true, create: false, update: false, delete: false, export: false, import: false, ...(rowLimit === undefined ? {} : { rowLimit }) } as never);
      };
      for (const table of ['deals', 'quotes', 'big_deals', 'big_quotes']) await grant('bench-all', table);
      for (const table of ['deals', 'quotes', 'big_deals', 'big_quotes']) await grant('bench-own', table, { read: OWN });
      for (const table of ['deals', 'big_deals']) await grant('bench-team', table, { read: { reach: 'team' } });
      await w.give('lena', 'bench-all');
      await w.give('dana', 'bench-own');
      await w.give('mara', 'bench-team');

      const data = `data/${w.connectionId}`;
      for (const [label, index] of [['no index on the owner', false], ['an index on the owner', true]] as const) {
        if (index) await w.run('CREATE INDEX big_deals_owner ON big_deals (owner_id)');
        const tag = (what: string) => `${what} (${label})`;
        if (!index) {
          say('14 deals, page of 50, exact count', 'nothing limits them', await time('lena', `${data}/deals?order=id.asc`));
          say('14 deals, page of 50, exact count', 'a rep (own)', await time('dana', `${data}/deals?order=id.asc`));
          say('14 deals, page of 50, exact count', 'a manager (team of 20)', await time('mara', `${data}/deals?order=id.asc`));
          say('5 quotes through their deal', 'nothing limits them', await time('lena', `${data}/quotes?order=id.asc`));
          say('5 quotes through their deal', 'a rep (own)', await time('dana', `${data}/quotes?order=id.asc`));
        }
        say(tag('50,000 deals, page of 50, exact count'), 'nothing limits them', await time('lena', `${data}/big_deals?order=id.asc`));
        say(tag('50,000 deals, page of 50, exact count'), 'a rep (own: 1,000 rows)', await time('dana', `${data}/big_deals?order=id.asc`));
        say(tag('50,000 deals, page of 50, exact count'), 'a manager (team of 20: 20,000 rows)', await time('mara', `${data}/big_deals?order=id.asc`));
        say(tag('50,000 deals, page of 50, no count'), 'nothing limits them', await time('lena', `${data}/big_deals?order=id.asc&count=none`));
        say(tag('50,000 deals, page of 50, no count'), 'a rep (own)', await time('dana', `${data}/big_deals?order=id.asc&count=none`));
        say(tag('50,000 deals, page 400 by offset, no count'), 'a rep (own)', await time('dana', `${data}/big_deals?order=id.asc&count=none&offset=900`));
        say(tag('50,000 deals, search "Deal 49", exact count'), 'nothing limits them', await time('lena', `${data}/big_deals?order=id.asc&q=Deal%2049`));
        say(tag('50,000 deals, search "Deal 49", exact count'), 'a rep (own)', await time('dana', `${data}/big_deals?order=id.asc&q=Deal%2049`));
        say(tag('50,000 quotes through their deal, page of 50, exact count'), 'nothing limits them', await time('lena', `${data}/big_quotes?order=id.asc`));
        say(tag('50,000 quotes through their deal, page of 50, exact count'), 'a rep (own)', await time('dana', `${data}/big_quotes?order=id.asc`));
        say(tag('one deal by its key'), 'nothing limits them', await time('lena', `${data}/big_deals/50`).catch(() => ({ ms: NaN, rows: 0, total: null })));
        // T07: a count over the rows that point at each listed row, a value looked up through a link, and a card's sum.
        const agg = encodeURIComponent('quotes:big_quotes.deal_id:count');
        say(tag('50,000 deals, page of 50, each with a count of its quotes'), 'nothing limits them', await time('lena', `${data}/big_deals?order=id.asc&count=none&agg=${agg}`));
        say(tag('50,000 deals, page of 50, each with a count of its quotes'), 'a rep (own)', await time('dana', `${data}/big_deals?order=id.asc&count=none&agg=${agg}`));
        const lookup = encodeURIComponent('deal_title:deal_id.title');
        say(tag('50,000 quotes, page of 50, each with its deal\'s title'), 'nothing limits them', await time('lena', `${data}/big_quotes?order=id.asc&count=none&lookup=${lookup}`));
        say(tag('50,000 quotes, page of 50, each with its deal\'s title'), 'a rep (own)', await time('dana', `${data}/big_quotes?order=id.asc&count=none&lookup=${lookup}`));
        const card = async (who: PersonName, what: string, descriptor: Record<string, unknown>, as: string) => {
          const cookie = (await w.signIn(who)).cookie;
          // A new filter value each time, so the card's 30-second cache never answers.
          const once = () => w.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie }, payload: { descriptor: { connectionId: w.connectionId, ...descriptor, filters: [{ column: 'id', op: 'gte', value: -(asked += 1) }] } } });
          const first = await once();
          expect(first.statusCode, first.body.slice(0, 300)).toBe(200);
          const took: number[] = [];
          for (let i = 0; i < RUNS; i += 1) {
            const at = performance.now();
            await once();
            took.push(performance.now() - at);
          }
          took.sort((a, b) => a - b);
          lines.push(`| ${tag(what)} | ${as} | ${took[Math.floor(RUNS / 2)]!.toFixed(1)} | - | ${JSON.stringify((JSON.parse(first.body) as { result: { value?: unknown } }).result.value ?? '')} |`);
        };
        const sum = { source: { name: 'big_deals' }, shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }] };
        await card('lena', 'a card: the sum of 50,000 deals', sum, 'nothing limits them');
        await card('dana', 'a card: the sum of 50,000 deals', sum, 'a rep (own)');
        await card('mara', 'a card: the sum of 50,000 deals', sum, 'a manager (team of 20)');
        const byState = { source: { name: 'big_deals' }, shape: 'categorical', groupBy: ['state'], aggregations: [{ fn: 'count', alias: 'n' }] };
        await card('lena', 'a card: 50,000 deals counted by state', byState, 'nothing limits them');
        await card('dana', 'a card: 50,000 deals counted by state', byState, 'a rep (own)');
      }
    }, 900_000);
  });
}

describe.skipIf(BENCH)('the row-limit bench', () => {
  it('runs only when asked (ROW_LIMIT_BENCH=1)', () => {
    expect(BENCH).toBe(false);
  });
});

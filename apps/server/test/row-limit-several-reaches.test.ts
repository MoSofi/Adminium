// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ACCOUNT MANAGER ON A DEAL HE IS ON, against the whole server on every
 * engine: several reaches for one action, and a listing that counts only
 * while a column of it holds a value.
 *
 * Kim is the account manager. His role reads every WON deal, and an open
 * deal only while he is listed on it — two reaches for one read, either
 * enough. He is listed on Dana's open deal 1, and was on Omar's open deal 3
 * until his row there was ended (`ended_on` set): a member row whose end is
 * set lists nobody. So he reads deals 1, 2, 6 and 9, the quote of deal 1,
 * and the comments of deal 1; he comments on deal 1 and on no other.
 *
 * Around him, the firm of `row-limit-world.ts`: two teams (North led by
 * Mara with Dana and Omar; South led by Lena with Sam), a rep in each, a
 * manager of one, and Lena, whom nothing limits. Every door a row can leave
 * by is asked as Kim: the list and the record, a lookup, the search box, a
 * dashboard figure (and its cache), a record's history, its files, the live
 * frames, a file out, the console's record page and the role editor,
 * comments and the people they mention.
 */
import { notificationsRepo, overridesRepo, rolesRepo, type RowReach } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { rowLimitFor } from '../src/crud/row-limit.js';
import { widgetDataChannel, type RealtimeEvent } from '../src/realtime/hub.js';
import { orderedSink, readLimitedFrames } from '../src/realtime/read-frames.js';
import { rowReachesOf } from '../src/rbac/row-limits.js';
import { BELONGS, ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;
const WON: RowReach = { reach: 'all', while: { column: 'state', in: ['won'] } };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const AMOUNT = { 1: 12000, 2: 30000, 3: 8000, 4: 5000, 5: 20000, 6: 15000, 7: 9000, 8: 7000, 9: 40000 } as const;

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string };
type Frame = { type: string; pk: Record<string, unknown> | null; row: Record<string, unknown> | null; changed?: true };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`the account manager on a deal he is on [${dialect}]`, () => {
    let w: World;
    let comments = '';
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) });
    const get = (who: Who, url: string) => call(who, 'GET', url);
    const data = (path: string): string => `data/${w.connectionId}/${path}`;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const ids = (res: Reply): number[] => json<{ data: { id: unknown }[] }>(res).data.map((row) => Number(row.id));
    const t = (name: string): string => encodeURIComponent(name === 'comments' ? comments : w.id(name as Parameters<World['id']>[0]));
    const deals = (): string => t('deals');
    /** A missing row and an unreached one, told apart by nothing but the key. */
    const shape = (res: Reply, key: number): unknown => ({ status: res.statusCode, body: res.body.replace(new RegExp(`\\b${String(key)}\\b`, 'g'), 'KEY').replace(/req_[0-9a-zA-Z]+/g, 'REQ') });
    const reason = (res: Reply): unknown => json<{ error?: { details?: { reason?: unknown } } }>(res).error?.details?.reason;
    const source = (table: Parameters<World['id']>[0]) => ({ name: table, ...(w.id(table).includes('.') && dialect === 'postgres' ? { schema: 'public' } : {}) });
    const card = (who: Who, descriptor: Record<string, unknown>) => call(who, 'POST', 'widget-data/query', { descriptor: { connectionId: w.connectionId, ...descriptor } });
    const figures = async (who: Who): Promise<{ n: number; total: number }> => {
      const counted = await card(who, { source: source('deals'), shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }] });
      const summed = await card(who, { source: source('deals'), shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }] });
      expect(counted.statusCode, counted.body).toBe(200);
      return { n: Number(json<{ result: { value: number } }>(counted).result.value), total: Number(json<{ result: { value: number } }>(summed).result.value) };
    };
    const found = async (who: Who, q: string): Promise<string[]> => {
      const res = await get(who, `search?q=${encodeURIComponent(q)}&types=record&limit=10`);
      expect(res.statusCode, res.body).toBe(200);
      return [...res.body.matchAll(/"label":"(Deal \d+)"/g)].map((match) => match[1]!).sort();
    };
    const sum = (...keys: (keyof typeof AMOUNT)[]): number => keys.reduce((total, key) => total + AMOUNT[key], 0);
    /** Who Kim reaches, as the test every read carries asks it: the business's day is the real one here. */
    const kimReaches = async (): Promise<number[] | 'all'> => w.reached(await w.setOf('kim'), 'deals', 'read', new Date().toISOString().slice(0, 10));
    /** The deals way that goes through the listing, with whatever it counts only while. */
    const listingWhile = async (when: Record<string, unknown> | null): Promise<void> => {
      const ways = (BELONGS.deals ?? []).map((way) => ('through' in way && way.through.table === 'deal_members' ? { through: { ...way.through, ...(when === null ? {} : { while: when }) } } : way));
      await w.belongs('deals', ways as never);
    };

    /** Put back what a test of the listing or the roles changed, so one that fails leaves the next as it found it. */
    const restore = async (): Promise<void> => {
      await w.run('UPDATE deal_members SET ended_on = NULL, kind = NULL WHERE id = 2');
      await w.run('DELETE FROM deal_members WHERE id = 9');
      await listingWhile({ column: 'ended_on', isNull: true });
      for (const slug of ['won-only', 'listed-only', 'editor']) if ((await rolesRepo(w.meta).findBySlug(slug)) !== null) await w.take('kim', slug).catch(() => undefined);
      await w.give('kim', 'account-manager').catch(() => undefined);
    };
    afterEach(async () => {
      await restore();
    });

    beforeAll(async () => {
      w = await world(dialect);
      // A member row may be ended, and may say what kind of member it is.
      await w.run('ALTER TABLE deal_members ADD COLUMN ended_on DATE NULL');
      await w.run('ALTER TABLE deal_members ADD COLUMN kind VARCHAR(12) NULL');
      await w.run('CREATE TABLE comments (id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL, author_id VARCHAR(36), body VARCHAR(400) NOT NULL, FOREIGN KEY (deal_id) REFERENCES deals(id))');
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      comments = (await w.model()).tables.find((table) => table.name === 'comments')!.id;
      const overrides = overridesRepo(w.meta);
      await overrides.create({ connectionId: w.connectionId, op: 'column.staff', tableName: comments, columnName: 'author_id', value: { staff: true }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'column.stamp', tableName: comments, columnName: 'author_id', value: { set: 'user-id', on: 'create' }, origin: 'user' } as never);
      await overrides.create({ connectionId: w.connectionId, op: 'column.mentions', tableName: comments, columnName: 'body', value: { mentions: { about: 'deal_id' } }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'table.belongs', tableName: comments, value: { ways: [{ via: 'deal_id' }] }, origin: 'user' });
      // A member row counts while its end is empty.
      await listingWhile({ column: 'ended_on', isNull: true });
      await w.run(`INSERT INTO deal_members (id, deal_id, user_id, ended_on) VALUES (2, 1, '${w.people.kim}', NULL), (3, 3, '${w.people.kim}', '2026-09-30')`);
      await w.run(`INSERT INTO comments (id, deal_id, author_id, body) VALUES (1, 1, '${w.people.dana}', 'On one'), (2, 3, '${w.people.omar}', 'On three'), (3, 2, '${w.people.dana}', 'On two, won')`);

      await w.role('rep', {
        deals: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } },
        quotes: { actions: ['read'], rows: { read: OWN } },
        followups: { actions: ['read'] },
      });
      await w.role('manager', { deals: { actions: ['read', 'update'], rows: { read: TEAM, update: TEAM } }, quotes: { actions: ['read'], rows: { read: TEAM } } });
      await w.role('editor', { deals: { actions: ['read', 'update', 'export'] }, quotes: { actions: ['read'] }, followups: { actions: ['read'] }, deal_members: { actions: ['read', 'update'] } });
      // Every won deal, or an open one while he is listed on it; its quote; and a file out, to prove that door too.
      await w.role('account-manager', { deals: { actions: ['read', 'export'], rows: { read: [WON, OWN] } }, quotes: { actions: ['read'], rows: { read: [OWN] } }, followups: { actions: ['read'] }, tags: { actions: ['read'] }, deal_tags: { actions: ['read'] } });
      // Looks after the workspace's files: a door that must not skip the rows either.
      await w.system('keeper', ['files.manage']);
      // The comments table is not one of the world's: its grants by hand, as `role` would write them.
      const { permissionsRepo } = await import('@adminium/meta');
      const grant = async (slug: string, actions: Record<string, boolean>, rowLimit?: Record<string, unknown>): Promise<void> => {
        const role = (await rolesRepo(w.meta).findBySlug(slug))!;
        await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${comments}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions, ...(rowLimit === undefined ? {} : { rowLimit }) } as never);
      };
      await grant('rep', { read: true, create: true }, { read: OWN });
      await grant('manager', { read: true, create: true }, { read: TEAM });
      await grant('editor', { read: true, create: true, update: true });
      await grant('account-manager', { read: true, create: true, update: true }, { read: [OWN], update: [{ reach: 'own', by: 'author_id' }] });
      for (const person of ['dana', 'omar', 'sam'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
      await w.give('lena', 'editor');
      await w.give('kim', 'account-manager');
      await w.give('kim', 'keeper');
      await w.page('deals', ['rep', 'manager', 'editor', 'account-manager']);
    }, 180_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('what he reads', () => {
      it('every won deal and the open one he is listed on: the list, its count, a search of it, the record by its key', async () => {
        expect(await kimReaches()).toEqual([1, 2, 6, 9]);
        const list = await get('kim', data(`${deals()}?order=id.asc&count=exact`));
        expect(list.statusCode, list.body).toBe(200);
        expect(ids(list)).toEqual([1, 2, 6, 9]);
        expect(json<{ page: { total: number } }>(list).page.total).toBe(4);
        expect(ids(await get('kim', data(`${deals()}?q=Deal%203`)))).toEqual([]);
        expect(ids(await get('kim', data(`${deals()}?q=Deal%201`)))).toEqual([1]);
        for (const key of [1, 2, 6, 9]) expect((await get('kim', data(`${deals()}/${String(key)}`))).statusCode, `deal ${String(key)}`).toBe(200);
        // An open deal he is not on (5, 7, 8), the one his listing has ended on (3), a lost one (4): as a row that is not there.
        for (const key of [3, 4, 5, 7, 8]) expect(shape(await get('kim', data(`${deals()}/${String(key)}`)), key), `deal ${String(key)}`).toEqual(shape(await get('kim', data(`${deals()}/999`)), 999));
      });

      it('two teams, a manager and somebody nothing limits are as they were', async () => {
        expect(ids(await get('sam', data(`${deals()}?order=id.asc`)))).toEqual([6, 8]);
        expect(ids(await get('lena', data(`${deals()}?order=id.asc`)))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        // Mara leads Dana and Omar; Dana helps on Lena's deal 5 and covers Lena from September with no end.
        expect(ids(await get('mara', data(`${deals()}?order=id.asc`)))).toEqual([1, 2, 3, 4, 5, 9]);
        // Kim's ended listing on deal 3 reaches nobody else either: a member row lists only its own person.
        expect(ids(await get('omar', data(`${deals()}?order=id.asc`)))).toEqual([3, 4]);
      });

      it('the quote of the deal he is on, the comments on it, and nothing hung on another deal', async () => {
        expect(ids(await get('kim', data(`quotes?order=id.asc`)))).toEqual([1]);
        expect(shape(await get('kim', data('quotes/2')), 2)).toEqual(shape(await get('kim', data('quotes/999')), 999));
        // A won deal's comments are not his: comments are reached through the deal by who is on it, not by "won".
        expect(ids(await get('kim', data(`${t('comments')}?order=id.asc`)))).toEqual([1]);
        expect(shape(await get('kim', data(`${t('comments')}/2`)), 2)).toEqual(shape(await get('kim', data(`${t('comments')}/999`)), 999));
      });

      it('a value looked up through a link is there for the deal he reaches, and empty for another', async () => {
        const list = rowsOf(await get('kim', data(`followups?order=id.asc&lookup=${encodeURIComponent('deal_title:deal_id.title')}`)));
        expect(list.map((row) => [Number(row['id']), row['deal_title']])).toEqual([[1, 'Deal 1'], [2, 'Deal 1'], [3, null], [4, null]]);
        expect(json<{ data: Record<string, unknown> }>(await get('kim', data(`followups/3?lookup=${encodeURIComponent('deal_title:deal_id.title')}`))).data['deal_title']).toBeNull();
      });

      it('the search box finds what he reads and nothing else', async () => {
        expect(await found('kim', 'Deal')).toEqual(['Deal 1', 'Deal 2', 'Deal 6', 'Deal 9']);
        expect(await found('kim', 'Deal 3')).toEqual([]);
        expect(await found('lena', 'Deal 3')).toEqual(['Deal 3']);
      });

      it('a dashboard figure counts and adds up his deals, and a group of them names no other', async () => {
        expect(await figures('kim')).toEqual({ n: 4, total: sum(1, 2, 6, 9) });
        const grouped = await card('kim', { source: source('deals'), shape: 'categorical', groupBy: ['state'], aggregations: [{ fn: 'count', alias: 'n' }] });
        expect(grouped.statusCode, grouped.body).toBe(200);
        expect(grouped.body).not.toContain('lost');
        const list = await card('kim', { source: source('deals'), shape: 'record-list', select: ['id'], orderBy: [{ column: 'id', dir: 'asc' }] });
        expect(json<{ result: { rows: { id: number }[] } }>(list).result.rows.map((row) => Number(row.id))).toEqual([1, 2, 6, 9]);
      });

      it('a record\'s history, what points at it, its linked rows and the console\'s record page: his deal answers, another is not there', async () => {
        const model = await w.model();
        const tags = model.relations.find((relation) => relation.through !== null && relation.from.tableId === w.id('deals') && relation.to.tableId === w.id('tags'))!.id;
        for (const path of [(key: number) => `${deals()}/${String(key)}/history`, (key: number) => `${deals()}/${String(key)}/references`, (key: number) => `${deals()}/${String(key)}?include=inboundCounts`, (key: number) => `${deals()}/${String(key)}/links/${encodeURIComponent(tags)}`]) {
          expect((await get('kim', data(path(1)))).statusCode, path(1)).toBe(200);
          for (const key of [3, 5]) expect(shape(await get('kim', data(path(key))), key), path(key)).toEqual(shape(await get('kim', data(path(999))), 999));
        }
      });

      it('a file hung on a deal: his deal\'s, and not one on a deal he is off', async () => {
        const upload = async (record: number): Promise<string> => {
          const res = await call('owner', 'POST', `files?${new URLSearchParams({ connectionId: w.connectionId, filename: `deal-${String(record)}.pdf`, table: w.id('deals'), recordId: String(record) }).toString()}`, PDF, { 'content-type': 'application/pdf' });
          expect(res.statusCode, res.body).toBe(201);
          return json<{ data: { id: string } }>(res).data.id;
        };
        const [on, off] = [await upload(1), await upload(3)];
        expect((await get('kim', `files/${on}`)).statusCode).toBe(200);
        expect((await get('kim', `files/${off}`)).statusCode).toBe(404);
        expect((await get('kim', `files/${off}/content`)).statusCode).toBe(404);
        const listed = json<{ data: { id: string }[] }>(await get('kim', `files?connectionId=${w.connectionId}&table=${deals()}&state=live`)).data.map((row) => row.id);
        expect(listed).toContain(on);
        expect(listed).not.toContain(off);
      });

      it('a file of the deals he asks for holds his deals and no other', async () => {
        const res = await call('kim', 'POST', 'exports', { connectionId: w.connectionId, source: { kind: 'table', table: w.id('deals') }, format: 'csv' });
        expect(res.statusCode, res.body).toBe(202);
        await w.jobs();
        const csv = (await get('kim', `exports/${json<{ data: { id: string } }>(res).data.id}/download`)).body;
        const keys = csv.replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map((line) => Number(line.split(',')[0])).sort((a, b) => a - b);
        expect(keys).toEqual([1, 2, 6, 9]);
      });

      it('the live frames of the deals tell him that something changed, never a row', async () => {
        const channel = widgetDataChannel(w.connectionId, w.id('deals'));
        const got: Frame[] = [];
        const off = w.app.realtime.subscribe(channel, orderedSink(await readLimitedFrames(w.meta)({ id: w.people.kim }, channel), (event: RealtimeEvent) => got.push(event.data as Frame)));
        for (const key of [3, 1]) expect((await call('lena', 'PATCH', data(`${deals()}/${String(key)}`), { values: { title: `Deal ${String(key)}` } })).statusCode).toBe(200);
        for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve, 5));
        off();
        expect(got.length).toBeGreaterThan(0);
        for (const frame of got) expect([frame.pk, frame.row, frame.changed]).toEqual([null, null, true]);
      });
    });

    describe('a listing that counts only while its end is empty', () => {
      it('ends at once, on every door, when his row\'s end is set; and is back when it is cleared', async () => {
        // Asked first, so a figure is kept: ending the listing must not leave it standing.
        expect(await figures('kim')).toEqual({ n: 4, total: sum(1, 2, 6, 9) });
        expect((await call('lena', 'PATCH', data(`deal_members/2`), { values: { ended_on: '2026-10-01' } })).statusCode).toBe(200);
        expect(await kimReaches()).toEqual([2, 6, 9]);
        expect(await figures('kim')).toEqual({ n: 3, total: sum(2, 6, 9) });
        expect(ids(await get('kim', data(`${deals()}?order=id.asc`)))).toEqual([2, 6, 9]);
        expect((await get('kim', data(`${deals()}/1`))).statusCode).toBe(404);
        expect((await get('kim', data(`${deals()}/1/history`))).statusCode).toBe(404);
        expect(await found('kim', 'Deal 1')).toEqual([]);
        expect(ids(await get('kim', data('quotes?order=id.asc')))).toEqual([]);
        expect(ids(await get('kim', data(`${t('comments')}?order=id.asc`)))).toEqual([]);
        // Nobody else is moved by it.
        expect(ids(await get('dana', data(`${deals()}?order=id.asc`)))).toEqual([1, 2, 5, 9]);
        await w.run('UPDATE deal_members SET ended_on = NULL WHERE id = 2');
        expect(await kimReaches()).toEqual([1, 2, 6, 9]);
        expect((await get('kim', data(`${deals()}/1`))).statusCode).toBe(200);
      });

      it('counts while a column holds one of some values, and a column the listing no longer has reaches nobody', async () => {
        await listingWhile({ column: 'kind', in: ['helper', 'following'] });
        // Neither of his rows says a kind, and Dana's helper row on deal 5 does not either: no listing counts.
        expect(await kimReaches()).toEqual([2, 6, 9]);
        await w.run(`UPDATE deal_members SET kind = 'following' WHERE id = 2`);
        expect(await kimReaches()).toEqual([1, 2, 6, 9]);
        await w.run(`UPDATE deal_members SET kind = 'left' WHERE id = 2`);
        expect(await kimReaches()).toEqual([2, 6, 9]);
        // Empty text is empty, either way it is written (his row on deal 3 says no kind at all, so it counts here).
        await listingWhile({ column: 'kind', isNull: true });
        await w.run(`UPDATE deal_members SET kind = '' WHERE id = 2`);
        expect(await kimReaches()).toEqual([1, 2, 3, 6, 9]);
        await w.run(`UPDATE deal_members SET kind = 'left' WHERE id = 2`);
        expect(await kimReaches()).toEqual([2, 3, 6, 9]);
        await listingWhile({ column: 'kind', isNull: false });
        expect(await kimReaches()).toEqual([1, 2, 6, 9]);
        await w.run(`UPDATE deal_members SET kind = '' WHERE id = 2`);
        expect(await kimReaches()).toEqual([2, 6, 9]);
        // A column that is not there: the way cannot be read, and fails closed.
        await listingWhile({ column: 'gone', isNull: true });
        expect(await kimReaches()).toEqual([2, 6, 9]);
        await listingWhile({ column: 'ended_on', isNull: true });
        await w.run(`UPDATE deal_members SET kind = NULL WHERE id = 2`);
        expect(await kimReaches()).toEqual([1, 2, 6, 9]);
      });

      it('a row nobody is listed on counts as nobody\'s through it: an ended listing does not make it owned', async () => {
        const { reach } = await w.setOf('kim');
        // A reach of the rows nobody owns: deal 7 is nobody's, and an ended member row on it keeps it so.
        await w.run(`INSERT INTO deal_members (id, deal_id, user_id, ended_on) VALUES (9, 7, '${w.people.sam}', '2026-01-01')`);
        const set = { superAdmin: false, rowLimits: { read: [{ limited: [{ grant: `table:${w.connectionId}:${w.id('deals')}:read`, reach: { reach: 'own' as const, unowned: true as const } }], unlimited: new Set<string>() }] }, reach: reach! };
        expect(await w.reached(set, 'deals')).toEqual([1, 7]);
        await w.run('DELETE FROM deal_members WHERE id = 9');
      });
    });

    describe('several reaches for one action', () => {
      const grant = (): string => `table:${w.connectionId}:${w.id('deals')}:read`;
      const asMara = async (limited: { reach: unknown }[]) => {
        const { reach } = await w.setOf('mara');
        return w.reached({ superAdmin: false, rowLimits: { read: [{ limited: limited.map((one) => ({ grant: grant(), reach: one.reach as never })), unlimited: new Set<string>() }] }, reach: reach! }, 'deals');
      };

      it('are each their own whole test, any one enough: the team\'s open deals and her own always never add up to the team\'s always', async () => {
        // Team: Mara, Dana, Omar (and, on 15 August, Omar covers Sam). Open: 1, 3, 5 (Dana helps), 8 (Sam's, covered).
        expect(await asMara([{ reach: { reach: 'team', while: { column: 'state', in: ['open'] } } }, { reach: OWN }])).toEqual([1, 3, 5, 8]);
        // Won ones of the team (2, 6 covered, 9 not yet) are not reached by either reach.
        expect(await asMara([{ reach: { reach: 'team', while: { column: 'state', in: ['open'] } } }])).toEqual([1, 3, 5, 8]);
        expect(await asMara([{ reach: WON }, { reach: { reach: 'team', while: { column: 'state', in: ['lost'] } } }])).toEqual([2, 4, 6, 9]);
      });

      it('are read from one role as from two: one role naming both is the two roles held together', async () => {
        const one = await w.setOf('kim');
        expect(rowReachesOf(one, w.connectionId, w.id('deals'), 'read')).toEqual([WON, OWN]);
        await w.take('kim', 'account-manager');
        await w.role('won-only', { deals: { actions: ['read'], rows: { read: WON } } });
        await w.role('listed-only', { deals: { actions: ['read'], rows: { read: OWN } } });
        await w.give('kim', 'won-only');
        await w.give('kim', 'listed-only');
        expect(await kimReaches()).toEqual([1, 2, 6, 9]);
        await w.take('kim', 'won-only');
        await w.take('kim', 'listed-only');
        // A role that reads every deal plainly lifts both.
        await w.give('kim', 'editor');
        expect(rowLimitFor(await w.contextOf(await w.setOf('kim')), w.id('deals'), 'read')).toBeNull();
        await w.take('kim', 'editor');
        await w.give('kim', 'account-manager');
        expect(await kimReaches()).toEqual([1, 2, 6, 9]);
      });

      it('the console shows them, keeps them through a save, tries them as a person, and refuses one that reaches every row', async () => {
        const role = (await rolesRepo(w.meta).findBySlug('account-manager'))!;
        const rows = json<{ tables: { tableId: string; limit: { read?: unknown } | null; ways: { kind: string; when?: unknown }[] }[] }>(await get('owner', `roles/${role.id}/rows`));
        const dealsRow = rows.tables.find((table) => table.tableId === w.id('deals'))!;
        expect(dealsRow.limit?.read).toEqual([WON, OWN]);
        expect(dealsRow.ways.find((way) => way.kind === 'listing' && way.when !== undefined)?.when).toEqual({ column: 'ended_on', label: expect.any(String), isNull: true });
        const preview = await call('owner', 'POST', 'roles/rows/preview', { connectionId: w.connectionId, table: w.id('deals'), userId: w.people.kim, roleId: role.id, reach: [WON, OWN] });
        expect(preview.statusCode, preview.body).toBe(200);
        expect(json<{ reached: number; total: number }>(preview)).toMatchObject({ reached: 4, total: 9 });
        // A save of the matrix keeps them; a list with a reach of every row and nothing to narrow it is refused.
        const held = json<{ grants: string[]; rows: Record<string, unknown> }>(await get('owner', `roles/${role.id}/permissions`));
        const ref = `${w.connectionId}/${w.id('deals')}`;
        expect((await call('owner', 'PUT', `roles/${role.id}/permissions`, { grants: held.grants })).statusCode).toBe(200);
        expect(json<{ rows: Record<string, { read?: unknown }> }>(await get('owner', `roles/${role.id}/permissions`)).rows[ref]?.read).toEqual([WON, OWN]);
        const wide = await call('owner', 'PUT', `roles/${role.id}/permissions`, { grants: held.grants, rows: { [ref]: { read: [WON, { reach: 'all' }] } } });
        expect(wide.statusCode, wide.body).toBe(422);
        expect(wide.body).toContain('all-without-while');
        expect(await kimReaches()).toEqual([1, 2, 6, 9]);
      });
    });

    describe('what he writes', () => {
      const comment = (who: Who, id: number, deal: number, body = 'A word') => call(who, 'POST', data(t('comments')), { values: { id, deal_id: deal, body } });
      const exists = async (id: number): Promise<boolean> => (await w.rows(`SELECT id FROM comments WHERE id = ${String(id)}`)).length === 1;

      it('comments on the open deal he is on, and on no won deal he is not on, nor one his listing has ended on', async () => {
        const mine = await comment('kim', 10, 1);
        expect(mine.statusCode, mine.body).toBe(201);
        expect((await w.rows('SELECT author_id FROM comments WHERE id = 10'))[0]!['author_id']).toBe(w.people.kim);
        // Deal 2 is won: he reads it, and is not on it.
        const won = await comment('kim', 11, 2);
        expect(won.statusCode, won.body).toBe(403);
        expect(reason(won)).toBe('parent-not-theirs');
        expect(await exists(11)).toBe(false);
        // Deal 3: his listing ended. He does not read it, and is told what a deal that is not there tells.
        expect(shape(await comment('kim', 12, 3), 12)).toEqual(shape(await comment('kim', 12, 999), 12));
        expect(await exists(12)).toBe(false);
        // His own comment is not moved to a won deal, and somebody else's is not his to change.
        const moved = await call('kim', 'PATCH', data(`${t('comments')}/10`), { values: { deal_id: 2 } });
        expect(moved.statusCode, moved.body).toBe(403);
        expect(Number((await w.rows('SELECT deal_id FROM comments WHERE id = 10'))[0]!['deal_id'])).toBe(1);
        expect((await call('kim', 'PATCH', data(`${t('comments')}/1`), { values: { body: 'Mine now' } })).statusCode).toBe(404);
        expect((await call('kim', 'PATCH', data(`${t('comments')}/10`), { values: { body: 'Edited' } })).statusCode).toBe(200);
        // He changes no deal.
        expect((await call('kim', 'PATCH', data(`${deals()}/1`), { values: { title: 'Mine' } })).statusCode).toBe(403);
      });

      it('a reach of every won deal beside her own does not let a helper take an open deal she only helps on, nor empty its owner', async () => {
        // Dana helps on Lena's open deal 5. With a second reach, of every won deal, she still holds deal 5 by her listing only.
        await w.role('rep-won', { deals: { actions: ['read', 'update'], rows: { read: [WON, OWN], update: [WON, OWN] } } });
        await w.take('dana', 'rep');
        await w.give('dana', 'rep-won');
        try {
          for (const owner of [w.people.dana, null]) {
            const taken = await call('dana', 'PATCH', data(`${deals()}/5`), { values: { owner_id: owner } });
            expect(taken.statusCode, taken.body).toBe(403);
            expect(['not-theirs-to-give', 'staff-column']).toContain(reason(taken));
          }
          expect((await w.rows('SELECT owner_id FROM deals WHERE id = 5'))[0]!['owner_id']).toBe(w.people.lena);
          // Her own open deal is hers to hand to nobody but a person she may name; a won one she holds by the first reach.
          expect((await call('dana', 'PATCH', data(`${deals()}/1`), { values: { title: 'Deal 1' } })).statusCode).toBe(200);
        } finally {
          await w.take('dana', 'rep-won');
          await w.give('dana', 'rep');
        }
      });

      it('the others comment as before: a rep on her deal, a manager on her team\'s, somebody nothing limits anywhere', async () => {
        expect((await comment('dana', 20, 1)).statusCode).toBe(201);
        expect(shape(await comment('dana', 21, 3), 21)).toEqual(shape(await comment('dana', 21, 999), 21));
        expect((await comment('mara', 22, 3)).statusCode).toBe(201);
        expect(shape(await comment('sam', 23, 1), 23)).toEqual(shape(await comment('sam', 23, 999), 23));
        expect((await comment('lena', 24, 7)).statusCode).toBe(201);
      });

      it('a mention names the deal only to somebody who reads it: him on his deal, not on the one he is off; a rep not on his', async () => {
        const mention = (person: PersonName) => `@[${person}](${w.people[person]})`;
        type Notice = { kind: string; entity: unknown; actionUrl: string | null };
        const notices = async (who: PersonName): Promise<Notice[]> => ((await notificationsRepo(w.meta).listForUser(w.people[who], { limit: 100 })) as unknown as Notice[]).filter((item) => item.kind === 'mention');
        expect((await comment('dana', 30, 1, `Over to ${mention('kim')}`)).statusCode).toBe(201);
        expect((await comment('omar', 31, 3, `Still ${mention('kim')}?`)).statusCode).toBe(201);
        expect((await comment('kim', 32, 1, `Thanks ${mention('omar')}`)).statusCode).toBe(201);
        await w.jobs();
        const kim = await notices('kim');
        expect(kim).toHaveLength(2);
        expect(kim.filter((notice) => notice.entity !== null)).toHaveLength(1);
        expect(kim.filter((notice) => notice.entity === null && notice.actionUrl === null)).toHaveLength(1);
        const omar = await notices('omar');
        expect(omar).toHaveLength(1);
        expect([omar[0]!.entity, omar[0]!.actionUrl]).toEqual([null, null]);
      });
    });

    const rowsOf = (res: Reply): Record<string, unknown>[] => json<{ data: Record<string, unknown>[] }>(res).data;
  });
}

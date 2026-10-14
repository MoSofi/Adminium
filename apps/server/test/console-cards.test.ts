// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S CONSOLE CARDS, against the whole server on SQLite, Postgres and
 * MySQL, through an app installed by the real installer:
 *
 *  - a card of a part (`layout.items[].module`) is not served while the part
 *    is off — in the shared layout and in a person's own — and is back when
 *    it is on; a layout saved while it is off keeps it where it was;
 *  - a card's column headings in other languages (`columns[].labels`) are
 *    kept by the install and served as written;
 *  - a column the app declares as money (`semantic`, `type` or a currency's
 *    places) is money to the board's totals (the page's column facts) and to
 *    a chart's table (the answer's `money`), whatever it is called; a count
 *    of it, and a plain number, are not.
 */
import { pagesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const count = (table: string) => ({ kind: 'table-query', source: { name: table, type: 'table' }, shape: 'metric+delta', aggregations: [{ fn: 'count', alias: 'n' }] });
const card = (i: string, table: string, x: number, more: Record<string, unknown> = {}) => ({ i, widget: 'kpi-stat-card', x, y: 0, w: 3, h: 3, config: { title: i, binding: count(table) }, ...more });

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crm.desc', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    modules: [
      { id: 'selling', label: en('Selling'), default: 'always' },
      { id: 'inbox', label: en('Inbox'), default: 'on' },
    ],
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          module: 'selling',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'stage', type: 'enum', enum: ['lead', 'won'], default: 'lead' },
            // Money by its name; money by the app's word; money by its places; a plain number.
            { ref: 'amount', type: 'decimal', default: 0 },
            { ref: 'weighted_value', type: 'decimal', default: 0, semantic: 'money' },
            { ref: 'list_value', type: 'decimal', scale: 'currency', default: 0 },
            { ref: 'odds', type: 'decimal', default: 0 },
          ],
        },
        { ref: 'enquiries', module: 'inbox', columns: [id, { ref: 'subject', type: 'text', maxLength: 80 }] },
      ],
    },
    roles: [{ key: 'manager', name: 'Manager', modules: ['selling'], permissions: ['table:@deals:read', 'page:@crm-overview:view', 'page:@crm-deals:view'] }],
    pages: [
      {
        ref: 'crm-overview',
        template: 'page-dashboard',
        title: { key: 't.overview', fallback: 'Overview' },
        nav: { group: 'sales', icon: 'gauge', order: 1 },
        module: 'selling',
        config: {
          layout: {
            version: 1,
            items: [
              card('open-deals', 'deals', 0),
              card('unclaimed', 'enquiries', 3, { module: 'inbox' }),
              {
                i: 'deals-list',
                widget: 'mini-table',
                x: 6,
                y: 0,
                w: 6,
                h: 6,
                config: { title: 'Deals', binding: { kind: 'table-query', source: { name: 'deals', type: 'table' }, shape: 'record-list', limit: 5 }, columns: [{ name: 'name', label: 'Deal', labels: { 'de-DE': 'Geschäft', 'ar-EG': 'الصفقة' } }] },
              },
            ],
          },
        },
      },
      { ref: 'crm-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 2 }, bindings: { rows: 'deals' }, module: 'selling' },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

type Item = { i: string; module?: string; config: Record<string, unknown> };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app's console cards, on ${dialect}`, () => {
    let s: WholeServer;
    let overview = '';
    let deals = '';
    const items = async (who: string): Promise<Item[]> => {
      const res = await s.get(who, `/api/v1/pages/${overview}`);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { config: { layout: { items: Item[] } } } }).data.config.layout.items;
    };
    const flip = async (on: boolean) => expect(said(await s.send('owner', 'PUT', '/api/v1/apps/crm/parts/inbox', { on }))).toBe('ok');

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { mia: ['manager'] } });
      const pages = await pagesRepo(s.meta).listAll();
      overview = pages.find((page) => page.slug === 'crm-overview')!.id;
      deals = pages.find((page) => page.slug === 'crm-deals')!.id;
      await s.rows(`INSERT INTO crm_deals (id, name, stage, amount, weighted_value, list_value, odds) VALUES (1, 'Atrium', 'lead', 1000, 100, 1200, 0.1), (2, 'Lobby', 'won', 500, 500, 600, 1)`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('serves a card of a part only while the part is on, and a layout saved meanwhile keeps it', async () => {
      expect((await items('mia')).map((item) => item.i)).toEqual(['open-deals', 'unclaimed', 'deals-list']);
      expect((await items('mia'))[1]).toMatchObject({ module: 'inbox' });
      await flip(false);
      expect((await items('mia')).map((item) => item.i)).toEqual(['open-deals', 'deals-list']);
      expect((await items('owner')).map((item) => item.i)).toEqual(['open-deals', 'deals-list']);
      // The owner moves a card while the Inbox is off: the shared layout keeps the card it did not show.
      const shown = await items('owner');
      const moved = shown.map((item) => (item.i === 'open-deals' ? { ...item, x: 3 } : item));
      expect(said(await s.send('owner', 'PATCH', `/api/v1/pages/${overview}/layout`, { version: 1, items: moved }))).toBe('ok');
      // A person's own layout, saved while it is off with what they were shown, keeps the card too, and is served without it.
      expect(said(await s.send('mia', 'PUT', `/api/v1/me/views/${overview}/layout`, { version: 1, items: [{ ...shown[0], x: 6 }] }))).toBe('ok');
      expect((await items('mia')).map((item) => item.i)).toEqual(['open-deals']);
      await flip(true);
      expect((await items('mia')).map((item) => item.i)).toEqual(['open-deals', 'unclaimed']);
      expect((await items('mia'))[0]).toMatchObject({ x: 6 });
      const back = await items('owner');
      expect(back.map((item) => item.i)).toEqual(['open-deals', 'deals-list', 'unclaimed']);
      expect(back.find((item) => item.i === 'open-deals')).toMatchObject({ x: 3 });
    });

    it('keeps a card\'s column headings in every language it gives', async () => {
      const list = (await items('owner')).find((item) => item.i === 'deals-list')!;
      expect((list.config['columns'] as unknown[])[0]).toMatchObject({ name: 'name', label: 'Deal', labels: { 'de-DE': 'Geschäft', 'ar-EG': 'الصفقة' } });
    });

    it('takes a column the app declares as money for money, whatever it is called: the board\'s totals', async () => {
      const res = await s.get('owner', `/api/v1/pages/${deals}`);
      expect(res.statusCode, res.body).toBe(200);
      const facts = (res.json() as { columnFacts?: { columns: { spec: { name: string; semantic?: string | null } }[] } }).columnFacts!.columns;
      const semantic = (name: string) => facts.find((fact) => fact.spec.name === name)?.spec.semantic ?? null;
      expect(semantic('amount')).toBe('money');
      expect(semantic('weighted_value')).toBe('money');
      expect(semantic('list_value')).toBe('money');
      expect(semantic('odds')).not.toBe('money');
    });

    it('says which of a chart\'s figures are money: a sum of a money column, never a count nor a plain number', async () => {
      const ask = async (shape: string, aggregations: Record<string, unknown>[], more: Record<string, unknown> = {}) => {
        const res = await s.send('owner', 'POST', '/api/v1/widget-data/query', {
          descriptor: { connectionId: s.connectionId, kind: 'table-query', source: { name: s.t('deals').split('.').at(-1), type: 'table' }, shape, aggregations, ...more },
        });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { result: { money?: string[] } }).result;
      };
      const pair = await ask('categorical', [{ fn: 'count', alias: 'deals' }, { fn: 'sum', column: 'weighted_value', alias: 'weighted' }, { fn: 'sum', column: 'list_value', alias: 'listed' }, { fn: 'sum', column: 'odds', alias: 'odds' }], { groupBy: ['stage'] });
      expect(pair.money).toEqual(['weighted', 'listed']);
      expect((await ask('categorical', [{ fn: 'sum', column: 'amount', alias: 'value' }], { groupBy: ['stage'] })).money).toEqual(['value']);
      expect((await ask('categorical', [{ fn: 'count', alias: 'deals' }], { groupBy: ['stage'] })).money).toBeUndefined();
      // A KPI's figure carries none: its card says how it is written.
      expect((await ask('single-metric', [{ fn: 'sum', column: 'amount', alias: 'value' }])).money).toBeUndefined();
    });
  });
}

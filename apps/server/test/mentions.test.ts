// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PEOPLE MENTIONED IN A TEXT, against the whole server on SQLite, Postgres
 * and MySQL: who is told, what their notice says and where it leads — for
 * somebody who can open the record, somebody whose roles read the table but
 * not that row, and somebody with no right on it at all — and what a save
 * that names nobody real does.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { mentionedIn } from '../src/crud/mentions.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.27' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const page = (ref: string, table: string, order: number) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'sales', icon: 'list', order }, bindings: { rows: table } });

function sales(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'sales',
    name: 'Sales',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.sales.desc', fallback: 'Sales.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.27', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: { 'en-US': 'Sales' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          belongs: [{ column: 'owner_id', set: 'anyone' }],
          indexes: [['owner_id']],
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 120 },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'notes', type: 'text', maxLength: 1000, nullable: true, rules: { mentions: true } },
          ],
        },
        {
          ref: 'comments',
          columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'body', type: 'text', maxLength: 1000, rules: { mentions: { about: 'deal_id' } } }],
        },
        { ref: 'deliveries', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }] },
      ],
    },
    roles: [
      {
        key: 'rep',
        name: 'Rep',
        permissions: ['table:@deals:read', 'table:@deals:create', 'table:@deals:update', 'table:@comments:read', 'table:@comments:create', 'table:@comments:update', 'page:@sales-deals:view'],
        limits: { deals: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } },
      },
      { key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'table:@deals:update', 'table:@comments:read', 'page:@sales-deals:view'] },
      { key: 'driver', name: 'Driver', permissions: ['table:@deliveries:read'] },
    ],
    pages: [page('sales-deals', 'deals', 1)],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

describe('the people a text names', () => {
  it('reads each person once, in order, and nothing that only looks like a mention', () => {
    expect(mentionedIn('Hi @[Sam Lee](usr_01ABCDEFGH) and @[Ivy](usr_01ZZZZZZZZ), and @[Sam Lee](usr_01ABCDEFGH) again')).toEqual(['usr_01ABCDEFGH', 'usr_01ZZZZZZZZ']);
    expect(mentionedIn('mail me @ home, or see [this](usr_01ABCDEFGH) and @Sam')).toEqual([]);
    expect(mentionedIn(null)).toEqual([]);
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`mentions, on ${dialect}`, () => {
    let s: WholeServer;
    let atrium = 0;
    const at = (who: string): string => `@[${who[0]!.toUpperCase()}${who.slice(1)}](${s.ids[who]!})`;
    type Notice = { title: string; body: string | null; actionUrl: string | null; entity: unknown; kind: string; actorLabel: string };
    const notices = async (who: string): Promise<Notice[]> => ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: Notice[] } }).data.items.filter((item) => item.kind === 'mention');

    beforeAll(async () => {
      s = await wholeServer(dialect, sales(), { people: { dana: ['rep'], noor: ['rep'], ivy: ['manager'], sam: ['driver'] }, smtp: true });
      expect(said(await s.make('owner', 'deals', { name: 'Atrium', owner_id: s.ids['dana'] }))).toBe('ok');
      atrium = Number((await s.rows("select id from sales_deals where name = 'Atrium'"))[0]!['id']);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('tells each person named who wrote and on which record, and never what was written', async () => {
      await s.emails();
      const secret = 'the margin is 41 percent';
      const made = await s.make('dana', 'comments', { deal_id: atrium, body: `${at('ivy')} ${at('noor')} ${at('sam')} can we deliver by the 12th? ${secret}` });
      expect(made.statusCode, made.body).toBe(201);

      // The manager reads every deal: her notice leads to the deal the comment is on.
      const ivy = await notices('ivy');
      expect(ivy).toHaveLength(1);
      expect(ivy[0]).toMatchObject({ title: 'Dana mentioned you', actorLabel: 'Dana', actionUrl: `/p/sales-deals/r/${String(atrium)}` });
      expect(ivy[0]!.body).toContain('Atrium');

      // A rep reads deals, but this one is not his: who and where, and no way in.
      const noor = await notices('noor');
      expect(noor).toHaveLength(1);
      expect(noor[0]).toMatchObject({ title: 'Dana mentioned you', actionUrl: null, entity: null });
      expect(noor[0]!.body).toContain('Atrium');

      // A driver has no right on deals at all: the same.
      const sam = await notices('sam');
      expect(sam).toHaveLength(1);
      expect(sam[0]).toMatchObject({ title: 'Dana mentioned you', actionUrl: null, entity: null });

      // Nobody's notice, in the app or by email, carries the text.
      for (const notice of [...ivy, ...noor, ...sam]) expect(JSON.stringify(notice)).not.toContain('41 percent');
      const mails = await s.emails();
      expect(mails.map((mail) => mail.to).sort()).toEqual(['ivy@sales.test', 'noor@sales.test', 'sam@sales.test']);
      for (const mail of mails) {
        expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain('41 percent');
        expect(`${mail.subject} ${mail.text}`).toContain('Dana mentioned you');
      }
      // The one way in is the manager's; the others' emails lead nowhere on the deal.
      expect(mails.find((mail) => mail.to === 'ivy@sales.test')!.html).toContain(`/p/sales-deals/r/${String(atrium)}`);
      expect(mails.find((mail) => mail.to === 'sam@sales.test')!.html).not.toContain('/p/sales-deals/r/');
    });

    it('tells only the people a change newly names, and never the writer', async () => {
      const first = await s.change('dana', 'deals', atrium, { notes: `Ask ${at('ivy')} about terms. ${at('dana')} to follow up.` });
      expect(first.statusCode, first.body).toBe(200);
      expect(await notices('ivy')).toHaveLength(2);
      expect(await notices('dana')).toHaveLength(0);
      // Saved again with one more person: only that one is told.
      expect(said(await s.change('dana', 'deals', atrium, { notes: `Ask ${at('ivy')} about terms. ${at('dana')} to follow up. ${at('sam')} delivers.` }))).toBe('ok');
      expect(await notices('ivy')).toHaveLength(2);
      expect(await notices('sam')).toHaveLength(2);
      // A change to another column of the row names nobody anew.
      expect(said(await s.change('dana', 'deals', atrium, { name: 'Atrium Tower' }))).toBe('ok');
      expect(await notices('ivy')).toHaveLength(2);
      expect(await notices('sam')).toHaveLength(2);
      // A mention on the deal itself names the deal, by its new name.
      expect((await notices('sam'))[0]!.body).toContain('Atrium');
    });

    it('refuses a save that names nobody who signs in here, by the column, and writes nothing', async () => {
      const before = (await s.rows('select id from sales_comments')).length;
      const refused = await s.make('dana', 'comments', { deal_id: atrium, body: 'Ask @[Somebody Else](usr_01NOBODYATALL00000000) first' });
      expect(said(refused)).toBe('422 VALIDATION_FAILED');
      expect((refused.json() as { error: { details: { fields: Record<string, { code: string }> } } }).error.details.fields).toEqual({ body: { code: 'mention-unknown' } });
      expect((await s.rows('select id from sales_comments')).length).toBe(before);
      // The same on a change: the row keeps what it held.
      expect(said(await s.change('dana', 'deals', atrium, { notes: 'Now @[Ghost](usr_01NOBODYATALL00000000)' }))).toBe('422 VALIDATION_FAILED');
      expect(String((await s.rows(`select notes from sales_deals where id = ${String(atrium)}`))[0]!['notes'])).toContain('delivers');
    });

    it('offers the people who may be named by name, to anybody signed in', async () => {
      const people = ((await s.get('sam', '/api/v1/people?q=iv')).json() as { people: { id: string; name: string }[] }).people;
      expect(people.map((person) => person.name)).toEqual(['Ivy']);
      expect(people[0]!.id).toBe(s.ids['ivy']);
    });
  });
}

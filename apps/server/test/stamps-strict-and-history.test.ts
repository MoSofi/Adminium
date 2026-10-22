// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO TICKED IT AND WHEN, NEVER TYPED; A CLOSED DEAL BROUGHT IN, NEVER DATED
 * BY THE IMPORT; A BLANK CELL, ITS COLUMN'S DEFAULT. Against the whole server
 * on SQLite, Postgres and MySQL.
 *
 *  - A stamp marked `strict` is the server's on every door, for every writer:
 *    a create, a change (PATCH) and a bulk edit that send a value for it lose
 *    it to the stamp (or to the row as it stands, when the stamp does not
 *    fire); a brought file's line that carries one is refused, by its column,
 *    in the preview and in the run — by the owner and by an app's role. A
 *    line that leaves it blank is stamped as its bringer.
 *  - An empty cell of a brought file under a column with a default takes the
 *    default (a blank "may be e-mailed" is no) instead of "required".
 *  - On a brought line, a stamp never fills a column `requiredWhen` asks for:
 *    a won deal without its closed date is named in the preview and not
 *    brought in; one with its date keeps that date. A person's own save is
 *    still stamped.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.33' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const strictStamp = (set: string) => ({ stamp: { set, on: { columns: ['may_email'] }, strict: true } });

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.33', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'contacts',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'may_email', type: 'bool', default: false },
            { ref: 'may_email_at', type: 'timestamptz', nullable: true, rules: strictStamp('now') },
            { ref: 'may_email_by', type: 'text', maxLength: 64, nullable: true, rules: strictStamp('user-id') },
          ],
        },
        {
          ref: 'deals',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'], default: 'open' },
            {
              ref: 'closed_at',
              type: 'timestamptz',
              nullable: true,
              rules: { stamp: { set: 'now', on: { column: 'state', values: ['won', 'lost'] } }, requiredWhen: { column: 'state', in: ['won', 'lost'] } },
            },
          ],
        },
      ],
    },
    roles: [
      {
        key: 'admin',
        name: 'CRM admin',
        permissions: ['table:@contacts:read', 'table:@contacts:create', 'table:@contacts:update', 'table:@contacts:import', 'table:@deals:read', 'table:@deals:create', 'table:@deals:update', 'table:@deals:import'],
      },
    ],
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'crm', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

/** A moment as milliseconds, however the driver hands it back. */
const ms = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value).replace(' ', 'T').replace(/(\d{2}:\d{2}:\d{2}(\.\d+)?)$/, '$1Z')));
const yes = (value: unknown): boolean => value === true || value === 1 || value === '1';

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`stamps a writer never gives, and what a brought file says [${dialect}]`, () => {
    let s: WholeServer;
    const data = (path: string) => `/api/v1/data/${s.connectionId}/${path}`;
    /** A file brought into a table by one person: what its preview says of each line, and what its run made. */
    const bring = async (who: string, ref: string, csv: string, columns: { from: string; to: string }[]) => {
      const up = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=lines.csv', headers: { cookie: s.cookie[who]!, 'content-type': 'text/csv' }, payload: csv });
      expect(up.statusCode, up.body).toBe(201);
      const made = await s.send(who, 'POST', '/api/v1/imports', { fileId: (up.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t(ref), mapping: { columns }, options: { mode: 'insert' } });
      expect(made.statusCode, made.body).toBe(201);
      const importId = (made.json() as { data: { import: { id: string } } }).data.import.id;
      const preview = await s.get(who, `/api/v1/imports/${importId}/preview`);
      expect(preview.statusCode, preview.body).toBe(200);
      const run = await s.send(who, 'POST', `/api/v1/imports/${importId}/run`);
      expect(run.statusCode, run.body).toBeLessThan(300);
      await s.jobs();
      const view = await s.get(who, `/api/v1/imports/${importId}`);
      return {
        lines: (preview.json() as { data: { lines: { row: number; status: string; column?: string; code?: string }[] } }).data.lines,
        stats: (view.json() as { data: { stats: { inserted: number; skipped: number } } }).data.stats,
      };
    };
    const contact = async (key: number) => (await s.rows(`select * from crm_contacts where id = ${String(key)}`))[0]!;
    const deal = async (key: number) => (await s.rows(`select * from crm_deals where id = ${String(key)}`))[0];
    const recent = (value: unknown) => Math.abs(ms(value) - Date.now()) < 10 * 60_000;

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { ada: ['admin'] } });
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('stamps a create as its writer, whatever the writer sent for the stamps', async () => {
      const made = await s.make('owner', 'contacts', { id: 1, name: 'Mara Quist', may_email: true, may_email_at: '2020-01-01T09:00:00Z', may_email_by: 'somebody-else' });
      expect(said(made)).toBe('ok');
      const row = await contact(1);
      expect(yes(row['may_email'])).toBe(true);
      expect(recent(row['may_email_at'])).toBe(true);
      expect(row['may_email_by']).toBe(s.ids['owner']);
    });

    it('drops a stamp sent by PATCH and by a bulk edit, by the owner and by the CRM admin', async () => {
      const held = await contact(1);
      expect(said(await s.change('owner', 'contacts', 1, { may_email_at: '2020-01-01T09:00:00Z', may_email_by: 'somebody-else' }))).toBe('ok');
      expect(await contact(1)).toMatchObject({ may_email_by: held['may_email_by'] });
      expect(ms((await contact(1))['may_email_at'])).toBe(ms(held['may_email_at']));
      expect(said(await s.send('ada', 'POST', data(`${s.t('contacts')}/bulk`), { action: 'update', ids: [1], values: { may_email_by: 'somebody-else' } }))).toBe('ok');
      expect((await contact(1))['may_email_by']).toBe(held['may_email_by']);
      // A tick by the CRM admin is stamped as her, whatever she sends beside it.
      expect(said(await s.change('ada', 'contacts', 1, { may_email: false, may_email_by: s.ids['owner'] }))).toBe('ok');
      expect((await contact(1))['may_email_by']).toBe(s.ids['ada']);
    });

    it('refuses a brought line that carries a stamp, by its column, and stamps one that leaves it blank', async () => {
      for (const who of ['owner', 'ada'] as const) {
        const brought = await bring(who, 'contacts', `Id,Name,May email,Ticked by\n${who === 'owner' ? '10' : '20'},Ines Holt,yes,somebody-else\n${who === 'owner' ? '11' : '21'},Ola Berg,yes,\n`, [
          { from: 'Id', to: 'id' },
          { from: 'Name', to: 'name' },
          { from: 'May email', to: 'may_email' },
          { from: 'Ticked by', to: 'may_email_by' },
        ]);
        expect(brought.lines.map((line) => [line.status, line.column])).toEqual([
          ['refused', 'may_email_by'],
          ['new', undefined],
        ]);
        expect(brought.stats).toMatchObject({ inserted: 1 });
        const made = await contact(who === 'owner' ? 11 : 21);
        expect(made['may_email_by']).toBe(s.ids[who]);
        expect(recent(made['may_email_at'])).toBe(true);
        expect(await s.rows(`select id from crm_contacts where id = ${who === 'owner' ? '10' : '20'}`)).toEqual([]);
      }
    });

    it('takes a blank "may be e-mailed" as no, its default, instead of refusing it as required', async () => {
      const brought = await bring('owner', 'contacts', 'Id,Name,May email\n30,Pia Lund,\n31,Tor Ek,yes\n', [
        { from: 'Id', to: 'id' },
        { from: 'Name', to: 'name' },
        { from: 'May email', to: 'may_email' },
      ]);
      expect(brought.lines.map((line) => line.status)).toEqual(['new', 'new']);
      expect(brought.stats).toMatchObject({ inserted: 2 });
      expect(yes((await contact(30))['may_email'])).toBe(false);
      expect(yes((await contact(31))['may_email'])).toBe(true);
    });

    it('names a won deal brought in without its closed date, and keeps the date one brings', async () => {
      const brought = await bring('ada', 'deals', 'Id,Name,State,Closed\n1,Harbour refit,won,\n2,Mill roof,won,2025-05-01T10:00:00Z\n3,Barn doors,open,\n', [
        { from: 'Id', to: 'id' },
        { from: 'Name', to: 'name' },
        { from: 'State', to: 'state' },
        { from: 'Closed', to: 'closed_at' },
      ]);
      expect(brought.lines.map((line) => [line.row, line.status, line.column])).toEqual([
        [1, 'refused', 'closed_at'],
        [2, 'new', undefined],
        [3, 'new', undefined],
      ]);
      expect(brought.stats).toMatchObject({ inserted: 2 });
      expect(await deal(1)).toBeUndefined();
      expect(ms((await deal(2))!['closed_at'])).toBe(Date.parse('2025-05-01T10:00:00Z'));
      expect((await deal(3))!['closed_at']).toBeNull();
    });

    it("still stamps a person's own save of a won deal", async () => {
      expect(said(await s.make('owner', 'deals', { id: 4, name: 'Quay lights', state: 'won' }))).toBe('ok');
      expect(recent((await deal(4))!['closed_at'])).toBe(true);
      expect(said(await s.change('owner', 'deals', 3, { state: 'lost' }))).toBe('ok');
      expect(recent((await deal(3))!['closed_at'])).toBe(true);
    });

    it('takes requiredWhen beside a stamp on Studio\'s door too', async () => {
      const issue = columnRuleIssue(
        'column.requiredWhen',
        { column: 'state', in: ['won'] },
        { name: 'closed_at', logicalType: 'timestamptz', nullable: true, isGenerated: false } as never,
        { dialect, tables: [], enums: [], relations: [] } as never,
        undefined,
        { rules: [{ op: 'column.stamp', columnName: 'closed_at', value: { set: 'now', on: { column: 'state', values: ['won'] } } }] },
      );
      // Not refused as a column Adminium fills: only the table it names is unknown to this bare model.
      expect(issue ?? '').not.toContain('so nobody is asked for it');
    });
  });
}

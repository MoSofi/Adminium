// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE REST OF "CHECKED AGAINST ANOTHER COLUMN", against the whole server on
 * SQLite, Postgres and MySQL, on every door a person writes by: a create, a
 * change (PATCH), a bulk edit and a brought file (its preview and its run).
 *
 *  - a number against a number: warm below stale (`strict`), judged also when
 *    only one of the two is changed, the refusal naming both;
 *  - a time of day kept as text against another: work starts before it ends;
 *  - an end at most so many days after a start: a cover lasts a year at most,
 *    and an empty end ("until further notice") stays allowed;
 *  - a moment not before now on a create (D18): a visit is never booked in
 *    the past, while a later change, and a brought file (history), are not
 *    held to it.
 *
 * A number, a time of day and a span are no history, so a brought file is
 * held to them too; a moment in the past is history, so it is not.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

// The words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.35' }));

const id = { ref: 'id', type: 'int', role: 'pk' };

function desk(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Desk',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.35', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'prefs',
          columns: [
            id,
            { ref: 'stale_days', type: 'int', default: 14 },
            { ref: 'warm_days', type: 'int', default: 7, rules: { notAfter: { column: 'stale_days', strict: true } } },
            { ref: 'work_to', type: 'text', maxLength: 5, default: '17:00' },
            { ref: 'work_from', type: 'text', maxLength: 5, default: '09:00', rules: { notAfter: { column: 'work_to', strict: true } } },
          ],
        },
        {
          ref: 'covers',
          columns: [
            id,
            { ref: 'starts_on', type: 'date' },
            { ref: 'ends_on', type: 'date', nullable: true, rules: { notBefore: { column: 'starts_on' }, notAfter: { column: 'starts_on', days: 365 } } },
          ],
        },
        { ref: 'visits', columns: [id, { ref: 'title', type: 'text', maxLength: 80 }, { ref: 'starts_at', type: 'timestamptz', rules: { notBefore: 'now' } }] },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'desk', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const fields = (res: Reply): Record<string, { code: string }> => (res.json() as { error?: { details?: { fields?: Record<string, { code: string }> } } }).error?.details?.fields ?? {};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a value checked against another column [${dialect}]`, () => {
    let s: WholeServer;
    const data = (path: string) => `/api/v1/data/${s.connectionId}/${path}`;
    const bulk = (ref: string, ids: number[], values: Record<string, unknown>) => s.send('owner', 'POST', data(`${s.t(ref)}/bulk`), { action: 'update', ids, values });
    /** A file brought into a table: what its preview says of each line, and what its run made. */
    const bring = async (ref: string, csv: string, columns: { from: string; to: string }[]) => {
      const up = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=lines.csv', headers: { cookie: s.cookie['owner']!, 'content-type': 'text/csv' }, payload: csv });
      expect(up.statusCode, up.body).toBe(201);
      const made = await s.send('owner', 'POST', '/api/v1/imports', { fileId: (up.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t(ref), mapping: { columns }, options: { mode: 'insert' } });
      expect(made.statusCode, made.body).toBe(201);
      const importId = (made.json() as { data: { import: { id: string } } }).data.import.id;
      const preview = await s.get('owner', `/api/v1/imports/${importId}/preview`);
      expect(preview.statusCode, preview.body).toBe(200);
      const run = await s.send('owner', 'POST', `/api/v1/imports/${importId}/run`);
      expect(run.statusCode, run.body).toBeLessThan(300);
      await s.jobs();
      const view = await s.get('owner', `/api/v1/imports/${importId}`);
      return {
        lines: (preview.json() as { data: { lines: { row: number; status: string; column?: string }[] } }).data.lines,
        stats: (view.json() as { data: { stats: { inserted: number; skipped: number } } }).data.stats,
      };
    };
    const count = async (ref: string) => Number((await s.rows(`select count(*) as n from desk_${ref}`))[0]!['n']);

    beforeAll(async () => {
      s = await wholeServer(dialect, desk());
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('keeps warm below stale on a create, naming both', async () => {
      const above = await s.make('owner', 'prefs', { stale_days: 14, warm_days: 20 });
      expect(said(above)).toBe('422 VALIDATION_FAILED');
      expect(fields(above)).toEqual({ warm_days: { code: 'out-of-range' }, stale_days: { code: 'out-of-range' } });
      // Strict: the same number is refused too.
      expect(said(await s.make('owner', 'prefs', { stale_days: 14, warm_days: 14 }))).toBe('422 VALIDATION_FAILED');
      expect(said(await s.make('owner', 'prefs', { id: 1, stale_days: 14, warm_days: 7 }))).toBe('ok');
    });

    it('judges a change of one of the two against the other as held, by PATCH and by a bulk edit', async () => {
      const warm = await s.change('owner', 'prefs', 1, { warm_days: 30 });
      expect(said(warm)).toBe('422 VALIDATION_FAILED');
      expect(fields(warm)).toMatchObject({ warm_days: { code: 'out-of-range' }, stale_days: { code: 'out-of-range' } });
      expect(said(await s.change('owner', 'prefs', 1, { stale_days: 5 }))).toBe('422 VALIDATION_FAILED');
      expect(said(await bulk('prefs', [1], { warm_days: 40 }))).not.toBe('ok');
      expect((await s.rows('select warm_days from desk_prefs where id = 1'))[0]).toMatchObject({ warm_days: 7 });
      expect(said(await s.change('owner', 'prefs', 1, { warm_days: 10 }))).toBe('ok');
      expect((await s.rows('select warm_days, stale_days from desk_prefs where id = 1'))[0]).toMatchObject({ warm_days: 10, stale_days: 14 });
    });

    it('keeps work starting before it ends, as times of day', async () => {
      const late = await s.change('owner', 'prefs', 1, { work_from: '18:00' });
      expect(said(late)).toBe('422 VALIDATION_FAILED');
      expect(fields(late)).toMatchObject({ work_from: { code: 'out-of-range' }, work_to: { code: 'out-of-range' } });
      // As times, never as text: 9:30 is before 17:00 though "9" sorts after "1".
      expect(said(await s.change('owner', 'prefs', 1, { work_from: '9:30' }))).toBe('ok');
      expect(said(await s.change('owner', 'prefs', 1, { work_to: '09:00' }))).toBe('422 VALIDATION_FAILED');
      expect(said(await bulk('prefs', [1], { work_from: '17:00' }))).not.toBe('ok');
      expect((await s.rows('select work_from from desk_prefs where id = 1'))[0]).toMatchObject({ work_from: '9:30' });
    });

    it('holds a brought file to warm below stale, and names the line', async () => {
      const brought = await bring('prefs', 'Id,Stale,Warm\n2,14,7\n3,10,12\n', [
        { from: 'Id', to: 'id' },
        { from: 'Stale', to: 'stale_days' },
        { from: 'Warm', to: 'warm_days' },
      ]);
      expect(brought.lines.map((line) => [line.row, line.status])).toEqual([
        [1, 'new'],
        [2, 'refused'],
      ]);
      expect(brought.stats).toMatchObject({ inserted: 1 });
      expect(await count('prefs')).toBe(2);
    });

    it('keeps a cover to a year at most, and an empty end allowed', async () => {
      expect(said(await s.make('owner', 'covers', { id: 1, starts_on: '2026-01-01', ends_on: '2027-01-01' }))).toBe('ok');
      const longer = await s.make('owner', 'covers', { starts_on: '2026-01-01', ends_on: '2027-01-02' });
      expect(said(longer)).toBe('422 VALIDATION_FAILED');
      expect(fields(longer)).toMatchObject({ ends_on: { code: 'out-of-range' }, starts_on: { code: 'out-of-range' } });
      expect(said(await s.make('owner', 'covers', { id: 2, starts_on: '2026-01-01', ends_on: null }))).toBe('ok');
      // Its start moved back a day: the end is now a day too far.
      expect(said(await s.change('owner', 'covers', 1, { starts_on: '2025-12-31' }))).toBe('422 VALIDATION_FAILED');
      expect(said(await bulk('covers', [2], { ends_on: '2028-01-01' }))).not.toBe('ok');
      expect((await s.rows('select ends_on from desk_covers where id = 2'))[0]!['ends_on']).toBeNull();
      const brought = await bring('covers', 'Id,Start,End\n3,2026-03-01,2026-09-01\n4,2026-03-01,2028-03-01\n', [
        { from: 'Id', to: 'id' },
        { from: 'Start', to: 'starts_on' },
        { from: 'End', to: 'ends_on' },
      ]);
      expect(brought.lines.map((line) => line.status)).toEqual(['new', 'refused']);
      expect(await count('covers')).toBe(3);
    });

    it('books a visit no earlier than now on a create; a change and a brought file are not held to it', async () => {
      const past = new Date(Date.now() - 3_600_000).toISOString();
      const soon = new Date(Date.now() + 3_600_000).toISOString();
      const before = await s.make('owner', 'visits', { title: 'Site survey', starts_at: past });
      expect(said(before)).toBe('422 VALIDATION_FAILED');
      expect(fields(before)).toEqual({ starts_at: { code: 'out-of-range' } });
      expect(said(await s.make('owner', 'visits', { id: 1, title: 'Site survey', starts_at: soon }))).toBe('ok');
      // Now, as the form was filled a moment ago: taken.
      expect(said(await s.make('owner', 'visits', { id: 2, title: 'Walk-in', starts_at: new Date(Date.now() - 20_000).toISOString() }))).toBe('ok');
      // A later change may correct a visit that happened.
      expect(said(await s.change('owner', 'visits', 1, { starts_at: past }))).toBe('ok');
      const brought = await bring('visits', `Id,Title,Starts\n3,Old visit,${past}\n`, [
        { from: 'Id', to: 'id' },
        { from: 'Title', to: 'title' },
        { from: 'Starts', to: 'starts_at' },
      ]);
      expect(brought.lines.map((line) => line.status)).toEqual(['new']);
      expect(await count('visits')).toBe(3);
    });
  });
}

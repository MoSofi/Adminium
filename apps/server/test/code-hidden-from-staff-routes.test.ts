// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A code no desk hands out (`code.hiddenFromStaff`) stays out of what the
 * data routes answer, against the whole server on every engine: a list, one
 * record, a list that asks for the column, orders or filters by it, a search,
 * the record's history and a write's reply — for a role that reads the whole
 * table and for the Super Admin alike.
 *
 * (`code-hidden-from-staff.test.ts` proves the view and the e-mail; this
 * proves the routes read through that view.)
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a code staff never read, over the data routes [${dialect}]`, () => {
    let w: World;
    let code: string;
    const cookies = new Map<PersonName | 'owner', string>();
    const as = async (who: PersonName | 'owner'): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const get = async (who: PersonName | 'owner', rest: string) => w.app.inject({ method: 'GET', url: `/api/v1/data/${w.connectionId}/deals${rest}`, headers: { cookie: await as(who) } });

    beforeAll(async () => {
      w = await world(dialect);
      await w.meta.db.deleteFrom('adminium_schema_overrides').where('connectionId', '=', w.connectionId).where('op', '=', 'column.code' as never).where('columnName', '=', 'ref_code').execute();
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.code', tableName: w.id('deals'), columnName: 'ref_code', value: { length: 8, hiddenFromStaff: true }, origin: 'user' } as never);
      await w.role('reader', { deals: { actions: ['read', 'update'] } });
      await w.give('lena', 'reader');
      await w.run(`UPDATE deals SET ref_code = 'K7QX2M9B' WHERE id = 1`);
      code = 'K7QX2M9B';
      // A change of the record, so that it has a history.
      const changed = await w.app.inject({ method: 'PATCH', url: `/api/v1/data/${w.connectionId}/deals/1`, headers: { cookie: await as('lena') }, payload: { values: { title: 'Deal 1, renamed' } } });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.body).not.toContain(code);
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    for (const who of ['lena', 'owner'] as const) {
      it(`${who === 'owner' ? 'the Super Admin' : 'a role that reads the whole table'} is answered no code, by any read`, async () => {
        for (const rest of ['?limit=50', '/1', '/1/history?limit=50', `?q=${code.slice(0, 5)}`]) {
          const res = await get(who, rest);
          expect(res.statusCode, `${rest}: ${res.body}`).toBe(200);
          expect(res.body, rest).not.toContain(code);
          expect(res.body, rest).not.toContain('ref_code');
        }
        // Asked for by name, ordered or filtered by: refused, and never answered with it.
        for (const rest of ['?select=id,ref_code', '?order=ref_code.asc', `?where=${encodeURIComponent(JSON.stringify({ column: 'ref_code', op: 'eq', value: code }))}`]) {
          const res = await get(who, rest);
          expect(res.statusCode, rest).toBeGreaterThanOrEqual(400);
          expect(res.body, rest).not.toContain(code);
        }
        // The row is still there, with everything else of it.
        expect((JSON.parse((await get(who, '/1')).body) as { data: Record<string, unknown> }).data['title']).toBe('Deal 1, renamed');
      });
    }

    it('nobody writes one either', async () => {
      const res = await w.app.inject({ method: 'PATCH', url: `/api/v1/data/${w.connectionId}/deals/1`, headers: { cookie: await as('lena') }, payload: { values: { ref_code: 'AAAAAAAA' } } });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect((await w.rows('SELECT ref_code FROM deals WHERE id = 1'))[0]!['ref_code']).toBe(code);
    });
  });
}

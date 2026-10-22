// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A summary's section held to "this year", or to "the last N days", on the
 * business's calendar: on a real database of each engine, across the turn of
 * the year where the business is.
 *
 * The business is in Auckland. The rule runs at 12:00 UTC on 31 December
 * 2026, which is 01:00 on 1 January 2027 there: its year is 2027, while the
 * server's clock (UTC) still says 2026. Dana's deals:
 *
 *   id  close_on     met_at (UTC)          Auckland
 *    1  2026-12-31   2026-12-31 10:30      31 Dec 2026, 23:30   last year
 *    2  2027-01-01   2026-12-31 11:30       1 Jan 2027, 00:30   this year, today
 *   10  2026-06-01   2026-06-01 00:00       1 Jun 2026          last year (but UTC's year)
 *   11  2027-12-31   2027-12-31 10:59      31 Dec 2027, 23:59   this year
 *   12  2028-01-01   2027-12-31 11:00       1 Jan 2028, 00:00   next year
 */
import { automationActionSchema, emailTemplatesRepo, rolesRepo, settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { boundNode } from '../src/apps/manifest-automations.js';
import { digestSendPayloadSchema, sendDigest, withinFilter } from '../src/automations/digest.js';
import { encryptSecret } from '../src/config/secrets.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { emailSecretKey } from '../src/email/config.js';
import { TEST_SECRET } from './helpers.js';
import { ENGINES, world, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const ZONE = 'Pacific/Auckland';
/** 01:00 on 1 January 2027 in Auckland; still 31 December 2026 in UTC. */
const MADE_AT = Date.parse('2026-12-31T12:00:00.000Z');

const DEALS: [number, string, string][] = [
  [10, '2026-06-01', '2026-06-01T00:00:00.000Z'],
  [11, '2027-12-31', '2027-12-31T10:59:00.000Z'],
  [12, '2028-01-01', '2027-12-31T11:00:00.000Z'],
];

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a summary's section of this year, or of the last days [${dialect}]`, () => {
    let w: World;
    let rule: string;
    let rep: string;
    /** An instant as this engine's column keeps it: an instant, UTC's wall clock on a UTC session, or this server's wall clock. */
    const stored = (iso: string): string => (dialect === 'postgres' ? iso : dialect === 'mysql' ? iso.slice(0, 19).replace('T', ' ') : String(normalizeWriteValue({ logicalType: 'timestamp' } as never, iso)));
    const section = (key: string, within: Record<string, unknown>) => ({ key, table: w.id('deals'), owner: 'owner_id', where: [], orderBy: { column: 'id', dir: 'asc' }, limit: 50, sum: ['amount'], within });
    const SECTIONS = () => [
      section('year-by-day', { column: 'close_on', this: 'year' }),
      section('year-by-moment', { column: 'met_at', this: 'year' }),
      section('two-days', { column: 'close_on', lastDays: 2 }),
      section('today-by-moment', { column: 'met_at', lastDays: 1 }),
    ];
    const send = async (madeAt: number, sections: Record<string, unknown>[] = SECTIONS()) => {
      const payload = digestSendPayloadSchema.parse({ ruleId: rule, ruleName: 'Dana’s year', runId: `run-${String(madeAt)}`, connectionId: w.connectionId, userId: w.people.dana, templateKey: 'firm-year', roles: [rep], sections, sendEmpty: true, madeAt });
      return sendDigest({ meta: w.meta, manager: w.manager, secret: TEST_SECRET }, payload, madeAt + 60_000);
    };

    beforeAll(async () => {
      w = await world(dialect);
      await settingsRepo(w.meta).set(
        'email.smtp',
        { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Firm <no-reply@firm.test>', secure: false },
        { updatedBy: null },
      );
      await w.meta.db.updateTable('adminium_connections').set({ timezone: ZONE }).where('id', '=', w.connectionId).execute();
      await w.run(`ALTER TABLE deals ADD COLUMN met_at ${dialect === 'postgres' ? 'TIMESTAMPTZ' : 'TIMESTAMP'} NULL`);
      const q = `'${w.people.dana}'`;
      for (const [id, day, moment] of DEALS) {
        await w.run(`INSERT INTO deals (id, title, owner_id, state, amount, big, company_id, close_on) VALUES (${String(id)}, 'Deal ${String(id)}', ${q}, 'won', ${String(id * 100)}, ${dialect === 'postgres' ? 'false' : '0'}, 1, '${day}')`);
        await w.run(`UPDATE deals SET met_at = '${stored(moment)}' WHERE id = ${String(id)}`);
      }
      await w.run(`UPDATE deals SET close_on = '2026-12-31', met_at = '${stored('2026-12-31T10:30:00.000Z')}' WHERE id = 1`);
      await w.run(`UPDATE deals SET close_on = '2027-01-01', met_at = '${stored('2026-12-31T11:30:00.000Z')}' WHERE id = 2`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      rep = await w.role('rep', { deals: { actions: ['read'], rows: { read: OWN } } });
      rep = (await rolesRepo(w.meta).findBySlug('rep'))!.id;
      await w.give('dana', 'rep');
      const rows = (key: string) => ({ block: 'email.rows', id: `rows-${key}`, data: { section: key, row: { title: '{{row.title}}' }, empty: 'None.' } });
      await emailTemplatesRepo(w.meta).create({ kind: 'template', key: 'firm-year', locale: 'en_US', name: 'Year', subject: 'Your year, {{name}}', blocks: SECTIONS().map((one) => rows(one.key)), enabled: true });
      // Saved through the rules' own door, which reads every word of it.
      const saved = await w.app.inject({
        method: 'POST',
        url: '/api/v1/automations',
        headers: { cookie: w.owner.cookie },
        payload: {
          name: 'Dana’s year',
          connectionId: w.connectionId,
          trigger: { kind: 'schedule', connectionId: w.connectionId, schedule: { kind: 'weekly', time: '07:00', dayOfWeek: 1, timezone: ZONE } },
          graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'Each week' }, { id: 'sum', kind: 'action', title: 'Her year', action: { kind: 'digest', templateKey: 'firm-year', to: { roles: [rep] }, sections: SECTIONS(), sendEmpty: true } }] },
          enabled: true,
        },
      });
      expect(saved.statusCode, saved.body).toBe(201);
      rule = (JSON.parse(saved.body) as { id: string }).id;
    }, 180_000);
    afterAll(async () => {
      await w?.close();
    });

    it('counts the business\'s year, from its own midnight on 1 January, and the last days on its calendar', async () => {
      const outcome = await send(MADE_AT);
      expect(outcome).toEqual({
        sent: true,
        rows: {
          // Deals 2 and 11: not deal 1 (Auckland's 31 December), deal 10 (UTC's year) nor deal 12 (next year).
          'year-by-day': 2,
          'year-by-moment': 2,
          // Today and yesterday where the business is: 1 January 2027 and 31 December 2026.
          'two-days': 2,
          // Today alone, from Auckland's midnight: deal 2, met at 00:30 there.
          'today-by-moment': 1,
        },
      });
    });

    it('turns with the business\'s year, not with the server\'s', async () => {
      // An hour before Auckland's midnight it is still 2026 there: deals 1 and 10.
      const before = await send(Date.parse('2026-12-31T10:00:00.000Z'));
      expect(before).toMatchObject({ sent: true, rows: { 'year-by-day': 2, 'year-by-moment': 2, 'two-days': 1, 'today-by-moment': 1 } });
      // Which rows, by name, for the year by a moment: the filter the section reads.
      const filter = withinFilter({ column: 'met_at', this: 'year' }, { id: 'deals', columns: new Map([['met_at', { name: 'met_at', logicalType: 'timestamptz' }]]) } as never, ZONE, MADE_AT);
      expect(filter).toEqual({ and: [{ column: 'met_at', op: 'gte', value: '2026-12-31T11:00:00.000Z' }, { column: 'met_at', op: 'lt', value: '2027-12-31T11:00:00.000Z' }] });
      const days = withinFilter({ column: 'close_on', lastDays: 7 }, { id: 'deals', columns: new Map([['close_on', { name: 'close_on', logicalType: 'date' }]]) } as never, ZONE, MADE_AT);
      expect(days).toEqual({ and: [{ column: 'close_on', op: 'gte', value: '2026-12-26' }, { column: 'close_on', op: 'lt', value: '2027-01-02' }] });
    });

    it('refuses at the save a section held by a column that keeps no date', async () => {
      const res = await w.app.inject({
        method: 'POST',
        url: '/api/v1/automations',
        headers: { cookie: w.owner.cookie },
        payload: {
          name: 'By a title',
          connectionId: w.connectionId,
          trigger: { kind: 'schedule', connectionId: w.connectionId, schedule: { kind: 'weekly', time: '07:00', dayOfWeek: 1, timezone: ZONE } },
          graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'Each week' }, { id: 'sum', kind: 'action', title: 'Her year', action: { kind: 'digest', templateKey: 'firm-year', to: { roles: [rep] }, sections: [section('year-by-day', { column: 'title', this: 'year' })], sendEmpty: true } }] },
          enabled: true,
        },
      });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.body).toContain('keeps no date');
    });

    it('is carried from an app\'s manifest to the stored step as written', () => {
      const bound = boundNode(
        { id: 'sum', kind: 'action', title: 'Her year', action: { kind: 'digest', templateKey: 'firm-year', to: { roles: ['rep'] }, sections: [{ key: 'won', table: 'deals', owner: 'owner_id', within: { column: 'close_on', this: 'year' } }, { key: 'recent', table: 'deals', owner: 'owner_id', within: { column: 'met_at', lastDays: 30 } }] } },
        { connectionId: w.connectionId, realId: (ref) => `real.${ref}`, roleId: (key) => `role-${key}`, timezone: ZONE, language: 'en-US' },
      ) as { action: unknown };
      const action = automationActionSchema.parse(bound.action) as { kind: 'digest'; sections: { table: string; within?: unknown }[] };
      expect(action.sections.map((one) => [one.table, one.within])).toEqual([
        ['real.deals', { column: 'close_on', this: 'year' }],
        ['real.deals', { column: 'met_at', lastDays: 30 }],
      ]);
    });
  });
}

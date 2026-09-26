// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An automation reads a `date` column as the calendar day it holds, on this
 * server's clock, on every engine and in every zone the server may run in.
 *
 * Every engine reads a date back as its `YYYY-MM-DD` text. A trigger's
 * condition, evaluated when a record changes, and the scheduled scan, which
 * asks the database, must then agree about the same row at the same moment:
 * an invoice due on the 14th is not "within the last day" at 18:00 on the
 * 13th, in Los Angeles or in Kolkata. Run this file under `TZ=UTC`,
 * `Europe/Berlin`, `America/Los_Angeles` and `Asia/Kolkata`.
 *
 * And a rule watching a date "updated" column carries on from where it was
 * before dates read as text: a cursor stored as the instant of the day's
 * local midnight (Postgres and MySQL handed a date back as a JavaScript date)
 * neither reads that day again nor mints new keys for rows that already ran.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  automationRunsRepo,
  automationsRepo,
  jobsRepo,
  type Automation,
  type AutomationCondition,
  type AutomationGraph,
  type AutomationTrigger,
  type EnqueueJobInput,
  type Job,
} from '@adminium/meta';

import { evaluateCondition } from '../src/automations/conditions.js';
import { recordOccurrenceKey } from '../src/automations/events.js';
import { AutomationMatcher } from '../src/automations/matcher.js';
import { scanDueSchedules } from '../src/automations/schedule.js';
import { pollWatchedTables } from '../src/automations/watch.js';
import type { ResolvedTable } from '../src/crud/identifiers.js';
import type { Row } from '../src/crud/mask.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const GRAPH: AutomationGraph = { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }] };
const DAY_MS = 86_400_000;

const manifest = () =>
  invoicingManifest([
    {
      ref: 'bills',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'due_on', type: 'date', nullable: true },
        { ref: 'updated_on', type: 'date', nullable: true },
      ],
    },
  ]);

/** `YYYY-MM-DD` of a local calendar day, plus some days. */
const localDay = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DUE = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17'];

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

async function setUp(dialect: (typeof LEGS)[number][0]) {
  const h = (open = await installInvoicing(dialect, manifest()));
  const view = await loadSnapshotView(h.meta, h.connectionId);
  const table = view.table(h.real('bills'));
  let now = 0;
  const enqueue = (input: EnqueueJobInput): Promise<Job> => jobsRepo(h.meta).enqueue({ ...input, kind: 'noop-progress' }, now);
  const makeRule = async (trigger: AutomationTrigger, patch: Partial<Automation> = {}) =>
    automationsRepo(h.meta).create({ connectionId: h.connectionId, name: 'Rule', trigger, graph: GRAPH, enabled: true, ...patch } as never, now);
  const runsOf = async (ruleId: string) => automationRunsRepo(h.meta).list({ since: 0, automationId: ruleId });
  return {
    h,
    table,
    enqueue,
    makeRule,
    runsOf,
    setNow: (at: number) => {
      now = at;
    },
    deps: () => ({ meta: h.meta, manager: h.manager, enqueue, now: () => now }),
  };
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`automations read a date as its day on ${dialect} (TZ=${process.env['TZ'] ?? 'unset'})`, () => {
    it('the event path and the scheduled scan agree, by the day on this server’s clock, around its edges', async () => {
      const s = await setUp(dialect);
      for (const [i, day] of DUE.entries()) {
        await s.h.rows(`insert into ${s.h.real('bills')} (id, due_on) values (${String(i + 1)}, '${day}')`);
      }
      const { db } = await s.h.manager.data(s.h.connectionId);
      const rows = (await db.selectFrom(s.table.id as never).selectAll().execute()) as Row[];
      expect(rows.map((row) => row['due_on']).sort()).toEqual(DUE);

      const conditions: [AutomationCondition['op'], number, (day: string, today: string, shift: (n: number) => string) => boolean][] = [
        ['within_last', 1, (day, today, shift) => day >= shift(-1) && day <= today],
        ['more_than_ago', 1, (day, _today, shift) => day < shift(-1)],
        ['more_than_ago', 2, (day, _today, shift) => day < shift(-2)],
        ['within_next', 2, (day, today, shift) => day >= today && day <= shift(2)],
        ['more_than_ahead', 1, (day, _today, shift) => day > shift(1)],
      ];
      // On the server's own clock: the evening before the 14th, the last and
      // the first minute either side of its midnight, and its noon.
      const moments = [new Date(2026, 7, 13, 18, 0), new Date(2026, 7, 13, 23, 59), new Date(2026, 7, 14, 0, 1), new Date(2026, 7, 14, 12, 0)].map((d) => d.getTime());

      for (const at of moments) {
        s.setNow(at);
        const today = localDay(at);
        const shift = (n: number) => localDay(at + n * DAY_MS);
        for (const [op, amount, holds] of conditions) {
          const condition = { left: { field: 'due_on' }, op, right: { amount, unit: 'days' } } as AutomationCondition;
          const expected = rows.filter((row) => holds(String(row['due_on']), today, shift)).map((row) => Number(row['id'])).sort((a, b) => a - b);
          const label = `${op} ${String(amount)} at ${new Date(at).toString()}`;

          // The event path: the record as a trigger reads it, with its table and without.
          const byEvent: number[] = [];
          const byShape: number[] = [];
          for (const row of rows) {
            if (await evaluateCondition(condition, { row, table: s.table, now: at })) byEvent.push(Number(row['id']));
            if (await evaluateCondition(condition, { row, now: at })) byShape.push(Number(row['id']));
          }
          expect(byEvent.sort((a, b) => a - b), `event: ${label}`).toEqual(expected);
          expect(byShape.sort((a, b) => a - b), `event without its table: ${label}`).toEqual(expected);

          // The scheduled scan: the same condition, asked of the database.
          const rule = await s.makeRule(
            {
              kind: 'schedule',
              connectionId: s.h.connectionId,
              schedule: { kind: 'interval', everyMinutes: '60' },
              forEach: { table: s.table.id, once: true, where: [condition] },
            } as AutomationTrigger,
            { nextRunAt: at } as never,
          );
          await scanDueSchedules(s.deps());
          const byScan = (await s.runsOf(rule.id)).map((run) => Number(run.triggerEvent.record?.pk['id'])).sort((a, b) => a - b);
          expect(byScan, `scan: ${label}`).toEqual(expected);
          await automationsRepo(s.h.meta).update(rule.id, { enabled: false });
        }
      }
    }, 120_000);

    it('a watch on a date "updated" column carries on after dates read as days: no day read again, no row run twice', async () => {
      const s = await setUp(dialect);
      const insert = (id: number, day: string) => s.h.rows(`insert into ${s.h.real('bills')} (id, updated_on) values (${String(id)}, '${day}')`);
      // 1 and 2 ran, and the cursor stands on 2. 5 ran from a dashboard save the
      // poller had not reached yet. 3 and 4 have not run.
      await insert(1, '2026-08-14');
      await insert(2, '2026-08-14');
      await insert(3, '2026-08-15');
      await insert(4, '2026-08-14');
      await insert(5, '2026-08-15');
      s.setNow(Date.UTC(2026, 7, 16, 12));

      const rule = await s.makeRule({ kind: 'record', event: 'updated', connectionId: s.h.connectionId, table: s.table.id, watch: true } as AutomationTrigger);
      /*
       * What the version before stored. Postgres and MySQL handed a date back
       * as a JavaScript date at this server's local midnight: the cursor held
       * its ISO instant and a key its epoch. SQLite handed back the text.
       */
      const before = (day: string): unknown => {
        if (dialect === 'sqlite') return day;
        const [y, m, d] = day.split('-').map(Number) as [number, number, number];
        return new Date(y, m - 1, d);
      };
      const cursorValue = before('2026-08-14');
      await automationsRepo(s.h.meta).advance(rule.id, {
        watchCursor: { column: 'updated_on', value: cursorValue instanceof Date ? cursorValue.toISOString() : (cursorValue as string), frontierPk: { id: 2 } },
      });
      for (const [id, day] of [
        [1, '2026-08-14'],
        [2, '2026-08-14'],
        [5, '2026-08-15'],
      ] as const) {
        const pk = { id };
        const run = await automationRunsRepo(s.h.meta).begin(
          {
            automationId: rule.id,
            dedupeKey: recordOccurrenceKey({ ruleId: rule.id, table: s.table, pk, changeStamp: before(day) }),
            origin: 'watch',
            triggerEvent: {
              event: 'record.updated',
              origin: 'watch',
              ruleId: null,
              hops: 0,
              record: { connectionId: s.h.connectionId, table: s.table.id, pk, label: String(id) },
              snapshot: null,
              occurredAt: Date.UTC(2026, 7, 15),
            },
            wakeAt: null,
          },
          Date.UTC(2026, 7, 15),
        );
        expect(run).not.toBeNull();
      }

      // One tick: the rows after the cursor, and of those only the two that never ran.
      const tick = await pollWatchedTables(s.deps());
      expect(tick).toMatchObject({ rulesPolled: 1, rowsSeen: 3, runsStarted: 2 });
      const ran = async () => (await s.runsOf(rule.id)).map((run) => Number(run.triggerEvent.record?.pk['id'])).sort((a, b) => a - b);
      expect(await ran()).toEqual([1, 2, 3, 4, 5]);
      const cursor = (await automationsRepo(s.h.meta).findById(rule.id))?.watchCursor;
      expect(cursor).toMatchObject({ column: 'updated_on', value: '2026-08-15', frontierPk: { id: 5 } });
      expect((await pollWatchedTables(s.deps())).runsStarted).toBe(0);

      // A save through Adminium that leaves the day as it was is the same occurrence it always was.
      const matcher = new AutomationMatcher({ meta: s.h.meta, enqueue: s.enqueue, now: () => Date.UTC(2026, 7, 16, 12) });
      const { db } = await s.h.manager.data(s.h.connectionId);
      const row1 = (await db.selectFrom(s.table.id as never).selectAll().where('id' as never, '=', 1 as never).executeTakeFirst()) as Row;
      await matcher.onRecordEvent({
        connectionId: s.h.connectionId,
        table: s.table as ResolvedTable,
        action: 'update',
        entity: { connectionId: s.h.connectionId, table: s.table.id, pk: { id: 1 }, label: '1' },
        before: row1,
        after: row1,
        origin: 'public',
      });
      expect(await ran()).toEqual([1, 2, 3, 4, 5]);
    }, 120_000);
  });
}

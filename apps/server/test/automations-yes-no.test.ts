// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE COMPARES A YES/NO THE SAME ON EVERY DATABASE.
 *
 * A yes/no column reads `true` on Postgres and `1` on SQLite and MySQL. A
 * condition written "is true" used to hold on one, "is 1" on the others —
 * a shipped rule could not say either and work everywhere. Both sides are
 * now read as a yes or a no: when a record changes (evaluated in memory) and
 * when a schedule asks the database (bound in SQL), and the two agree about
 * every row.
 *
 * And two mistakes are refused when a rule is saved, where before they were
 * rules that never ran: anything but "is" / "is not" on a yes/no, and a count
 * of related rows among a schedule's conditions.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { automationRunsRepo, automationsRepo, jobsRepo, type AutomationCondition, type AutomationGraph, type AutomationTrigger, type EnqueueJobInput, type Job } from '@adminium/meta';

import { evaluateCondition } from '../src/automations/conditions.js';
import { scanDueSchedules } from '../src/automations/schedule.js';
import { resolveRule } from '../src/automations/validate.js';
import { yesNo } from '../src/automations/yes-no.js';
import type { Row } from '../src/crud/mask.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const GRAPH: AutomationGraph = { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }] };
const manifest = () =>
  invoicingManifest([
    {
      ref: 'orders',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'auto_send', type: 'bool', nullable: true },
        { ref: 'line_count', type: 'int', default: 0 },
      ],
    },
    { ref: 'order_lines', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'order_id', type: 'fk', references: 'orders' }] },
  ]);

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

describe('a yes or a no, whatever spelled it', () => {
  it('reads every spelling a database or a rule uses, and nothing else', () => {
    for (const yes of [true, 1, 1n, '1', 'true', 'TRUE', ' yes ']) expect(yesNo(yes), String(yes)).toBe(true);
    for (const no of [false, 0, 0n, '0', 'false', 'No']) expect(yesNo(no), String(no)).toBe(false);
    for (const neither of [null, undefined, '', 'maybe', 2, -1, {}, 'y']) expect(yesNo(neither), String(neither)).toBeNull();
  });
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a rule's yes/no condition on ${dialect}`, () => {
    async function setUp() {
      const h = (open = await installInvoicing(dialect, manifest()));
      const view = await loadSnapshotView(h.meta, h.connectionId);
      const table = view.table(h.real('orders'));
      const flag = (on: boolean) => (dialect === 'postgres' ? String(on) : on ? '1' : '0');
      // Two that send by themselves, two that do not, one nobody answered.
      await h.rows(`insert into ${h.real('orders')} (id, auto_send, line_count) values (1, ${flag(true)}, 2), (2, ${flag(false)}, 0), (3, ${flag(true)}, 0), (4, ${flag(false)}, 5), (5, NULL, 1)`);
      const { db } = await h.manager.data(h.connectionId);
      const rows = (await db.selectFrom(table.id as never).selectAll().execute()) as Row[];
      const enqueue = (input: EnqueueJobInput): Promise<Job> => jobsRepo(h.meta).enqueue({ ...input, kind: 'noop-progress' }, 1);
      return { h, view, table, rows, enqueue };
    }

    it('"is true", "is 1" and "is yes" hold for the same rows — when a record changes and when the schedule asks the database', async () => {
      const s = await setUp();
      // A rule's right side is text or a number (a stored rule has no yes/no of its own): every spelling of one.
      const cases: [AutomationCondition['op'], unknown, number[]][] = [
        ['is', 1, [1, 3]],
        ['is', 'true', [1, 3]],
        ['is', 'yes', [1, 3]],
        ['is', 0, [2, 4]],
        ['is', 'no', [2, 4]],
        // "Is not yes" keeps the row nobody answered: nothing said is not a yes.
        ['is_not', 'true', [2, 4, 5]],
        ['is_not', 'false', [1, 3, 5]],
      ];
      for (const [op, right, expected] of cases) {
        const condition = { left: { field: 'auto_send' }, op, right } as AutomationCondition;
        const label = `${op} ${JSON.stringify(right)}`;
        const byEvent: number[] = [];
        for (const row of s.rows) if (await evaluateCondition(condition, { row, table: s.table, now: 1 })) byEvent.push(Number(row['id']));
        // In memory an unanswered row is neither: "is not yes" does not hold for it there…
        expect(byEvent.sort((a, b) => a - b), `event: ${label}`).toEqual(expected.filter((id) => id !== 5));

        const rule = await automationsRepo(s.h.meta).create(
          { connectionId: s.h.connectionId, name: 'Rule', graph: GRAPH, enabled: true, nextRunAt: 1, trigger: { kind: 'schedule', connectionId: s.h.connectionId, schedule: { kind: 'interval', everyMinutes: '60' }, forEach: { table: s.table.id, once: true, where: [condition] } } as AutomationTrigger } as never,
          1,
        );
        await scanDueSchedules({ meta: s.h.meta, manager: s.h.manager, enqueue: s.enqueue, now: () => 1 });
        const byScan = (await automationRunsRepo(s.h.meta).list({ since: 0, automationId: rule.id })).map((run) => Number(run.triggerEvent.record?.pk['id'])).sort((a, b) => a - b);
        // …and the scan, which a person reading "is not" expects to keep it, does (as "is not" does for every column).
        expect(byScan, `scan: ${label}`).toEqual(expected);
        await automationsRepo(s.h.meta).update(rule.id, { enabled: false });
      }
    }, 120_000);

    it('a plain number column is still compared as a number', async () => {
      const s = await setUp();
      const held = async (condition: AutomationCondition) => {
        const out: number[] = [];
        for (const row of s.rows) if (await evaluateCondition(condition, { row, table: s.table, now: 1 })) out.push(Number(row['id']));
        return out.sort((a, b) => a - b);
      };
      expect(await held({ left: { field: 'line_count' }, op: 'gt', right: 0 } as AutomationCondition)).toEqual([1, 4, 5]);
      expect(await held({ left: { field: 'line_count' }, op: 'is', right: 1 } as AutomationCondition)).toEqual([5]);
    }, 120_000);

    it('a rule that could never run is refused when it is saved', async () => {
      const s = await setUp();
      const ctx = { view: s.view, templateKeys: new Set<string>(), blockLoopback: true };
      const scan = (where: AutomationCondition[]): AutomationTrigger => ({ kind: 'schedule', connectionId: s.h.connectionId, schedule: { kind: 'interval', everyMinutes: '60' }, forEach: { table: s.table.id, once: false, where } }) as AutomationTrigger;
      const save = (where: AutomationCondition[]) => () => resolveRule(scan(where), GRAPH, ctx as never);

      expect(save([{ left: { field: 'auto_send' }, op: 'is', right: 'true' } as AutomationCondition])).not.toThrow();
      expect(save([{ left: { field: 'auto_send' }, op: 'not_empty' } as AutomationCondition])).not.toThrow();
      // "Greater than yes" holds on no engine.
      expect(save([{ left: { field: 'auto_send' }, op: 'gt', right: 0 } as AutomationCondition])).toThrow('is a yes/no, so a rule asks whether it is or is not');
      expect(save([{ left: { field: 'auto_send' }, op: 'contains', right: 'tr' } as AutomationCondition])).toThrow('is a yes/no');
      // Neither a yes nor a no.
      expect(save([{ left: { field: 'auto_send' }, op: 'is', right: 'maybe' } as AutomationCondition])).toThrow('compare it with yes or no');

      // A count of related rows is a second query: a scan cannot ask it, and used to throw at every tick with nobody told.
      const counted = { left: { count: { table: s.view.table(s.h.real('order_lines')).id, matchColumn: 'order_id', equalsField: 'id' } }, op: 'gt', right: 0 } as AutomationCondition;
      expect(save([counted])).toThrow("A schedule's conditions are read by the database. Count related rows in a step after it.");
      // The same count on a record's own trigger is what it has always been.
      const onRecord = { kind: 'record', event: 'updated', connectionId: s.h.connectionId, table: s.table.id, watch: false, when: [counted] } as AutomationTrigger;
      expect(() => resolveRule(onRecord, GRAPH, ctx as never)).not.toThrow();
    }, 120_000);
  });
}

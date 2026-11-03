// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ceil` and `floor` written by the write path on every engine: a print job's
 * sheets are `ceil(quantity / pieces per sheet)` stored in a whole-number
 * column, and a share rounded down stored in a `numeric(10,2)` at its scale,
 * the app's own columns and an operator's rule on a table the app did not make.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type Dialect, type InvoicingHarness } from './invoicing-install.helpers.js';
import { units } from './invoicing-writes.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(): Record<string, unknown> {
  const m = invoicingManifest([
    {
      ref: 'jobs',
      columns: [
        id,
        { ref: 'qty', type: 'int', nullable: true },
        { ref: 'per_sheet', type: 'int', nullable: true },
        { ref: 'sheets', type: 'int', nullable: true, rules: { formula: { ceil: { div: ['qty', 'per_sheet'] } } } },
        { ref: 'whole', type: 'int', nullable: true, rules: { formula: { floor: { div: ['qty', 'per_sheet'] } } } },
        { ref: 'share', type: 'decimal', scale: 2, nullable: true, rules: { formula: { floor: { div: ['qty', 3] } } } },
        { ref: 'share_up', type: 'decimal', scale: 2, nullable: true, rules: { formula: { ceil: [{ div: ['qty', 3] }, 1] } } },
      ],
    },
  ]);
  // A band, a working-day stamp and a ceil or floor are read by Adminium 0.3.43 and later.
  m['compatibility'] = { minAdminiumVersion: '0.3.43' };
  return m;
}

/** A table the app did not make: a whole-number column and a `numeric(10,2)` one, each an operator's rule. */
function printsDdl(dialect: Dialect, name: string): string {
  if (dialect === 'postgres') return `create table ${name} (id serial primary key, qty int, per_sheet int, sheets int, share numeric(10,2))`;
  if (dialect === 'mysql') return `create table ${name} (id int auto_increment primary key, qty int null, per_sheet int null, sheets int null, share decimal(10,2) null)`;
  return `create table ${name} (id integer primary key autoincrement, qty integer, per_sheet integer, sheets integer, share numeric(10,2))`;
}

const two = (value: unknown) => (value === null || value === undefined ? null : units(value, 2).toString());

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`ceil and floor written, on ${dialect}`, () => {
    let h: InvoicingHarness & { reply: Record<string, unknown> };
    let w: Awaited<ReturnType<typeof writerFor>>;
    const row = async (table: string, key: unknown) => (await h.rows(`select * from ${table} where id = ${String(key)}`))[0]!;

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest());
      expect((h.reply['rules'] as { skipped: unknown[] }).skipped).toEqual([]);
      await h.rows(printsDdl(dialect, h.real('prints')));
      await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const model = parseDatabaseModel(snapshot.schema);
      const prints = model.tables.find((t) => t.name === h.real('prints'))!;
      const column = (name: string) => prints.columns.find((c) => c.name === name)!;
      const rules = [
        ['sheets', { ceil: { div: ['qty', 'per_sheet'] } }],
        ['share', { floor: [{ div: ['qty', 3] }, 2] }],
      ] as const;
      for (const [target, formula] of rules) {
        expect(columnRuleIssue('column.formula', { formula }, column(target), model)).toBeNull();
        await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.formula', tableName: prints.id, columnName: target, value: { formula }, origin: 'user' });
      }
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.scale', tableName: prints.id, columnName: 'share', value: { scale: 2 }, origin: 'user' });
      // Places past 4 are refused as round's are.
      expect(columnRuleIssue('column.formula', { formula: { ceil: ['qty', 5] } }, column('sheets'), model)).not.toBeNull();
      w = await writerFor(h);
    }, 120_000);

    afterAll(async () => {
      await h?.close();
    });

    it('stores the sheets a quantity needs, rounded up, and the whole sheets, rounded down', async () => {
      const job = await w.create('jobs', { qty: 250, per_sheet: 24 });
      const stored = await row(h.real('jobs'), job['id']);
      expect(Number(stored['sheets'])).toBe(11);
      expect(Number(stored['whole'])).toBe(10);
      // 250 / 3 = 83.333…: down to 83.33 at the column's scale, up to 83.4 at one place.
      expect(two(stored['share'])).toBe('8333');
      expect(two(stored['share_up'])).toBe('8340');
      // An exact fit is that many sheets, not one more.
      await w.update('jobs', job['id'], { qty: 240 });
      const exact = await row(h.real('jobs'), job['id']);
      expect(Number(exact['sheets'])).toBe(10);
      expect(Number(exact['whole'])).toBe(10);
      expect(two(exact['share'])).toBe('8000');
    });

    it('rounds a negative number towards minus and plus infinity', async () => {
      const job = await w.create('jobs', { qty: -250, per_sheet: 24 });
      const stored = await row(h.real('jobs'), job['id']);
      expect(Number(stored['sheets'])).toBe(-10);
      expect(Number(stored['whole'])).toBe(-11);
      expect(two(stored['share'])).toBe('-8334');
      expect(two(stored['share_up'])).toBe('-8330');
    });

    it('leaves the result empty when a divisor is missing or zero', async () => {
      const job = await w.create('jobs', { qty: 250, per_sheet: 0 });
      const stored = await row(h.real('jobs'), job['id']);
      expect(stored['sheets']).toBeNull();
      expect(stored['whole']).toBeNull();
    });

    it('works an operator rule out into an int and a numeric(10,2) column', async () => {
      const job = await w.create('prints', { qty: 1001, per_sheet: 100 });
      const stored = await row(h.real('prints'), job['id']);
      expect(Number(stored['sheets'])).toBe(11);
      // 1001 / 3 = 333.666…: floor keeps 333.66, never round's 333.67.
      expect(two(stored['share'])).toBe('33366');
    });
  });
}

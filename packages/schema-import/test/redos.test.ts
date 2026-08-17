// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Polynomial-ReDoS regression tests for the parsers that read *uploaded* schema
 * files (CodeQL js/polynomial-redos alerts #11–#18). Each case feeds the exact
 * pathological input CodeQL named, asserts the parse finishes far inside a
 * budget every quadratic matcher blew through, and asserts the parse is still
 * *correct* — a timing test on its own would pass just as happily if the fix
 * had broken the grammar.
 *
 * Why the trailing `\r`: the old matchers ended `(.*)$` / `(.+)$`, and `.` never
 * matches a line terminator, so `$` could not land and the engine retried every
 * split of the preceding whitespace run. A `schema.rb` or `models.py` saved with
 * CR-only line endings is one enormous "line" full of `\r`, so this is a shape a
 * real upload has, not only a crafted one. Those lines were skipped before the
 * fix and are skipped after it.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile } from '../src/index.js';
import { snakeCase } from '../src/text.js';

/** ~120 KB of spaces. At 20 KB every matcher below already cost ~0.6s. */
const PAD = ' '.repeat(60_000);
/** Generous: the linear versions all run in single-digit milliseconds. */
const BUDGET_MS = 1_000;

function timed<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

describe('rails schema.rb — quadratic statement matchers', () => {
  const goodTable = [
    'create_table "orders", force: :cascade do |t|',
    '  t.string "status", null: false',
    '  t.integer "quantity", default: 1, null: false',
    'end',
  ].join('\n');

  /** `'<keyword> ' + many '  '` + a `\r` the old `(.*)$` could not get past. */
  const attackLine = (keyword: string): string => `${keyword} ${PAD}\r"orders", ["status"]\rx`;

  it('create_table (#12) stays linear and keeps parsing the rest of the file', () => {
    const content = `${attackLine('create_table')}\n${goodTable}\n`;
    const { ms, value } = timed(() => parseSchemaFile(content, { format: 'rails' }));
    expect(ms).toBeLessThan(BUDGET_MS);
    // The mangled line is not a create_table (it never was), the real one is.
    expect(value.model.tables.map((t) => t.name)).toEqual(['orders']);
    expect(value.model.tables[0]?.columns.map((c) => c.name)).toEqual([
      'id',
      'status',
      'quantity',
    ]);
  });

  it('t.<method> (#13) stays linear and keeps parsing sibling columns', () => {
    const content = [
      'create_table "orders", force: :cascade do |t|',
      `  t.string ${PAD}\r"status"\rx`,
      '  t.integer "quantity", default: 1, null: false',
      'end',
    ].join('\n');
    const { ms, value } = timed(() => parseSchemaFile(content, { format: 'rails' }));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.model.tables[0]?.columns.map((c) => c.name)).toEqual(['id', 'quantity']);
  });

  it('add_index (#14) stays linear and keeps the real indexes', () => {
    const content = `${goodTable}\n${attackLine('add_index')}\nadd_index "orders", ["status"], name: "idx_status"\n`;
    const { ms, value } = timed(() => parseSchemaFile(content, { format: 'rails' }));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.model.tables[0]?.indexes.map((i) => i.name)).toEqual(['idx_status']);
  });

  it('add_foreign_key (#15) stays linear and keeps the real FK', () => {
    const content = [
      'create_table "customers", force: :cascade do |t|',
      '  t.string "email"',
      'end',
      'create_table "orders", force: :cascade do |t|',
      '  t.bigint "customer_id", null: false',
      'end',
      attackLine('add_foreign_key'),
      'add_foreign_key "orders", "customers", on_delete: :cascade',
    ].join('\n');
    const { ms, value } = timed(() => parseSchemaFile(content, { format: 'rails' }));
    expect(ms).toBeLessThan(BUDGET_MS);
    const fk = value.model.relations.find((r) => r.from.tableId === 'public.orders');
    expect(fk?.to.tableId).toBe('public.customers');
    expect(fk?.onDelete).toBe('cascade');
  });

  it('add_check_constraint (#16) stays linear and keeps the real constraint', () => {
    const content = [
      goodTable,
      attackLine('add_check_constraint'),
      `add_check_constraint "orders", "status IN ('new', 'done')", name: "orders_status_check"`,
    ].join('\n');
    const { ms, value } = timed(() => parseSchemaFile(content, { format: 'rails' }));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.model.tables[0]?.checks).toEqual([
      { name: 'orders_status_check', expression: "status IN ('new', 'done')" },
    ]);
    // `col IN (...)` is lifted to a check-sourced enum.
    expect(value.model.enums.map((e) => e.values)).toEqual([['new', 'done']]);
  });

  it('still accepts a legal statement padded with a long run of spaces', () => {
    const content = `${goodTable}\nadd_index${PAD}"orders", ["status"], name: "idx_status"\n`;
    const { ms, value } = timed(() => parseSchemaFile(content, { format: 'rails' }));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.model.tables[0]?.indexes.map((i) => i.name)).toEqual(['idx_status']);
  });

  it('t.<method> keeps its `!`/`?` suffix and no-argument forms', () => {
    const content = [
      'create_table "orders", force: :cascade do |t|',
      '  t.timestamps',
      '  t.jsonb! "payload"',
      'end',
    ].join('\n');
    const { model, warnings } = parseSchemaFile(content, { format: 'rails' });
    expect(model.tables[0]?.columns.map((c) => c.name)).toEqual([
      'id',
      'created_at',
      'updated_at',
    ]);
    expect(warnings.some((w) => /t\.jsonb!/.test(w))).toBe(true);
  });
});

describe('typeorm entity scan — quadratic class matcher (#18)', () => {
  it("stays linear on 'class $' + many '$' and still finds the real entity", () => {
    // The `$` run must be the last `class` in the file with no `{` after it —
    // that is the case where the old `[^{]*\{` scanned to the end and then
    // retried every split of the run against the name's `[\w$]*`.
    const source = [
      "@Entity('orders')",
      'export class Order {',
      '  @PrimaryGeneratedColumn()',
      '  id!: number;',
      '',
      "  @Column({ type: 'varchar', length: 24 })",
      '  reference!: string;',
      '}',
      `class $${'$'.repeat(60_000)}`,
    ].join('\n');
    const { ms, value } = timed(() => parseSchemaFile(source, { format: 'typeorm' }));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.model.tables.map((t) => t.name)).toEqual(['orders']);
    expect(value.model.tables[0]?.columns.map((c) => c.name)).toEqual(['id', 'reference']);
  });
});

describe('django Meta assignment — quadratic key=value matcher (#11)', () => {
  const model = (metaBody: string): string =>
    [
      'from django.db import models',
      '',
      '',
      'class Order(models.Model):',
      '    reference = models.CharField(max_length=24)',
      '',
      '    class Meta:',
      metaBody,
      '        db_table = "orders"',
      '',
    ].join('\n');

  it("stays linear on '_=' + many ' ' and still honours db_table", () => {
    const { ms, value } = timed(() =>
      parseSchemaFile(model(`        ordering =${PAD}\r["reference"]\rx`), { format: 'django' }),
    );
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.model.tables.map((t) => t.name)).toEqual(['orders']);
    expect(value.model.tables[0]?.columns.map((c) => c.name)).toEqual(['id', 'reference']);
  });

  it('still reads a Meta value padded with a long run of spaces', () => {
    const { ms, value } = timed(() =>
      parseSchemaFile(model(`        unique_together =${PAD}[["reference"]]`), {
        format: 'django',
      }),
    );
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.model.tables[0]?.uniques.map((u) => u.columns)).toEqual([['reference']]);
  });
});

describe('snakeCase — quadratic upper-case-run matcher (#17)', () => {
  it('stays linear on a long run of "A" and returns the same string', () => {
    const { ms, value } = timed(() => snakeCase('A'.repeat(60_000)));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).toBe('a'.repeat(60_000));
  });

  it('still splits acronym boundaries the way the old pattern did', () => {
    expect(snakeCase('HTTPServer')).toBe('http_server');
    expect(snakeCase('OrderItem')).toBe('order_item');
    expect(snakeCase('UserID')).toBe('user_id');
    expect(snakeCase('ABCdEFgh')).toBe('ab_cd_e_fgh');
    expect(snakeCase('Order2Item')).toBe('order2_item');
    expect(snakeCase('order-item')).toBe('order_item');
    expect(snakeCase('Order')).toBe('order');
  });
});

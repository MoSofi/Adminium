import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyClassification, classifyModel, parseDatabaseModel } from '../src/index.js';

/**
 * Golden-file test: the FULL classified output for the Northwind fixture
 * (every column's semantics + every table's shape/role) is snapshotted to
 * fixtures/northwind.classified.json. Any heuristic change shows up as a
 * reviewable diff of that file.
 *
 * To regenerate after an intentional rule change:
 *   UPDATE_GOLDEN=1 pnpm --filter @adminium/engine test
 */

const modelPath = fileURLToPath(new URL('./fixtures/northwind.model.json', import.meta.url));
const goldenPath = fileURLToPath(
  new URL('./fixtures/northwind.classified.json', import.meta.url),
);

const model = parseDatabaseModel(readFileSync(modelPath, 'utf8'));
const classified = classifyModel(model);

describe('northwind classification golden file', () => {
  it('matches fixtures/northwind.classified.json byte-for-byte', () => {
    const actual = JSON.parse(JSON.stringify(classified)) as unknown;
    if (process.env['UPDATE_GOLDEN'] !== undefined || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as unknown;
    expect(actual).toEqual(golden);
  });

  it('covers every table and column of the model', () => {
    expect(classified.tables).toHaveLength(model.tables.length);
    const columnCount = classified.tables.reduce((n, t) => n + t.columns.length, 0);
    expect(columnCount).toBe(model.tables.reduce((n, t) => n + t.columns.length, 0));
  });
});

describe('northwind spot checks (independent of the golden file)', () => {
  const table = (id: string) => classified.tables.find((t) => t.tableId === id)!;
  const column = (tableId: string, name: string) =>
    table(tableId).columns.find((c) => c.column === name)!;

  it('employees is a people table with a reports_to hierarchy', () => {
    const employees = table('public.employees');
    expect(employees.shape.kind).toBe('people');
    expect(employees.semantics.role).toBe('people');
    expect(employees.semantics.hierarchy).toEqual({ parentColumn: 'reports_to' });
  });

  it('join tables are detected structurally', () => {
    expect(table('public.employee_territories').semantics.role).toBe('join-table');
    expect(table('public.customer_customer_demo').semantics.role).toBe('join-table');
  });

  it('order_details is a line-items child', () => {
    expect(table('public.order_details').semantics.role).toBe('line-items');
  });

  it('us_states is geo-shaped', () => {
    expect(table('public.us_states').shape.kind).toBe('geo');
  });

  it('person identity + PII land on employees/customers', () => {
    expect(column('public.employees', 'first_name').semantics.primary).toBe('person-name');
    expect(column('public.employees', 'first_name').semantics.flags.pii).toBe('person-name');
    expect(column('public.customers', 'phone').semantics.primary).toBe('phone');
    expect(column('public.customers', 'address').semantics.flags.pii).toBe('address');
    expect(column('public.employees', 'birth_date').semantics.flags.pii).toBe('dob');
  });

  it('media, urls, money, and regions classify as expected', () => {
    expect(column('public.employees', 'photo').semantics.primary).toBe('image-url');
    expect(column('public.employees', 'photo_path').semantics.primary).toBe('image-url');
    expect(column('public.categories', 'picture').semantics.primary).toBe('image-url');
    expect(column('public.suppliers', 'homepage').semantics.primary).toBe('url');
    expect(column('public.products', 'unit_price').semantics.primary).toBe('money');
    expect(column('public.customers', 'country').semantics.primary).toBe('geo-region');
    expect(column('public.orders', 'order_date').semantics.primary).toBe('event-timestamp');
    expect(column('public.orders', 'customer_id').semantics.primary).toBe('fk');
  });

  it('display columns pick the human-readable label', () => {
    expect(table('public.products').displayColumn).toBe('product_name');
    expect(table('public.customers').displayColumn).toBe('company_name');
    expect(table('public.categories').displayColumn).toBe('category_name');
  });
});

describe('applyClassification', () => {
  it('fills semantics on a new model without mutating the input', () => {
    expect(model.tables[0]!.semantics).toBeNull();
    const applied = applyClassification(model);
    expect(applied).not.toBe(model);
    expect(model.tables[0]!.semantics).toBeNull(); // input untouched
    for (const t of applied.tables) {
      expect(t.semantics).not.toBeNull();
      for (const c of t.columns) {
        expect(c.semantics).not.toBeNull();
        expect(c.semantics!.source).toBe('heuristic');
      }
    }
  });

  it('preserves existing override/llm semantics (overrides always win)', () => {
    const withOverride = structuredClone(model);
    const target = withOverride.tables.find((t) => t.id === 'public.products')!;
    const overridden = target.columns.find((c) => c.name === 'unit_price')!;
    overridden.semantics = {
      primary: 'plain',
      flags: { secret: false, pii: null, maskedByDefault: false },
      format: null,
      pair: null,
      confidence: 1,
      source: 'override',
    };
    const applied = applyClassification(withOverride);
    const after = applied.tables
      .find((t) => t.id === 'public.products')!
      .columns.find((c) => c.name === 'unit_price')!;
    expect(after.semantics!.primary).toBe('plain');
    expect(after.semantics!.source).toBe('override');
  });
});

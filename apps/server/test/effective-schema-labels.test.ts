// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `llm.label` in the effective schema (06-llm-assist.md §8.3): an accepted
 * LLM label bundle is a real override row (`op: 'llm.label'`, origin 'llm',
 * localized value) — before M11 `applyOverrides` had no case for it and the
 * rename silently vanished. These tests pin the resolution rules:
 *
 *   - the L10n map resolves to the connection's default locale (en_US in v1),
 *   - user `table.label` / `column.label` rows beat llm bundles REGARDLESS of
 *     created_at order (provenance user > llm > heuristic),
 *   - `activeTableLabels` (the generation pipeline's overlay source) agrees
 *     with the model path.
 */
import { describe, expect, it } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import type { SchemaOverride } from '@adminium/meta';

import { activeTableLabels, applyOverrides } from '../src/connections/effective-schema.js';

const MODEL = parseDatabaseModel({
  dialect: 'sqlite',
  name: 'northwind',
  defaultSchema: 'main',
  schemas: ['main'],
  tables: [
    {
      schema: 'main',
      name: 'order_details',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'unit_price', logicalType: 'decimal' },
      ],
      primaryKey: ['id'],
    },
  ],
});

let seq = 0;
/** A decoded `adminium_schema_overrides` row (created_at order = call order). */
function row(
  op: string,
  value: Record<string, unknown>,
  opts: { origin?: 'user' | 'llm'; column?: string | null; status?: 'active' | 'disabled' } = {},
): SchemaOverride {
  seq += 1;
  return {
    id: `ovr_${String(seq).padStart(22, '0')}`,
    connectionId: 'conn_1',
    op: op as SchemaOverride['op'],
    tableName: 'main.order_details',
    columnName: opts.column ?? null,
    value,
    origin: opts.origin ?? (op.startsWith('llm.') ? 'llm' : 'user'),
    llmRunId: null,
    status: opts.status ?? 'active',
    createdBy: null,
    createdAt: 1_000 + seq,
    updatedAt: 1_000 + seq,
  };
}

const LLM_TABLE_BUNDLE = {
  label: { en_US: 'Order lines', de_DE: 'Bestellpositionen' },
  description: { en_US: 'One product line on an order.' },
  icon: 'list',
};

describe('applyOverrides — llm.label', () => {
  it('resolves a table-scoped bundle to the default locale (en_US)', () => {
    const effective = applyOverrides(MODEL, [row('llm.label', LLM_TABLE_BUNDLE)]);
    expect(effective.tables[0]?.label).toBe('Order lines');
  });

  it('resolves to an explicit default locale, falling back to en_US when absent', () => {
    const [de] = applyOverrides(MODEL, [row('llm.label', LLM_TABLE_BUNDLE)], {
      defaultLocale: 'de_DE',
    }).tables;
    expect(de?.label).toBe('Bestellpositionen');
    const [fr] = applyOverrides(MODEL, [row('llm.label', LLM_TABLE_BUNDLE)], {
      defaultLocale: 'fr_FR',
    }).tables;
    expect(fr?.label).toBe('Order lines');
  });

  it('a user table.label wins over a LATER llm.label row (provenance, not created_at)', () => {
    const overrides = [
      row('table.label', { label: 'Line items' }), // user first…
      row('llm.label', LLM_TABLE_BUNDLE), // …llm applied afterwards
    ];
    expect(applyOverrides(MODEL, overrides).tables[0]?.label).toBe('Line items');
  });

  it('a user table.label also wins when it came first in created_at order reversed', () => {
    const overrides = [row('llm.label', LLM_TABLE_BUNDLE), row('table.label', { label: 'Line items' })];
    expect(applyOverrides(MODEL, overrides).tables[0]?.label).toBe('Line items');
  });

  it('a disabled llm.label row stays invisible', () => {
    const effective = applyOverrides(MODEL, [row('llm.label', LLM_TABLE_BUNDLE, { status: 'disabled' })]);
    expect(effective.tables[0]?.label).toBeUndefined();
  });

  it('resolves a column-scoped bundle; a user column.label beats it either way round', () => {
    const bundle = { label: { en_US: 'Unit price', de_DE: 'Stückpreis' } };
    const col = (m: ReturnType<typeof applyOverrides>) =>
      m.tables[0]?.columns.find((c) => c.name === 'unit_price');

    expect(col(applyOverrides(MODEL, [row('llm.label', bundle, { column: 'unit_price' })]))?.label).toBe(
      'Unit price',
    );
    const userWins = [
      row('column.label', { label: 'Price each' }, { column: 'unit_price' }),
      row('llm.label', bundle, { column: 'unit_price' }),
    ];
    expect(col(applyOverrides(MODEL, userWins))?.label).toBe('Price each');
  });
});

describe('degenerate empty-string user labels (legacy rows; write path rejects them now)', () => {
  it("a LATER empty table.label row clears the earlier label — '' is an explicit clear, later row wins", () => {
    const overrides = [row('table.label', { label: 'Orders' }), row('table.label', { label: '' })];
    expect(applyOverrides(MODEL, overrides).tables[0]?.label).toBeUndefined();
    expect(activeTableLabels(overrides).has('main.order_details')).toBe(false);
  });

  it('an earlier empty row loses to a later non-empty one (§3.15 order preserved)', () => {
    const overrides = [row('table.label', { label: '' }), row('table.label', { label: 'Orders' })];
    expect(applyOverrides(MODEL, overrides).tables[0]?.label).toBe('Orders');
    expect(activeTableLabels(overrides).get('main.order_details')).toBe('Orders');
  });

  it('an empty user table.label still LOCKS the table against an llm bundle, either order', () => {
    const userFirst = [row('table.label', { label: '' }), row('llm.label', LLM_TABLE_BUNDLE)];
    const llmFirst = [row('llm.label', LLM_TABLE_BUNDLE), row('table.label', { label: '' })];
    for (const overrides of [userFirst, llmFirst]) {
      expect(applyOverrides(MODEL, overrides).tables[0]?.label).toBeUndefined();
      expect(activeTableLabels(overrides).has('main.order_details')).toBe(false);
    }
  });

  it('an empty user column.label clears the column label and locks out the llm bundle', () => {
    const bundle = { label: { en_US: 'Unit price' } };
    const overrides = [
      row('llm.label', bundle, { column: 'unit_price' }),
      row('column.label', { label: '' }, { column: 'unit_price' }),
    ];
    const column = applyOverrides(MODEL, overrides).tables[0]?.columns.find((c) => c.name === 'unit_price');
    expect(column?.label).toBeUndefined();
  });
});

describe('activeTableLabels (the generation overlay source)', () => {
  it('resolves llm bundles and enforces user > llm', () => {
    expect(activeTableLabels([row('llm.label', LLM_TABLE_BUNDLE)]).get('main.order_details')).toBe(
      'Order lines',
    );
    const both = [row('table.label', { label: 'Line items' }), row('llm.label', LLM_TABLE_BUNDLE)];
    expect(activeTableLabels(both).get('main.order_details')).toBe('Line items');
  });

  it('ignores column-scoped llm bundles and disabled rows', () => {
    const rows = [
      row('llm.label', { label: { en_US: 'Unit price' } }, { column: 'unit_price' }),
      row('llm.label', LLM_TABLE_BUNDLE, { status: 'disabled' }),
    ];
    expect(activeTableLabels(rows).size).toBe(0);
  });
});

/**
 * 23-runtime-translations.md §8 — the micro-SaaS half of the ask.
 *
 * A user-authored rename used to be a bare string, so an operator who renamed
 * "Records" to "Patients" got that in one language forever, while `llm.label`
 * rows were already locale maps. Both shapes are now accepted: a bare string
 * stays correct for a single-language workspace (and is what every existing
 * row holds), a map resolves for the viewer.
 */
describe('user labels are localizable (23 §8)', () => {
  const BILINGUAL = { label: { en_US: 'Patients', de_DE: 'Patienten' } };

  it('resolves a user table label for the viewer locale', () => {
    const overrides = [row('table.label', BILINGUAL)];
    expect(applyOverrides(MODEL, overrides).tables[0]?.label).toBe('Patients');
    expect(
      applyOverrides(MODEL, overrides, { defaultLocale: 'de_DE' }).tables[0]?.label,
    ).toBe('Patienten');
  });

  it('falls back to en_US for a locale the operator has not authored', () => {
    const overrides = [row('table.label', BILINGUAL)];
    expect(
      applyOverrides(MODEL, overrides, { defaultLocale: 'zh_CN' }).tables[0]?.label,
    ).toBe('Patients');
  });

  it('still accepts the bare-string shape every existing row uses', () => {
    const overrides = [row('table.label', { label: 'Line items' })];
    expect(applyOverrides(MODEL, overrides).tables[0]?.label).toBe('Line items');
    expect(
      applyOverrides(MODEL, overrides, { defaultLocale: 'de_DE' }).tables[0]?.label,
    ).toBe('Line items');
  });

  it('localizes column labels the same way', () => {
    const overrides = [
      row('column.label', { label: { en_US: 'Unit price', de_DE: 'Stückpreis' } }, { column: 'unit_price' }),
    ];
    const de = applyOverrides(MODEL, overrides, { defaultLocale: 'de_DE' });
    expect(de.tables[0]?.columns.find((c) => c.name === 'unit_price')?.label).toBe('Stückpreis');
  });

  it('feeds the generation overlay from the same resolution', () => {
    expect(activeTableLabels([row('table.label', BILINGUAL)], 'de_DE').get('main.order_details')).toBe(
      'Patienten',
    );
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The derived-column vocabulary reaches the SERVER through
 * `@adminium/engine/config` and nowhere else.
 *
 * That is not a stylistic preference. dependency-cruiser's
 * `server-no-ui-widgets-charts` forbids `apps/server` importing
 * `@adminium/widgets` at all, so if this re-export is wrong the server cannot
 * see the schema, the decimal arithmetic or the evaluator — and the money law
 * ends up with a second implementation. This file exercises the whole path:
 * the built `page-config` leaf, the config-schema re-export, and the values
 * that come out the other side.
 *
 * It also pins the other half of: the two new blocks are OPT-IN, so every
 * page in the byte-pinned generation baseline must carry neither.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { PageEnvelope } from '../src/config-schema/index.js';
import {
  WORKING_SCALE,
  evaluateDerivedFields,
  formatDecimal,
  gridColumnSpecSchema,
  parseCrudDerived,
  parseDecimal,
} from '../src/config-schema/index.js';

const baselinePath = fileURLToPath(
  new URL('./fixtures/northwind.pages.baseline.json', import.meta.url),
);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<
  string,
  { pages: PageEnvelope[] }
>;

const crudPages = Object.values(baseline).flatMap(({ pages }) =>
  pages.filter((page) => page.template === 'page-crud'),
);

describe('the vocabulary crosses the config-schema boundary intact', () => {
  it('carries the parser, the arithmetic and the evaluator', () => {
    expect(WORKING_SCALE).toBe(6);
    expect(formatDecimal(parseDecimal('1300.0000') ?? 0n, 2)).toBe('1300.00');
  });

  it('parses the owner block and evaluates it to the same numbers as the leaf does', () => {
    const parsed = parseCrudDerived({
      measures: [
        {
          id: 'subtotal',
          table: 'public.invoice_items',
          fkColumn: 'invoice_id',
          fn: 'sum',
          of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
        },
      ],
      fields: [
        {
          id: 'tax_amount',
          scale: 2,
          expr: {
            op: 'mul',
            args: [
              { measure: 'subtotal' },
              { op: 'div', args: [{ col: 'tax_rate' }, { lit: '100' }] },
            ],
          },
        },
        {
          id: 'total',
          scale: 2,
          expr: { op: 'add', args: [{ measure: 'subtotal' }, { field: 'tax_amount' }] },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { values } = evaluateDerivedFields(parsed.value.fields, {
      row: { subtotal: '1266.00', tax_rate: '8.00' },
    });
    expect(values).toEqual({ tax_amount: '101.28', total: '1367.28' });
  });

  it('refuses by name, so a 422 can say which measure and which rule', () => {
    const refused = parseCrudDerived({
      measures: [{ id: 'm', table: 't', fkColumn: 'f', fn: 'sum' }],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.refusal.code).toBe('DERIVED_MEASURE_BODY_REQUIRED');
    expect(refused.refusal.id).toBe('m');
  });
});

describe('the new blocks are absent from every generated page', () => {
  it('covers the baseline (an empty sweep would pass vacuously)', () => {
    expect(crudPages.length).toBeGreaterThanOrEqual(30);
  });

  it.each(crudPages.map((page) => [page.id, page] as const))(
    '%s carries no derived block and no display block',
    (_id, page) => {
      const config = page.config as { columns?: unknown[]; derived?: unknown };
      expect(config.derived).toBeUndefined();
      for (const raw of config.columns ?? []) {
        const column = gridColumnSpecSchema.parse(raw);
        expect(column.derived).toBeUndefined();
        expect(column.display).toBeUndefined();
      }
    },
  );
});

describe('text outcomes', () => {
  const rule = {
    id: 'shipping',
    scale: 0,
    result: 'text' as const,
    expr: {
      cases: [{ when: { left: { measure: 'subtotal' }, cmp: 'gt' as const, right: { lit: '5000' } }, then: { text: 'Waived' } }],
      else: { text: 'Standard' },
    },
  };
  const subtotal = {
    id: 'subtotal',
    table: 'public.invoice_items',
    fkColumn: 'invoice_id',
    fn: 'sum' as const,
    of: { terms: [{ sign: 'plus' as const, factors: ['line_total'] }] },
  };

  it('parses a rule whose outcomes are words and evaluates them per row', () => {
    const parsed = parseCrudDerived({ measures: [subtotal], fields: [rule] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const over = evaluateDerivedFields(parsed.value.fields, { row: { subtotal: '6100.00' } });
    const under = evaluateDerivedFields(parsed.value.fields, { row: { subtotal: '1266.00' } });
    const absent = evaluateDerivedFields(parsed.value.fields, { row: { subtotal: null } });
    expect(over.values['shipping']).toBe('Waived');
    expect(under.values['shipping']).toBe('Standard');
    // An absent operand is not a match; the chain falls through to `else`.
    expect(absent.values['shipping']).toBe('Standard');
    expect(over.masked).toEqual([]);
  });

  it('still refuses the whole field when a predicate operand is refused', () => {
    const parsed = parseCrudDerived({ measures: [subtotal], fields: [rule] });
    if (!parsed.ok) throw new Error(parsed.refusal.message);
    const out = evaluateDerivedFields(parsed.value.fields, { row: { subtotal: null }, masked: ['subtotal'] });
    expect(out.values['shipping']).toBeNull();
    expect(out.masked).toEqual(['shipping']);
  });

  it('refuses a text leaf as an operand of arithmetic or of a comparison', () => {
    const asOperand = parseCrudDerived({
      measures: [subtotal],
      fields: [{ id: 'bad', scale: 2, result: 'text', expr: { op: 'add', args: [{ measure: 'subtotal' }, { text: 'x' }] } }],
    });
    expect(asOperand.ok).toBe(false);
    if (!asOperand.ok) expect(asOperand.refusal.code).toBe('DERIVED_TEXT_PLACEMENT');

    const asCompared = parseCrudDerived({
      measures: [subtotal],
      fields: [
        {
          id: 'bad',
          scale: 0,
          result: 'text',
          expr: { cases: [{ when: { left: { text: 'a' }, cmp: 'eq', right: { text: 'a' } }, then: { text: 'y' } }], else: { text: 'n' } },
        },
      ],
    });
    expect(asCompared.ok).toBe(false);
    if (!asCompared.ok) expect(asCompared.refusal.code).toBe('DERIVED_TEXT_PLACEMENT');
  });

  it('refuses a rule nested inside arithmetic from answering with a word', () => {
    const nested = parseCrudDerived({
      measures: [subtotal],
      fields: [
        {
          id: 'bad',
          scale: 2,
          result: 'text',
          expr: {
            op: 'mul',
            args: [
              { measure: 'subtotal' },
              { cases: [{ when: { left: { measure: 'subtotal' }, cmp: 'gt', right: { lit: '1' } }, then: { text: 'x' } }], else: { lit: '1' } },
            ],
          },
        },
      ],
    });
    expect(nested.ok).toBe(false);
    if (!nested.ok) expect(nested.refusal.code).toBe('DERIVED_TEXT_PLACEMENT');
  });

  it('holds `result` and the text leaf together', () => {
    const undeclared = parseCrudDerived({ measures: [subtotal], fields: [{ ...rule, result: undefined }] });
    expect(undeclared.ok).toBe(false);
    if (!undeclared.ok) expect(undeclared.refusal.code).toBe('DERIVED_TEXT_RESULT');

    const hollow = parseCrudDerived({
      measures: [subtotal],
      fields: [{ id: 'hollow', scale: 2, result: 'text', expr: { measure: 'subtotal' } }],
    });
    expect(hollow.ok).toBe(false);
    if (!hollow.ok) expect(hollow.refusal.code).toBe('DERIVED_TEXT_RESULT');
  });

  it('refuses a later field that reads a text field', () => {
    const reader = parseCrudDerived({
      measures: [subtotal],
      fields: [rule, { id: 'twice', scale: 2, expr: { op: 'mul', args: [{ field: 'shipping' }, { lit: '2' }] } }],
    });
    expect(reader.ok).toBe(false);
    if (!reader.ok) expect(reader.refusal.code).toBe('DERIVED_TEXT_FIELD_READ');
  });

  it('bounds the word', () => {
    const long = parseCrudDerived({
      measures: [subtotal],
      fields: [{ ...rule, expr: { ...rule.expr, else: { text: 'x'.repeat(65) } } }],
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.refusal.code).toBe('DERIVED_MALFORMED');
  });
});

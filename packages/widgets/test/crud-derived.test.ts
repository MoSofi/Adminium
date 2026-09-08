// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  MAX_DERIVED_FIELDS,
  MAX_FIELD_NODES,
  MAX_MEASURES,
  collectFieldColumns,
  emptyPolicyOf,
  parseCrudDerived,
  type CrudDerivedConfigInput,
  type FieldExpr,
  type Measure,
} from '../src/page-config/index.js';

/**
 * The `config.derived` vocabulary (36-derived-columns.md §3.3).
 *
 * Every refusal below is asserted BY NAME rather than by "it failed": a page
 * author whose measure is rejected has to be told which measure and which
 * rule, because these are hard 422s that blank the whole page rather than
 * degradations that blank one cell (D10).
 */

/** The plan's own worked example — all five asks against the real schema. */
const OWNERS_BLOCK: CrudDerivedConfigInput = {
  measures: [
    {
      id: 'subtotal',
      table: 'public.invoice_items',
      fkColumn: 'invoice_id',
      fn: 'sum',
      of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
    },
    {
      id: 'gross',
      table: 'public.invoice_items',
      fkColumn: 'invoice_id',
      fn: 'sum',
      of: { terms: [{ sign: 'plus', factors: ['qty', 'rate'] }] },
    },
  ],
  fields: [
    {
      id: 'discount_total',
      scale: 2,
      expr: { op: 'sub', args: [{ measure: 'gross' }, { measure: 'subtotal' }] },
    },
    {
      id: 'tax_amount',
      scale: 2,
      expr: {
        op: 'mul',
        args: [{ measure: 'subtotal' }, { op: 'div', args: [{ col: 'tax_rate' }, { lit: '100' }] }],
      },
    },
    {
      id: 'total',
      scale: 2,
      expr: { op: 'add', args: [{ measure: 'subtotal' }, { field: 'tax_amount' }] },
    },
    {
      id: 'shipping',
      scale: 2,
      expr: {
        cases: [
          {
            when: { left: { field: 'total' }, cmp: 'gte', right: { lit: '500' } },
            then: { lit: '0' },
          },
        ],
        else: { lit: '12.50' },
      },
    },
  ],
};

const SUM_MEASURE: Measure = {
  id: 'subtotal',
  table: 'public.invoice_items',
  fkColumn: 'invoice_id',
  fn: 'sum',
  of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
};

/** Refuse and name it: the code and the offending id, not just "invalid". */
function refusalOf(raw: unknown, namespace?: Parameters<typeof parseCrudDerived>[1]) {
  const result = parseCrudDerived(raw, namespace);
  if (result.ok) throw new Error('expected a refusal, got a valid block');
  return result.refusal;
}

function valueOf(raw: unknown, namespace?: Parameters<typeof parseCrudDerived>[1]) {
  const result = parseCrudDerived(raw, namespace);
  if (!result.ok) throw new Error(`expected a valid block, got ${result.refusal.code}`);
  return result.value;
}

describe('what a valid block looks like', () => {
  it('reads the five numbers the owner asked for', () => {
    const value = valueOf(OWNERS_BLOCK);
    expect(value.measures.map((m) => m.id)).toEqual(['subtotal', 'gross']);
    expect(value.fields.map((f) => f.id)).toEqual([
      'discount_total',
      'tax_amount',
      'total',
      'shipping',
    ]);
  });

  it('treats an absent block as an empty vocabulary, not a refusal', () => {
    expect(parseCrudDerived(undefined)).toEqual({ ok: true, value: { measures: [], fields: [] } });
    expect(parseCrudDerived(null)).toEqual({ ok: true, value: { measures: [], fields: [] } });
    expect(valueOf({})).toEqual({ measures: [], fields: [] });
  });

  it('defaults the empty-fold policy per aggregate (D18)', () => {
    const base = { id: 'm', table: 't', fkColumn: 'f' } as const;
    const body = { terms: [{ sign: 'plus' as const, factors: ['x'] }] };
    expect(emptyPolicyOf({ ...base, fn: 'sum', of: body })).toBe('zero');
    expect(emptyPolicyOf({ ...base, fn: 'avg', of: body })).toBe('null');
    expect(emptyPolicyOf({ ...base, fn: 'min', of: body })).toBe('null');
    expect(emptyPolicyOf({ ...base, fn: 'sum', of: body, emptyAs: 'null' })).toBe('null');
    // count never observes it: SQL answers an empty COUNT with 0, not NULL.
    expect(emptyPolicyOf({ ...base, fn: 'count', emptyAs: 'null' })).toBe('zero');
  });
});

describe('shape refusals', () => {
  it.each([
    ['not an object', 'nope'],
    ['an unknown key', { measures: [], fields: [], footer: true }],
    ['an unknown aggregate', { measures: [{ ...SUM_MEASURE, fn: 'median' }] }],
    ['an alias that is not an identifier', { measures: [{ ...SUM_MEASURE, id: '1total' }] }],
    ['an alias over 64 bytes', { measures: [{ ...SUM_MEASURE, id: `a${'b'.repeat(64)}` }] }],
    ['a float literal in exponent form', { fields: [{ id: 'f', scale: 2, expr: { lit: '1e5' } }] }],
    ['a bare fraction literal', { fields: [{ id: 'f', scale: 2, expr: { lit: '.5' } }] }],
    ['a leading-zero literal', { fields: [{ id: 'f', scale: 2, expr: { lit: '01' } }] }],
    [
      'a literal finer than the working width',
      { fields: [{ id: 'f', scale: 2, expr: { lit: '1.0000000' } }] },
    ],
    ['a scale wider than the arithmetic', { fields: [{ id: 'f', scale: 7, expr: { lit: '1' } }] }],
    [
      'a fifth case',
      {
        fields: [
          {
            id: 'f',
            scale: 2,
            expr: {
              cases: Array.from({ length: 5 }, () => ({
                when: { left: { lit: '1' }, cmp: 'gt', right: { lit: '0' } },
                then: { lit: '1' },
              })),
              else: { lit: '0' },
            },
          },
        ],
      },
    ],
    [
      'a fifth factor',
      {
        measures: [
          {
            ...SUM_MEASURE,
            of: { terms: [{ sign: 'plus', factors: ['a', 'b', 'c', 'd', 'e'] }] },
          },
        ],
      },
    ],
  ])('refuses %s', (_name, block) => {
    expect(refusalOf(block).code).toBe('DERIVED_MALFORMED');
  });

  it('names where the shape broke', () => {
    const refusal = refusalOf({ measures: [{ ...SUM_MEASURE, fn: 'median' }] });
    expect(refusal.message).toContain('measures.0.fn');
  });
});

describe('the shared alias namespace (D26)', () => {
  it('refuses a measure id that collides with a base column', () => {
    const refusal = refusalOf(OWNERS_BLOCK, { columns: ['id', 'number', 'subtotal'] });
    expect(refusal.code).toBe('DERIVED_ALIAS_COLLISION');
    expect(refusal.id).toBe('subtotal');
  });

  it('refuses a measure id that collides with a lookup alias on the same request', () => {
    const refusal = refusalOf(OWNERS_BLOCK, { takenAliases: ['client_id__display', 'gross'] });
    expect(refusal.code).toBe('DERIVED_ALIAS_COLLISION');
    expect(refusal.id).toBe('gross');
  });

  it('refuses a second measure with the same id', () => {
    const refusal = refusalOf({ measures: [SUM_MEASURE, { ...SUM_MEASURE, fn: 'avg' }] });
    expect(refusal.code).toBe('DERIVED_ALIAS_COLLISION');
    expect(refusal.id).toBe('subtotal');
  });

  it('refuses a field that takes a measure id', () => {
    const refusal = refusalOf({
      measures: [SUM_MEASURE],
      fields: [{ id: 'subtotal', scale: 2, expr: { lit: '1' } }],
    });
    expect(refusal.code).toBe('DERIVED_ALIAS_COLLISION');
    expect(refusal.id).toBe('subtotal');
  });

  it.each(['_masked'])('refuses %s — a row key the read path writes itself', (id) => {
    // Claiming it would overwrite the refusal list, and the visible effect is
    // that refused cells stop rendering masked and start rendering as empty.
    expect(refusalOf({ measures: [], fields: [{ id, scale: 2, expr: { lit: '1' } }] })).toMatchObject({
      code: 'DERIVED_ALIAS_RESERVED',
      id,
    });
    expect(refusalOf({ measures: [{ ...SUM_MEASURE, id }] }).code).toBe('DERIVED_ALIAS_RESERVED');
  });

  it('accepts the owner block against the real invoices columns', () => {
    expect(
      valueOf(OWNERS_BLOCK, {
        columns: ['id', 'number', 'client_id', 'project_id', 'title', 'status', 'tax_rate'],
        takenAliases: ['client_id__display'],
      }).measures,
    ).toHaveLength(2);
  });
});

describe('measure bodies', () => {
  it('refuses an `of` body on count', () => {
    const refusal = refusalOf({ measures: [{ ...SUM_MEASURE, id: 'items', fn: 'count' }] });
    expect(refusal).toMatchObject({ code: 'DERIVED_MEASURE_BODY_FORBIDDEN', id: 'items' });
  });

  it('refuses a sum with nothing to fold', () => {
    const refusal = refusalOf({ measures: [{ id: 'm', table: 't', fkColumn: 'f', fn: 'sum' }] });
    expect(refusal).toMatchObject({ code: 'DERIVED_MEASURE_BODY_REQUIRED', id: 'm' });
  });

  it('refuses `of.factor` on a min measure', () => {
    // k·min(x) = min(k·x) only for k > 0 (D17).
    const refusal = refusalOf({
      measures: [
        {
          id: 'cheapest',
          table: 'public.invoice_items',
          fkColumn: 'invoice_id',
          fn: 'min',
          of: { terms: [{ sign: 'plus', factors: ['rate'] }], factor: '0.01' },
        },
      ],
    });
    expect(refusal).toMatchObject({ code: 'DERIVED_MEASURE_FACTOR_FORBIDDEN', id: 'cheapest' });
  });

  it.each([
    [
      'two terms',
      {
        terms: [
          { sign: 'plus', factors: ['rate'] },
          { sign: 'plus', factors: ['qty'] },
        ],
      },
    ],
    ['two factors', { terms: [{ sign: 'plus', factors: ['qty', 'rate'] }] }],
    ['a negated term', { terms: [{ sign: 'minus', factors: ['rate'] }] }],
  ])('refuses a max over %s', (_name, of) => {
    const refusal = refusalOf({
      measures: [{ id: 'dearest', table: 't', fkColumn: 'f', fn: 'max', of }],
    });
    expect(refusal).toMatchObject({ code: 'DERIVED_MEASURE_SHAPE_FORBIDDEN', id: 'dearest' });
  });

  it('accepts a min over one plain column', () => {
    expect(
      valueOf({
        measures: [
          {
            id: 'cheapest',
            table: 't',
            fkColumn: 'f',
            fn: 'min',
            of: { terms: [{ sign: 'plus', factors: ['rate'] }] },
          },
        ],
      }).measures,
    ).toHaveLength(1);
  });

  it('accepts a multi-term fold with a post-fold factor', () => {
    expect(
      valueOf({
        measures: [
          {
            id: 'discount',
            table: 'public.invoice_items',
            fkColumn: 'invoice_id',
            fn: 'sum',
            of: {
              terms: [{ sign: 'plus', factors: ['qty', 'rate', 'discount_pct'] }],
              factor: '0.01',
            },
          },
        ],
      }).measures[0]?.of?.factor,
    ).toBe('0.01');
  });
});

describe('field references point backward only', () => {
  it('refuses a field that reads itself', () => {
    const refusal = refusalOf({
      fields: [{ id: 'total', scale: 2, expr: { op: 'add', args: [{ field: 'total' }, { lit: '1' }] } }],
    });
    expect(refusal).toMatchObject({ code: 'DERIVED_SELF_REFERENCE', id: 'total' });
  });

  it('refuses a field that reads one declared after it', () => {
    const refusal = refusalOf({
      fields: [
        { id: 'total', scale: 2, expr: { op: 'add', args: [{ field: 'tax' }, { lit: '1' }] } },
        { id: 'tax', scale: 2, expr: { lit: '1' } },
      ],
    });
    expect(refusal).toMatchObject({ code: 'DERIVED_FORWARD_REFERENCE', id: 'total' });
    expect(refusal.message).toContain('tax');
  });

  it('refuses a field that reads nothing that exists', () => {
    const refusal = refusalOf({ fields: [{ id: 'total', scale: 2, expr: { field: 'ghost' } }] });
    expect(refusal).toMatchObject({ code: 'DERIVED_UNKNOWN_FIELD', id: 'total' });
  });

  it('refuses a field that reads an undeclared measure', () => {
    const refusal = refusalOf({ fields: [{ id: 'total', scale: 2, expr: { measure: 'ghost' } }] });
    expect(refusal).toMatchObject({ code: 'DERIVED_UNKNOWN_MEASURE', id: 'total' });
  });
});

describe('division (D6)', () => {
  it('refuses a per-row divisor', () => {
    const refusal = refusalOf({
      fields: [
        { id: 'ratio', scale: 2, expr: { op: 'div', args: [{ lit: '1' }, { col: 'tax_rate' }] } },
      ],
    });
    expect(refusal).toMatchObject({ code: 'DERIVED_DIVISOR_NOT_LITERAL', id: 'ratio' });
  });

  it('refuses a measure as a divisor too', () => {
    const refusal = refusalOf({
      measures: [SUM_MEASURE],
      fields: [
        {
          id: 'ratio',
          scale: 2,
          expr: { op: 'div', args: [{ lit: '1' }, { measure: 'subtotal' }] },
        },
      ],
    });
    expect(refusal.code).toBe('DERIVED_DIVISOR_NOT_LITERAL');
  });

  it.each(['0', '0.0', '0.000000', '-0'])('refuses division by %s', (literal) => {
    const refusal = refusalOf({
      fields: [{ id: 'ratio', scale: 2, expr: { op: 'div', args: [{ lit: '1' }, { lit: literal }] } }],
    });
    expect(refusal).toMatchObject({ code: 'DERIVED_DIVISOR_ZERO', id: 'ratio' });
  });
});

describe('collectFieldColumns', () => {
  it('names every base column the fields read, once, in first-seen order', () => {
    const value = valueOf({
      measures: [SUM_MEASURE],
      fields: [
        {
          id: 'tax',
          scale: 2,
          expr: {
            op: 'mul',
            args: [{ measure: 'subtotal' }, { op: 'div', args: [{ col: 'tax_rate' }, { lit: '100' }] }],
          },
        },
        {
          id: 'band',
          scale: 0,
          expr: {
            cases: [
              { when: { left: { col: 'weight' }, cmp: 'gt', right: { col: 'tax_rate' } }, then: { col: 'zone' } },
            ],
            else: { col: 'weight' },
          },
        },
      ],
    });
    expect(collectFieldColumns(value.fields)).toEqual(['tax_rate', 'weight', 'zone']);
  });

  it('is empty for fields that read only measures and literals', () => {
    const value = valueOf({
      measures: [SUM_MEASURE],
      fields: [{ id: 'x', scale: 2, expr: { op: 'add', args: [{ measure: 'subtotal' }, { lit: '1' }] } }],
    });
    expect(collectFieldColumns(value.fields)).toEqual([]);
  });
});

describe('the budgets', () => {
  const leaf: FieldExpr = { lit: '1' };
  const pair: FieldExpr = { op: 'add', args: [{ lit: '1' }, { lit: '2' }] };

  /** A `cases` node: 1 + three slots per branch + the fallback. */
  function casesNode(
    branches: readonly (readonly [FieldExpr, FieldExpr, FieldExpr])[],
    fallback: FieldExpr,
  ): FieldExpr {
    return {
      cases: branches.map(([left, right, then]) => ({
        when: { left, cmp: 'gte' as const, right },
        then,
      })),
      else: fallback,
    };
  }

  const triple = [leaf, leaf, leaf] as const;

  it(`accepts an AST of exactly ${String(MAX_FIELD_NODES)} nodes`, () => {
    // 1 root + 12 leaf slots + an 11-node nested `cases` fallback = 24.
    const expr = casesNode(
      [triple, triple, triple, triple],
      casesNode([triple, triple, triple], leaf),
    );
    expect(valueOf({ fields: [{ id: 'big', scale: 2, expr }] }).fields).toHaveLength(1);
  });

  it('refuses an AST of 25 nodes', () => {
    // 1 root + (3 + 3 + 1) + 9 leaf slots + an 8-node nested fallback = 25.
    const expr = casesNode(
      [[pair, pair, leaf], triple, triple, triple],
      casesNode([triple, triple], leaf),
    );
    const refusal = refusalOf({ fields: [{ id: 'big', scale: 2, expr }] });
    expect(refusal).toMatchObject({ code: 'DERIVED_FIELD_TOO_LARGE', id: 'big' });
  });

  it('refuses an expression nested four deep', () => {
    const expr: FieldExpr = {
      op: 'add',
      args: [{ op: 'mul', args: [{ op: 'sub', args: [leaf, leaf] }, leaf] }, leaf],
    };
    const refusal = refusalOf({ fields: [{ id: 'deep', scale: 2, expr }] });
    expect(refusal).toMatchObject({ code: 'DERIVED_FIELD_TOO_DEEP', id: 'deep' });
  });

  it('accepts the tax ask, which sits exactly at the depth cap', () => {
    expect(valueOf(OWNERS_BLOCK).fields).toHaveLength(4);
  });

  it('refuses more measures than the shared subquery budget', () => {
    const measures = Array.from({ length: MAX_MEASURES + 1 }, (_, i) => ({
      ...SUM_MEASURE,
      id: `m${String(i)}`,
    }));
    const refusal = refusalOf({ measures });
    expect(refusal.code).toBe('DERIVED_MEASURE_LIMIT');
    expect(refusal.message).toContain('agg');
  });

  it('refuses more fields than a page has any business carrying', () => {
    const fields = Array.from({ length: MAX_DERIVED_FIELDS + 1 }, (_, i) => ({
      id: `f${String(i)}`,
      scale: 2,
      expr: { lit: '1' },
    }));
    expect(refusalOf({ fields }).code).toBe('DERIVED_FIELD_LIMIT');
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stable suggestion-id scheme (06-llm-assist.md §8.1). Locks: each constructor
 * emits the exact §8.1 string; ids are deterministic (stable across calls); the
 * dispatcher matches the constructors; ids are collision-free across every
 * suggestion in the demo schema.
 */
import { describe, expect, it } from 'vitest';

import {
  columnLabelId,
  copyId,
  dashboardId,
  enumId,
  groupId,
  keyId,
  piiId,
  relationId,
  SUGGESTION_ID_PREFIXES,
  suggestionId,
  suggestionIdPrefix,
  tableLabelId,
  templateId,
  widgetId,
  type SuggestionRef,
} from './suggestion-id.js';

describe('suggestion-id constructors match §8.1 verbatim', () => {
  it('emits the documented id strings', () => {
    expect(tableLabelId('public.orders')).toBe('label:public.orders');
    expect(columnLabelId('public.orders', 'total_cents')).toBe('label:public.orders.total_cents');
    expect(keyId('public.orders')).toBe('key:public.orders');
    expect(enumId('public.orders', 'status')).toBe('enum:public.orders.status');
    expect(relationId('public.orders', ['product_id'], 'public.products', ['id'])).toBe(
      'relation:public.orders.product_id->public.products.id',
    );
    expect(piiId('public.customers', 'email')).toBe('pii:public.customers.email');
    expect(templateId('public.orders', 'page-queue-inbox')).toBe(
      'template:public.orders:page-queue-inbox',
    );
    expect(groupId('sales')).toBe('group:sales');
    expect(dashboardId('revenue')).toBe('dashboard:revenue');
    expect(widgetId('revenue', 'chart-line-area', 3)).toBe('widget:revenue:chart-line-area:3');
    expect(copyId('public.orders')).toBe('copy:public.orders');
  });

  it('joins composite relation endpoints deterministically', () => {
    expect(
      relationId('public.a', ['x', 'y'], 'public.b', ['p', 'q']),
    ).toBe('relation:public.a.x,y->public.b.p,q');
  });
});

describe('determinism & distinctness', () => {
  it('produces the same id for the same input every time', () => {
    expect(columnLabelId('public.orders', 'status')).toBe(
      columnLabelId('public.orders', 'status'),
    );
    expect(widgetId('revenue', 'chart-donut', 4)).toBe(widgetId('revenue', 'chart-donut', 4));
  });

  it('distinguishes a table-label id from a column-label id', () => {
    expect(tableLabelId('public.orders')).not.toBe(columnLabelId('public.orders', 'total_cents'));
  });

  it('separates widgets of the same type by rank', () => {
    expect(widgetId('revenue', 'kpi-stat-card', 1)).not.toBe(
      widgetId('revenue', 'kpi-stat-card', 2),
    );
  });
});

describe('suggestionId dispatcher', () => {
  it('matches the individual constructors for every ref kind', () => {
    const cases: Array<[SuggestionRef, string]> = [
      [{ kind: 'table-label', table: 'public.orders' }, 'label:public.orders'],
      [
        { kind: 'column-label', table: 'public.orders', column: 'total_cents' },
        'label:public.orders.total_cents',
      ],
      [{ kind: 'key', table: 'public.orders' }, 'key:public.orders'],
      [{ kind: 'enum', table: 'public.orders', column: 'status' }, 'enum:public.orders.status'],
      [
        {
          kind: 'relation',
          fromTable: 'public.orders',
          fromColumns: ['product_id'],
          toTable: 'public.products',
          toColumns: ['id'],
        },
        'relation:public.orders.product_id->public.products.id',
      ],
      [{ kind: 'pii', table: 'public.customers', column: 'email' }, 'pii:public.customers.email'],
      [
        { kind: 'template', table: 'public.orders', template: 'page-board' },
        'template:public.orders:page-board',
      ],
      [{ kind: 'group', group: 'sales' }, 'group:sales'],
      [{ kind: 'dashboard', dashboard: 'revenue' }, 'dashboard:revenue'],
      [
        { kind: 'widget', dashboard: 'revenue', widget: 'chart-line-area', rank: 3 },
        'widget:revenue:chart-line-area:3',
      ],
      [{ kind: 'copy', table: 'public.orders' }, 'copy:public.orders'],
    ];
    for (const [ref, expected] of cases) {
      expect(suggestionId(ref)).toBe(expected);
    }
  });
});

describe('suggestionIdPrefix', () => {
  it('extracts the known category prefix', () => {
    expect(suggestionIdPrefix('label:public.orders.total_cents')).toBe('label');
    expect(suggestionIdPrefix('widget:revenue:chart-line-area:3')).toBe('widget');
    expect(suggestionIdPrefix('relation:public.orders.product_id->public.products.id')).toBe(
      'relation',
    );
  });

  it('returns null for an unknown or malformed prefix', () => {
    expect(suggestionIdPrefix('mystery:x')).toBeNull();
    expect(suggestionIdPrefix('no-colon')).toBeNull();
    expect(suggestionIdPrefix(':leading')).toBeNull();
  });

  it('covers every declared prefix', () => {
    expect(new Set(SUGGESTION_ID_PREFIXES).size).toBe(SUGGESTION_ID_PREFIXES.length);
  });
});

describe('collision-freedom across the demo schema (§6.2/§6.3)', () => {
  it('assigns a unique id to every atomic suggestion', () => {
    const orders = 'public.orders';
    const customers = 'public.customers';
    const products = 'public.products';

    const ids: string[] = [
      // table-label + key + copy bundles, per table
      tableLabelId(orders),
      tableLabelId(customers),
      tableLabelId(products),
      keyId(orders),
      keyId(customers),
      keyId(products),
      copyId(orders),
      copyId(customers),
      copyId(products),
      // column labels
      columnLabelId(orders, 'order_number'),
      columnLabelId(orders, 'customer_id'),
      columnLabelId(orders, 'product_id'),
      columnLabelId(orders, 'status'),
      columnLabelId(orders, 'total_cents'),
      columnLabelId(orders, 'placed_at'),
      columnLabelId(customers, 'email'),
      columnLabelId(customers, 'full_name'),
      columnLabelId(customers, 'country'),
      columnLabelId(customers, 'created_at'),
      columnLabelId(products, 'sku'),
      columnLabelId(products, 'name'),
      columnLabelId(products, 'category'),
      columnLabelId(products, 'price_cents'),
      // enum
      enumId(orders, 'status'),
      // relations
      relationId(orders, ['customer_id'], customers, ['id']),
      relationId(orders, ['product_id'], products, ['id']),
      // pii
      piiId(customers, 'email'),
      piiId(customers, 'full_name'),
      // templates
      templateId(orders, 'page-queue-inbox'),
      templateId(orders, 'page-board'),
      templateId(customers, 'page-directory'),
      // groups
      groupId('sales'),
      groupId('catalog'),
      // dashboard + widgets
      dashboardId('revenue'),
      widgetId('revenue', 'kpi-stat-card', 1),
      widgetId('revenue', 'kpi-stat-card', 2),
      widgetId('revenue', 'chart-line-area', 3),
      widgetId('revenue', 'chart-donut', 4),
      widgetId('revenue', 'top-movers-list', 5),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});

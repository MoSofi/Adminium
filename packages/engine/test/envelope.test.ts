// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  navConfigSchema,
  pageEnvelopeSchema,
  widgetConfigSchema,
} from '../src/config-schema/index.js';

/** The page-crud example from 07-meta-store.md §3.17, verbatim field shapes. */
const pageCrudExample = {
  v: 1,
  kind: 'page',
  id: 'page_customers',
  template: 'page-crud',
  title: { key: 'nav.customers', fallback: 'Customers' },
  source: { connectionId: 'conn_01HZX0000000000000000000', table: 'public.customers' },
  nav: { group: 'library', icon: 'users', order: 20 },
  access: { minRole: 'viewer', permissions: ['table:public.customers:read'] },
  config: {
    columns: [
      { column: 'name', widget: 'cell-text', sortable: true },
      { column: 'mrr', widget: 'cell-money', align: 'end', sortable: true },
    ],
    defaultSort: [{ column: 'created_at', dir: 'desc' }],
    pageSize: 50,
    detail: { template: 'page-record', tabsFromInboundFks: true },
  },
};

/** The page-dashboard example from 07-meta-store.md §3.17 (abridged). */
const dashboardExample = {
  v: 1,
  kind: 'dashboard',
  id: 'page_overview',
  template: 'page-dashboard',
  title: { key: 'nav.overview', fallback: 'Overview' },
  source: { connectionId: 'conn_01HZX0000000000000000000', table: null },
  nav: { group: 'home', icon: 'layout-dashboard', order: 10 },
  access: { minRole: 'viewer', permissions: [] },
  config: {
    layout: {
      version: 1,
      items: [
        {
          i: 'w_01HZY0000000000000000000',
          widget: 'kpi-stat-card',
          x: 0,
          y: 0,
          w: 3,
          h: 3,
          config: { title: 'MRR' },
        },
      ],
    },
  },
};

describe('pageEnvelopeSchema', () => {
  it('accepts the §3.17 page-crud envelope', () => {
    const parsed = pageEnvelopeSchema.parse(pageCrudExample);
    expect(parsed.kind).toBe('page');
    // per-template config body round-trips untouched
    expect(parsed.config).toEqual(pageCrudExample.config);
  });

  it('accepts the §3.17 dashboard envelope with a valid layout', () => {
    const parsed = pageEnvelopeSchema.parse(dashboardExample);
    expect(parsed.kind).toBe('dashboard');
  });

  it('accepts prefixed-ULID ids and slug/badge nav extras', () => {
    const doc = {
      ...pageCrudExample,
      id: 'view_01HZXW8Q2E5T7N9RB3KVDMYAFC',
      kind: 'view',
      nav: { group: 'library', icon: 'users', order: 20, slug: 'customers', badge: 'new' },
    };
    expect(pageEnvelopeSchema.safeParse(doc).success).toBe(true);
  });

  it.each([
    ['v other than 1', { v: 2 }],
    ['unknown kind', { kind: 'report' }],
    ['unprefixed id', { id: 'customers' }],
    ['wrong id prefix', { id: 'conn_01HZX0000000000000000000' }],
    ['non-kebab-case template', { template: 'PageCrud' }],
    ['title missing fallback', { title: { key: 'nav.customers' } }],
    ['source missing table key', { source: { connectionId: 'conn_x' } }],
    ['nav order non-integer', { nav: { group: 'library', icon: 'users', order: 1.5 } }],
    ['access missing permissions', { access: { minRole: 'viewer' } }],
    ['non-record config', { config: [] }],
  ])('rejects %s', (_label, overrides) => {
    expect(pageEnvelopeSchema.safeParse({ ...pageCrudExample, ...overrides }).success).toBe(false);
  });

  it('rejects a dashboard without config.layout, with issues under config.layout', () => {
    const result = pageEnvelopeSchema.safeParse({ ...dashboardExample, config: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.slice(0, 2)).toEqual(['config', 'layout']);
    }
  });

  it('rejects a dashboard whose layout has an invalid item', () => {
    const bad = structuredClone(dashboardExample);
    (bad.config.layout.items[0] as { x: number }).x = 42;
    const result = pageEnvelopeSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.slice(0, 2)).toEqual(['config', 'layout']);
    }
  });

  it('does not require a layout on non-dashboard kinds', () => {
    expect(pageEnvelopeSchema.safeParse(pageCrudExample).success).toBe(true);
  });
});

describe('navConfigSchema', () => {
  it('accepts the minimal nav block', () => {
    expect(navConfigSchema.safeParse({ group: 'home', icon: 'users', order: 0 }).success).toBe(true);
  });

  it('rejects a non-kebab-case slug', () => {
    expect(
      navConfigSchema.safeParse({ group: 'home', icon: 'users', order: 0, slug: 'My Page' }).success,
    ).toBe(false);
  });
});

describe('widgetConfigSchema', () => {
  const instance = {
    i: 'w_1',
    widget: 'kpi-stat-card',
    x: 0,
    y: 0,
    w: 3,
    h: 3,
    config: {},
  };

  it('accepts an instance without a binding', () => {
    expect(widgetConfigSchema.safeParse(instance).success).toBe(true);
  });

  it('accepts an instance with a valid query-descriptor binding', () => {
    const withBinding = {
      ...instance,
      config: {
        binding: {
          connectionId: 'conn_01HZX0000000000000000000',
          source: { name: 'orders' },
          shape: 'metric+delta',
          aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }],
        },
      },
    };
    expect(widgetConfigSchema.safeParse(withBinding).success).toBe(true);
  });

  it('rejects an invalid binding, with issues under config.binding', () => {
    const result = widgetConfigSchema.safeParse({
      ...instance,
      config: { binding: { shape: 'not-a-shape' } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.slice(0, 2)).toEqual(['config', 'binding']);
    }
  });
});

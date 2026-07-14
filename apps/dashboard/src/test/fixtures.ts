/** Shared bootstrap + page-envelope fixtures mirroring the server reply shapes. */
import type { PageEnvelope } from '@adminium/engine/config';

import type { BootstrapData } from '../app/bootstrap.js';

export function makeBootstrap(overrides: Partial<BootstrapData> = {}): BootstrapData {
  return {
    user: {
      id: 'usr_test',
      email: 'ava@adminium.io',
      name: 'Ava Reyes',
      status: 'active',
      totpEnabled: false,
      lastLoginAt: null,
      createdAt: 1,
      updatedAt: 1,
    },
    roles: ['super-admin'],
    prefs: {
      theme: 'light',
      accent: 'indigo',
      density: 'comfortable',
      locale: 'en_US',
      dir: 'ltr',
      source: { theme: 'system', accent: 'system', density: 'system', locale: 'system', dir: 'system' },
    },
    nav: {
      groups: [
        {
          key: 'workspace',
          items: [
            { pageId: 'page_customers', slug: 'customers', labelKey: 'nav.customers', fallback: 'Customers', icon: 'users', order: 1 },
            { pageId: 'page_orders', slug: 'orders', labelKey: 'nav.orders', fallback: 'Orders', icon: 'shopping-cart', order: 2 },
          ],
        },
        {
          key: 'library',
          items: [
            { pageId: 'page_exports', slug: 'exports', labelKey: 'nav.exports', fallback: 'Data exports', icon: 'download', order: 1 },
          ],
        },
      ],
    },
    version: '0.0.0',
    configVersion: 42,
    llm: { enabled: false },
    ...overrides,
  };
}

/** A valid `page-crud` envelope for `public.customers` (01-architecture.md §6.1). */
export function makeCrudEnvelope(overrides: Partial<PageEnvelope> = {}): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_customers',
    template: 'page-crud',
    title: { key: 'pages.customers', fallback: 'Customers' },
    source: { connectionId: 'conn_1', table: 'public.customers' },
    nav: { group: 'workspace', icon: 'users', order: 1, slug: 'customers' },
    access: { minRole: 'viewer', permissions: [] },
    config: {
      columns: [
        { name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, mono: true },
        { name: 'name', label: 'Name', logicalType: 'text', isDisplay: true },
      ],
    },
    ...overrides,
  };
}

/** A valid dashboard envelope with two bound widget instances. */
export function makeDashboardEnvelope(overrides: Partial<PageEnvelope> = {}): PageEnvelope {
  const binding = {
    kind: 'table-query',
    connectionId: 'conn_1',
    source: { schema: 'public', name: 'orders', type: 'table' },
    shape: 'single-metric',
    aggregations: [{ fn: 'count', alias: 'orders' }],
  };
  return {
    v: 1,
    kind: 'dashboard',
    id: 'page_overview',
    template: 'page-dashboard',
    title: { key: 'pages.overview', fallback: 'Overview' },
    source: { connectionId: 'conn_1', table: null },
    nav: { group: 'workspace', icon: 'layout-dashboard', order: 0, slug: 'overview' },
    access: { minRole: 'viewer', permissions: [] },
    config: {
      layout: {
        version: 1,
        items: [
          { i: 'w1', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { binding } },
          { i: 'w2', widget: 'kpi-stat-card', x: 3, y: 0, w: 3, h: 3, config: { binding } },
        ],
      },
    },
    ...overrides,
  };
}

/** Minimal fetch Response stand-in (happy-dom fetch would hit the network). */
export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** Shared bootstrap fixture mirroring the server reply shape. */
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

/** Minimal fetch Response stand-in (happy-dom fetch would hit the network). */
export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

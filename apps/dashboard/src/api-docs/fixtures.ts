// SPDX-License-Identifier: AGPL-3.0-only
/** A Northwind-shaped catalogue for the explorer's tests (Appendix B: never the comps' sample data). */
import type { ApiDocs, CatalogueEndpoint } from './apiDocsApi.js';

export function makeEndpoint(overrides: Partial<CatalogueEndpoint> = {}): CatalogueEndpoint {
  return {
    ref: 'orders',
    path: '/orders',
    singular: 'Order',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'BATCH'],
    auth: 'anon',
    limit: 20,
    maxLimit: 200,
    order: 'order_id.desc',
    rate: { requests: 120, window: '1m' },
    response: 'wrapped',
    columns: [
      { name: 'order_id', type: 'integer', tags: ['pk'] },
      { name: 'customer_id', type: 'varchar', tags: ['fk'] },
      { name: 'ship_name', type: 'varchar', tags: [] },
      { name: 'freight', type: 'decimal', tags: [] },
      { name: 'shipped', type: 'boolean', tags: [] },
      { name: 'order_date', type: 'timestamp', tags: [] },
    ],
    writable: ['customer_id', 'ship_name', 'freight', 'shipped', 'order_date'],
    ...overrides,
  };
}

export function makeDocs(overrides: Partial<ApiDocs> = {}): ApiDocs {
  return {
    apiEnabled: true,
    registered: true,
    baseUrl: 'https://admin.northwind.test',
    connections: [
      {
        label: null,
        endpoints: [
          makeEndpoint({ ref: 'customers', path: '/customers', singular: 'Customer', methods: ['GET'], order: 'customer_id.desc', writable: [], columns: [
            { name: 'customer_id', type: 'varchar', tags: ['pk'] },
            { name: 'company_name', type: 'varchar', tags: [] },
            { name: 'email', type: 'varchar', tags: ['unique'] },
          ] }),
          makeEndpoint(),
        ],
      },
    ],
    ...overrides,
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A link to a table the app does not create is advice, not a refusal: the
 * install takes it when the database has that table (a loyalty app on a shop's
 * own `customers`) and refuses it anywhere else. `app check` says so, since it
 * cannot see the database (walkthrough finding V10).
 */
import { describe, expect, it } from 'vitest';

import { planInstall, validateManifest, type SchemaModelView } from '../src/index.js';

const loyalty = (references: string) => ({
  kind: 'app',
  manifestVersion: 1,
  key: 'loyalty',
  name: 'Loyalty',
  version: '0.1.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'Points per customer.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'members', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', nullable: true }] },
      {
        ref: 'accounts',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'customer_id', type: 'fk', references, nullable: true },
          { ref: 'points', type: 'int', default: 0 },
        ],
      },
    ],
  },
  pages: [{ ref: 'loyalty-accounts', template: 'page-crud', title: { key: 't', fallback: 'Accounts' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'accounts' } }],
  frontends: [{ side: 'staff', kind: 'spa' }],
});

describe('a link to a table the app does not create', () => {
  it('validates, with a warning that names the table the database must have', () => {
    const result = validateManifest(loyalty('customers'));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      {
        path: 'requiredSchema.tables.1.columns.1.references',
        message: '"accounts.customer_id" links to "customers", which this app does not create, so it installs only on a database that already has a table called "customers"',
      },
    ]);
  });

  it('says a link to one of Adminium’s own tables is refused on every database, and both planners refuse it', () => {
    const manifest = loyalty('adminium_users');
    const result = validateManifest(manifest);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      {
        path: 'requiredSchema.tables.1.columns.1.references',
        message: '"accounts.customer_id" links to "adminium_users", one of Adminium\'s own tables: the install refuses it on every database',
      },
    ]);
    if (!result.ok) return;
    // The database has the table (the meta store shares it): still refused, by name.
    const model = { dialect: 'sqlite' as const, tables: [{ ref: 'adminium_users', columns: [{ ref: 'id' }] }] } as unknown as SchemaModelView;
    for (const plan of [planInstall(result.manifest, model), planInstall(result.manifest, model, { prefix: 'loyalty_', records: {}, others: [], dialect: 'sqlite' })]) {
      expect(plan.installable).toBe(false);
      expect(plan.problems.map((p) => `${p.code} ${p.table}.${p.column ?? ''}`)).toContain('RESERVED_TABLE accounts.customer_id');
      expect(plan.references.find((r) => r.fromColumn === 'customer_id')?.resolution).toBe('unresolved');
    }
  });

  it('is not warned about when the table is one of the app’s', () => {
    const result = validateManifest(loyalty('members'));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

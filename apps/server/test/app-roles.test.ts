// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's manifest may ask of its roles: grants through placeholders on
 * its own tables and pages, never the console, never a wildcard, never a clone
 * of a built-in role — and a slug that fits the column.
 */
import { describe, expect, it } from 'vitest';
import type { Manifest } from '@adminium/manifest';

import { roleIssues, roleSlugFor } from '../src/apps/manifest-roles.js';

function manifest(roles: Record<string, unknown>[], key = 'pos'): Manifest {
  return {
    kind: 'app',
    key,
    requiredSchema: { tables: [{ ref: 'payments', columns: [] }] },
    pages: [{ ref: 'pos-menu' }],
    roles,
  } as unknown as Manifest;
}

const messages = (m: Manifest) => roleIssues(m).map((issue) => `${issue.code} ${issue.message}`);

describe('an app’s roles, as its manifest asks for them', () => {
  it('accepts placeholders on its own tables and pages, its staff screens, and a clone of its own role', () => {
    expect(
      roleIssues(
        manifest([
          { key: 'cashier', name: 'Cashier', permissions: ['table:@payments:create', 'page:@pos-menu:view', 'app:@:staff'] },
          { key: 'manager', name: 'Manager', cloneFrom: 'cashier', permissions: ['table:@payments:delete'] },
        ]),
      ),
    ).toEqual([]);
    expect(roleSlugFor('pos', 'cashier')).toBe('pos-cashier');
  });

  it('refuses the console, wildcards, what it does not declare, and a clone of a built-in role', () => {
    expect(
      messages(
        manifest([
          {
            key: 'cashier',
            name: 'Cashier',
            cloneFrom: 'admin',
            permissions: ['system:users:manage', 'table:@*:read', 'table:@invoices:read', 'page:@reports:view', 'table:conn_1:x:read'],
          },
        ]),
      ),
    ).toEqual([
      'ROLE_INVALID The role "cashier": it clones "admin", which is not another of this app\'s roles.',
      'ROLE_INVALID The role "cashier": "system:users:manage" gives a console permission, which an app cannot.',
      'ROLE_INVALID The role "cashier": "table:@*:read" is a wildcard; name each table and page.',
      'ROLE_INVALID The role "cashier": "table:@invoices:read" names a table the app does not declare.',
      'ROLE_INVALID The role "cashier": "page:@reports:view" names a page the app does not declare.',
      'ROLE_INVALID The role "cashier": "table:conn_1:x:read" is not a grant an app can give (table:@…, page:@… or app:@:staff).',
    ]);
  });

  it('refuses a slug longer than a role’s column holds', () => {
    const key = 'a-very-long-application-key-indeed';
    expect(messages(manifest([{ key: 'shift-supervisor', name: 'Supervisor' }], key))).toEqual([
      `IDENTIFIER_TOO_LONG The role "${key}-shift-supervisor" is longer than 40 characters.`,
    ]);
  });
});

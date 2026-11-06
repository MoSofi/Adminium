// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A self-made app's column under the name it has in its own database
 * (`orderDate`, `Order Date`): who may keep one, which names are refused, that
 * the rest of the file names the column the same way, and the word floor an
 * older Adminium reads.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, installFloorWords, validateManifest } from '../src/index.js';

type Doc = Record<string, unknown>;

function shop(columns: Doc[], over: Doc = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '1.0.0',
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [{ ref: 'orders', columns: [{ ref: 'id', type: 'int', role: 'pk' }, ...columns] }],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    ...over,
  };
}

const issues = (doc: Doc): string[] => {
  const result = validateManifest(doc, { allowLocalPublisher: true });
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('a column under its own name', () => {
  it('is kept by a self-made app, with its word and floor', () => {
    const doc = shop([
      { ref: 'orderDate', type: 'date', nullable: true },
      { ref: 'Order Total', type: 'decimal', precision: 10, scale: 2, nullable: true },
      { ref: 'customer-code', type: 'text', maxLength: 20, nullable: true },
    ]);
    expect(issues(doc)).toEqual([]);
    expect(installFloorWords(doc).filter((word) => word.word === 'column.name').map((word) => word.path)).toEqual([
      'requiredSchema.tables.0.columns.1.ref',
      'requiredSchema.tables.0.columns.2.ref',
      'requiredSchema.tables.0.columns.3.ref',
    ]);
    expect(WORD_FLOORS['column.name']).toBe('0.3.49');
    // An older floor says which word needs which Adminium.
    expect(issues({ ...doc, compatibility: { minAdminiumVersion: '0.3.45' } }).join('\n')).toContain('"column.name" is read by Adminium 0.3.49 and later');
  });

  it('is refused anywhere but a self-made app', () => {
    const released = shop([{ ref: 'orderDate', type: 'date', nullable: true }], { publisher: { id: 'adminium', name: 'Adminium' } });
    expect(issues(released).join('\n')).toContain('requiredSchema.tables.0.columns.1.ref: column ref must be a snake_case identifier');
  });

  it('refuses a name a database would read apart, or not at all', () => {
    for (const bad of ['a.b', 'x as y', '9lives', ' lead', 'trail ', '24:00', 'semi;colon']) {
      expect(issues(shop([{ ref: bad, type: 'text', nullable: true }])).length, bad).toBeGreaterThan(0);
    }
  });

  it('refuses two columns a database that ignores case reads as one', () => {
    const doc = shop([
      { ref: 'orderDate', type: 'date', nullable: true },
      { ref: 'OrderDate', type: 'date', nullable: true },
    ]);
    expect(issues(doc).join('\n')).toContain('one column to a database that ignores case');
  });

  it('is named the same way by the rest of the file, and an unknown name is still refused', () => {
    const roles = [{ key: 'clerk', name: 'Clerk', permissions: ['table:@orders:read', 'table:@orders:update'], limits: { orders: { writable: ['orderDate'] } } }];
    const doc = shop([{ ref: 'orderDate', type: 'date', nullable: true }], { roles });
    expect(issues(doc)).toEqual([]);
    const wrong = shop([{ ref: 'orderDate', type: 'date', nullable: true }], { roles: [{ ...roles[0], limits: { orders: { writable: ['shipDate'] } } }] });
    expect(issues(wrong).join('\n')).toContain('shipDate');
  });
});

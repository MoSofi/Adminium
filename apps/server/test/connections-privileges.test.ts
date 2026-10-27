// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pure half of the data role's table grants: which writes a rights map
 * refuses, and which database errors are privilege refusals. Unknown rights
 * refuse nothing — the database still decides.
 */
import { describe, expect, it } from 'vitest';

import { isPrivilegeRefusal, privilegesOf, readRefusal, refusedObject, writeRefused } from '../src/connections/privileges.js';
import { mapDbError } from '../src/routes/data/index.js';

const MAP = {
  'public.orders': { insert: true, update: true, delete: false },
  'public.audit': { insert: false, update: false, delete: false },
  'sales.audit': { insert: true, update: true, delete: true },
};

describe('writeRefused', () => {
  it('reads each action from its own right', () => {
    expect(writeRefused(MAP, 'public.orders', 'create')).toBe(false);
    expect(writeRefused(MAP, 'public.orders', 'update')).toBe(false);
    expect(writeRefused(MAP, 'public.orders', 'delete')).toBe(true);
  });

  it('refuses nothing it cannot name', () => {
    expect(writeRefused(null, 'public.orders', 'delete')).toBe(false);
    expect(writeRefused(MAP, 'public.missing', 'create')).toBe(false);
  });

  it('resolves a bare name only when one schema has it', () => {
    expect(privilegesOf(MAP, 'orders')).toEqual(MAP['public.orders']);
    // Two schemas hold an `audit`: ambiguous, so unknown.
    expect(privilegesOf(MAP, 'audit')).toBeNull();
  });
});

describe('privilege refusals from the database', () => {
  it('recognises postgres and mysql codes, nothing else', () => {
    expect(isPrivilegeRefusal({ code: '42501' })).toBe(true);
    expect(isPrivilegeRefusal({ code: 'ER_TABLEACCESS_DENIED_ERROR' })).toBe(true);
    expect(isPrivilegeRefusal({ code: 'ER_COLUMNACCESS_DENIED_ERROR' })).toBe(true);
    expect(isPrivilegeRefusal({ code: '23505' })).toBe(false);
    expect(isPrivilegeRefusal(null)).toBe(false);
  });

  it('maps one to 403 READ_ONLY_MODE, not a 500', () => {
    const error = Object.assign(new Error('permission denied for table orders'), { code: '42501' });
    expect(() => mapDbError(error)).toThrow(
      expect.objectContaining({ statusCode: 403, code: 'READ_ONLY_MODE', details: { table: null, reason: 'privileges' } }),
    );
  });
});

describe('what a refused read names', () => {
  it("reads the schema or table out of PostgreSQL's and MySQL's sentences", () => {
    expect(refusedObject(new Error('permission denied for schema auth'))).toEqual({ kind: 'schema', name: 'auth' });
    expect(refusedObject(new Error('permission denied for table users'))).toEqual({ kind: 'table', name: 'users' });
    expect(refusedObject(new Error('permission denied for materialized view sales_mv'))).toEqual({
      kind: 'materialized view',
      name: 'sales_mv',
    });
    expect(refusedObject(new Error("SELECT command denied to user 'app'@'localhost' for table 'customers'"))).toEqual({
      kind: 'table',
      name: 'customers',
    });
    expect(refusedObject(new Error('something else'))).toBeNull();
    expect(refusedObject(null)).toBeNull();
  });

  it('says "read", never "change", and falls back to "this table"', () => {
    expect(readRefusal(new Error('permission denied for table users')).message).toContain('read the table "users"');
    const unnamed = readRefusal(new Error('denied'));
    expect(unnamed.message).toContain('read this table');
    expect(unnamed).toMatchObject({ statusCode: 403, code: 'SOURCE_READ_REFUSED', details: { reason: 'privileges', object: null } });
  });
});

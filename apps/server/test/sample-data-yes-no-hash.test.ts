// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A sample row recorded before its SQLite column was marked a yes/no still
 * measures as unchanged.
 *
 * The ledger hashes each sample row as it was read back. SQLite keeps a
 * yes/no as a whole number, and the row was recorded as `1`; once the column
 * is marked (`column.yesNo`, written when the app is updated) it reads as
 * `true`. Hashed by what it reads as, every sample row with a yes/no would
 * measure as changed and stay when the sample is removed.
 */
import { describe, expect, it } from 'vitest';

import { hashRow } from '../src/apps/sample-data.js';
import type { ResolvedTable } from '../src/crud/identifiers.js';

const table = (flag: Record<string, unknown>): ResolvedTable =>
  ({ table: { columns: [{ name: 'id', logicalType: 'integer' }, { name: 'shown', ...flag }] } }) as unknown as ResolvedTable;

describe('a sample row with a SQLite yes/no', () => {
  const recorded = hashRow({ id: 1, shown: 1 }, table({ logicalType: 'integer' }));

  it('hashes the same once the column is marked a yes/no, read as true or as 1', () => {
    const marked = table({ logicalType: 'boolean', storedAsNumber: true });
    expect(hashRow({ id: 1, shown: true }, marked)).toEqual(recorded);
    expect(hashRow({ id: 1, shown: 1 }, marked)).toEqual(recorded);
  });

  it('still measures a real change', () => {
    const marked = table({ logicalType: 'boolean', storedAsNumber: true });
    expect(hashRow({ id: 1, shown: false }, marked).colHashes['shown']).not.toBe(recorded.colHashes['shown']);
    expect(hashRow({ id: 1, shown: null }, marked).colHashes['shown']).not.toBe(recorded.colHashes['shown']);
  });

  it('leaves an engine with a yes/no type of its own as it was: true and false', () => {
    const real = table({ logicalType: 'boolean' });
    expect(hashRow({ id: 1, shown: true }, real).colHashes['shown']).not.toBe(recorded.colHashes['shown']);
    expect(hashRow({ id: 1, shown: true }, real)).toEqual(hashRow({ id: 1, shown: 1 }, real));
  });
});

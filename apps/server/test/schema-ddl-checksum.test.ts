// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a plan's checksum has to cover.
 *
 * ─── The replay this file exists to keep closed ────────────────────────────
 *
 * `checksumOf` hashed `{base, steps:[{kind, table, column, sql}]}` and nothing
 * else. That was fine while every plan difference showed up in the SQL, and it
 * stopped being fine the moment a plan could differ by whether a REFUSAL was
 * present:
 *
 *   - `compileFor` returns no SQL for a refused step, so a door-closed plan and
 *     a door-open plan differed in `sql` on postgres and mysql — which sounds
 *     safe but was fatal the other way: the checksums disagreed, so
 *     `applySchemaEdit` threw SCHEMA_DRIFT and D18's door could never open.
 *   - On SQLite a `rebuild-table` step compiles to no SQL WHETHER OR NOT it is
 *     refused. So the two plans hashed IDENTICALLY, and a checksum taken from a
 *     plan that showed the operator a ceiling refusal would have replayed,
 *     unchanged and unnoticed, into an apply that opened the door.
 *
 * Found by an adversarial design review before the door was built, not by a
 * test — no test existed that compared two plans differing only in refusal.
 */
import { describe, expect, it } from 'vitest';
import { checksumOf, type PlannedStep } from '../src/schema-ddl/service.js';

const EDIT = {
  baseSnapshotId: 'snap_1',
  renames: { tables: [], columns: [] },
  upsertTables: [],
  addColumns: [],
  dropTables: [],
};

const planned = (over: Partial<PlannedStep> & { sql: string[] }): PlannedStep => ({
  id: 's1',
  kind: 'alter-column-type',
  table: 'main.huge',
  column: 'amount',
  constraint: null,
  hazard: 'rewrite',
  requiresSuperAdmin: true,
  summary: 's',
  rationale: 'r',
  consequences: [],
  dependsOn: [],
  outsideTransaction: false,
  refusal: null,
  ...over,
});

describe('a plan differing only by its REFUSAL hashes differently', () => {
  it('separates a refused plan from an identical unrefused one — even with no SQL either side', () => {
    // The SQLite rebuild shape: `sql: []` whether refused or not. Before the
    // refusal joined the hash these two were the same checksum.
    const refused = checksumOf([planned({ sql: [], kind: 'rebuild-table', refusal: 'TABLE_TOO_LARGE' })], EDIT);
    const open = checksumOf([planned({ sql: [], kind: 'rebuild-table', refusal: null })], EDIT);
    expect(refused).not.toBe(open);
  });

  it('separates plans by WHICH refusal, not merely by whether one exists', () => {
    const tooLarge = checksumOf([planned({ sql: [], refusal: 'TABLE_TOO_LARGE' })], EDIT);
    const noCount = checksumOf([planned({ sql: [], refusal: 'COUNT_UNAVAILABLE' })], EDIT);
    expect(tooLarge).not.toBe(noCount);
  });
});

describe('the ceiling acknowledgement is part of a plan’s identity (D18)', () => {
  it('separates an acknowledged plan from an unacknowledged one', () => {
    const steps = [planned({ sql: ['ALTER TABLE "huge" ...'] })];
    expect(checksumOf(steps, EDIT, [])).not.toBe(checksumOf(steps, EDIT, ['main.huge']));
  });

  it('does not depend on the ORDER the client sent the acknowledgement in', () => {
    // A set is what was authorised; the order it arrives in is not part of it,
    // and hashing it would make a re-plan fail for no reason a user could see.
    const steps = [planned({ sql: ['x'] })];
    expect(checksumOf(steps, EDIT, ['a.t', 'b.t'])).toBe(checksumOf(steps, EDIT, ['b.t', 'a.t']));
  });

  it('separates an acknowledgement of a DIFFERENT table', () => {
    const steps = [planned({ sql: ['x'] })];
    expect(checksumOf(steps, EDIT, ['main.huge'])).not.toBe(checksumOf(steps, EDIT, ['main.other']));
  });
});

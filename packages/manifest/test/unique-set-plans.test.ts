// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Columns an app keeps unique together, planned: an update gives a table
 * the app made earlier each set it lacks, by the set's own name (over a
 * column the same update adds, too), and nothing for a set the table keeps
 * already; MySQL refuses a set wider than it can index, on the check; and a
 * set's name is cut short and hashed when it is too long or already taken.
 */
import { describe, expect, it } from 'vitest';

import { planInstall, uniqueSetBytes, uniqueSetName, type Manifest, type PlanContext, type SchemaModelView } from '../src/index.js';

const app = (unique: string[][], extra: Record<string, unknown>[] = []) =>
  ({
    kind: 'app',
    key: 'box',
    version: '0.2.0',
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'events', columns: [{ ref: 'id', type: 'int', role: 'pk' }] },
        {
          ref: 'waitlist',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'event_id', type: 'fk', references: 'events' },
            { ref: 'email', type: 'text', maxLength: 200, nullable: true },
            ...extra,
          ],
          unique,
        },
      ],
    },
  }) as unknown as Manifest;

const records = { events: { table: 'box_events', owned: true, state: 'released' }, waitlist: { table: 'box_waitlist', owned: true, state: 'released' } };
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ prefix: 'box_', records, others: [], dialect: 'postgres', ...over });
const col = (ref: string, over: Record<string, unknown> = {}) => ({ ref, nullable: true, ...over });
const live = (uniques?: string[][], indexNames?: string[]): SchemaModelView => ({
  tables: [
    { ref: 'box_events', columns: [col('id', { isPrimaryKey: true, logicalType: 'integer', isIdentity: true, nullable: false })] },
    {
      ref: 'box_waitlist',
      columns: [
        col('id', { isPrimaryKey: true, logicalType: 'integer', isIdentity: true, nullable: false }),
        col('event_id', { logicalType: 'integer', nullable: false }),
        col('email', { logicalType: 'varchar', maxLength: 200 }),
      ],
      ...(uniques === undefined ? {} : { uniques }),
      ...(indexNames === undefined ? {} : { indexNames }),
    },
  ],
});
const waitlistEdits = (manifest: Manifest, model: SchemaModelView, over: Partial<PlanContext> = {}) => planInstall(manifest, model, ctx(over)).tables?.find((t) => t.ref === 'waitlist')?.edits;

describe('an update of a table the app made', () => {
  it('adds each set the table lacks, by its own name, and none it keeps', () => {
    expect(waitlistEdits(app([['event_id', 'email']]), live([]))).toEqual([{ kind: 'add-unique', column: 'email', with: ['event_id'], name: 'uq_box_waitlist_event_id_email' }]);
    expect(waitlistEdits(app([['event_id', 'email']]), live([['email', 'event_id']]))).toEqual([]);
    // Unknown rules offer nothing on a guess.
    expect(waitlistEdits(app([['event_id', 'email']]), live())).toEqual([]);
  });

  it('adds a set over a column the same update adds', () => {
    const seat = { ref: 'seat', type: 'text', maxLength: 8, nullable: true };
    expect(waitlistEdits(app([['event_id', 'seat']], [seat]), live([]))).toEqual([
      { kind: 'add-column', column: 'seat' },
      { kind: 'add-unique', column: 'seat', with: ['event_id'], name: 'uq_box_waitlist_event_id_seat' },
    ]);
  });

  it('never takes a name the database already has', () => {
    const [edit] = waitlistEdits(app([['event_id', 'email']]), { ...live([]), indexNames: ['uq_box_waitlist_event_id_email'] }) as { name: string }[];
    expect(edit!.name).not.toBe('uq_box_waitlist_event_id_email');
    expect(edit!.name).toBe(uniqueSetName('box_waitlist', ['event_id', 'email'], new Set(['uq_box_waitlist_event_id_email'])));
  });
});

describe('a set MySQL cannot index', () => {
  const wide = app([['email', 'note']], [{ ref: 'note', type: 'text', maxLength: 600, nullable: true }]);
  it('is refused on the check on MySQL alone, naming every column', () => {
    const problems = (dialect: 'mysql' | 'postgres') => planInstall(wide, { tables: [] }, ctx({ dialect, records: {} })).problems.filter((p) => p.code === 'UNIQUE_KEY_TOO_LONG');
    expect(problems('mysql')).toEqual([expect.objectContaining({ table: 'waitlist', column: 'note', message: expect.stringContaining('email, note') })]);
    expect(problems('postgres')).toEqual([]);
  });

  it('counts text by its characters, an enum by its widest, a link by its key', () => {
    const table = {
      columns: [
        { ref: 'a', type: 'text', maxLength: 10 },
        { ref: 'b', type: 'enum', enum: ['x'] },
        { ref: 'c', type: 'fk', references: 't' },
        { ref: 'd', type: 'date' },
      ],
    } as never;
    expect(uniqueSetBytes(['a', 'b', 'c', 'd'], table, [{ ref: 't', columns: [{ ref: 'id', type: 'uuid', role: 'pk' }] }] as never)).toBe(40 + 128 + 144 + 8);
    // A uuid of the row's own is 36 characters on MySQL too, linked or not.
    const own = { columns: [{ ref: 'token', type: 'uuid' }, { ref: 'e', type: 'text', maxLength: 10 }] } as never;
    expect(uniqueSetBytes(['token', 'e'], own, [] as never)).toBe(144 + 40);
  });
});

describe('a set\'s name', () => {
  it('is cut short and hashed past 63 bytes, the same every time', () => {
    const long = 'a'.repeat(60);
    const name = uniqueSetName(long, ['event_id', 'email']);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
    expect(name).toBe(uniqueSetName(long, ['event_id', 'email']));
    expect(name).toMatch(/^uq_a+_[0-9a-f]{8}$/);
  });
});

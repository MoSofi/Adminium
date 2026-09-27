// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Column rules for totals that count and climb, days between two dates, a
 * joined name, prices by the night, copies that follow their row, a document
 * listing several sources, and the sample order a priced table needs.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { dayNumberOf, evaluateFormula, formulaColumns, sampleBundleIssues, type Manifest } from '../src/index.js';
import { addOnManifest } from './invoicing-fixture.js';
import { columnOf, guestHouse, issuesText, kitchen, messages, tableOf, type Doc } from './orders-stays-fixture.js';

function broken(make: () => Doc, change: (m: Doc) => void): string {
  const m = make();
  change(m);
  return issuesText(m);
}
const rules = (m: Doc, table: string, column: string) => columnOf(m, table, column)['rules'] as Doc;

describe('a total that counts', () => {
  it('adds up a column or counts rows, not both, into a whole number', () => {
    expect(broken(kitchen, (m) => ((rules(m, 'orders', 'item_count')['rollup'] as Doc)['sum'] = 'qty'))).toContain('a total adds up `sum` or counts rows (`count: true`), not both');
    expect(broken(kitchen, (m) => delete (rules(m, 'orders', 'subtotal')['rollup'] as Doc)['sum'])).toContain('a total adds up `sum` or counts rows');
    expect(broken(kitchen, (m) => ((rules(m, 'orders', 'item_count')['rollup'] as Doc)['times'] = 'qty'))).toContain('a count takes no `times`, `balance` or `cap`');
    expect(broken(kitchen, (m) => (columnOf(m, 'orders', 'item_count')['type'] = 'decimal'))).toContain('a count is kept in a whole-number column (`int` or `bigint`)');
  });
});

describe('totals that climb', () => {
  /** option → line → order → customer, and one more table above. */
  function chain(extra: boolean): Doc {
    const m = kitchen();
    (tableOf(m, 'customers')['columns'] as Doc[]).push({ ref: 'lifetime', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'orders', via: 'customer_id', sum: 'total' } } });
    if (extra) {
      (tableOf(m, 'customers')['columns'] as Doc[]).push({ ref: 'region_id', type: 'fk', references: 'regions', nullable: true });
      (m['requiredSchema'] as { tables: Doc[] }).tables.push({
        ref: 'regions',
        columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'spent', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'customers', via: 'region_id', sum: 'lifetime' } } }],
      });
    }
    return m;
  }

  it('climb three tables', () => {
    expect(messages(chain(false))).toEqual([]);
  });

  it('never a fourth', () => {
    expect(issuesText(chain(true))).toContain('totals climb at most three tables: order_item_modifiers → order_items → orders → customers → regions');
  });

  it('never in a circle', () => {
    expect(
      broken(kitchen, (m) => (tableOf(m, 'menu_items')['columns'] as Doc[]).push({ ref: 'parent_id', type: 'fk', references: 'menu_items', nullable: true }, { ref: 'kids', type: 'int', nullable: true, rules: { rollup: { from: 'menu_items', via: 'parent_id', count: true } } })),
    ).toContain('totals climb in a circle: menu_items → menu_items');
    const m = kitchen();
    (tableOf(m, 'order_items')['columns'] as Doc[]).push({ ref: 'order_total', type: 'decimal', scale: 2, nullable: true, rules: { copy: { via: 'order_id', from: 'total' } } });
    columnOf(m, 'order_items', 'line_total')['rules'] = { rollup: { from: 'orders', via: 'id', sum: 'total' } };
    expect(issuesText(m)).toContain('totals climb in a circle');
  });
});

describe('days between two dates', () => {
  it('count between two different date columns', () => {
    expect(broken(guestHouse, (m) => (rules(m, 'stays', 'nights')['formula'] = { daysBetween: ['arrive', 'arrive'] }))).toContain('days are counted between two different columns');
    expect(broken(guestHouse, (m) => (rules(m, 'stays', 'nights')['formula'] = { daysBetween: ['arrive', 'guests'] }))).toContain(
      '"guests" is not a date (a date column), so no days are counted from it',
    );
  });

  it('are whole calendar days, empty when either is empty or the stop comes first', () => {
    const nights = (arrive: unknown, depart: unknown) => evaluateFormula({ daysBetween: ['arrive', 'depart'] }, { arrive, depart }, 0);
    expect(nights('2026-08-03', '2026-08-05')).toBe('2');
    expect(nights('2026-08-03', '2026-08-03')).toBe('0');
    expect(nights('2026-08-05', '2026-08-03')).toBeNull();
    expect(nights(null, '2026-08-03')).toBeNull();
    expect(nights('2026-02-30', '2026-03-03')).toBeNull();
    expect(nights('2028-02-28', '2028-03-01')).toBe('2');
    expect(nights(new Date(2026, 7, 3), new Date(2026, 7, 5))).toBe('2');
    expect(nights('2026-08-03 00:00:00', '2026-08-05T23:59:00')).toBe('2');
  });

  describe.each(['America/New_York', 'Europe/Berlin', 'Pacific/Auckland'])('on a server in %s', (zone) => {
    const before = process.env['TZ'];
    afterEach(() => {
      if (before === undefined) delete process.env['TZ'];
      else process.env['TZ'] = before;
    });
    it('count the nights the clocks change as one each', () => {
      process.env['TZ'] = zone;
      for (const [from, to] of [
        ['2026-03-07', '2026-03-09'],
        ['2026-03-28', '2026-03-30'],
        ['2026-10-24', '2026-10-26'],
        ['2026-10-31', '2026-11-02'],
      ] as const) {
        expect(evaluateFormula({ daysBetween: ['a', 'b'] }, { a: from, b: to }, 0)).toBe('2');
        const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
        const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
        expect(dayNumberOf(new Date(y2, m2 - 1, d2))! - dayNumberOf(new Date(y1, m1 - 1, d1))!).toBe(2);
      }
    });
  });
});

describe('a joined name', () => {
  it('fills a text column from columns and text, and is the whole formula', () => {
    expect(formulaColumns({ join: ['first_name', ' ', 'last_name'] })).toEqual(['first_name', 'last_name']);
    expect(broken(guestHouse, (m) => (columnOf(m, 'stays', 'guest_name')['type'] = 'int'))).toContain('a join fills a text column');
    expect(broken(guestHouse, (m) => (rules(m, 'stays', 'guest_name')['formula'] = { join: ['first_name', ' ', 'middle_name'] }))).toContain('the table has no column "middle_name"');
    expect(broken(guestHouse, (m) => (rules(m, 'stays', 'total')['formula'] = { add: [1, { join: ['first_name', 'last_name'] }] }))).toContain('a join is the whole formula, not a part of one');
  });

  it('reads text and whole numbers only, spelled alike by every database', () => {
    const joining = (parts: string[]) => broken(guestHouse, (m) => (rules(m, 'stays', 'guest_name')['formula'] = { join: parts }));
    expect(joining(['first_name', ' × ', 'guests'])).not.toContain('a join reads');
    // A decimal is `8.250` on one engine and `8.25` on another; a yes or no `true` or `1`; a day by the server's clock.
    expect(joining(['first_name', ' ', 'total'])).toContain('"total" is a decimal column: a join reads text and whole-number columns only');
    expect(joining(['first_name', ' ', 'link_stopped'])).toContain('"link_stopped" is a bool column: a join reads text and whole-number columns only');
    expect(joining(['first_name', ' ', 'arrive'])).toContain('"arrive" is a date column: a join reads text and whole-number columns only');
  });

  it('never reads a column kept from readers into one that is not', () => {
    expect(
      broken(guestHouse, (m) => {
        columnOf(m, 'stays', 'last_name')['rules'] = { personal: true };
      }),
    ).toContain('"stays.last_name" is personal data, so no formula reads it');
    // Kept alike in the column it lands in, it may.
    expect(
      broken(guestHouse, (m) => {
        columnOf(m, 'stays', 'last_name')['rules'] = { personal: true };
        rules(m, 'stays', 'guest_name')['personal'] = true;
      }),
    ).not.toContain('so no formula reads it');
  });
});

describe('a price by the night', () => {
  const night = (m: Doc) => rules(m, 'stays', 'room_total')['perNight'] as Doc;
  const adjust = (m: Doc) => night(m)['adjust'] as Doc;
  it('is kept in a money column, one per table, alone', () => {
    expect(broken(guestHouse, (m) => (columnOf(m, 'stays', 'room_total')['type'] = 'float'))).toContain('a price by the night is kept in a decimal, money or whole-number column');
    expect(
      broken(guestHouse, (m) => (tableOf(m, 'stays')['columns'] as Doc[]).push({ ref: 'again', type: 'decimal', nullable: true, rules: { perNight: night(m) } })),
    ).toContain('"stays" is already priced by the night in "room_total"');
    expect(broken(guestHouse, (m) => (rules(m, 'stays', 'room_total')['formula'] = 'guests'))).toContain('a column is decided by one rule');
  });

  it('runs between two date columns, from a rate a foreign key reads', () => {
    expect(broken(guestHouse, (m) => (night(m)['to'] = 'guests'))).toContain('"stays.guests" is not a date');
    expect(broken(guestHouse, (m) => (night(m)['to'] = 'arrive'))).toContain('the nights run between two different dates');
    expect(broken(guestHouse, (m) => (night(m)['rate'] = { via: 'email', column: 'base_rate' }))).toContain('"email" is not a foreign key of "stays"');
    expect(broken(guestHouse, (m) => (night(m)['rate'] = { via: 'room_type_id', column: 'name' }))).toContain('"room_types.name" is not a price');
  });

  it('reads adjustments that match the same rooms, on listed nights, between dates', () => {
    expect(broken(guestHouse, (m) => (adjust(m)['table'] = 'nope'))).toContain('"nope" is not a table of this app');
    expect(broken(guestHouse, (m) => (adjust(m)['add'] = 'name'))).toContain('"rate_rules.name" is not a price');
    expect(broken(guestHouse, (m) => (adjust(m)['name'] = 'amount'))).toContain('"rate_rules.amount" is not a text column');
    expect(broken(guestHouse, (m) => ((adjust(m)['match'] as Doc)['via'] = 'weekdays'))).toContain('"weekdays" is not a foreign key of "rate_rules"');
    expect(broken(guestHouse, (m) => (columnOf(m, 'rate_rules', 'weekdays')['maxLength'] = 10))).toContain('a text column of at least 27 characters');
    expect(broken(guestHouse, (m) => ((adjust(m)['match'] as Doc)['from'] = 'name'))).toContain('"rate_rules.name" is not a date');
    expect(broken(guestHouse, (m) => (columnOf(m, 'rate_rules', 'active')['nullable'] = true))).toContain('"rate_rules.active" may be empty');
    expect(
      broken(guestHouse, (m) => {
        (tableOf(m, 'rate_rules')['columns'] as Doc[]).push({ ref: 'extra_id', type: 'fk', references: 'extras', nullable: true });
        (adjust(m)['match'] as Doc)['via'] = 'extra_id';
      }),
    ).toContain('"rate_rules.extra_id" points at "extras", and "stays.room_type_id" at "room_types"');
  });

  it('never names a secret or personal column', () => {
    expect(broken(guestHouse, (m) => (columnOf(m, 'rate_rules', 'name')['rules'] = { personal: true }))).toContain('"rate_rules.name" is personal data, so no night is tagged with it');
  });

  it('is never written by a guest', () => {
    const m = guestHouse();
    const create = (m['publicAccess'] as Doc[]).find((e) => e['table'] === 'stays' && (e['methods'] as string[]).includes('POST'))!;
    (create['writable'] as string[]).push('room_total');
    expect(issuesText(m)).toContain('"room_total" is decided by Adminium and cannot be written publicly');
  });

  it('is not what an add-on\'s shape declares, nor a nightly list a shape\'s document reads', () => {
    const m = addOnManifest();
    const shape = ((m['addOn'] as Doc)['shapes'] as Doc[])[0]!;
    const doc = (shape['parts'] as Record<string, { columns: Doc[] }>)['document']!;
    doc.columns.push({ ref: 'from_day', type: 'date', nullable: true }, { ref: 'to_day', type: 'date', nullable: true });
    doc.columns.find((c) => c['ref'] === 'total')!['rules'] = { perNight: { from: 'from_day', to: 'to_day', rate: { via: 'nope', column: 'x' } } };
    expect(issuesText(m)).toContain('a shape does not price by the night');
    const again = addOnManifest();
    const profile = (((again['addOn'] as Doc)['shapes'] as Doc[])[0]!['documentProfiles'] as Doc[])[0]!;
    (profile['mapping'] as Doc)['nights'] = { collection: { nightly: 'total', columns: { date: 'date' } } };
    expect(issuesText(again)).toContain('a shape does not price by the night');
  });
});

describe('a copy that follows its row', () => {
  const copy = (m: Doc, column: string) => rules(m, 'stay_extras', column)['copy'] as Doc;
  it('always wins and follows one level', () => {
    expect(broken(guestHouse, (m) => (copy(m, 'nights')['mode'] = 'default'))).toContain('a copy that follows its row always wins (`mode: "always"`)');
    expect(
      broken(guestHouse, (m) => {
        (tableOf(m, 'extras')['columns'] as Doc[]).push({ ref: 'stay_id', type: 'fk', references: 'stays', nullable: true }, { ref: 'nights', type: 'int', nullable: true, rules: { copy: { via: 'stay_id', from: 'nights', mode: 'always', follow: true } } });
        copy(m, 'nights')['via'] = 'extra_id';
      }),
    ).toContain('a copy follows one level');
  });

  it('never follows what its own rows total into', () => {
    expect(broken(guestHouse, (m) => (copy(m, 'nights')['from'] = 'total'))).toContain('"stays.total" is worked out from "stay_extras", so "stay_extras.nights" cannot follow it');
  });

  it('never follows what changes without a change of the row: a total, a balance, a stamp, or a formula over one', () => {
    const paying = (m: Doc) => {
      (m['requiredSchema'] as { tables: Doc[] }).tables.push({
        ref: 'payments',
        columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'amount', type: 'decimal', scale: 2 }],
      });
      (tableOf(m, 'stays')['columns'] as Doc[]).push(
        { ref: 'paid', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'payments', via: 'stay_id', sum: 'amount', balance: { column: 'balance', of: 'total' } } } },
        { ref: 'balance', type: 'decimal', scale: 2, nullable: true },
        { ref: 'paid_twice', type: 'decimal', scale: 2, nullable: true, rules: { formula: { mul: ['paid', 2] } } },
        { ref: 'booked_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: 'create' } } },
      );
      (tableOf(m, 'stay_extras')['columns'] as Doc[]).push({ ref: 'copied', type: 'decimal', scale: 2, nullable: true }, { ref: 'copied_at', type: 'timestamptz', nullable: true });
    };
    const following = (column: string, from: string) =>
      broken(guestHouse, (m) => {
        paying(m);
        columnOf(m, 'stay_extras', column)['rules'] = { copy: { via: 'stay_id', from, mode: 'always', follow: true } };
      });
    expect(following('copied', 'paid')).toContain('"stays.paid" is a total, which changes without a change of the row, so "stay_extras.copied" cannot follow it');
    expect(following('copied', 'balance')).toContain('"stays.balance" is a balance, which changes without a change of the row');
    expect(following('copied_at', 'booked_at')).toContain('"stays.booked_at" is a stamp, which changes without a change of the row');
    expect(following('copied', 'paid_twice')).toContain('"stays.paid_twice" (it is worked out from "paid", a total), which changes without a change of the row');
    // Its own copied nights and guests stay as they were.
    expect(broken(guestHouse, paying)).not.toContain('cannot follow it');
  });

  it('comes from a table that totals into that row alone', () => {
    expect(
      broken(guestHouse, (m) => (tableOf(m, 'extras')['columns'] as Doc[]).push({ ref: 'sold', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'stay_extras', via: 'extra_id', sum: 'amount' } } })),
    ).toContain('"stay_extras" totals into "extras" too, so its copies cannot follow "stays"');
  });
});

describe('a document listing several sources', () => {
  const items = (m: Doc) => ((m['documents'] as Doc[])[0]!['mapping'] as Doc)['items'] as { collections: Doc[] };
  it('reads the nights of a price by the night, and child rows', () => {
    expect(broken(guestHouse, (m) => (items(m).collections[0]!['nightly'] = 'total'))).toContain('"stays.total" is not priced by the night');
    expect(broken(guestHouse, (m) => ((items(m).collections[0]!['columns'] as Doc)['desc'] = 'label'))).toContain('a night has no "label"');
    expect(broken(guestHouse, (m) => ((items(m).collections[0]!['columns'] as Doc)['desc'] = 'extra_id.name'))).toContain('through "room_type_id", not "extra_id"');
    expect(broken(guestHouse, (m) => ((items(m).collections[0]!['columns'] as Doc)['desc'] = 'room_type_id.nope'))).toContain('"room_types" has no column "nope"');
    expect(broken(guestHouse, (m) => (items(m).collections[1]!['via'] = 'extra_id'))).toContain('"stay_extras.extra_id" does not point at "stays"');
    expect(broken(guestHouse, (m) => (items(m).collections = []))).toContain('collections');
  });

  it('accepts one nightly source as a collection too', () => {
    const m = guestHouse();
    ((m['documents'] as Doc[])[0]!['mapping'] as Doc)['items'] = { collection: { nightly: 'room_total', columns: { date: 'date', amount: 'rate' } } };
    expect(messages(m)).toEqual([]);
  });

  it('lists names one level below a line', () => {
    const m = guestHouse();
    const extras = items(m).collections[1]!;
    (extras['columns'] as Doc)['options'] = { list: { table: 'stay_extras', via: 'stay_id', column: 'label' } };
    expect(issuesText(m)).toContain('"stay_extras.stay_id" does not point at "stay_extras"');
    (m['requiredSchema'] as { tables: Doc[] }).tables.push({
      ref: 'extra_notes',
      columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'stay_extra_id', type: 'fk', references: 'stay_extras' }, { ref: 'text', type: 'text', maxLength: 80 }, { ref: 'n', type: 'int', default: 0 }],
    });
    (extras['columns'] as Doc)['options'] = { list: { table: 'extra_notes', via: 'stay_extra_id', column: 'text', orderBy: 'n' } };
    expect(messages(m)).toEqual([]);
    (extras['columns'] as Doc)['options'] = { list: { table: 'extra_notes', via: 'stay_extra_id', column: 'n' } };
    expect(issuesText(m)).toContain('"extra_notes.n" is not a text column, so it lists no names');
  });
});

describe('sample rows of a table priced by the night', () => {
  it('come after its rates and adjustments', () => {
    const manifest = guestHouse() as unknown as Manifest;
    const bundle = (order: string[]) => ({ format: 'adminium.sample/1', app: 'guesthouse', tables: order.map((ref) => ({ ref, rows: [] })), assets: {} }) as never;
    expect(sampleBundleIssues(bundle(['room_types', 'rate_rules', 'stays']), manifest)).toEqual([]);
    expect(sampleBundleIssues(bundle(['room_types', 'stays', 'rate_rules']), manifest).map((i) => i.message)).toEqual([
      '"rate_rules" must come before "stays": "stays" is priced from it.',
    ]);
  });
});

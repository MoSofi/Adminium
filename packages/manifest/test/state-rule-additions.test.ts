// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the manifest takes and refuses of the smaller state and moment rules:
 * a child tied to its parent's states apart for a new row and a change
 * (`createIn` / `changeIn`); a changed link that moves the rows on both sides
 * of it; a moment's time of day kept on the row; a setting read only from a
 * one-row table; a hold stamp capped by a moment; a stay judged from today
 * once its guest has arrived; a copy that follows one parent while its rows
 * total into another; and the advice about a capped balance worked out from a
 * formula whose columns stay open.
 */
import { describe, expect, it } from 'vitest';

import { cappedFormulaWarnings, settingReferences } from '../src/schema.js';
import { changeEffectSchema, momentSchema, stateChildSchema, validateManifest } from '../src/index.js';
import { columnOf, issuesText, moveOf, statesOf, tableOf, venue, type Doc } from './conditioned-moves-fixture.js';
import fs from 'node:fs';

const setting = (column: string) => ({ table: 'settings', column });
const released = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/released/${name}.manifest.json`, import.meta.url), 'utf8')) as Doc;

/** The venue with payments tied to stays, as the parent form ties them. */
function paying(tie: Doc): Doc {
  const m = venue();
  (m['requiredSchema'] as { tables: Doc[] }).tables.push({
    ref: 'payments',
    columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'amount', type: 'decimal', scale: 2 }],
  });
  statesOf(m, 'stays')['children'] = { payments: { via: 'stay_id', ...tie } };
  return m;
}

describe('a child tied to its parent: added in some states, changed in more', () => {
  it('takes createIn and changeIn apart, or parentIn for both', () => {
    expect(issuesText(paying({ createIn: ['booked', 'in_house'], changeIn: ['booked', 'in_house', 'cancelled'] }))).toBe('');
    expect(issuesText(paying({ createIn: ['booked'] }))).toBe('');
    expect(issuesText(paying({ changeIn: ['cancelled'] }))).toBe('');
    expect(issuesText(paying({ parentIn: ['booked', 'in_house'] }))).toBe('');
  });

  it('refuses parentIn beside either, a lock beside either, and a state the parent does not have', () => {
    expect(stateChildSchema.safeParse({ via: 'stay_id', parentIn: ['booked'], changeIn: ['cancelled'] }).success).toBe(false);
    expect(issuesText(paying({ parentIn: ['booked'], createIn: ['booked'] }))).toContain('parentIn says createIn and changeIn at once');
    expect(issuesText(paying({ lock: true, changeIn: ['booked'] }))).toContain('a child is locked with its parent, or writable only in some of its states');
    expect(issuesText(paying({ createIn: ['booked'], changeIn: ['gone'] }))).toContain('"gone" is not a value of "stays.status"');
    expect(issuesText(paying({ createIn: [] }))).not.toBe('');
  });
});

describe('an effect of a changed link', () => {
  const moving = (effect: Doc) => {
    const m = venue();
    // A room may be taken back for cleaning, and a ready one given to a guest.
    (statesOf(m, 'stays')['effects'] as Doc[]).push(effect);
    return m;
  };
  const roomMove = { on: { change: 'room_id', in: ['in_house'] }, old: { set: { status: 'cleaning' } }, new: { set: { status: 'occupied' } } };

  it('takes the old row, the new one or both, only while the row is in some states', () => {
    expect(issuesText(moving(roomMove))).toBe('');
    expect(issuesText(moving({ on: { change: 'room_id' }, new: { set: { status: 'occupied' } } }))).toBe('');
    expect(changeEffectSchema.safeParse({ on: { change: 'room_id' }, old: { set: { status: 'cleaning' } } }).success).toBe(true);
  });

  it('refuses no side at all, two columns set, an unknown key and a state no move reaches', () => {
    expect(changeEffectSchema.safeParse({ on: { change: 'room_id' } }).success).toBe(false);
    expect(issuesText(moving({ on: { change: 'room_id' } }))).toContain('an effect of a changed link moves the old row, the new one, or both');
    expect(issuesText(moving({ ...roomMove, new: { set: { status: 'occupied', other: 'x' } } }))).toContain("an effect sets one column: the linked table's state");
    expect(issuesText(moving({ ...roomMove, on: { change: 'room_id', when: 'x' } }))).not.toBe('');
    expect(issuesText(moving({ ...roomMove, new: { set: { status: 'gone' } } }))).toContain('no move of "rooms" goes to "gone"');
    expect(issuesText(moving({ ...roomMove, on: { change: 'room_id', in: ['nowhere'] } }))).toContain('"nowhere" is not a value of "stays.status"');
  });

  it('refuses a column that is not a link to a table with states, the state column, and two on one link', () => {
    expect(issuesText(moving({ ...roomMove, on: { change: 'arrive' } }))).toContain('"stays.arrive" does not point at a table of this manifest');
    expect(issuesText(moving({ ...roomMove, on: { change: 'status' } }))).toContain('an effect of a changed link watches a link');
    const m = moving(roomMove);
    (statesOf(m, 'stays')['effects'] as Doc[]).push({ on: { change: 'room_id' }, old: { set: { status: 'cleaning' } } });
    expect(issuesText(m)).toContain('another effect already moves the rows "room_id" points at when it changes');
    const noStates = moving(roomMove);
    delete tableOf(noStates, 'rooms')['states'];
    expect(issuesText(noStates)).toContain('"rooms" declares no states');
  });

  it('refuses a move of the linked row that waits for another row, as an effect of a move does', () => {
    const m = moving(roomMove);
    const rooms = statesOf(m, 'rooms');
    rooms['moves'] = { ready: [{ to: 'occupied', requires: { linked: [{ via: 'id', where: [{ column: 'status', eq: 'ready' }] }] } }], occupied: ['cleaning'], cleaning: ['ready'] };
    expect(issuesText(m)).toContain('waits for another row, so an effect cannot make it');
  });

  it('keeps at most four effects on a table, whatever sets them off', () => {
    const m = venue();
    statesOf(m, 'stays')['effects'] = [...(statesOf(m, 'stays')['effects'] as Doc[]), roomMove, { on: { to: 'cancelled' }, via: 'room_id', set: { status: 'cleaning' } }, { on: { to: 'no_show' }, via: 'room_id', set: { status: 'cleaning' } }];
    expect(issuesText(m)).not.toBe('');
  });
});

describe("a moment's time of day kept on the row", () => {
  it('takes a column of the row the moment reads', () => {
    expect(momentSchema.safeParse({ column: 'arrive', time: { column: 'arrival_time' } }).success).toBe(true);
    const m = venue();
    (tableOf(m, 'stays')['columns'] as Doc[]).push({ ref: 'arrival_time', type: 'text', maxLength: 5, nullable: true });
    moveOf(m, 'stays', 'booked', 'in_house')['requires'] = { time: { after: { column: 'arrive', time: { column: 'arrival_time' }, minus: { hours: 2 } } } };
    expect(issuesText(m)).toBe('');
  });

  it("reads a linked row's own time through the same link", () => {
    const m = venue();
    (tableOf(m, 'events')['columns'] as Doc[]).push({ ref: 'doors_time', type: 'text', maxLength: 5, nullable: true }, { ref: 'day', type: 'date', nullable: true });
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['time'] = { after: { via: 'event_id', column: 'day', time: { column: 'doors_time' } } };
    expect(issuesText(m)).toBe('');
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['time'] = { after: { via: 'event_id', column: 'day', time: { column: 'valid_to' } } };
    expect(issuesText(m)).toContain('"events" has no column "valid_to"');
  });

  it('refuses a column that is not HH:MM text, or too short for it', () => {
    const m = venue();
    (tableOf(m, 'stays')['columns'] as Doc[]).push({ ref: 'arrival_time', type: 'text', maxLength: 4, nullable: true }, { ref: 'arrival_n', type: 'int', nullable: true });
    moveOf(m, 'stays', 'booked', 'in_house')['requires'] = { time: { after: { column: 'arrive', time: { column: 'arrival_time' } } } };
    expect(issuesText(m)).toContain('"stays.arrival_time" holds fewer than the 5 characters of HH:MM');
    moveOf(m, 'stays', 'booked', 'in_house')['requires'] = { time: { after: { column: 'arrive', time: { column: 'arrival_n' } } } };
    expect(issuesText(m)).toContain('"stays.arrival_n" is not a text column holding HH:MM');
  });
});

describe('a setting is read from a one-row table', () => {
  it('refuses a table of many rows: the rule would read whichever row came first', () => {
    const m = venue();
    (tableOf(m, 'stays')['columns'] as Doc[]).push({ ref: 'arrival_time', type: 'text', maxLength: 5, nullable: true });
    moveOf(m, 'stays', 'booked', 'in_house')['requires'] = { time: { after: { column: 'arrive', time: { table: 'stays', column: 'arrival_time' } } } };
    expect(issuesText(m)).toContain('"stays" may hold many rows, so "stays.arrival_time" is no setting');
  });

  it('refuses one everywhere a setting is read: a move waiting for one, a shift, a hold stamp, a limit', () => {
    const m = venue();
    (tableOf(m, 'events')['columns'] as Doc[]).push({ ref: 'on', type: 'bool', default: true }, { ref: 'minutes', type: 'int', default: 10 });
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['setting'] = [{ table: 'events', column: 'on', eq: true }];
    columnOf(m, 'orders', 'held_until')['rules'] = { stamp: { set: { addMinutes: { minutes: { table: 'events', column: 'minutes' } } }, on: 'create' } };
    ((statesOf(m, 'orders')['timed'] as Doc[])[1]!['at'] as Doc)['plus'] = { hours: { table: 'events', column: 'minutes' } };
    const text = issuesText(m);
    expect(text).toContain('requiredSchema.tables.4.states.moves.valid.0.requires.setting.0: "events" may hold many rows');
    expect(text).toContain('rules.stamp.set.addMinutes.minutes: "events" may hold many rows');
    expect(text).toContain('states.timed.1.at.plus.hours: "events" may hold many rows');
  });

  it("takes the app's settings table (its outbox's), even one that links elsewhere, and a table standing alone", () => {
    const m = venue();
    // A settings table with a link of its own is refused, until the outbox names it the settings.
    (tableOf(m, 'settings')['columns'] as Doc[]).push({ ref: 'house_event_id', type: 'fk', references: 'events', nullable: true });
    expect(issuesText(m)).toContain('"settings" may hold many rows');
    m['outbox'] = { table: 'outbox_messages', settings: { table: 'settings' } };
    expect(issuesText(m)).not.toContain('may hold many rows');
    expect(issuesText(venue())).toBe('');
  });

  it('finds every setting a released app reads, and each is a one-row table', () => {
    for (const [name, table, count] of [
      ['point-of-sale-0.2.2', 'booking_rules', 6],
      ['clinic-desk-0.2.1', 'settings', 12],
      ['client-portal-0.2.1', 'settings', 18],
    ] as const) {
      const m = released(name);
      const refs = settingReferences(m as never);
      expect(refs.length).toBe(count);
      expect(new Set(refs.map((ref) => ref.table))).toEqual(new Set([table]));
      expect(validateManifest(m).ok).toBe(true);
    }
  });
});

describe('a hold stamp capped by a moment', () => {
  it("takes addMinutes with notAfter, checked as a deadline's cap is", () => {
    const m = venue();
    columnOf(m, 'orders', 'held_until')['rules'] = {
      stamp: { set: { addMinutes: { minutes: setting('hold_minutes'), notAfter: { via: 'event_id', column: 'doors_at' } } }, on: 'create' },
    };
    expect(issuesText(m)).toBe('');
    columnOf(m, 'orders', 'held_until')['rules'] = {
      stamp: { set: { addMinutes: { minutes: setting('hold_minutes'), notAfter: { via: 'event_id', column: 'name' } } }, on: 'create' },
    };
    expect(issuesText(m)).toContain('"events.name" is not a date or a timestamptz');
    columnOf(m, 'orders', 'held_until')['rules'] = { stamp: { set: { addMinutes: { minutes: 10, notAfter: 'doors' } }, on: 'create' } };
    expect(issuesText(m)).not.toBe('');
  });
});

describe('a stay whose guest has arrived', () => {
  const nightly = (arrived: Doc | undefined) => {
    const m = venue();
    (m['requiredSchema'] as { tables: Doc[] }).tables.push({ ref: 'room_types', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'rooms', type: 'int', default: 1 }] });
    (tableOf(m, 'stays')['columns'] as Doc[]).push({ ref: 'depart', type: 'date' }, { ref: 'room_type_id', type: 'fk', references: 'room_types' });
    tableOf(m, 'stays')['capacity'] = {
      kind: 'night',
      from: 'arrive',
      to: 'depart',
      countWhere: { column: 'status', values: ['booked', 'in_house'] },
      pool: { via: 'room_type_id', size: { column: 'rooms' } },
      ...(arrived === undefined ? {} : { arrived }),
    };
    return m;
  };
  it('names states the rule counts', () => {
    expect(issuesText(nightly({ states: ['in_house'] }))).toBe('');
    expect(issuesText(nightly({ states: ['departed'] }))).toContain('"departed" is not counted, so no stay counted in it has begun');
    expect(issuesText(nightly({ states: [] }))).not.toBe('');
  });
});

describe('a copy that follows one parent while its rows total into another', () => {
  /** Tickets follow their event's doors and total their prices into their order. */
  const box = (sumOf: string) => {
    const m = venue();
    (tableOf(m, 'tickets')['columns'] as Doc[]).push(
      { ref: 'price', type: 'decimal', scale: 2, default: 0 },
      { ref: 'doors_at', type: 'timestamptz', nullable: true, rules: { copy: { via: 'event_id', from: 'doors_at', mode: 'always', follow: true } } },
      { ref: 'doors_early', type: 'timestamptz', nullable: true },
    );
    (tableOf(m, 'orders')['columns'] as Doc[]).push({ ref: 'total', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'tickets', via: 'order_id', sum: sumOf } } });
    return m;
  };
  it('follows when no total of the other parent reads what the follow writes', () => {
    expect(issuesText(box('price'))).toBe('');
  });
  it('refuses when one does', () => {
    const m = box('price');
    columnOf(m, 'orders', 'total')['rules'] = { rollup: { from: 'tickets', via: 'order_id', sum: 'price', where: { column: 'doors_at', eq: 'x' } } };
    expect(issuesText(m)).toContain('"tickets" totals into "orders" too, so its copies cannot follow "events"');
  });
});

describe('advice about a capped balance worked out from a formula', () => {
  /** An invoice whose balance is capped by its payments, its total a formula over a rate and its lines. */
  const invoice = (lock: Doc | undefined, tie: Doc) => ({
    ref: 'invoices',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'void'], default: 'draft' },
      { ref: 'rate', type: 'decimal', scale: 2, default: 0 },
      { ref: 'subtotal', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'lines', via: 'invoice_id', sum: 'amount' } } },
      { ref: 'total', type: 'decimal', scale: 2, nullable: true, rules: { formula: { add: ['subtotal', 'rate'] } } },
      { ref: 'paid', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'payments', via: 'invoice_id', sum: 'amount', balance: { column: 'balance', of: 'total' }, cap: true } } },
      { ref: 'balance', type: 'decimal', scale: 2, nullable: true },
    ],
    states: { column: 'status', initial: 'draft', moves: { draft: ['sent', 'void'], sent: ['void'] }, ...(lock === undefined ? {} : { lock }), children: { lines: { via: 'invoice_id', lock: true }, payments: { via: 'invoice_id', ...tie } } },
  });
  const warned = (table: Doc) => cappedFormulaWarnings([table as never]).map((w) => w.message).join('\n');

  it('says nothing when the formula reads only locked columns while payments exist', () => {
    expect(warned(invoice({ when: ['sent', 'void'] }, { parentIn: ['sent'] }))).toBe('');
  });
  it('names the columns that stay open: no lock, a lock that lets one out, or payments that exist in unlocked states', () => {
    expect(warned(invoice(undefined, { parentIn: ['sent'] }))).toContain('"invoices.total" is worked out from "subtotal", "rate"');
    expect(warned(invoice({ when: ['sent', 'void'], except: ['rate'] }, { parentIn: ['sent'] }))).toContain('from "rate"');
    expect(warned(invoice({ when: ['sent', 'void'] }, {}))).toContain('from "subtotal", "rate"');
  });
  it('gives no advice for the released apps', () => {
    for (const name of ['client-portal-0.2.1', 'clinic-desk-0.2.1', 'point-of-sale-0.2.2']) {
      const result = validateManifest(released(name));
      expect(result.warnings.filter((w) => w.message.includes('settles the balance without the cap'))).toEqual([]);
    }
    const invoices = released('invoices-1.0.5') as { addOn: { shapes: { parts: Record<string, Doc> }[] } };
    const parts = invoices.addOn.shapes.flatMap((shape) => Object.entries(shape.parts).map(([ref, part]) => ({ ref, ...part })));
    expect(cappedFormulaWarnings(parts as never)).toEqual([]);
  });
  it('is advice: the manifest still validates', () => {
    const m = venue();
    (m['requiredSchema'] as { tables: Doc[] }).tables.push(
      invoice({ when: ['sent', 'void'], except: ['rate'] }, { parentIn: ['sent'] }),
      { ref: 'lines', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'invoice_id', type: 'fk', references: 'invoices' }, { ref: 'amount', type: 'decimal', scale: 2, default: 0 }] },
      { ref: 'payments', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'invoice_id', type: 'fk', references: 'invoices' }, { ref: 'amount', type: 'decimal', scale: 2, default: 0 }] },
    );
    const result = validateManifest(m);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.message).join('\n')).toContain('settles the balance without the cap');
  });
});

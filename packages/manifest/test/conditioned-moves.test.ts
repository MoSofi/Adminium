// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Moves that wait for things and moves the clock makes, in the manifest:
 * the moment every time rule reads, conditions on a linked row, the settings
 * row and the clock, the once-means-once refusal, late moves, timed moves,
 * deadline stamps, a public change allowed inside a window, and a move that
 * moves a linked row too. What each takes, and what each refuses.
 */
import { describe, expect, it } from 'vitest';

import { momentSchema, statesSchema } from '../src/index.js';
import { columnOf, entryOf, issuesText, moveOf, statesOf, tableOf, venue, type Doc } from './conditioned-moves-fixture.js';

const setting = (column: string) => ({ table: 'settings', column });

describe('the venue fixture', () => {
  it('validates with every new rule in it', () => {
    expect(issuesText(venue())).toBe('');
  });
});

describe('a moment', () => {
  it('takes a column, a link, a time of day, a shift and fallbacks', () => {
    expect(momentSchema.safeParse({ column: 'starts_at' }).success).toBe(true);
    expect(momentSchema.safeParse({ column: 'arrive', time: '15:00', minus: { hours: 48 } }).success).toBe(true);
    expect(momentSchema.safeParse({ via: 'event_id', column: 'starts_at', plus: { days: setting('refund_days') } }).success).toBe(true);
    expect(momentSchema.safeParse({ column: 'refund_until', or: [{ via: 'event_id', column: 'starts_at', minus: { days: 7 } }] }).success).toBe(true);
  });

  it('refuses both shifts, two units in one shift, a bad time of day, a nested fallback and an unknown key', () => {
    expect(momentSchema.safeParse({ column: 'a', plus: { hours: 1 }, minus: { hours: 1 } }).success).toBe(false);
    expect(momentSchema.safeParse({ column: 'a', plus: { hours: 1, days: 1 } }).success).toBe(false);
    expect(momentSchema.safeParse({ column: 'a', plus: {} }).success).toBe(false);
    expect(momentSchema.safeParse({ column: 'a', time: '24:00' }).success).toBe(false);
    expect(momentSchema.safeParse({ column: 'a', time: '9:00' }).success).toBe(false);
    expect(momentSchema.safeParse({ column: 'a', or: [{ column: 'b', or: [{ column: 'c' }] }] }).success).toBe(false);
    expect(momentSchema.safeParse({ column: 'a', date: 'b' }).success).toBe(false);
    expect(momentSchema.safeParse({ column: 'a', plus: { days: 36_601 } }).success).toBe(false);
    expect(momentSchema.safeParse({ column: 'a', plus: { minutes: 1_000_001 } }).success).toBe(false);
  });

  it('refuses a date with no time of day, a column that is not a date, and a link that points nowhere', () => {
    let m = venue();
    delete ((statesOf(m, 'stays')['late'] as Doc[])[0]!['moment'] as Doc)['time'];
    expect(issuesText(m)).toContain('"stays.arrive" is a date, so the moment names a time of day on it');
    m = venue();
    ((statesOf(m, 'orders')['timed'] as Doc[])[0]!['at'] as Doc)['column'] = 'email';
    expect(issuesText(m)).toContain('"orders.email" is not a date or a timestamptz');
    m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['time'] = { after: { via: 'door', column: 'doors_at' } };
    expect(issuesText(m)).toContain('"tickets.door" does not point at a table of this manifest');
    m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['time'] = { after: { via: 'id', column: 'doors_at' } };
    expect(issuesText(m)).toContain('"tickets.id" is the key, and points at no other row');
    m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['time'] = { after: { via: 'event_id', column: 'nope' } };
    expect(issuesText(m)).toContain('"events" has no column "nope"');
  });

  it('refuses a time setting that is not HH:MM text, a shift setting that is not a whole number, and a bad hours table', () => {
    let m = venue();
    ((statesOf(m, 'stays')['late'] as Doc[])[0]!['moment'] as Doc)['time'] = setting('cancel_hours');
    expect(issuesText(m)).toContain('"settings.cancel_hours" is not a text column holding HH:MM');
    m = venue();
    ((statesOf(m, 'stays')['late'] as Doc[])[0]!['moment'] as Doc)['time'] = setting('short_time');
    expect(issuesText(m)).toContain('"settings.short_time" holds fewer than the 5 characters of HH:MM');
    m = venue();
    ((statesOf(m, 'stays')['timed'] as Doc[])[0]!['at'] as Doc)['plus'] = { days: setting('arrive_from') };
    expect(issuesText(m)).toContain('"settings.arrive_from" is not a whole number');
    m = venue();
    (columnOf(m, 'hours', 'weekday'))['enum'] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    expect(issuesText(m)).toContain('"hours.weekday" is not an enum of mon, tue, wed, thu, fri, sat, sun');
    m = venue();
    const at = (statesOf(m, 'pickups')['timed'] as Doc[])[0]!['at'] as Doc;
    (at['time'] as Doc)['edge'] = 'opens';
    delete ((at['time'] as Doc)['hours'] as Doc)['opens'];
    expect(issuesText(m)).toContain('the opening hour is read from a column: name it (hours.opens)');
    m = venue();
    (((statesOf(m, 'pickups')['timed'] as Doc[])[0]!['at'] as Doc)['time'] as Doc)['hours'] = { table: 'hours', weekday: 'weekday', open: 'opens', closes: 'closes' };
    expect(issuesText(m)).toContain('"hours.opens" is not a bool');
  });

  it('checks each fallback like the first moment', () => {
    const m = venue();
    const when = entryOf(m)['writableWhen'] as Doc;
    (((when['event_id'] as Doc)['before'] as Doc)['or'] as Doc[])[0]!['column'] = 'name';
    expect(issuesText(m)).toContain('"events.name" is not a date or a timestamptz');
  });
});

describe('a move with conditions', () => {
  it('refuses a linked condition through a column that is no link, or on a column the linked row lacks', () => {
    let m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['linked'] = [{ via: 'door', where: [{ column: 'pay', eq: 'paid' }] }];
    expect(issuesText(m)).toContain('"tickets.door" does not point at a table of this manifest');
    m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['linked'] = [{ via: 'order_id', where: [{ column: 'pay', eq: 'cash' }] }];
    expect(issuesText(m)).toContain('"cash" is not a value of "orders.pay"');
    m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['linked'] = [{ via: 'order_id', where: [] }];
    expect(issuesText(m)).not.toBe('');
  });

  it('refuses a time condition that says neither after nor before', () => {
    const m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['time'] = {};
    expect(issuesText(m)).toContain('a time condition says after, before or both');
  });

  it('refuses a setting condition on a column that is not there or a value it cannot hold', () => {
    let m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['setting'] = [{ table: 'settings', column: 'nope', eq: true }];
    expect(issuesText(m)).toContain('"settings" has no column "nope"');
    m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['setting'] = [{ table: 'settings', column: 'door_on', eq: 'yes' }];
    expect(issuesText(m)).toContain('"yes" is not a value of "settings.door_on"');
    m = venue();
    (moveOf(m, 'tickets', 'valid', 'checked_in')['requires'] as Doc)['setting'] = [{ table: 'elsewhere', column: 'door_on', eq: true }];
    expect(issuesText(m)).toContain('"elsewhere" is not a table of this manifest');
  });
});

describe('once means once', () => {
  it('takes true, or up to four columns to repeat', () => {
    const m = venue();
    statesOf(m, 'tickets')['strict'] = true;
    expect(issuesText(m)).toBe('');
    expect(statesSchema.safeParse({ column: 's', initial: 'a', moves: {}, strict: { show: ['a', 'b', 'c', 'd', 'e'] } }).success).toBe(false);
    expect(statesSchema.safeParse({ column: 's', initial: 'a', moves: {}, strict: false }).success).toBe(false);
  });

  it('never repeats a column that is not there, personal or secret', () => {
    let m = venue();
    statesOf(m, 'tickets')['strict'] = { show: ['nope'] };
    expect(issuesText(m)).toContain('"tickets" has no column "nope"');
    m = venue();
    statesOf(m, 'tickets')['strict'] = { show: ['holder_email'] };
    expect(issuesText(m)).toContain('"tickets.holder_email" is personal data, so a refusal never repeats it');
    m = venue();
    statesOf(m, 'tickets')['strict'] = { show: ['door'] };
    columnOf(m, 'tickets', 'door')['rules'] = { secret: true };
    expect(issuesText(m)).toContain('"tickets.door" is a secret, so a refusal never repeats it');
  });
});

describe('a late move', () => {
  const late = (m: Doc) => (statesOf(m, 'stays')['late'] as Doc[])[0]!;

  it('refuses a move that is not listed, a state that is not one, and a flag that is not a bool', () => {
    let m = venue();
    late(m)['from'] = ['in_house'];
    expect(issuesText(m)).toContain('no listed move goes from "in_house" to "cancelled"');
    m = venue();
    late(m)['to'] = 'gone';
    expect(issuesText(m)).toContain('"gone" is not a value of "stays.status"');
    m = venue();
    delete late(m)['from'];
    late(m)['to'] = 'booked';
    expect(issuesText(m)).toContain('no listed move goes to "booked"');
    m = venue();
    late(m)['flag'] = 'arrive';
    expect(issuesText(m)).toContain('"stays.arrive" is not a bool');
  });

  it('refuses a flag without mode flag, a refusal said by a flag, and a flag another rule writes', () => {
    let m = venue();
    delete late(m)['flag'];
    expect(issuesText(m)).toContain('a flag names its column, and only mode "flag" has one');
    m = venue();
    late(m)['refuse'] = 'public';
    expect(issuesText(m)).toContain('who is refused is said only by mode "refuse"');
    m = venue();
    columnOf(m, 'stays', 'late_cancel')['rules'] = { stamp: { set: { byOrigin: { public: 'x' } }, on: 'create' } };
    expect(issuesText(m)).toContain('"stays.late_cancel" is written by another rule already');
  });

  it('takes a refusal for everyone, and refuses two late rules for one move', () => {
    let m = venue();
    Object.assign(late(m), { mode: 'refuse', refuse: 'everyone' });
    delete late(m)['flag'];
    expect(issuesText(m)).toBe('');
    m = venue();
    (statesOf(m, 'stays')['late'] as Doc[]).push({ ...late(m), flag: undefined, mode: 'refuse' });
    expect(issuesText(m)).toContain('another late rule already judges the move to "cancelled"; one late rule per move');
  });

  it('makes its flag Adminium\'s, so no public write sets it', () => {
    const m = venue();
    (m['publicAccess'] as Doc[]).push({
      table: 'stays',
      methods: ['POST'],
      writable: ['arrive', 'late_cancel'],
    });
    expect(issuesText(m)).toContain('"late_cancel" is decided by Adminium and cannot be written publicly');
  });
});

describe('a timed move', () => {
  const timed = (m: Doc, table = 'orders') => statesOf(m, table)['timed'] as Doc[];

  it('refuses a move that is not listed, two for one state, and a time read through a link', () => {
    let m = venue();
    timed(m)[0]!['to'] = 'cancelled';
    expect(issuesText(m)).toContain('no listed move goes from "held" to "cancelled"');
    m = venue();
    timed(m).push({ from: 'held', to: 'paid', at: { column: 'held_until' } });
    expect(issuesText(m)).toContain('another timed move already leaves "held"');
    m = venue();
    timed(m)[0]!['at'] = { via: 'event_id', column: 'starts_at' };
    expect(issuesText(m)).toContain("a timed move reads its own row's time, never a linked row's");
    m = venue();
    timed(m)[0]!['at'] = { column: 'held_until', or: [{ via: 'event_id', column: 'starts_at' }] };
    expect(issuesText(m)).toContain("a timed move reads its own row's time, never a linked row's");
  });

  it('refuses a timed move whose move waits until later than the time it is made at', () => {
    const m = venue();
    const moves = statesOf(m, 'orders')['moves'] as Record<string, unknown[]>;
    moves['held'] = ['awaiting_transfer', 'paid', { to: 'expired', requires: { time: { after: { column: 'held_until', plus: { minutes: 5 } } } } }];
    expect(issuesText(m)).toContain('waits until later than this, so it could never be made in time');
    timed(m)[0]!['at'] = { column: 'held_until', plus: { minutes: 5 } };
    expect(issuesText(m)).toBe('');
  });

  it('takes at most eight', () => {
    const m = venue();
    statesOf(m, 'orders')['timed'] = Array.from({ length: 9 }, () => timed(venue())[0]);
    expect(issuesText(m)).not.toBe('');
  });
});

describe('a deadline stamp', () => {
  it('refuses a column that is not a timestamptz, and settings of the wrong kind', () => {
    let m = venue();
    columnOf(m, 'orders', 'held_until')['type'] = 'date';
    expect(issuesText(m)).toContain('a stamped moment needs a timestamptz column');
    m = venue();
    (columnOf(m, 'orders', 'held_until')['rules'] as Doc)['stamp'] = { set: { addMinutes: { minutes: setting('arrive_from') } }, on: 'create' };
    expect(issuesText(m)).toContain('"settings.arrive_from" is not a whole number');
    m = venue();
    const deadline = (((columnOf(m, 'orders', 'pay_by')['rules'] as Doc)['stamp'] as Doc)['set'] as Doc)['deadline'] as Doc;
    deadline['time'] = setting('short_time');
    expect(issuesText(m)).toContain('"settings.short_time" holds fewer than the 5 characters of HH:MM');
    deadline['time'] = '18:00';
    deadline['notAfter'] = { via: 'event_id', column: 'name' };
    expect(issuesText(m)).toContain('"events.name" is not a date or a timestamptz');
  });

  it('adds minutes or hours, one of the two', () => {
    const m = venue();
    (columnOf(m, 'orders', 'held_until')['rules'] as Doc)['stamp'] = { set: { addMinutes: { minutes: 10, hours: 1 } }, on: 'create' };
    expect(issuesText(m)).not.toBe('');
    (columnOf(m, 'orders', 'held_until')['rules'] as Doc)['stamp'] = { set: { addMinutes: { hours: 12 } }, on: 'create' };
    expect(issuesText(m)).toBe('');
  });
});

describe('a stamped moment that follows what it is worked out from', () => {
  const stamp = (m: Doc) => (columnOf(m, 'stays', 'cancel_by')['rules'] as Doc)['stamp'] as Doc;

  it('refuses a column that is not a timestamptz, a bad moment, its own column, and a watched column that is not there', () => {
    let m = venue();
    columnOf(m, 'stays', 'cancel_by')['type'] = 'date';
    expect(issuesText(m)).toContain('a stamped moment needs a timestamptz column');
    m = venue();
    delete ((stamp(m)['set'] as Doc)['moment'] as Doc)['time'];
    expect(issuesText(m)).toContain('"stays.arrive" is a date, so the moment names a time of day on it');
    m = venue();
    stamp(m)['set'] = { moment: { column: 'cancel_by' } };
    expect(issuesText(m)).toContain('a stamped moment is worked out from other columns, not its own');
    m = venue();
    stamp(m)['on'] = { columns: ['arrive', 'nope'] };
    expect(issuesText(m)).toContain('"stays" has no column "nope"');
    m = venue();
    stamp(m)['on'] = { columns: ['cancel_by'] };
    expect(issuesText(m)).toContain('a stamp watches another column');
    m = venue();
    stamp(m)['on'] = { columns: [] };
    expect(issuesText(m)).not.toBe('');
  });

  it('may also fire on a state, as any stamp', () => {
    const m = venue();
    stamp(m)['on'] = ['create', { columns: ['arrive'] }];
    expect(issuesText(m)).toBe('');
  });
});

describe('a public change inside a window', () => {
  const when = (m: Doc) => entryOf(m)['writableWhen'] as Doc;

  it('keyed by a link, names the linked column; keyed by a date, names none', () => {
    let m = venue();
    delete ((when(m)['event_id'] as Doc)['before'] as Doc)['column'];
    expect(issuesText(m)).toContain('"event_id" is a link: name the column of the row it points at');
    m = venue();
    tableOf(m, 'orders');
    delete when(m)['event_id'];
    when(m)['held_until'] = { before: { column: 'pay_by' } };
    expect(issuesText(m)).toContain('the window is "orders.held_until" itself, so it names no other column');
    m = venue();
    delete when(m)['event_id'];
    when(m)['held_until'] = { before: { minus: { minutes: 2 } } };
    expect(issuesText(m)).toBe('');
  });

  it('refuses a key that is no date, time or link, and conditions on a row keyed by a date', () => {
    let m = venue();
    delete when(m)['event_id'];
    when(m)['email'] = { before: {} };
    expect(issuesText(m)).toContain('"orders.email" is neither a date, a time nor a link, so no window is read from it');
    m = venue();
    delete when(m)['event_id'];
    when(m)['held_until'] = { where: [{ column: 'refunds_on', eq: true }] };
    expect(issuesText(m)).toContain('conditions on a linked row are keyed by a link of "orders"');
    m = venue();
    ((when(m)['event_id'] as Doc)['where'] as Doc[])[0]!['column'] = 'nope';
    expect(issuesText(m)).toContain('"events" has no column "nope"');
  });

  it('keeps one time window per entry', () => {
    const m = venue();
    when(m)['held_until'] = { within: 60 };
    expect(issuesText(m)).toContain('one time window per entry');
  });

  it('never lets the same write move the date that opens the window', () => {
    let m = venue();
    delete when(m)['event_id'];
    when(m)['held_until'] = { before: { minus: { minutes: 2 } } };
    entryOf(m)['writable'] = ['status', 'held_until'];
    expect(issuesText(m)).toContain('"held_until" decides when this row may change, so a write through this entry may not set it');
    m = venue();
    entryOf(m)['writable'] = ['status', 'event_id'];
    expect(issuesText(m)).toContain('"event_id" decides when this row may change');
  });
});

describe('a move that moves a linked row', () => {
  const effects = (m: Doc) => statesOf(m, 'stays')['effects'] as Doc[];

  it('refuses a link to a table with no states, a column that is not its state, and a state no move reaches', () => {
    let m = venue();
    effects(m)[0]!['via'] = 'arrive';
    expect(issuesText(m)).toContain('"stays.arrive" does not point at a table of this manifest');
    m = venue();
    delete tableOf(m, 'rooms')['states'];
    expect(issuesText(m)).toContain('"rooms" declares no states, so its rows have no moves to make');
    m = venue();
    effects(m)[0]!['set'] = { name: 'occupied' };
    expect(issuesText(m)).toContain('"rooms" moves by "status", not "name"');
    m = venue();
    (statesOf(m, 'rooms')['moves'] as Doc)['ready'] = [];
    expect(issuesText(m)).toContain('no move of "rooms" goes to "occupied"');
  });

  it('refuses an effect nothing sets off, two for one move and link, more than four, and two columns', () => {
    let m = venue();
    (effects(m)[0]!['on'] as Doc)['to'] = 'booked';
    expect(issuesText(m)).toContain('no listed move goes to "booked", so nothing sets this off');
    m = venue();
    effects(m).push({ on: { to: 'in_house' }, via: 'room_id', set: { status: 'cleaning' } });
    expect(issuesText(m)).toContain('another effect already moves the row "room_id" points at on a move to "in_house"');
    m = venue();
    statesOf(m, 'stays')['effects'] = Array.from({ length: 5 }, (_, i) => ({ on: { to: i % 2 === 0 ? 'in_house' : 'departed' }, via: 'room_id', set: { status: 'cleaning' } }));
    expect(issuesText(m)).not.toBe('');
    m = venue();
    effects(m)[0]!['set'] = { status: 'occupied', other: 'x' };
    expect(issuesText(m)).toContain("an effect sets one column: the linked table's state");
  });

  it("refuses a move judged late by another row's time, and a move of the app's outbox", () => {
    let m = venue();
    (tableOf(m, 'rooms')['columns'] as Doc[]).push({ ref: 'event_id', type: 'fk', references: 'events', nullable: true });
    statesOf(m, 'rooms')['late'] = [{ to: 'occupied', moment: { via: 'event_id', column: 'starts_at' }, within: { hours: 2 }, mode: 'refuse' }];
    expect(issuesText(m)).toContain('a move of "rooms" to "occupied" is judged late by another row\'s time, so an effect cannot make it');
    // Its own row's time is fine.
    m = venue();
    (tableOf(m, 'rooms')['columns'] as Doc[]).push({ ref: 'ready_at', type: 'timestamptz', nullable: true });
    statesOf(m, 'rooms')['late'] = [{ to: 'occupied', moment: { column: 'ready_at' }, within: { hours: 2 }, mode: 'refuse' }];
    expect(issuesText(m)).not.toContain('judged late by another row');
    m = venue();
    m['outbox'] = {
      table: 'rooms',
      columns: { kind: 'kind', status: 'status', to: 'to_address' },
      recipient: { via: 'room_id', table: 'stays', email: 'email' },
      kinds: { note: 'venue-note' },
      producers: [{ kind: 'note', link: 'id', onChange: { table: 'stays', column: 'status', to: 'in_house' } }],
    };
    expect(issuesText(m)).toContain('"rooms" is the app\'s outbox, whose messages move only by the outbox\'s own moves');
  });
});

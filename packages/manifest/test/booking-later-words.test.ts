// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The later words of a booking rule: a buffer, the times a person is away, how
 * "anyone" is given a person, hours capped by the practice's, a window for
 * guests only, and the states a row is judged from as a new booking. One studio uses them all and validates; each test breaks one
 * and reads the sentence that names it. An engine before them refuses the
 * manifest by release, so each is a word with a floor.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const hhmm = (ref: string) => ({ ref, type: 'text', maxLength: 5 });
const weekday = { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] };
const at = (ref: string) => ({ ref, type: 'timestamptz' });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references });

function rule(): Doc {
  return {
    start: 'starts_at',
    minutes: 'minutes',
    buffer: 'buffer_min',
    resource: 'team_id',
    kind: 'service_id',
    countWhere: { column: 'state', values: ['booked'] },
    placedFrom: ['offered'],
    eligible: { table: 'team_services', resource: 'team_id', kind: 'service_id', order: { table: 'team', column: 'position' } },
    hours: {
      practice: { table: 'opening_hours', weekday: 'weekday', opens: 'opens', closes: 'closes' },
      own: { table: 'team_hours', resource: 'team_id', weekday: 'weekday', opens: 'opens', closes: 'closes', within: 'practice' },
    },
    busy: [
      { table: 'time_off', resource: 'team_id', start: 'starts_at', end: 'ends_at' },
      { table: 'calendar_busy', resource: 'team_id', start: 'starts_at', end: 'ends_at', engine: { account: 'account' } },
    ],
    anyone: { pick: { column: 'anyone_pick' }, made: 'made_at', flag: 'picked_by_anyone' },
    grid: 15,
    windowDays: 30,
    windowFor: 'guests',
  };
}

function studio(change: (booking: Doc, tables: Doc[]) => void = () => undefined): Doc {
  const booking = rule();
  const tables: Doc[] = [
    { ref: 'opening_hours', columns: [id, weekday, hhmm('opens'), hhmm('closes')] },
    { ref: 'team', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'position', type: 'int' }] },
    { ref: 'services', columns: [id, { ref: 'minutes', type: 'int' }, { ref: 'buffer_min', type: 'int' }, { ref: 'anyone_pick', type: 'enum', enum: ['even', 'order'] }] },
    { ref: 'team_services', columns: [id, fk('team_id', 'team'), fk('service_id', 'services')] },
    { ref: 'team_hours', columns: [id, fk('team_id', 'team'), weekday, hhmm('opens'), hhmm('closes')] },
    { ref: 'time_off', columns: [id, fk('team_id', 'team'), at('starts_at'), at('ends_at')] },
    { ref: 'calendar_busy', private: true, columns: [id, fk('team_id', 'team'), at('starts_at'), at('ends_at'), { ref: 'account', type: 'text', maxLength: 40 }] },
    {
      ref: 'bookings',
      booking,
      columns: [
        id,
        fk('team_id', 'team'),
        fk('service_id', 'services'),
        at('starts_at'),
        { ref: 'minutes', type: 'int', rules: { copy: { via: 'service_id', from: 'minutes', mode: 'always' } } },
        { ref: 'buffer_min', type: 'int', rules: { copy: { via: 'service_id', from: 'buffer_min', mode: 'always' } } },
        { ref: 'state', type: 'enum', enum: ['offered', 'booked', 'cancelled'], default: 'booked' },
        at('made_at'),
        { ref: 'picked_by_anyone', type: 'bool', default: false },
      ],
    },
  ];
  change(booking, tables);
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'studio',
    name: 'Studio',
    version: '0.2.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A studio.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.71' },
    requiredSchema: { prefixed: true, tables },
    pages: [{ ref: 'studio-bookings', template: 'page-crud', title: { key: 't', fallback: 'Bookings' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'bookings' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const messages = (doc: Doc): string[] => {
  const result = validateManifest(doc) as { ok: boolean; errors?: { message: string }[]; issues?: { message: string }[] };
  return (result.errors ?? result.issues ?? []).map((issue) => issue.message);
};
const tableOf = (tables: Doc[], ref: string) => tables.find((table) => table['ref'] === ref)!;

describe('the later words of a booking rule', () => {
  it('validates a studio that uses them all', () => {
    expect(messages(studio())).toEqual([]);
  });

  it('asks that the buffer is copied from the kind, always', () => {
    const doc = studio((_booking, tables) => {
      const columns = tableOf(tables, 'bookings')['columns'] as Doc[];
      columns.find((column) => column['ref'] === 'buffer_min')!['rules'] = { copy: { via: 'service_id', from: 'buffer_min', mode: 'default' } };
    });
    expect(messages(doc).join(' ')).toContain('copied from the kind, always');
  });

  it('holds a busy source to a person and two moments', () => {
    const wrongLink = studio((booking) => {
      (booking['busy'] as Doc[])[0]!['resource'] = 'id';
    });
    expect(messages(wrongLink).join(' ')).toContain('time_off.id');
    const notAMoment = studio((_booking, tables) => {
      const columns = tableOf(tables, 'time_off')['columns'] as Doc[];
      columns[3] = { ref: 'ends_at', type: 'date' };
    });
    expect(messages(notAMoment).join(' ')).toContain('must be a timestamptz');
    const itself = studio((booking) => {
      (booking['busy'] as Doc[])[0]!['table'] = 'bookings';
    });
    expect(messages(itself).join(' ')).toContain('already counted');
  });

  it('keeps a calendar Adminium writes private, and to one source', () => {
    const open = studio((_booking, tables) => {
      delete tableOf(tables, 'calendar_busy')['private'];
    });
    expect(messages(open).join(' ')).toContain('"private": true');
    const two = studio((booking) => {
      (booking['busy'] as Doc[])[0]!['engine'] = { account: 'id' };
    });
    expect(messages(two).join(' ')).toContain("one busy source is Adminium's own");
  });

  it('still asks any other private table whose its rows are', () => {
    const doc = studio((_booking, tables) => {
      tables.push({ ref: 'notes', private: true, columns: [id] });
    });
    expect(messages(doc).join(' ')).toContain('give it "belongs"');
  });

  it('asks what sharing evenly reads', () => {
    const noMade = studio((booking) => {
      booking['anyone'] = { pick: 'even' };
    });
    expect(messages(noMade).join(' ')).toContain('when each row was made');
    expect(messages(studio((booking) => { booking['anyone'] = { pick: 'order' }; }))).toEqual([]);
    const badPick = studio((_booking, tables) => {
      const columns = tableOf(tables, 'services')['columns'] as Doc[];
      columns[3] = { ref: 'anyone_pick', type: 'enum', enum: ['even', 'fair'] };
    });
    expect(messages(badPick).join(' ')).toContain('an enum of even, order');
  });

  it('asks for a window before saying who it holds', () => {
    const doc = studio((booking) => {
      delete booking['windowDays'];
    });
    expect(messages(doc).join(' ')).toContain('no window');
  });

  it('places only from a state the table has, and that takes no time', () => {
    const unknown = studio((booking) => {
      booking['placedFrom'] = ['waiting'];
    });
    expect(messages(unknown).join(' ')).toContain('"waiting" is not a value');
    const counted = studio((booking) => {
      booking['placedFrom'] = ['booked'];
    });
    expect(messages(counted).join(' ')).toContain('already counts');
  });

  it('names each word, with the release that first runs it', () => {
    const words = installFloorWords(studio()).map((one) => one.word).filter((word) => word.startsWith('table.booking.'));
    expect(words.sort()).toEqual(['table.booking.anyone', 'table.booking.buffer', 'table.booking.busy', 'table.booking.hours.within', 'table.booking.placedFrom', 'table.booking.windowFor']);
    for (const word of words) expect(WORD_FLOORS[word]).toBe('0.3.71');
  });

  it('adds none of them to a rule that does not use them', () => {
    const plain = studio((booking, tables) => {
      for (const word of ['buffer', 'busy', 'anyone', 'windowFor', 'placedFrom']) delete booking[word];
      delete (booking['hours'] as { own: Doc }).own['within'];
      delete tableOf(tables, 'calendar_busy')['private'];
    });
    expect(messages(plain)).toEqual([]);
    expect(installFloorWords(plain).filter((one) => one.word.startsWith('table.booking.'))).toEqual([]);
  });
});

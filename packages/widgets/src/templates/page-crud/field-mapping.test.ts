// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  coerceFieldValue,
  controlForColumn,
  dateOnlyValue,
  fieldTypeTag,
  formColumns,
  isRequired,
  optionsForColumn,
  withFactChoices,
} from './field-mapping.js';
import { SEGMENTED_MAX_ARITY } from '../../page-config/crud-form.js';
import type { ColumnFact } from './field-mapping.js';
import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

/*
 * `controlForColumn` replaced `fieldKindFor` in phase E: one mapping, over the
 * control catalog the designer and the server also read (Appendix C). The kinds
 * this file used to assert map onto controls — `checkbox` became the comp's
 * `toggle-row`, `fk` became `reference` — and the two RULES that matter are
 * unchanged: what is hidden, and when a small required enum segments.
 */
describe('controlForColumn — the one mapping', () => {
  it('pk with default and server-managed timestamps are hidden', () => {
    expect(controlForColumn(spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true }))).toBe('hidden');
    expect(controlForColumn(spec({ name: 'created_at', label: 'Created', logicalType: 'timestamptz', semantic: 'created-at' }))).toBe('hidden');
    expect(controlForColumn(spec({ name: 'updated_at', label: 'Updated', logicalType: 'timestamptz', semantic: 'updated-at' }))).toBe('hidden');
  });

  it('cross-table projections (lookup + reverse aggregate) never become form fields', () => {
    expect(
      controlForColumn(spec({ name: 'client_id__name', label: 'Client Name', lookup: { path: ['client_id'], select: 'name' } })),
    ).toBe('hidden');
    expect(
      controlForColumn(
        spec({
          name: 'items__count',
          label: 'Items Count',
          logicalType: 'integer',
          reverse: { table: 'public.invoice_items', fkColumn: 'invoice_id', agg: 'count' },
        }),
      ),
    ).toBe('hidden');
  });

  it('read-only columns render as readonly, natural pks stay editable', () => {
    expect(controlForColumn(spec({ name: 'slug', label: 'Slug', readOnly: true }))).toBe('readonly');
    expect(controlForColumn(spec({ name: 'code', label: 'Code', primaryKey: true, hasDefault: false, nullable: false }))).toBe('text');
  });

  it('a foreign key is a reference', () => {
    expect(
      controlForColumn(spec({ name: 'owner_id', label: 'Owner', logicalType: 'integer', fk: { table: 'public.team_members', column: 'id' } })),
    ).toBe('reference');
  });

  describe('enum arity rule (comp: SegmentedControl for small required enums)', () => {
    const enumSpec = (count: number, nullable: boolean) =>
      spec({
        name: 'status',
        label: 'Status',
        logicalType: 'enum',
        enumValues: Array.from({ length: count }, (_, i) => `v${String(i)}`),
        nullable,
      });

    it(`arity ≤ ${String(SEGMENTED_MAX_ARITY)} and required → segmented`, () => {
      expect(controlForColumn(enumSpec(2, false))).toBe('segmented');
      expect(controlForColumn(enumSpec(SEGMENTED_MAX_ARITY, false))).toBe('segmented');
    });
    it('larger arity → select', () => {
      expect(controlForColumn(enumSpec(SEGMENTED_MAX_ARITY + 1, false))).toBe('select');
    });
    it('nullable enums always select (need the empty option)', () => {
      expect(controlForColumn(enumSpec(2, true))).toBe('select');
    });
  });

  it('logicalType dispatch: boolean/number/date/time/datetime/json', () => {
    // The comp's boolean is a toggle ROW, not a checkbox (D18).
    expect(controlForColumn(spec({ name: 'ok', label: 'OK', logicalType: 'boolean' }))).toBe('toggle-row');
    expect(controlForColumn(spec({ name: 'seats', label: 'Seats', logicalType: 'integer' }))).toBe('number');
    // Money gets the currency prefix (Appendix C), which a plain number has no
    // room for.
    expect(controlForColumn(spec({ name: 'mrr', label: 'MRR', logicalType: 'decimal', semantic: 'money' }))).toBe('currency');
    expect(controlForColumn(spec({ name: 'day', label: 'Day', logicalType: 'date' }))).toBe('date');
    expect(controlForColumn(spec({ name: 'at', label: 'At', logicalType: 'time' }))).toBe('time');
    expect(controlForColumn(spec({ name: 'when', label: 'When', logicalType: 'timestamptz' }))).toBe('datetime');
    expect(controlForColumn(spec({ name: 'meta', label: 'Meta', logicalType: 'json' }))).toBe('json');
  });

  it('semantics dispatch: email/url/free-text; unbounded text → textarea', () => {
    expect(controlForColumn(spec({ name: 'email', label: 'Email', logicalType: 'varchar', semantic: 'email' }))).toBe('email');
    expect(controlForColumn(spec({ name: 'site', label: 'Site', logicalType: 'varchar', semantic: 'url' }))).toBe('url');
    expect(controlForColumn(spec({ name: 'bio', label: 'Bio', logicalType: 'text', semantic: 'free-text' }))).toBe('textarea');
    expect(controlForColumn(spec({ name: 'notes', label: 'Notes', logicalType: 'text' }))).toBe('textarea');
    expect(controlForColumn(spec({ name: 'name', label: 'Name', logicalType: 'varchar', maxLength: 120 }))).toBe('text');
  });
});

describe('form helpers', () => {
  it('formColumns drops hidden fields, keeps order', () => {
    const columns = [
      spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true }),
      spec({ name: 'name', label: 'Name', logicalType: 'varchar' }),
      spec({ name: 'created_at', label: 'Created', semantic: 'created-at', logicalType: 'timestamptz' }),
    ];
    expect(formColumns(columns).map((c) => c.name)).toEqual(['name']);
  });

  it('isRequired: NOT NULL without default', () => {
    expect(isRequired(spec({ name: 'name', label: 'Name', nullable: false }))).toBe(true);
    expect(isRequired(spec({ name: 'name', label: 'Name', nullable: false, hasDefault: true }))).toBe(false);
    expect(isRequired(spec({ name: 'name', label: 'Name', nullable: true }))).toBe(false);
  });

  it('fieldTypeTag explains the generation (varchar / enum / → table)', () => {
    expect(fieldTypeTag(spec({ name: 'n', label: 'N', logicalType: 'varchar' }))).toBe('varchar');
    expect(fieldTypeTag(spec({ name: 's', label: 'S', logicalType: 'enum', enumValues: ['a'] }))).toBe('enum');
    expect(fieldTypeTag(spec({ name: 'o', label: 'O', fk: { table: 'public.team_members', column: 'id' } }))).toBe(
      '→ public.team_members',
    );
    // A table with a name for a person is tagged by it, not its identifier.
    expect(fieldTypeTag(spec({ name: 'c', label: 'Category', fk: { table: 'main.pos_menu_categories', column: 'id', label: 'Categories' } }))).toBe(
      '→ Categories',
    );
  });

  it('coerceFieldValue: numbers, booleans, JSON, nullable empties', () => {
    const seats = spec({ name: 'seats', label: 'Seats', logicalType: 'integer' });
    expect(coerceFieldValue(seats, '42')).toBe(42);
    const flag = spec({ name: 'ok', label: 'OK', logicalType: 'boolean' });
    expect(coerceFieldValue(flag, true)).toBe(true);
    const meta = spec({ name: 'meta', label: 'Meta', logicalType: 'json' });
    expect(coerceFieldValue(meta, '{"a":1}')).toEqual({ a: 1 });
    const note = spec({ name: 'note', label: 'Note', nullable: true });
    expect(coerceFieldValue(note, '')).toBeNull();
  });
});

describe('date columns — wire-instant round-trip (client-portal audit repro)', () => {
  const issuedOn = spec({ name: 'issued_on', label: 'Issued on', logicalType: 'date', nullable: true });

  it('recovers the calendar day from a server-local-midnight instant in any browser TZ', () => {
    const tzBefore = process.env.TZ;
    try {
      // Ahead of UTC (the reproduced Europe/Berlin −1-day audit shift) and
      // behind it — a regression to local-time getters or a bare
      // toISOString().slice() fails in at least one of the two zones.
      for (const tz of ['Europe/Berlin', 'America/New_York']) {
        process.env.TZ = tz;
        // pg serializes date '2026-05-29' on a UTC+2 host as 22:00Z the day before.
        expect(dateOnlyValue('2026-05-28T22:00:00.000Z')).toBe('2026-05-29');
        // The same calendar day served by UTC and UTC−4 hosts.
        expect(dateOnlyValue('2026-05-29T00:00:00.000Z')).toBe('2026-05-29');
        expect(dateOnlyValue('2026-05-29T04:00:00.000Z')).toBe('2026-05-29');
        expect(dateOnlyValue(new Date('2026-05-28T22:00:00.000Z'))).toBe('2026-05-29');
        // Untouched edit fields still hold the wire instant at submit time —
        // the audit repro was issued_on '2026-05-28T22:00:00.000Z' saved back
        // unchanged and coming out a day earlier.
        expect(coerceFieldValue(issuedOn, '2026-05-28T22:00:00.000Z')).toBe('2026-05-29');
      }
    } finally {
      if (tzBefore === undefined) delete process.env.TZ;
      else process.env.TZ = tzBefore;
    }
  });

  it('plain date strings, empties, and garbage pass through', () => {
    expect(dateOnlyValue('2026-06-01')).toBe('2026-06-01');
    expect(coerceFieldValue(issuedOn, '2026-06-01')).toBe('2026-06-01');
    expect(coerceFieldValue(issuedOn, '')).toBeNull();
    expect(coerceFieldValue(issuedOn, null)).toBeNull();
    // Unparseable values reach the database untouched — its error is the signal.
    expect(dateOnlyValue('not-a-date')).toBe('not-a-date');
  });
});

describe('column facts — what the server says about the table right now', () => {
  const fact = (over: Partial<ColumnFact> = {}): ColumnFact => ({
    filledBy: null,
    required: false,
    writable: true,
    ...over,
  });

  const createdAt = spec({
    name: 'created_at',
    label: 'Created',
    logicalType: 'timestamptz',
    semantic: 'created-at',
    nullable: false,
  });

  it('shows a created_at that NOTHING fills — the create the owner could not make', () => {
    /*
     * The bug this whole plan starts from. The form hid the column on the
     * classifier's TAG, and on a table whose `created_at` is NOT NULL with no
     * database default that left a form which could not supply a value the
     * database then demanded. A tag says what a column means; only a fact says
     * who writes it.
     */
    expect(controlForColumn(createdAt, fact({ required: true }))).toBe('datetime');
    expect(isRequired(createdAt, fact({ required: true }))).toBe(true);
  });

  it('asks for a column while another holds one of the values its rule lists', () => {
    const person = spec({ name: 'person_id', label: 'Person', logicalType: 'integer', nullable: true });
    const when = fact({ requiredWhen: { column: 'kind', in: ['away', 'sick'] } });
    expect(isRequired(person, when)).toBe(false);
    expect(isRequired(person, when, { kind: 'office' })).toBe(false);
    expect(isRequired(person, when, { kind: null })).toBe(false);
    expect(isRequired(person, when, { kind: 'sick' })).toBe(true);
    // A switch holds a boolean; a number column may hold its value as text.
    expect(isRequired(person, fact({ requiredWhen: { column: 'done', in: [true] } }), { done: true })).toBe(true);
    expect(isRequired(person, fact({ requiredWhen: { column: 'tier', in: [2] } }), { tier: '2' })).toBe(true);
    // A record read back from MySQL or SQLite holds a yes as 1: still a yes, as on the server.
    const urgent = fact({ requiredWhen: { column: 'urgent', in: [true] } });
    expect(isRequired(person, urgent, { urgent: 1 })).toBe(true);
    expect(isRequired(person, urgent, { urgent: 0 })).toBe(false);
    expect(isRequired(person, fact({ requiredWhen: { column: 'urgent', in: [false] } }), { urgent: 0 })).toBe(true);
  });

  it('asks nothing of an edit that changes neither column, as the server judges it', () => {
    const person = spec({ name: 'person_id', label: 'Person', logicalType: 'integer', nullable: true });
    const when = fact({ requiredWhen: { column: 'kind', in: ['away'] } });
    const stored = { kind: 'away', person_id: null };
    expect(isRequired(person, when, { ...stored }, stored)).toBe(false);
    expect(isRequired(person, when, { kind: 'away', person_id: '' }, stored)).toBe(false);
    // Moving either column is judged.
    expect(isRequired(person, when, { kind: 'away', person_id: null }, { kind: 'office', person_id: null })).toBe(true);
    expect(isRequired(person, when, { kind: 'away', person_id: null }, { kind: 'away', person_id: 7 })).toBe(true);
  });

  it('still hides one that the database or Adminium fills', () => {
    expect(controlForColumn(createdAt, fact({ filledBy: 'database' }))).toBe('hidden');
    expect(controlForColumn(createdAt, fact({ filledBy: 'adminium' }))).toBe('hidden');
    expect(isRequired(createdAt, fact({ filledBy: 'adminium' }))).toBe(false);
  });

  it('hides a key with a default and shows one the person has to type', () => {
    const key = spec({ name: 'id', label: 'ID', primaryKey: true, nullable: false });
    expect(controlForColumn(key, fact({ filledBy: 'database' }))).toBe('hidden');
    expect(controlForColumn(key, fact({ required: true }))).toBe('text');
  });

  it('shows a generated column without letting anybody edit it', () => {
    const total = spec({ name: 'total', label: 'Total', logicalType: 'decimal' });
    expect(controlForColumn(total, fact({ writable: false, filledBy: 'database' }))).toBe('readonly');
  });

  it('never resurrects a projection, whatever the facts say', () => {
    const lookup = spec({
      name: 'client_id__name',
      label: 'Client Name',
      lookup: { path: ['client_id'], select: 'name' },
    });
    expect(controlForColumn(lookup, fact({ required: true }))).toBe('hidden');
  });

  it('falls back to the stored spec when the reply carried no facts', () => {
    expect(controlForColumn(createdAt)).toBe('hidden');
    expect(formColumns([createdAt])).toEqual([]);
    expect(formColumns([createdAt], { created_at: fact({ required: true }) })).toHaveLength(1);
  });
});

/*
 * A `column.options` rule is the admin's answer list, and it
 * decides both what the control OFFERS and which control it is — a column the
 * database calls `varchar` is a choice field once somebody has said what may go
 * in it.
 */
describe('an admin\u2019s answers — inline values and named lists', () => {
  const fact = (over: Partial<ColumnFact> = {}): ColumnFact => ({
    filledBy: null,
    required: false,
    writable: true,
    ...over,
  });
  const country = spec({ name: 'country', label: 'Country', logicalType: 'varchar', nullable: false });
  const lists = (key: string) =>
    key === 'builtin:countries'
      ? [
          { value: 'DE', label: 'Germany' },
          { value: 'FR', label: 'France' },
        ]
      : undefined;

  it('offers the rule\u2019s own values, over the column\u2019s enum', () => {
    const stage = spec({
      name: 'stage',
      label: 'Stage',
      logicalType: 'enum',
      enumValues: ['new', 'old'],
      nullable: false,
    });
    // The rule is the narrower statement and the server enforces it: a form
    // offering `old` would be a form arguing with the write path.
    expect(
      optionsForColumn(stage, fact({ options: { values: [{ value: 'new', label: 'New' }] } })),
    ).toEqual([{ value: 'new', label: 'New' }]);
    expect(optionsForColumn(stage)).toEqual([{ value: 'new' }, { value: 'old' }]);
  });

  it('names an enum’s own values with the column’s labels', () => {
    const kind = spec({ name: 'kind', label: 'Choice', logicalType: 'enum', enumValues: ['radio', 'check'], nullable: false });
    expect(optionsForColumn(kind, fact({ enumLabels: { radio: 'Pick one', check: 'Pick any' } }))).toEqual([
      { value: 'radio', label: 'Pick one' },
      { value: 'check', label: 'Pick any' },
    ]);
  });

  it('resolves a named list through the host, in the reader\u2019s language', () => {
    const facts = fact({ options: { list: 'builtin:countries' } });
    expect(optionsForColumn(country, facts, lists)).toEqual([
      { value: 'DE', label: 'Germany' },
      { value: 'FR', label: 'France' },
    ]);
    // Two answers and required ⇒ the comp's segmented control, not a select:
    // the rule decides the control as well as the answers.
    expect(controlForColumn(country, facts, lists)).toBe('segmented');
  });

  it('a list nobody can resolve leaves the column as it was', () => {
    /*
     * The list was deleted, or the reader cannot see the store. Refusing to
     * render the field would take a form down over a list somebody tidied up,
     * and the WRITE path treats an unresolvable list the same way.
     */
    const facts = fact({ options: { list: 'gone' } });
    expect(optionsForColumn(country, facts, lists)).toEqual([]);
    expect(controlForColumn(country, facts, lists)).toBe('text');
  });
});

/*
 * A page's stored columns never carry a choice column's words — generation
 * writes none — so the list takes them from the server's facts, read in the
 * person's language, and says what the form beside it offers.
 */
describe('the server’s words for a choice column, on a page’s stored columns', () => {
  const status = spec({ name: 'status', label: 'Status', logicalType: 'enum', enumValues: ['waiting', 'seen'] });
  const paid = spec({ name: 'paid_with', label: 'Paid with' });
  const base: ColumnFact = { filledBy: null, required: false, writable: true };

  it('takes the facts’ labels and tones where the page sets none', () => {
    const facts = { status: { ...base, enumLabels: { waiting: 'Wartend' }, enumTones: { waiting: 'warn', seen: 'glitter' } } };
    const [shown] = withFactChoices([status], facts);
    expect(shown?.enumLabels).toEqual({ waiting: 'Wartend' });
    // A tone no cell can draw is left to the column's default.
    expect(shown?.enumTones).toEqual({ waiting: 'warn' });
  });

  it('draws an inline list’s words and tones over the value labels, as the form offers them', () => {
    const facts = {
      paid_with: { ...base, options: { values: [{ value: 'cash', label: 'Bar', tone: 'pos' }, { value: 'card' }] } },
      status: { ...base, enumLabels: { waiting: 'Wartend' }, options: { values: [{ value: 'waiting', label: 'In der Schlange' }] } },
    };
    const [shownPaid, shownStatus] = withFactChoices([paid, status], facts);
    expect(shownPaid).toMatchObject({ enumLabels: { cash: 'Bar' }, enumTones: { cash: 'pos' } });
    expect(shownStatus?.enumLabels).toEqual({ waiting: 'In der Schlange' });
  });

  it('keeps a named list’s column as it was: a grid of codes stays one', () => {
    const columns = [paid];
    expect(withFactChoices(columns, { paid_with: { ...base, options: { list: 'builtin:countries' } } })).toBe(columns);
  });

  it('a page’s own words and tones win, each on its own', () => {
    const own = spec({ name: 'status', label: 'Status', logicalType: 'enum', enumLabels: { waiting: 'Queued' } });
    const [shown] = withFactChoices([own], { status: { ...base, enumLabels: { waiting: 'Wartend' }, enumTones: { waiting: 'warn' } } });
    expect(shown?.enumLabels).toEqual({ waiting: 'Queued' });
    expect(shown?.enumTones).toEqual({ waiting: 'warn' });
  });

  it('hands back the same columns when there is nothing to add', () => {
    const columns = [status, paid];
    expect(withFactChoices(columns, undefined)).toBe(columns);
    expect(withFactChoices(columns, { status: base })).toBe(columns);
  });

  it('a form’s answer with no word of its own takes the column’s value label', () => {
    const fact: ColumnFact = { ...base, enumLabels: { waiting: 'Wartend' }, options: { values: [{ value: 'waiting' }, { value: 'seen', label: 'Behandelt' }] } };
    expect(optionsForColumn(status, fact)).toEqual([
      { value: 'waiting', label: 'Wartend' },
      { value: 'seen', label: 'Behandelt' },
    ]);
  });
});

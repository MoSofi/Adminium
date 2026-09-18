// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The form document: what a page may store, what it gets when
 * it stores nothing, and what happens when the stored one has gone stale.
 *
 * ─── The three failures this file exists to hold shut ──────────────────────
 *
 * 1. A form that hides a column nothing fills (B1) — the create the owner
 *    reported. The derivation asks WHO FILLS IT, never what the column is
 *    called.
 * 2. A required column at the BOTTOM of the form (B10), because the grid's
 *    eight-column cap dropped it and it was re-appended last. The derivation is
 *    in the table's own order and knows nothing about the grid.
 * 3. A stored document that predates a column the database now demands. The
 *    safety net appends it rather than letting every create fail with a field
 *    the form never drew.
 */
import { describe, expect, it } from 'vitest';

import {
  controlFor,
  deriveFormDocument,
  formDocumentFor,
  legalControls,
  parseCrudForm,
  type CrudFormColumnField,
  type FormColumnFact,
  type FormColumnShape,
} from '../src/page-config/crud-form.js';

const spec = (over: Partial<FormColumnShape> & { name: string }): FormColumnShape => ({
  logicalType: 'varchar',
  semantic: null,
  nullable: true,
  maxLength: 120,
  ...over,
});

const fact = (over: Partial<FormColumnFact> & { spec: FormColumnShape }): FormColumnFact => ({
  ordinal: 1,
  writable: true,
  filledBy: null,
  required: false,
  ...over,
});

const columns = (document: { sections: { fields: unknown[] }[] }): CrudFormColumnField[] =>
  document.sections.flatMap((section) => section.fields as CrudFormColumnField[]);

// ---------------------------------------------------------------------------
// controlFor / legalControls (D18, Appendix C)
// ---------------------------------------------------------------------------

describe('the control a column gets when nobody chose one', () => {
  it('asks the semantic before the type, because money is a decimal', () => {
    expect(controlFor(spec({ name: 'total', logicalType: 'decimal', semantic: 'money' }))).toBe('currency');
    expect(controlFor(spec({ name: 'qty', logicalType: 'integer' }))).toBe('number');
    expect(controlFor(spec({ name: 'phone', semantic: 'phone' }))).toBe('phone');
    expect(controlFor(spec({ name: 'email', semantic: 'email' }))).toBe('email');
  });

  it('segments a small REQUIRED choice and selects everything else', () => {
    const values = ['new', 'open', 'done'];
    expect(controlFor(spec({ name: 's', enumValues: values, nullable: false }))).toBe('segmented');
    // Optional: a select, because the empty answer needs somewhere to live.
    expect(controlFor(spec({ name: 's', enumValues: values, nullable: true }))).toBe('select');
    expect(
      controlFor(spec({ name: 's', enumValues: ['a', 'b', 'c', 'd', 'e'], nullable: false })),
    ).toBe('select');
  });

  it('reads an admin’s option list the same way as a database enum', () => {
    const options = { values: [{ value: 'low' }, { value: 'high' }] };
    expect(controlFor(spec({ name: 'band', options, nullable: false }))).toBe('segmented');
    // A NAMED list is as long as it is — a select, never a tray of unknown size.
    expect(controlFor(spec({ name: 'country', options: { list: 'builtin:countries' } }))).toBe('select');
  });

  it('gives a boolean the comp’s toggle row, not a checkbox', () => {
    expect(controlFor(spec({ name: 'active', logicalType: 'boolean' }))).toBe('toggle-row');
  });

  it('keeps an identifier on one line even when its type is unbounded', () => {
    expect(controlFor(spec({ name: 'notes', logicalType: 'text', maxLength: null }))).toBe('textarea');
    expect(
      controlFor(spec({ name: 'slug', logicalType: 'text', maxLength: null, unique: true })),
    ).toBe('text');
  });

  it('offers only what the column can hold', () => {
    expect(legalControls(spec({ name: 'active', logicalType: 'boolean' }))).toEqual([
      'toggle-row',
      'check-row',
    ]);
    // A calendar is legal wherever a day is — and never the default, because a
    // month grid is six rows of dialog for a field most forms want one line for.
    expect(legalControls(spec({ name: 'when', logicalType: 'date' }))).toEqual(['date', 'calendar']);
    const text = legalControls(spec({ name: 'name' }));
    expect(text).toContain('password');
    expect(text).not.toContain('slider');
    expect(legalControls(spec({ name: 'qty', logicalType: 'integer' }))).toContain('stepper');
    expect(legalControls(spec({ name: 'owner', fk: { table: 'users' } }))).toEqual([
      'reference',
      'choice-cards',
      'select',
    ]);
  });

  it('every default control is legal for its own column', () => {
    const shapes: FormColumnShape[] = [
      spec({ name: 'a' }),
      spec({ name: 'b', logicalType: 'text', maxLength: null }),
      spec({ name: 'c', logicalType: 'boolean' }),
      spec({ name: 'd', logicalType: 'integer' }),
      spec({ name: 'e', logicalType: 'decimal', semantic: 'money' }),
      spec({ name: 'f', logicalType: 'date' }),
      spec({ name: 'g', logicalType: 'timestamptz' }),
      spec({ name: 'h', logicalType: 'json' }),
      spec({ name: 'i', enumValues: ['x', 'y'], nullable: false }),
      spec({ name: 'j', enumValues: ['x', 'y'], nullable: true }),
      spec({ name: 'k', fk: { table: 't' } }),
      spec({ name: 'l', semantic: 'email' }),
    ];
    for (const shape of shapes) {
      expect(legalControls(shape), shape.name).toContain(controlFor(shape));
    }
  });
});

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

describe('the form a table gets when nobody designed one', () => {
  const table: FormColumnFact[] = [
    fact({ ordinal: 1, spec: spec({ name: 'id', logicalType: 'integer', primaryKey: true }), filledBy: 'database' }),
    fact({ ordinal: 2, spec: spec({ name: 'full_name' }), required: true }),
    fact({ ordinal: 3, spec: spec({ name: 'status', enumValues: ['new', 'seen'], nullable: false }) }),
    fact({ ordinal: 4, spec: spec({ name: 'notes', logicalType: 'text', maxLength: null }) }),
    fact({
      ordinal: 5,
      spec: spec({ name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' }),
      filledBy: 'adminium',
    }),
    fact({ ordinal: 6, spec: spec({ name: 'total', logicalType: 'decimal', semantic: 'money' }) }),
  ];

  it('lists every writable column in TABLE order, and nothing that is filled', () => {
    const document = deriveFormDocument({ columns: [...table].reverse() });
    expect(columns(document).map((field) => field.column)).toEqual([
      'full_name',
      'status',
      'notes',
      'total',
    ]);
    expect(document.preset).toBe('sectioned');
    expect(document.sections).toHaveLength(1);
    expect(document.sections[0]?.label).toBeUndefined();
  });

  it('KEEPS a timestamp nothing fills — the whole of B1', () => {
    const nobodyFills = table.map((entry) =>
      entry.spec.name === 'created_at' ? { ...entry, filledBy: null, required: true } : entry,
    );
    const fields = columns(deriveFormDocument({ columns: nobodyFills }));
    const createdAt = fields.find((field) => field.column === 'created_at');
    expect(createdAt).toBeDefined();
    expect(createdAt?.required).toBe(true);
    expect(createdAt?.control).toBe('datetime');
  });

  it('puts a required column where the TABLE puts it, not at the bottom (B10)', () => {
    // The grid's eight-column cap re-appended a required column last, so it
    // rendered under everything optional. The form knows nothing about the grid.
    const wide: FormColumnFact[] = [
      ...table,
      ...Array.from({ length: 10 }, (_, i) =>
        fact({ ordinal: 7 + i, spec: spec({ name: `extra_${String(i)}` }) }),
      ),
      fact({ ordinal: 3.5, spec: spec({ name: 'owner' }), required: true }),
    ];
    const names = columns(deriveFormDocument({ columns: wide })).map((field) => field.column);
    expect(names.indexOf('owner')).toBeLessThan(names.indexOf('notes'));
    // …and every one of the extra columns IS in the form, which the grid's
    // eight could never be.
    expect(names).toContain('extra_9');
  });

  it('never lists a projection or a generated column', () => {
    const document = deriveFormDocument({
      columns: [
        fact({ spec: { ...spec({ name: 'customer_name' }), lookup: { table: 'customers' } } }),
        fact({ ordinal: 2, spec: { ...spec({ name: 'order_count' }), reverse: {} } }),
        fact({ ordinal: 3, spec: { ...spec({ name: 'margin' }), derived: {} } }),
        fact({ ordinal: 4, spec: spec({ name: 'line_total' }), writable: false }),
        fact({ ordinal: 5, spec: spec({ name: 'note' }) }),
      ],
    });
    expect(columns(document).map((field) => field.column)).toEqual(['note']);
  });

  it('spans the row for the controls that need it', () => {
    const fields = columns(deriveFormDocument({ columns: table }));
    expect(fields.find((field) => field.column === 'notes')?.span).toBe(2);
    expect(fields.find((field) => field.column === 'full_name')?.span).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Parsing a stored document
// ---------------------------------------------------------------------------

describe('what a page may store', () => {
  const valid = {
    v: 2,
    preset: 'sectioned',
    sections: [{ id: 'main', columns: 2, fields: [{ column: 'full_name' }] }],
  };

  it('reads a well-formed document', () => {
    const parsed = parseCrudForm({ form: valid });
    expect(parsed?.sections[0]?.fields).toHaveLength(1);
  });

  it('IGNORES version 1 — the block nothing ever read', () => {
    /*
     * Every generated page carries `form: { fields: [...] }` written by
     * `composeCrudBody` and read by nothing. Honouring it now would change how
     * a stored page renders, which is exactly what an unedited page is promised
     * will not happen.
     */
    expect(parseCrudForm({ form: { fields: [{ column: 'full_name', kind: 'text' }] } })).toBeNull();
  });

  it('degrades to the derived form rather than half-rendering', () => {
    expect(parseCrudForm({})).toBeNull();
    expect(parseCrudForm({ form: null })).toBeNull();
    // A preset this build does not have, a control this build does not have, a
    // column twice, an empty document: each one falls back whole.
    expect(parseCrudForm({ form: { ...valid, preset: 'timeline' } })).toBeNull();
    // `child-rows` is a RELATION control; naming it on a column is a document
    // this build cannot render, and it degrades rather than half-renders.
    expect(
      parseCrudForm({
        form: { ...valid, sections: [{ id: 'a', fields: [{ column: 'x', control: 'child-rows' }] }] },
      }),
    ).toBeNull();
    expect(
      parseCrudForm({
        form: { ...valid, sections: [{ id: 'a', fields: [{ column: 'x' }, { column: 'x' }] }] },
      }),
    ).toBeNull();
    expect(parseCrudForm({ form: { ...valid, sections: [{ id: 'a', fields: [] }] } })).toBeNull();
  });

  it('takes a relation field, which is not a column', () => {
    const parsed = parseCrudForm({
      form: { ...valid, sections: [{ id: 'a', fields: [{ relation: 'orders_services' }] }] },
    });
    expect(parsed?.sections[0]?.fields[0]).toMatchObject({ relation: 'orders_services' });
  });
});

// ---------------------------------------------------------------------------
// The safety net
// ---------------------------------------------------------------------------

describe('a stored document that has gone stale', () => {
  it('appends a column the database now demands, rather than failing every create', () => {
    const stored = parseCrudForm({
      form: { v: 2, preset: 'sectioned', sections: [{ id: 'main', fields: [{ column: 'full_name' }] }] },
    });
    const document = formDocumentFor(stored, {
      columns: [
        fact({ spec: spec({ name: 'full_name' }) }),
        fact({ ordinal: 2, spec: spec({ name: 'email', semantic: 'email' }), required: true }),
      ],
    });
    const fields = columns(document);
    expect(fields.map((field) => field.column)).toEqual(['full_name', 'email']);
    expect(fields[1]?.required).toBe(true);
    expect(fields[1]?.control).toBe('email');
  });

  it('leaves a document alone when nothing is missing', () => {
    const stored = parseCrudForm({
      form: { v: 2, preset: 'sectioned', sections: [{ id: 'main', fields: [{ column: 'full_name' }] }] },
    });
    const document = formDocumentFor(stored, {
      columns: [fact({ spec: spec({ name: 'full_name' }), required: true })],
    });
    expect(document).toBe(stored);
  });

  it('does not append a required column something FILLS', () => {
    const stored = parseCrudForm({
      form: { v: 2, preset: 'sectioned', sections: [{ id: 'main', fields: [{ column: 'full_name' }] }] },
    });
    const document = formDocumentFor(stored, {
      columns: [
        fact({ spec: spec({ name: 'full_name' }) }),
        fact({
          ordinal: 2,
          spec: spec({ name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' }),
          required: false,
          filledBy: 'adminium',
        }),
      ],
    });
    expect(columns(document).map((field) => field.column)).toEqual(['full_name']);
  });
});

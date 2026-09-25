// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The **Rules** section of the column inspector.
 *
 * ─── What is really being tested ───────────────────────────────────────────
 *
 * Four override ops now change what every WRITER must satisfy — the create
 * dialog, a CSV import, an automation and the public API. The server enforces
 * them and refuses the ones it cannot keep; this file is the other end of that
 * contract: the section an admin actually uses, and the exact document it PUTs.
 *
 * The document matters more than the controls. `column.required` may only ever
 * say `true` — "not required" is the ABSENCE of the row, because a stored
 * `false` would be an override claiming something about the DATABASE that only
 * the column's own NOT NULL can say.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeColumn, makeModel, makeSchemaReply } from './fixtures.js';
import { installFetch, renderEditor } from './test-harness.js';
import type { EffectiveModel } from './model.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Open the inspector on a column of `orders` — the tree labels are display labels. */
async function openColumn(columnLabel: RegExp, table: RegExp = /Order notes/): Promise<void> {
  renderEditor();
  await userEvent.click(await screen.findByRole('button', { name: table }));
  await userEvent.click(await screen.findByRole('button', { name: columnLabel }));
  await screen.findByTestId('column-rules');
}

describe('the Rules section writes the four ops', () => {
  it('stages a fill, a required mark, a value list and a bound — in one document', async () => {
    const harness = installFetch();
    await openColumn(/Body/);

    await userEvent.selectOptions(screen.getByLabelText('Starts as'), 'literal');
    await userEvent.type(screen.getByLabelText('The value'), '0');

    await userEvent.click(screen.getByRole('switch', { name: 'Must be filled in' }));

    await userEvent.type(screen.getByLabelText('Shortest'), '2');

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));

    const { overrides } = harness.putBodies[0] as {
      overrides: { op: string; tableName: string; columnName: string; value: unknown }[];
    };
    const byOp = new Map(overrides.map((o) => [o.op, o]));

    expect(byOp.get('column.default')).toEqual({
      op: 'column.default',
      tableName: 'public.order_notes',
      columnName: 'body',
      value: { kind: 'literal', text: '0' },
    });
    expect(byOp.get('column.required')?.value).toEqual({ required: true });
    expect(byOp.get('column.validation')?.value).toEqual({ minLength: 2 });
  });

  it('takes a rule back by REMOVING its row, never by storing a false', async () => {
    const harness = installFetch();
    await openColumn(/Body/);

    const required = screen.getByRole('switch', { name: 'Must be filled in' });
    await userEvent.click(required);
    await userEvent.click(required);

    await userEvent.selectOptions(screen.getByLabelText('Starts as'), 'literal');
    await userEvent.selectOptions(screen.getByLabelText('Starts as'), '');

    // Nothing is staged, so there is nothing to save.
    expect(screen.queryByRole('button', { name: 'Save overrides' })?.hasAttribute('disabled')).not.toBe(
      false,
    );
    expect(harness.putBodies).toHaveLength(0);
  });

  it('offers a value list only where the database does not already fix one', async () => {
    installFetch();
    await openColumn(/Body/);
    // `body` is a plain text column: an admin may list its answers.
    expect(screen.getByLabelText('Allowed values')).toBeDefined();

    // `status` is a native enum: its values are the database's, and the section
    // says where to change them instead of offering a second, quieter list.
    await userEvent.click(screen.getByRole('button', { name: /Orders/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Status/ }));
    await screen.findByTestId('column-rules');
    expect(screen.queryByLabelText('Allowed values')).toBeNull();
    expect(
      screen.getByText('Your database fixes the allowed values for this column. Change them in Design.'),
    ).toBeDefined();
  });

  it('turns typed lines into option values, and an emptied box back into nothing', async () => {
    const harness = installFetch();
    await openColumn(/Body/);

    // Three sources, not two: "these values" and "a list I name" store
    // different things, so the box only appears once one of them is chosen.
    await userEvent.selectOptions(screen.getByLabelText('Allowed values'), 'values');
    // A paste, not keystrokes: the value is a block of lines, and typing
    // `{enter}` into a controlled textarea is not how anyone fills this in.
    fireEvent.change(screen.getByLabelText('The values'), {
      target: { value: 'low\nmid\nhigh' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    const { overrides } = harness.putBodies[0] as { overrides: { op: string; value: unknown }[] };
    expect(overrides.find((o) => o.op === 'column.options')?.value).toEqual({
      values: [{ value: 'low' }, { value: 'mid' }, { value: 'high' }],
    });
  });

  it('names a LIST rather than copying its values into the rule', async () => {
    /*
     * The rule stores the key. Copying the list's values into it would make
     * every column a snapshot of the list as it was the day somebody bound it,
     * and editing the list would change nothing anywhere.
     */
    const harness = installFetch({
      optionLists: () => [
        { key: 'builtin:countries', name: 'Countries', items: [{ value: 'DE' }], origin: 'builtin', editable: false },
        { key: 'stages', name: 'Stages', items: [{ value: 'new' }], origin: 'custom', editable: true },
      ],
    });
    await openColumn(/Body/);

    await userEvent.selectOptions(screen.getByLabelText('Allowed values'), 'list');
    await userEvent.selectOptions(await screen.findByLabelText('List'), 'stages');
    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));

    const { overrides } = harness.putBodies[0] as { overrides: { op: string; value: unknown }[] };
    expect(overrides.find((o) => o.op === 'column.options')?.value).toEqual({ list: 'stages' });
  });

  it('says what already fills a column, so "leave it to the database" is not read as "nothing"', async () => {
    /*
     * A `created_at` with no database default is filled by Adminium with no
     * rule stored at all (D5) — the fix the owner's failed insert needed. The
     * default choice reads "Leave it to the database", which for that column
     * would be a lie, so the helper says who really fills it.
     */
    const model = makeModel();
    const withCreatedAt: EffectiveModel = {
      ...model,
      tables: model.tables.map((table) =>
        table.name === 'order_notes'
          ? {
              ...table,
              columns: [
                ...table.columns,
                makeColumn({
                  name: 'created_at',
                  ordinal: 4,
                  dbType: 'timestamptz',
                  logicalType: 'timestamptz',
                  nullable: false,
                  semantics: {
                    primary: 'created-at',
                    flags: { secret: false, pii: null, maskedByDefault: false },
                    format: null,
                    pair: null,
                    confidence: 1,
                    source: 'heuristic',
                  },
                }),
              ],
            }
          : table,
      ),
    };
    installFetch({ schema: () => makeSchemaReply(withCreatedAt) });
    await openColumn(/Created at/);
    expect(screen.getByText('Adminium fills this in automatically.')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: /Body/ }));
    await screen.findByTestId('column-rules');
    expect(screen.queryByText('Adminium fills this in automatically.')).toBeNull();
  });
});

describe('the columns Adminium decides', () => {
  const row = (op: string, columnName: string, value: Record<string, unknown>, id: string) => ({
    id,
    op,
    tableName: 'public.order_notes',
    columnName,
    value,
    origin: 'app',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  });
  const rows = () => [
    row('column.code', 'body', { prefix: 'MR-', length: 4 }, 'ovr_code'),
    row('column.sequence', 'body', { start: 100 }, 'ovr_seq'),
    // Another column's rule of the same op: two targets, not one.
    row('column.code', 'author', { length: 6 }, 'ovr_code_2'),
    row(
      'column.rollup',
      'body',
      { from: 'public.order_notes', via: 'id', sum: 'id', times: 'id', where: { column: 'author', eq: 'ann' }, balance: { column: 'id', of: 'id', minus: ['author'] }, cap: true },
      'ovr_roll',
    ),
    row('column.venueLocal', 'body', { venueLocal: true }, 'ovr_local'),
    row('column.stamp', 'body', { set: { byOrigin: { public: 'patient', staff: 'desk' } }, on: { column: 'author', values: ['x', 'y'] } }, 'ovr_stamp'),
  ];

  it('says what decides the column, and removes one rule without touching the others', async () => {
    const harness = installFetch({ overridesRows: rows });
    await openColumn(/Body/);
    const decided = await screen.findByTestId('rules-decided');
    expect(decided.textContent).toContain('The next number in order, from 100');
    expect(decided.textContent).toContain('A random code like MR-XXXX');
    expect(decided.textContent).toContain(
      'The total of id × id over its rows in Order notes; counting only rows where author is ann; and keeps id = id − author − this total; A write that would take the balance below zero is refused.',
    );
    expect(decided.textContent).toContain('Set to “patient” from the public side, “desk” from staff when author becomes x, y');
    expect(screen.getByTestId('rules-venue-local').textContent).toContain('the venue’s own time');

    const [, first] = screen.getAllByRole('button', { name: 'Remove this rule' });
    fireEvent.click(first!);
    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    const { overrides } = harness.putBodies[0] as { overrides: { op: string; columnName?: string }[] };
    // Each kept rule still names its column: without it a save would refuse them all.
    // The running number went; both codes and the total stayed.
    expect(overrides.map((o) => `${o.op}:${o.columnName ?? ''}`).sort()).toEqual([
      'column.code:author',
      'column.code:body',
      'column.rollup:body',
      'column.stamp:body',
      'column.venueLocal:body',
    ]);
  });

  it('says the worked-out values, prefixed numbers, stamps and places an invoicing app installs, and keeps them through a save', async () => {
    const harness = installFetch({
      overridesRows: () => [
        row('column.formula', 'body', { formula: { add: ['id', { coalesce: ['author', 0] }] } }, 'ovr_formula'),
        row('column.scale', 'body', { scale: 'currency' }, 'ovr_scale'),
        row('column.format', 'order_ref', { from: 'id', prefix: 'INV-', pad: 4 }, 'ovr_format'),
        row('column.sequence', 'id', { gapless: true, scope: 'author' }, 'ovr_gapless'),
        row(
          'column.stamp',
          'body',
          { set: { addDays: { date: 'created_at', days: 'author', map: { a: 7 } } }, on: [{ column: 'author', values: ['sent'] }, { column: 'id', filled: true }] },
          'ovr_days',
        ),
      ],
    });
    await openColumn(/Body/);
    const decided = await screen.findByTestId('rules-decided');
    expect(decided.textContent).toContain('Worked out from id, author on every write');
    expect(decided.textContent).toContain('Rounded to the decimal places of its currency');
    expect(decided.textContent).toContain(
      'Set to created_at plus the days author gives when author becomes sent; Set to created_at plus the days author gives when id is first filled',
    );
    await userEvent.click(await screen.findByRole('button', { name: /Order ref/ }));
    const other = await screen.findByTestId('rules-decided');
    expect(other.textContent).toContain('Written as INV-0001, from the number in id');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this rule' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies.length).toBeGreaterThan(0));
    const { overrides } = harness.putBodies.at(-1) as { overrides: { op: string; columnName?: string }[] };
    // The prefixed number went; every other rule kept its column.
    expect(overrides.map((o) => `${o.op}:${o.columnName ?? ''}`).sort()).toEqual([
      'column.formula:body',
      'column.scale:body',
      'column.sequence:id',
      'column.stamp:body',
    ]);
  });
});

describe('an app’s words for its allowed values', () => {
  /** The row an app installs: one value's word in every language it speaks, one plain. */
  const rows = () => [
    {
      id: 'ovr_app_options',
      op: 'column.options',
      tableName: 'public.order_notes',
      columnName: 'body',
      value: {
        values: [
          { value: 'cash', label: { en_US: 'Cash', de_DE: 'Bar' }, tone: 'pos' },
          { value: 'card', label: 'Card' },
        ],
      },
      origin: 'app',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
  ];

  it('keeps each kept value’s words, every language of them, when the values are edited', async () => {
    const harness = installFetch({ overridesRows: rows });
    await openColumn(/Body/);
    expect((screen.getByLabelText('The values') as HTMLTextAreaElement).value).toBe('cash\ncard');

    fireEvent.change(screen.getByLabelText('The values'), { target: { value: 'cash\ncard\nvoucher' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    const { overrides } = harness.putBodies[0] as { overrides: { op: string; value: unknown }[] };
    expect(overrides.find((o) => o.op === 'column.options')?.value).toEqual({
      values: [
        { value: 'cash', label: { en_US: 'Cash', de_DE: 'Bar' }, tone: 'pos' },
        { value: 'card', label: 'Card' },
        { value: 'voucher' },
      ],
    });
  });
});

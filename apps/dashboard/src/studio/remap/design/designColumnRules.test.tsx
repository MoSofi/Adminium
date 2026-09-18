// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The three controls the Schema Designer never had: Default, Allowed values and
 * Key generation (D23, plan 50 phase B).
 *
 * ─── What this file is really testing ──────────────────────────────────────
 *
 * The model, the validator, the planner and the compiler already carried five
 * default kinds and a value list. `TableDesigner` rendered neither, so on screen
 * the vocabulary was three switches and a type select — and two of the type
 * select's options could not be applied at all: `enum` always ended in
 * `ENUM_ON_NON_ENUM_COLUMN` because there was nowhere to type values, and
 * retyping the generated key left `default: autoincrement` behind for
 * `UNSUPPORTED_DEFAULT`. 35-T12 is marked ✅ BUILT for exactly these controls.
 *
 * So every test here goes through the screen and asserts what reaches the WIRE.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures.js';
import { makeColumn, makeModel, makeSchemaReply } from '../fixtures.js';
import { installFetch, renderEditor } from '../test-harness.js';
import type { EffectiveModel } from '../model.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const EMPTY_PLAN = {
  steps: [],
  refusals: [],
  warnings: [],
  hazard: 'safe',
  requiresSuperAdmin: false,
  checksum: 'sha256:plan',
  ceilings: [],
  unfinished: null,
};

type PlanBody = {
  upsertTables: {
    name: string;
    columns: { name: string; logicalType: string; default: { kind: string; text?: string } | null }[];
    enumValues: Record<string, string[]>;
  }[];
};

async function openDesign(): Promise<void> {
  renderEditor();
  await screen.findByRole('tab', { name: 'Design' });
  await userEvent.click(screen.getByRole('tab', { name: 'Design' }));
  await screen.findByText('Design your schema');
}

/** The northwind fixture with a counted `bigint` key on `order_notes`. */
function modelWithGeneratedKey(): EffectiveModel {
  const model = makeModel();
  return {
    ...model,
    tables: model.tables.map((table) =>
      table.name === 'order_notes'
        ? {
            ...table,
            columns: table.columns.map((column) =>
              column.name === 'id' ? { ...column, default: { kind: 'autoincrement' as const } } : column,
            ),
          }
        : table,
    ),
  };
}

// ---------------------------------------------------------------------------
// B7 — an existing enum column keeps its values
// ---------------------------------------------------------------------------

describe('the value list of a column that already has one (B7)', () => {
  it('loads it, shows it, and sends it back', async () => {
    /*
     * `RemapEditor` never passed `enumValuesByTable`, so every table with an
     * enum column staged `enumValues: {}` — and the gate refuses an enum column
     * with no values. Opening `orders` at all produced an edit that could not
     * be applied, about a column nobody had touched.
     */
    const harness = installFetch({ onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'orders' }));

    expect((screen.getByLabelText('Value 1') as HTMLInputElement).value).toBe('pending');
    expect((screen.getByLabelText('Value 2') as HTMLInputElement).value).toBe('paid');
    expect((screen.getByLabelText('Value 3') as HTMLInputElement).value).toBe('cancelled');

    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    const body = harness.planBodies[0] as PlanBody;
    expect(body.upsertTables[0]?.enumValues).toEqual({
      status: ['pending', 'paid', 'cancelled'],
    });
  });

  it('refuses to remove a value from a native Postgres type, and says why', async () => {
    // 35 D32: postgres has no `ALTER TYPE … DROP VALUE`. The fixture's
    // `order_status` is a native type, so the list is add-only.
    installFetch({ onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'orders' }));

    expect(screen.getByRole('button', { name: 'Remove pending' }).hasAttribute('disabled')).toBe(true);
    expect((screen.getByLabelText('Value 1') as HTMLInputElement).readOnly).toBe(true);
    expect(
      screen.getByText(/Postgres cannot remove or rename a value once it exists/),
    ).toBeDefined();
    // Adding is still offered — that part postgres can do.
    expect(screen.getByRole('button', { name: 'Add value' }).hasAttribute('disabled')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B5 — type `enum` is reachable now
// ---------------------------------------------------------------------------

describe('choosing the choice type (B5)', () => {
  it('asks for values before Review, and sends them once they are typed', async () => {
    const harness = installFetch({ onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));

    // `body` is the third column of order_notes.
    const types = screen.getAllByLabelText('Type');
    await userEvent.selectOptions(types[2]!, 'enum');

    // The prompt, and Review closed until it is answered.
    expect(
      await screen.findByText('Give body at least one allowed value to review the changes.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Review changes' }).hasAttribute('disabled')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Add value' }));
    await userEvent.type(screen.getByLabelText('Value 1'), 'draft');
    await userEvent.click(screen.getByRole('button', { name: 'Add value' }));
    await userEvent.type(screen.getByLabelText('Value 2'), 'sent');

    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    expect((harness.planBodies[0] as PlanBody).upsertTables[0]?.enumValues).toEqual({
      body: ['draft', 'sent'],
    });
  });

  it('keeps Review closed while a value is blank or repeated', async () => {
    installFetch({ onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));
    await userEvent.selectOptions(screen.getAllByLabelText('Type')[2]!, 'enum');

    await userEvent.click(screen.getByRole('button', { name: 'Add value' }));
    await userEvent.type(screen.getByLabelText('Value 1'), 'draft');
    await userEvent.click(screen.getByRole('button', { name: 'Add value' }));
    // Value 2 is still blank — `""` is refused by the gate's `min(1)`.
    expect(
      await screen.findByText(
        'Every allowed value on body needs to be filled in and different from the others.',
      ),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Review changes' }).hasAttribute('disabled')).toBe(true);

    await userEvent.type(screen.getByLabelText('Value 2'), 'draft');
    expect(screen.getByRole('button', { name: 'Review changes' }).hasAttribute('disabled')).toBe(true);

    await userEvent.clear(screen.getByLabelText('Value 2'));
    await userEvent.type(screen.getByLabelText('Value 2'), 'sent');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Review changes' }).hasAttribute('disabled')).toBe(false),
    );
  });

  it('reorders the values, because the order is the order the form offers them in', async () => {
    const harness = installFetch({ onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'orders' }));

    await userEvent.click(screen.getByRole('button', { name: 'Move paid up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));

    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    expect((harness.planBodies[0] as PlanBody).upsertTables[0]?.enumValues).toEqual({
      status: ['paid', 'pending', 'cancelled'],
    });
  });
});

// ---------------------------------------------------------------------------
// The Default control (D23, F2)
// ---------------------------------------------------------------------------

describe('the Default control offers only what the type and the engine allow', () => {
  it('offers the clock to a timestamp and not to text', async () => {
    const model = makeModel();
    const withSeenAt: EffectiveModel = {
      ...model,
      tables: model.tables.map((table) =>
        table.name === 'order_notes'
          ? {
              ...table,
              columns: [
                ...table.columns,
                makeColumn({ name: 'seen_at', ordinal: 4, dbType: 'timestamptz', logicalType: 'timestamptz' }),
              ],
            }
          : table,
      ),
    };
    const harness = installFetch({
      schema: () => makeSchemaReply(withSeenAt),
      onPlan: () => jsonResponse(200, EMPTY_PLAN),
    });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));

    const starts = screen.getAllByLabelText('Starts as');
    // `body` is text: a value, or a generated id (postgres can put a uuid in a
    // text column) — but never the clock, which is what `now` needs a date for.
    expect([...(starts[2] as HTMLSelectElement).options].map((o) => o.value)).not.toContain('now');
    // `seen_at` is a timestamp: a value, or the clock.
    expect([...(starts[3] as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      'none',
      'literal',
      'now',
    ]);

    await userEvent.selectOptions(starts[3]!, 'now');
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    const columns = (harness.planBodies[0] as PlanBody).upsertTables[0]?.columns ?? [];
    expect(columns.find((c) => c.name === 'seen_at')?.default).toEqual({ kind: 'now' });
  });

  it('types the literal with the control that cannot produce an invalid one', async () => {
    const harness = installFetch({ onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'orders' }));

    // `status` is an enum: its literal is one of its own values, picked.
    const starts = screen.getAllByLabelText('Starts as');
    await userEvent.selectOptions(starts[2]!, 'literal');
    const value = screen.getByLabelText('Value') as HTMLSelectElement;
    expect([...value.options].map((o) => o.value)).toEqual(['pending', 'paid', 'cancelled']);
    await userEvent.selectOptions(value, 'paid');

    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    const columns = (harness.planBodies[0] as PlanBody).upsertTables[0]?.columns ?? [];
    expect(columns.find((c) => c.name === 'status')?.default).toEqual({
      kind: 'literal',
      text: 'paid',
    });
  });
});

// ---------------------------------------------------------------------------
// B8 — a retype clears a default the new type cannot have
// ---------------------------------------------------------------------------

describe('retyping a column (B8)', () => {
  it('drops a default the new type cannot carry, so the plan comes back clean', async () => {
    /*
     * Retyping the generated `id` to `uuid` left `default: autoincrement`,
     * which is legal on an integer and nowhere else. The plan came back
     * `UNSUPPORTED_DEFAULT` on the column the person had just changed, with no
     * control anywhere to clear the offending value.
     */
    const harness = installFetch({
      schema: () => makeSchemaReply(modelWithGeneratedKey()),
      onPlan: () => jsonResponse(200, EMPTY_PLAN),
    });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));

    expect((screen.getAllByLabelText('Starts as')[0] as HTMLSelectElement).value).toBe(
      'autoincrement',
    );
    await userEvent.selectOptions(screen.getAllByLabelText('Type')[0]!, 'uuid');

    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    const columns = (harness.planBodies[0] as PlanBody).upsertTables[0]?.columns ?? [];
    expect(columns.find((c) => c.name === 'id')).toMatchObject({
      logicalType: 'uuid',
      default: null,
    });
  });
});

// ---------------------------------------------------------------------------
// T14 — key generation, honest per engine (the test 35-T12 promised)
// ---------------------------------------------------------------------------

describe('how a new table’s key is filled (D31)', () => {
  it('offers a unique id on postgres', async () => {
    installFetch({ onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'New table' }));

    const key = screen.getByLabelText('How the key is filled') as HTMLSelectElement;
    expect([...key.options].map((o) => o.value)).toEqual(['autoincrement', 'uuid']);
  });

  it('does not offer a unique id for a MySQL connection’s key', async () => {
    /*
     * The test 35-T12 said existed. MySQL reads a new row back by `insertId`,
     * which only an auto-increment column has — a uuid key is a row the CRUD
     * path cannot fetch after writing it (D31, `UNADDRESSABLE_KEY`). The option
     * is ABSENT, not disabled, and the reason is in the helper text.
     */
    const mysql: EffectiveModel = { ...makeModel(), dialect: 'mysql' };
    installFetch({ schema: () => makeSchemaReply(mysql), onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'New table' }));

    const key = screen.getByLabelText('How the key is filled') as HTMLSelectElement;
    expect([...key.options].map((o) => o.value)).toEqual(['autoincrement']);
    expect(
      screen.getByText(/On mysql a key must be a counted integer/),
    ).toBeDefined();
  });

  it('sets the key’s type and default together, so the two cannot disagree', async () => {
    const harness = installFetch({ onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'New table' }));
    await userEvent.type(screen.getByLabelText('Table name'), 'documents');
    await userEvent.selectOptions(screen.getByLabelText('How the key is filled'), 'uuid');

    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    const table = (harness.planBodies[0] as PlanBody).upsertTables[0];
    expect(table?.columns[0]).toMatchObject({
      name: 'id',
      logicalType: 'uuid',
      default: { kind: 'uuid' },
    });
  });
});

// ---------------------------------------------------------------------------
// B12 — the orphans now have callers
// ---------------------------------------------------------------------------

describe('a staged new table is discarded, not dropped (B12)', () => {
  it('has a button that unstages it without touching the rest of the change', async () => {
    installFetch({ onPlan: () => jsonResponse(200, EMPTY_PLAN) });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'New table' }));
    await userEvent.type(screen.getByLabelText('Table name'), 'scratch');

    await userEvent.click(screen.getByRole('button', { name: 'Discard this new table' }));

    // The designer is empty again and there is nothing left to review.
    await waitFor(() =>
      expect(screen.queryByLabelText('Table name')).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Review changes' }).hasAttribute('disabled')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The whole strip, once: an enum table opens, is widened, and plans
// ---------------------------------------------------------------------------

describe('changing the allowed values on a table that already exists', () => {
  it('sends the widened list with the table it belongs to', async () => {
    const model = makeModel();
    // A CHECK-backed enum — Adminium's own shape (D32), where values can go.
    const checkBacked: EffectiveModel = {
      ...model,
      enums: model.enums.map((def) => ({ ...def, source: 'check' as const })),
    };
    const harness = installFetch({
      schema: () => makeSchemaReply(checkBacked),
      onPlan: () => jsonResponse(200, EMPTY_PLAN),
    });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'orders' }));

    await userEvent.click(screen.getByRole('button', { name: 'Remove cancelled' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add value' }));
    await userEvent.type(screen.getByLabelText('Value 3'), 'refunded');

    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    const upsert = (harness.planBodies[0] as PlanBody).upsertTables[0];
    expect(upsert?.enumValues).toEqual({ status: ['pending', 'paid', 'refunded'] });
  });
});

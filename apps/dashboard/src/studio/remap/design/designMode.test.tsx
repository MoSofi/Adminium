// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Design mode end to end in the browser sense.
 *
 * ─── What this covers that unit tests did not ──────────────────────────────
 *
 * Every defect the owner found in this surface lived between a correct plan
 * and a correct guard: the switches had no labels, the 422 said only "Request
 * body failed validation", typing a table name staged five tables, the confirm
 * word was the constant "APPLY" for every destructive change, and a created
 * table was invisible afterwards because nothing offered to put it in the app.
 * Four thousand passing tests missed all of it, because each half was right.
 *
 * So this file drives the whole strip: pick a table → Review → the plan's SQL
 * on screen → Apply → type the OBJECT'S OWN NAME → the summary → the inclusion
 * offer → the regeneration report.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures.js';
import { makeSchemaReply } from '../fixtures.js';
import { installFetch, renderEditor } from '../test-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const DROP_PLAN = {
  steps: [
    {
      id: 'drop-table-1',
      kind: 'drop-table',
      table: 'public.order_notes',
      column: null,
      hazard: 'irreversible',
      requiresSuperAdmin: true,
      summary: 'Drop table order_notes and all of its data',
      rationale: 'The table and every row in it are destroyed. Adminium cannot undo this.',
      consequences: [{ kind: 'page', message: '1 page is bound to this table', refs: ['pg_1'] }],
      dependsOn: [],
      outsideTransaction: false,
      refusal: null,
      sql: ['drop table "order_notes"'],
    },
  ],
  refusals: [],
  warnings: [],
  hazard: 'irreversible',
  requiresSuperAdmin: true,
  checksum: 'sha256:plan',
  ceilings: [],
  unfinished: null,
};

const APPLIED = {
  changeId: 'sch_1',
  status: 'applied',
  steps: [{ ...DROP_PLAN.steps[0], outcome: 'succeeded', error: null, durationMs: 3 }],
  error: null,
  snapshotId: 'snap_2',
  repaired: null,
  createdTables: [],
};

/** Open the page and switch to Design. */
async function openDesign(): Promise<void> {
  renderEditor();
  await screen.findByRole('tab', { name: 'Design' });
  await userEvent.click(screen.getByRole('tab', { name: 'Design' }));
  await screen.findByText('Design your schema');
}

describe('the review step (D2 — the preview IS the statement)', () => {
  it('shows the exact SQL, its hazard and its consequences before anything runs', async () => {
    installFetch({ onPlan: () => jsonResponse(200, DROP_PLAN) });
    await openDesign();

    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Drop this table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));

    // The statement itself — not a summary of it.
    expect(await screen.findByText('drop table "order_notes"')).toBeDefined();
    expect(screen.getByText('Cannot be undone')).toBeDefined();
    expect(screen.getByText('1 page is bound to this table')).toBeDefined();
  });
});

describe('type-to-confirm names the object, not a constant (D8)', () => {
  it('asks for the table’s own name and refuses until it is typed', async () => {
    /*
     * It asked for the literal "APPLY" for every destructive change in the
     * product — the same six letters to drop a scratch table or a customer's
     * orders. Muscle memory defeats that on the second use, and it never makes
     * anyone look at WHAT is being destroyed. Record-delete already sets the
     * standard: the thing you type is the thing you are deleting.
     */
    installFetch({
      onPlan: () => jsonResponse(200, DROP_PLAN),
      onApply: () => jsonResponse(200, APPLIED),
    });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Drop this table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await screen.findByText('drop table "order_notes"');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Type order_notes to confirm');
    const confirm = within(dialog).getByRole('button', { name: 'Apply changes' });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    // The old constant is not the answer any more.
    await userEvent.type(field, 'APPLY');
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await userEvent.clear(field);
    await userEvent.type(field, 'order_notes');
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
  });
});

describe('the post-apply sequence (D11)', () => {
  it('offers to put a NEW table in the app, and reports what regeneration did', async () => {
    const created = {
      ...APPLIED,
      createdTables: ['reservations'],
      steps: [{ ...APPLIED.steps[0], kind: 'create-table', hazard: 'safe' }],
    };
    const harness = installFetch({
      onPlan: () => jsonResponse(200, { ...DROP_PLAN, hazard: 'safe', requiresSuperAdmin: false }),
      onApply: () => jsonResponse(200, created),
      onAdopt: () =>
        jsonResponse(200, {
          included: ['reservations'],
          includesEverything: false,
          snapshotId: 'snap_2',
          pages: 4,
          result: {
            created: 1,
            updated: 0,
            unchanged: 3,
            pruned: 0,
            skippedEdited: ['orders'],
            keptEdited: [],
          },
        }),
    });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Drop this table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await screen.findByText('drop table "order_notes"');
    // A non-destructive plan applies without the confirm dialog.
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    // The offer — a created table does nothing until it has a page.
    const offer = await screen.findByText(/Add reservations to your app\?/);
    expect(offer).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Add to my app' }));

    expect(await screen.findByText(/1 pages created, 0 updated, 3 already current\./)).toBeDefined();
    // The sentence D11 exists for: a hand-edited page was NOT regenerated.
    expect(screen.getByText(/Left untouched because you edited them: orders\./)).toBeDefined();
    expect(harness.adoptBodies).toEqual([{ tables: ['reservations'] }]);
  });
});

describe('renaming an existing table is an explicit intent (D1)', () => {
  it('sends a renames entry, not just a differently-named upsert', async () => {
    /*
     * `buffer.renameTable` existed, was typed, was reachable from the buffer's
     * public interface — and NOTHING CALLED IT. Typing a new name into the
     * field re-staged the table under its new name and the wire carried no
     * `renames` entry, so the server diffed and found nothing to do: the review
     * pane said "No schema changes yet." and the rename round trip was
     * unreachable from the product. Found by running criterion 13.
     *
     * The distinction is not cosmetic. Without the explicit intent a diff
     * cannot tell "rename this" from "drop that and create this", and getting
     * it wrong destroys every row in the table.
     */
    const harness = installFetch({
      onPlan: () => jsonResponse(200, { ...DROP_PLAN, steps: [], hazard: 'safe', requiresSuperAdmin: false }),
    });
    await openDesign();

    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));
    const name = screen.getByLabelText('Table name');
    await userEvent.clear(name);
    await userEvent.type(name, 'notes_archive');
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));

    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    const body = harness.planBodies[0] as {
      renames: { tables: { from: string; to: string }[] };
      upsertTables: { id: string | null; name: string }[];
    };
    expect(body.renames.tables).toEqual([
      { from: 'public.order_notes', to: 'notes_archive' },
    ]);
    // …and the table still travels under the id it was loaded as, so the
    // server can map it through the rename it was just told about.
    expect(body.upsertTables[0]).toMatchObject({ id: 'public.order_notes', name: 'notes_archive' });
  });

  it('drops the rename again when the name is typed back', async () => {
    const harness = installFetch({
      onPlan: () => jsonResponse(200, { ...DROP_PLAN, steps: [], hazard: 'safe', requiresSuperAdmin: false }),
    });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));
    const name = screen.getByLabelText('Table name');
    await userEvent.clear(name);
    await userEvent.type(name, 'notes_archive');
    await userEvent.clear(name);
    await userEvent.type(name, 'order_notes');
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));

    await waitFor(() => expect(harness.planBodies).toHaveLength(1));
    const body = harness.planBodies[0] as { renames: { tables: unknown[] } };
    expect(body.renames.tables).toEqual([]);
  });
});

describe('a failed apply is not a partial one', () => {
  it('says the database is unchanged, and shows what the engine said', async () => {
    /*
     * The banner treated every non-`applied` status as partial, so a
     * `create table` MySQL rejected outright reported "Partly applied: 0 of 1
     * steps ran" — which reads as "something happened to your database" when
     * nothing did, and swallowed the engine's message entirely. The ledger had
     * `failed` and the real error the whole time; only the sentence was wrong.
     * Found on the first MySQL apply of the acceptance run.
     */
    installFetch({
      onPlan: () => jsonResponse(200, { ...DROP_PLAN, hazard: 'safe', requiresSuperAdmin: false }),
      onApply: () =>
        jsonResponse(200, {
          ...APPLIED,
          status: 'failed',
          error: "Referencing column 'client_id' and referenced column 'id' are incompatible.",
          steps: [
            {
              ...APPLIED.steps[0],
              kind: 'create-table',
              outcome: 'failed',
              error: "Referencing column 'client_id' and referenced column 'id' are incompatible.",
            },
          ],
          snapshotId: null,
          createdTables: [],
        }),
    });
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Drop this table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await screen.findByText('drop table "order_notes"');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText(/Nothing was applied — your database is unchanged/)).toBeDefined();
    expect(screen.queryByText(/Partly applied/)).toBeNull();
    // The engine's own words — in the headline AND on the step that failed, so
    // an operator reading either line learns the same thing.
    expect(screen.getAllByText(/are incompatible/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/create-table .*: .*are incompatible/)).toBeDefined();
  });
});

describe("D18's ceiling door", () => {
  /*
   * A design critique run before this was built found that the door, as first
   * drawn, could never be REACHED from the product no matter what the server
   * allowed — and both reasons lived in this file:
   *
   *   - `applicable` was `plan.refusals.length === 0`, so a ceiling refusal
   *     disabled Apply, and the second field lives inside a modal only Apply
   *     opens.
   *   - the modal opened on `destructive` (hazard lossy/irreversible), and an
   *     over-ceiling plan's hazard is `refused` — so even a live Apply would
   *     not have opened it.
   */
  const CEILING_PLAN = {
    ...DROP_PLAN,
    hazard: 'refused',
    requiresSuperAdmin: true,
    steps: [
      {
        ...DROP_PLAN.steps[0],
        kind: 'alter-column-type',
        table: 'public.big_events',
        hazard: 'refused',
        summary: 'Change amount from integer to bigint',
        sql: [],
        refusal: 'TABLE_TOO_LARGE',
      },
    ],
    refusals: [
      {
        code: 'TABLE_TOO_LARGE',
        message: '"public.big_events" holds over 1,000,000 rows, over the 1,000,000-row ceiling.',
        table: 'public.big_events',
        column: null,
      },
    ],
    ceilings: [
      { table: 'public.big_events', rows: 1_000_000, capped: true, acknowledged: false, openable: true },
    ],
  }

  async function reachTheCeiling(): Promise<void> {
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Drop this table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await screen.findByText(/over the 1,000,000-row ceiling/);
  }

  it('leaves Apply LIVE for a ceiling refusal — it is a refusal you can answer', async () => {
    installFetch({ onPlan: () => jsonResponse(200, CEILING_PLAN) });
    await reachTheCeiling();
    expect(screen.getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(false);
  });

  it('opens the confirm and asks for the TABLE NAME, not a constant', async () => {
    /*
     * D18's wording says "type-the-row-count". Its own capped probe makes that
     * number the literal 1,000,000 for every table forever — a second magic
     * word. The table's name is the fact that differs.
     */
    installFetch({ onPlan: () => jsonResponse(200, CEILING_PLAN) });
    await reachTheCeiling();
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/holds over 1,000,000 rows/)).toBeDefined();
    expect(within(dialog).getByLabelText('Type big_events again to authorise the rewrite')).toBeDefined();
  });

  it('will not apply until the table is named', async () => {
    installFetch({
      onPlan: () => jsonResponse(200, CEILING_PLAN),
      onApply: () => jsonResponse(200, APPLIED),
    });
    await reachTheCeiling();
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Apply changes' });

    // This plan destroys nothing, so the ceiling IS the gate — one field, and
    // it names the table rather than a word that would mean nothing here.
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).queryByLabelText('Type DISCARD to confirm')).toBeNull();
    await userEvent.type(
      within(dialog).getByLabelText('Type big_events again to authorise the rewrite'),
      'big_events',
    );
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
  });

  it('RE-PLANS with the acknowledgement, so the checksum matches the door-open plan', async () => {
    /*
     * The plan on screen is the refused one, and a refused step compiles to no
     * SQL — so applying its checksum with the door open is a checksum for a
     * different plan and the server rejects it as SCHEMA_DRIFT. The second plan
     * request is what keeps D2 intact.
     */
    const harness = installFetch({
      onPlan: (body) =>
        jsonResponse(
          200,
          ((body as { acknowledgeCeiling?: string[] }).acknowledgeCeiling ?? []).length > 0
            ? { ...CEILING_PLAN, checksum: 'sha256:open', refusals: [], hazard: 'rewrite' }
            : CEILING_PLAN,
        ),
      onApply: () => jsonResponse(200, APPLIED),
    })
    await reachTheCeiling();
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText('Type big_events again to authorise the rewrite'),
      'big_events',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply changes' }));

    await waitFor(() => expect(harness.applyBodies).toHaveLength(1));
    // The SECOND plan carried the acknowledgement…
    expect(harness.planBodies).toHaveLength(2);
    expect((harness.planBodies[1] as { acknowledgeCeiling: string[] }).acknowledgeCeiling).toEqual([
      'public.big_events',
    ]);
    // …and the apply used ITS checksum, not the refused plan's.
    expect(harness.applyBodies[0]).toMatchObject({
      checksum: 'sha256:open',
      acknowledgeCeiling: ['public.big_events'],
    });
  });

  it('shows a sentence, not a field, to someone who cannot open it', async () => {
    // A field a non-super-admin can never satisfy is a gesture that only ever
    // ends in a 403. The SERVER decides `openable`, so the UI never guesses.
    installFetch({
      onPlan: () =>
        jsonResponse(200, {
          ...CEILING_PLAN,
          ceilings: [{ ...CEILING_PLAN.ceilings[0], openable: false }],
        }),
    })
    await openDesign();
    await userEvent.click(screen.getByRole('button', { name: 'order_notes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Drop this table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));

    expect(await screen.findByText(/Only a Super Admin can authorise a rewrite this large/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('honest absence', () => {
  it('removes the Design tab entirely on a read-only connection, and says why', async () => {
    /*
     * Absence, not a disabled button. A disabled control still asserts "this is
     * something Adminium does here, and you may not do it"; for a read-only
     * role it is not something Adminium does here at all. The server refuses it
     * regardless — this is the same fact rendered.
     */
    installFetch({
      schema: () =>
        makeSchemaReply(undefined, 0, { authorable: false, reason: 'READ_ONLY_ROLE' }),
    });
    renderEditor();
    expect(
      await screen.findByText(
        'This connection signs in with a read-only role, so Adminium cannot change its schema.',
      ),
    ).toBeDefined();
    expect(screen.queryByRole('tab', { name: 'Design' })).toBeNull();
    // The diagram is a READ of the schema and stays.
    expect(screen.getByRole('tab', { name: 'Diagram' })).toBeDefined();
  });

  it('explains a schema-file source in its own words', async () => {
    installFetch({
      schema: () =>
        makeSchemaReply(undefined, 0, { authorable: false, reason: 'NO_LIVE_DATABASE' }),
    });
    renderEditor();
    expect(await screen.findByText(/created from a schema file/)).toBeDefined();
    expect(screen.queryByRole('tab', { name: 'Design' })).toBeNull();
  });

  it('keeps Design when the server says nothing (an older server)', async () => {
    const reply = makeSchemaReply();
    delete (reply as { schemaAuthoring?: unknown }).schemaAuthoring;
    installFetch({ schema: () => reply });
    renderEditor();
    expect(await screen.findByRole('tab', { name: 'Design' })).toBeDefined();
  });
});

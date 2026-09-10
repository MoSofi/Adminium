// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Design mode — 35-schema-authoring.md §3.6, D1, D2, D8, 35-T12/T13/T14.
 *
 * The flow the whole plan is shaped around: edit a desired model → review the
 * real statements → confirm → apply.
 *
 * ─── Why Review is a step and not a tooltip ────────────────────────────────
 *
 * D2 makes the preview the statement. That is only worth anything if the user
 * SEES it, so planning is a first-class step with its own button and its own
 * pane, and Apply is not reachable until a plan exists. Bytebase is the only
 * tool the survey found that does this; Supabase Studio shows the current
 * definition, not the pending diff (§6.2).
 *
 * ─── Why destructive applies type-to-confirm ───────────────────────────────
 *
 * D8. `ConfirmModal` already implements type-to-confirm and record delete
 * already sets the standard of naming dependent counts BEFORE asking. A drop
 * here names what preflight found — pages, saved views, public keys — because
 * "this may affect other things" is an adjective and those are facts.
 */
import { useState } from 'react';
import { Banner, Button, ConfirmModal, EmptyState, Spinner } from '@adminium/ui';

import { ApiError } from '../../../app/api.js';
import { t } from '../../../i18n/t.js';
import { adoptTables, applySchemaEdit, planSchemaEdit } from './api.js';
import { PlanReview } from './PlanReview.js';
import { TableDesigner, identifierError } from './TableDesigner.js';
import {
  blankTable,
  modelTableToDesired,
  newTableKey,
  unsupportedColumnNotes,
  useDesignBuffer,
  type ModelRelation,
  type ModelTable,
} from './useDesignBuffer.js';
import type { AdoptResult, ApplyResult, DesiredTable, SchemaPlan } from './types.js';

export interface DesignModeProps {
  connectionId: string;
  snapshotId: string;
  dialect: string;
  /** Table ids in the active snapshot, for the drop picker. */
  /**
   * The connection's real tables, in full. A SUMMARY is not enough: clicking a
   * table has to load what is actually in it, and staging a blank table with
   * the real one's id made the planner propose dropping every column.
   */
  tables: ModelTable[];
  /** Declared relations, so an existing table's links load with it. */
  relations?: ModelRelation[];
  /** Column value lists, so an existing enum column keeps its options. */
  enumValuesByTable?: Record<string, Record<string, string[]>>;
  onApplied: () => void;
}

/**
 * Turn a 422 into something the operator can act on.
 *
 * The server already sends the precise fault — `{path, message}` per issue,
 * e.g. `upsertTables.0.name` / `must match ^[a-z][a-z0-9_]*$`. Rendering only
 * `error.message` throws all of it away and leaves "Request body failed
 * validation.", which names neither the field nor the rule and is the same
 * string for every possible mistake.
 *
 * The path is the wire shape (`upsertTables.0.columns.2.name`), so it is
 * translated back into what the person is looking at: a table, a column, a
 * field.
 */
function describeValidation(error: ApiError): string {
  const issues = (error.details as { issues?: { path?: string; message?: string }[] } | undefined)
    ?.issues;
  if (issues === undefined || issues.length === 0) return error.message;
  return issues
    .map((issue) => {
      const path = issue.path ?? '';
      const column = /columns\.(\d+)\.(\w+)/.exec(path);
      const table = /upsertTables\.(\d+)\.(\w+)/.exec(path);
      const where =
        column !== null
          ? t('studio:design.error.atColumn', 'Column {n}, {field}', {
              n: Number(column[1]) + 1,
              field: column[2] ?? '',
            })
          : table !== null
            ? t('studio:design.error.atTable', 'Table {field}', { field: table[2] ?? '' })
            : path;
      return where === '' ? (issue.message ?? '') : `${where}: ${issue.message ?? ''}`;
    })
    .join(' · ');
}

export function DesignMode({
  connectionId,
  snapshotId,
  dialect,
  tables,
  relations = [],
  enumValuesByTable = {},
  onApplied,
}: DesignModeProps) {
  const buffer = useDesignBuffer();
  const [editing, setEditing] = useState<{ key: string; table: DesiredTable } | null>(null);
  /** Columns whose stored default the designer's vocabulary cannot express. */
  const [unrepresentable, setUnrepresentable] = useState<string[]>([]);
  const [plan, setPlan] = useState<SchemaPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [adoptResult, setAdoptResult] = useState<AdoptResult | null>(null);
  const [adoptError, setAdoptError] = useState<string | null>(null);

  const stage = (key: string, table: DesiredTable): void => {
    buffer.upsert(key, table);
    /*
     * Renaming an EXISTING table is a separate intent, not an inference (D1).
     *
     * Every other edit is expressed by the desired document alone, but a
     * changed `name` on a table that already exists is ambiguous on the wire:
     * a diff cannot tell "rename this" from "drop that and create this", and
     * getting it wrong destroys the rows. So the buffer carries `renames`
     * explicitly and the planner pre-applies them.
     *
     * `renameTable` and the whole `renames` path — the wire field, the
     * pre-application, the `rename-table` step, the compiler, the meta-store
     * repair — existed and were tested, and NOTHING CALLED THIS. Typing a new
     * name into the field produced "No schema changes yet."; the rename round
     * trip was unreachable from the product. Found by running §10's criterion
     * 13 rather than by any test.
     */
    if (table.id !== null) {
      const original = tables.find((candidate) => candidate.id === table.id);
      if (original !== undefined) {
        buffer.renameTable(table.id, table.name === original.name ? null : table.name);
      }
    }
    setEditing({ key, table });
    // Any edit invalidates the plan: the checksum it carries is the identity
    // of a plan for a DIFFERENT document, and applying it would be refused.
    setPlan(null);
    setResult(null);
  };

  const handlePlan = async (): Promise<void> => {
    setPlanning(true);
    setError(null);
    try {
      setPlan(await planSchemaEdit(connectionId, buffer.buildEdit(snapshotId)));
    } catch (caught) {
      setError(caught instanceof ApiError ? describeValidation(caught) : String(caught));
      setPlan(null);
    } finally {
      setPlanning(false);
    }
  };

  /**
   * D11's last beat. Apply re-introspected and told us which tables are new;
   * this is the offer to put them in the app, and its report.
   *
   * It is an OFFER and not an automatic step because generation is
   * whole-connection: it rewrites the page set, and a person who has hand-built
   * pages is entitled to decide when that runs. `skippedEdited` is why the
   * report is rendered rather than counted — a page regeneration left alone is
   * the fact most likely to be misread as a page it updated.
   */
  const handleAdopt = async (): Promise<void> => {
    if (result === null || result.createdTables.length === 0) return;
    setAdopting(true);
    setAdoptError(null);
    try {
      const adopted = await adoptTables(connectionId, result.createdTables);
      setAdoptResult(adopted);
      onApplied();
    } catch (caught) {
      setAdoptError(
        caught instanceof ApiError
          ? caught.status === 403
            ? t(
                'studio:design.adopt.forbidden',
                'Your role can change the schema but not generate pages. Ask an admin with connection management to add these tables to the app.',
              )
            : describeValidation(caught)
          : String(caught),
      );
    } finally {
      setAdopting(false);
    }
  };

  const handleApply = async (): Promise<void> => {
    if (plan === null) return;
    setApplying(true);
    setError(null);
    setAdoptResult(null);
    setAdoptError(null);
    try {
      const edit = buffer.buildEdit(snapshotId);
      const acknowledged = openableCeilings.map((c) => c.table);

      /*
       * A ceiling that is being opened needs a SECOND plan.
       *
       * The plan on screen is the refused one — that is how the operator learnt
       * which table to name. Applying its checksum with the door open would be
       * a checksum for a different plan (a refused step compiles to no SQL), so
       * the compare would reject it as SCHEMA_DRIFT. Re-planning with the
       * acknowledgement produces the plan that will actually run, and its
       * checksum is the one authorised — which is D2 kept intact rather than
       * worked around.
       */
      const authorised =
        acknowledged.length === 0 ? plan : await planSchemaEdit(connectionId, edit, acknowledged);

      const applied = await applySchemaEdit(
        connectionId,
        edit,
        authorised.checksum,
        // The operator has seen the row counts — they are on the review pane
        // above the button they just pressed (D18).
        true,
        acknowledged,
      );
      setResult(applied);
      if (applied.status === 'applied') {
        buffer.clear();
        setPlan(null);
        onApplied();
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? describeValidation(caught) : String(caught));
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  };

  /**
   * Every identifier the buffer is holding, checked before the round trip.
   *
   * The server refuses these too — it has to, it is the boundary — but making
   * the operator press Review to discover that a name is illegal wastes the
   * trip and reports the fault a long way from the field that caused it.
   */
  const invalidNames = [...buffer.upserts.values()].flatMap((table) => [
    ...(identifierError(table.name, dialect) === null ? [] : [table.name]),
    ...table.columns.filter((c) => identifierError(c.name, dialect) !== null).map((c) => c.name),
  ]);

  /**
   * Rows that have not been named yet — a different state from a bad name.
   *
   * A just-added column has an empty name because nobody has typed one, not
   * because anyone got it wrong, so it earns a prompt rather than a red field.
   * It still blocks Review: an empty identifier is a 422 at the gate, and the
   * useful place to say so is here.
   */
  const unnamed = [...buffer.upserts.values()].reduce(
    (count, table) =>
      count + (table.name === '' ? 1 : 0) + table.columns.filter((c) => c.name === '').length,
    0,
  );

  const destructive =
    plan !== null && (plan.hazard === 'lossy' || plan.hazard === 'irreversible');

  /**
   * What the operator has to type, and why it is not a constant.
   *
   * It was `"APPLY"` — the same word for every destructive change ever made,
   * which muscle memory defeats on the second use and which never makes anyone
   * look at WHAT is being destroyed. D8's precedent is the record-delete flow,
   * where the thing typed is the record's own key.
   *
   * So: the table's name when exactly one table is being dropped — the case
   * where a mistake is unrecoverable and the name is the thing to check. When a
   * plan drops nothing but still discards data (a column, a type narrowing),
   * there is no single object to name and the literal stands in.
   */
  const droppedTables = [...new Set((plan?.steps ?? []).filter((s) => s.kind === 'drop-table').map((s) => s.table))];
  const confirmWord =
    droppedTables.length === 1
      ? (droppedTables[0]!.slice(droppedTables[0]!.lastIndexOf('.') + 1))
      : 'DISCARD';
  /*
   * D18's ceiling is a refusal you can ANSWER, and the rest are not.
   *
   * `applicable` was `plan.refusals.length === 0`, so a ceiling refusal
   * disabled Apply — and the second confirm field the door lives behind sits
   * inside a modal that only Apply opens. The door was unreachable from the
   * product no matter what the server allowed. `destructive` had the same
   * problem from the other side: an over-ceiling plan's hazard is `refused`,
   * not `lossy`, so the modal would not have opened even if Apply were live.
   */
  // `?? []` because a server one release behind sends no `ceilings` at all, and
  // a missing field must degrade to "no ceiling gates" rather than crashing the
  // whole review pane on `undefined.filter`.
  const allCeilings = plan?.ceilings ?? [];
  const openableCeilings = allCeilings.filter((c) => c.openable);
  const blockedCeilings = allCeilings.filter((c) => !c.openable);
  const ceilingTables = new Set(openableCeilings.map((c) => c.table));
  const blockingRefusals =
    plan === null
      ? []
      : plan.refusals.filter(
          (r) => !(r.code === 'TABLE_TOO_LARGE' && r.table !== null && ceilingTables.has(r.table)),
        );
  const applicable = plan !== null && blockingRefusals.length === 0 && plan.steps.length > 0;
  /** A gesture is required for a destructive plan OR an unopened ceiling. */
  const needsConfirm = destructive || openableCeilings.length > 0;

  /*
   * The ceiling the confirm asks about, and why the token is the TABLE NAME
   * rather than the row count D18's wording specifies.
   *
   * D18 says "a second type-the-row-count field". Its own mechanism defeats
   * that: the count is capped at one past the ceiling, so a step is refused if
   * and only if the count HIT the cap — which makes the number shown, and the
   * number typed, the literal 1,000,000 for every table in every workspace,
   * forever. That is a second magic word, not a fact about the operator's
   * table, and this file already carries the proof of what happens to a
   * constant confirmation: `acknowledgeRows` was passed as a hardcoded `true`.
   *
   * The table's own name is specific, is the precedent D8 already sets for a
   * drop, and needs no unbounded COUNT(*) on a table nobody has measured. The
   * count is still on screen — it belongs in the sentence, where a number that
   * is read rather than retyped can carry a thousands separator.
   *
   * D18 originally said "type-the-row-count". The owner amended it on
   * 2026-09-05 to this, and ruled against uncapping the count to make the
   * number real — so no plan request ever runs an unbounded scan on the
   * largest table in the database. Do not "restore" the row count here
   * without reopening D18.
   *
   * One gate at a time: if a plan crosses the ceiling on two tables the
   * operator authorises them one apply at a time, rather than the dialog
   * growing a field per table.
   */
  /*
   * When the plan destroys nothing, the CEILING is the only gate — so it is the
   * first field, not a second one beside a meaningless first.
   *
   * D18 says "a second type-the-row-count field in the same confirm", which
   * assumes a confirm that was already there. A plan that only rewrites a large
   * table is not destructive (its hazard is `refused`, not `lossy`), so there is
   * no first gesture for this to be second to — and the fallback word would be
   * `DISCARD` on a change that discards nothing. Two challenges, one of them
   * false, is worse than one that means something.
   */
  const ceilingGate = ((): { name: string; rows: string } | undefined => {
    const gate = openableCeilings[0];
    if (gate === undefined) return undefined;
    return {
      name: gate.table.slice(gate.table.lastIndexOf('.') + 1),
      rows: gate.rows.toLocaleString('en-US'),
    };
  })();
  const ceilingIsPrimary = ceilingGate !== undefined && !destructive;
  const primaryWord = ceilingIsPrimary ? ceilingGate.name : confirmWord;

  /** What a destructive confirm names, from preflight — never an adjective. */
  const consequences =
    plan === null
      ? []
      : plan.steps.flatMap((step) => step.consequences.map((c) => c.message));

  return (
    // Not 50/50: the designer holds a row of five labelled controls (name,
    // type, three switches, the link) and the review pane holds statements that
    // read fine narrow. An even split gave the designer 566px at a 1512px
    // viewport, which wrapped the link onto its own line.
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
      <section
        aria-label={t('studio:design.designer', 'Table designer')}
        className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface p-4"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              setUnrepresentable([]);
              stage(newTableKey(), blankTable());
            }}
          >
            {t('studio:design.newTable', 'New table')}
          </Button>
          {buffer.dirty ? (
            <Button variant="ghost" onClick={() => { buffer.clear(); setEditing(null); setPlan(null); }}>
              {t('studio:design.discard', 'Discard changes')}
            </Button>
          ) : null}
        </div>

        {editing === null ? (
          <EmptyState
            preset="no-data"
            title={t('studio:design.empty.title', 'Design your schema')}
            body={t(
              'studio:design.empty.body',
              'Create a table, or pick one to edit. Nothing reaches your database until you review the statements and apply them.',
            )}
          />
        ) : (
          <TableDesigner
            table={editing.table}
            dialect={dialect}
            /* Everything this table may link to: the connection's real tables
               (minus itself), plus any other table staged in this same edit —
               a reservations table can point at a clients table that is being
               created in the same apply, because the planner orders the
               creates so the target exists first. */
            linkTargets={[
              ...tables
                .filter((candidate) => candidate.id !== editing.table.id)
                .map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                  keyColumn: candidate.primaryKey.length === 1 ? (candidate.primaryKey[0] ?? null) : null,
                  keyType: (candidate.primaryKey.length === 1
                    ? (candidate.columns.find((c) => c.name === candidate.primaryKey[0])?.logicalType ?? null)
                    : null) as never,
                })),
              ...[...buffer.upserts.entries()]
                .filter(([key, staged]) => key !== editing.key && staged.id === null)
                .map(([, staged]) => ({
                  id: staged.name,
                  name: staged.name,
                  keyColumn: staged.primaryKey[0] ?? null,
                  keyType: (staged.columns.find((c) => c.name === staged.primaryKey[0])?.logicalType ?? null) as never,
                })),
            ]}
            existing={editing.table.id !== null}
            /* Re-stage under the SAME key, so renaming replaces the staged
               table instead of adding a second one beside it. */
            onChange={(next) => stage(editing.key, next)}
          />
        )}

        {/*
          * Dropping a table (O4, ruled: it ships). The whole path existed —
          * `buffer.drop`, `dropTables` on the wire, the planner's reverse
          * topological order, the compiler's `dropTable`, the `irreversible`
          * hazard and the Super-Admin gate — and nothing called it, because
          * there was no button. Offered only for a table that already exists:
          * a staged one is discarded, not dropped.
          */}
        {editing !== null && editing.table.id !== null && (
          <div className="mt-4 border-t border-border pt-3">
            <Button
              variant="destructive"
              onClick={() => {
                buffer.drop(editing.table.id!, true);
                setEditing(null);
                setPlan(null);
              }}
            >
              {t('studio:design.table.drop', 'Drop this table')}
            </Button>
            <p className="mt-1 text-caption text-fg-muted">
              {t(
                'studio:design.table.dropHelp',
                'The table and every row in it are destroyed. You will see exactly what breaks before anything runs.',
              )}
            </p>
          </div>
        )}

        {/*
          * A default this vocabulary cannot author (D30 admits five kinds; a
          * database `expression` default is not one) is dropped from the staged
          * copy, because sending it back would be refused at the gate. Saying
          * which column beats a form that silently forgets a default — and the
          * column keeps its default in the database unless the operator
          * deliberately changes it.
          */}
        {editing !== null && unrepresentable.length > 0 && (
          <p className="mt-3 text-caption text-fg-muted">
            {t(
              'studio:design.unrepresentableDefaults',
              'These columns keep a database-generated default Adminium cannot edit here, and it is left as it is: {columns}',
              { columns: unrepresentable.join(', ') },
            )}
          </p>
        )}

        {buffer.drops.size > 0 && editing === null ? (
          <div className="mb-4 rounded-lg border border-danger bg-danger-soft p-3">
            <h4 className="text-body font-medium text-fg">
              {t('studio:design.dropping', 'Marked for deletion')}
            </h4>
            <ul className="mt-2 flex flex-wrap gap-2">
              {[...buffer.drops].map((tableId) => (
                <li key={tableId}>
                  <Button variant="secondary" onClick={() => buffer.drop(tableId, false)}>
                    {t('studio:design.keepTable', 'Keep {table}', {
                      table: tableId.slice(tableId.lastIndexOf('.') + 1),
                    })}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {tables.length > 0 && editing === null ? (
          <div className="mt-4">
            <h4 className="text-body font-medium text-fg">
              {t('studio:design.existing', 'Existing tables')}
            </h4>
            <ul className="mt-2 flex flex-wrap gap-2">
              {tables.map((table) => (
                <li key={table.id}>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      {
                        setUnrepresentable(unsupportedColumnNotes(table));
                        stage(
                          table.id,
                          modelTableToDesired(table, relations, enumValuesByTable[table.id] ?? {}),
                        );
                      }
                    }
                  >
                    {table.name}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section
        aria-label={t('studio:design.reviewPane', 'Review')}
        className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface p-4"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void handlePlan()}
            disabled={!buffer.dirty || planning || invalidNames.length > 0 || unnamed > 0}
          >
            {planning ? <Spinner size="sm" /> : null}
            {t('studio:design.plan', 'Review changes')}
          </Button>
          <Button
            variant="primary"
            disabled={!applicable || applying}
            onClick={() => (needsConfirm ? setConfirmOpen(true) : void handleApply())}
          >
            {t('studio:design.apply', 'Apply')}
          </Button>
        </div>

        {error !== null ? (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        ) : null}

        {/*
          * A gate this viewer cannot open earns a SENTENCE, not a field.
          *
          * Showing the second confirm field to a non-super-admin would dangle a
          * gesture that can only ever end in a 403 after they press Apply — the
          * server decides `openable`, so the UI never has to guess at the
          * principal, and never disagrees with the refusal.
          */}
        {blockedCeilings.map((gate) => (
          <Banner key={gate.table} tone="warn" role="status">
            {t(
              'studio:design.ceiling.notYours',
              '{table} holds over {rows} rows. Only a Super Admin can authorise a rewrite this large — ask one, or run the change during a maintenance window with your own tooling.',
              {
                table: gate.table.slice(gate.table.lastIndexOf('.') + 1),
                rows: gate.rows.toLocaleString('en-US'),
              },
            )}
          </Banner>
        ))}

        {unnamed > 0 ? (
          <p className="text-body-sm text-fg-muted">
            {t('studio:design.unnamed', 'Name every table and column to review the changes.')}
          </p>
        ) : null}

        {result !== null ? (
          <Banner
            tone={
              result.status === 'applied' ? 'pos' : result.status === 'failed' ? 'danger' : 'warn'
            }
            role={result.status === 'failed' ? 'alert' : 'status'}
          >
            <span className="flex flex-col gap-1">
              <span>
                {result.status === 'applied'
                  ? t('studio:design.result.applied', 'Applied. Adminium re-read your schema.')
                  : result.status === 'failed'
                    ? /*
                       * A change where NOTHING ran is a failure, not a partial.
                       *
                       * The banner treated every non-`applied` status as
                       * partial, so a `create table` that MySQL rejected
                       * outright reported "Partly applied: 0 of 1 steps ran" —
                       * which reads as "something happened to your database"
                       * when nothing did, and, worse, swallowed the engine's
                       * error entirely. The server had it right in the ledger
                       * the whole time; only the sentence was wrong.
                       */
                      t(
                        'studio:design.result.failed',
                        'Nothing was applied — your database is unchanged. {error}',
                        { error: result.error ?? '' },
                      )
                    : t(
                        'studio:design.result.partial',
                        'Partly applied: {done} of {total} steps ran. Applying the same changes again completes them.',
                        {
                          done: String(result.steps.filter((s) => s.outcome === 'succeeded').length),
                          total: String(result.steps.length),
                        },
                      )}
              </span>
              {/*
                The step that failed, and what the engine said about it — the
                only place an operator can see why. A partial apply names it
                too: the failing step is the one they have to think about.
              */}
              {result.status !== 'applied'
                ? result.steps
                    .filter((step) => step.outcome === 'failed' && step.error !== null)
                    .map((step) => (
                      <span key={step.id} className="text-fg-muted">
                        {step.kind} {step.table}: {step.error}
                      </span>
                    ))
                : null}
              {/*
                D33's repair, said out loud. An operator who renames a table
                should be told their pages and grants followed it, not left to
                open /settings/roles to find out.
              */}
              {result.repaired !== null &&
              result.repaired.pages + result.repaired.grants + result.repaired.overrides > 0 ? (
                <span className="text-fg-muted">
                  {t(
                    'studio:design.result.repaired',
                    'The rename was carried into {pages, plural, one {# page} other {# pages}}, {grants, plural, one {# role grant} other {# role grants}} and {overrides, plural, one {# schema override} other {# schema overrides}}.',
                    {
                      // NUMBERS, not strings: ICU picks the plural category from
                      // the value, and a string never matches `one`. It read
                      // "carried into 1 pages, 1 role grants and 1 schema
                      // overrides" in the browser.
                      pages: result.repaired.pages,
                      grants: result.repaired.grants,
                      overrides: result.repaired.overrides,
                    },
                  )}
                </span>
              ) : null}
            </span>
          </Banner>
        ) : null}

        {/* ─── D11: the inclusion offer ─────────────────────────────────── */}
        {result !== null && result.createdTables.length > 0 && adoptResult === null ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3.5">
            <p className="text-body-sm text-fg">
              {t(
                'studio:design.adopt.offer',
                'A new table does nothing until it has a page. Add {tables} to your app?',
                { tables: result.createdTables.join(', ') },
              )}
            </p>
            <p className="text-body-sm text-fg-muted">
              {t(
                'studio:design.adopt.grants',
                'No role is given access automatically — grant it in Settings → Roles.',
              )}
            </p>
            {adoptError !== null ? (
              <Banner tone="danger" role="alert">
                {adoptError}
              </Banner>
            ) : null}
            <div>
              <Button variant="primary" loading={adopting} onClick={() => void handleAdopt()}>
                {t('studio:design.adopt.action', 'Add to my app')}
              </Button>
            </div>
          </div>
        ) : null}

        {adoptResult !== null ? (
          <Banner tone="pos" role="status">
            <span className="flex flex-col gap-1">
              <span>
                {t(
                  'studio:design.adopt.done',
                  '{created} pages created, {updated} updated, {unchanged} already current.',
                  {
                    created: String(adoptResult.result.created),
                    updated: String(adoptResult.result.updated),
                    unchanged: String(adoptResult.result.unchanged),
                  },
                )}
              </span>
              {/*
                The sentence D11 exists for: a page someone edited by hand was
                NOT regenerated, and believing otherwise is how a person waits
                for a change that will never arrive.
              */}
              {adoptResult.result.skippedEdited.length > 0 ? (
                <span className="text-fg-muted">
                  {t(
                    'studio:design.adopt.skippedEdited',
                    'Left untouched because you edited them: {pages}.',
                    { pages: adoptResult.result.skippedEdited.join(', ') },
                  )}
                </span>
              ) : null}
              {adoptResult.includesEverything ? (
                <span className="text-fg-muted">
                  {t(
                    'studio:design.adopt.everything',
                    'This connection already shows every table, so nothing had to be included.',
                  )}
                </span>
              ) : null}
            </span>
          </Banner>
        ) : null}

        {plan === null ? (
          <p className="text-body-sm text-fg-muted">
            {t(
              'studio:design.review.pending',
              'Review your changes to see the exact statements Adminium will run.',
            )}
          </p>
        ) : (
          <PlanReview plan={plan} />
        )}
      </section>

      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('studio:design.confirm.title', 'Apply a destructive change')}
        body={
          <span className="flex flex-col gap-1">
            <span>
              {t(
                'studio:design.confirm.body',
                'This change discards data or removes an object. Adminium cannot undo it.',
              )}
            </span>
            {ceilingGate !== undefined ? (
              <span>
                {t(
                  'studio:design.ceiling.body',
                  '{table} holds over {rows} rows — past the size Adminium rewrites on its own. Only a Super Admin can authorise this, and the table will be locked for as long as the rewrite takes.',
                  { table: ceilingGate.name, rows: ceilingGate.rows },
                )}
              </span>
            ) : null}
            {consequences.map((line, index) => (
              <span key={index} className="text-fg-muted">
                {line}
              </span>
            ))}
          </span>
        }
        confirmWord={primaryWord}
        promptLabel={
          ceilingIsPrimary
            ? t('studio:design.ceiling.prompt', 'Type {table} again to authorise the rewrite', {
                table: primaryWord,
              })
            : t('studio:design.confirm.prompt', 'Type {word} to confirm', { word: primaryWord })
        }
        /*
         * D18's second gesture. The token is the TABLE'S OWN NAME, not the row
         * count D18's wording names — see `ceilingGate` below for why.
         */
        {...(ceilingGate === undefined || ceilingIsPrimary
          ? {}
          : {
              secondPrompt: {
                label: t('studio:design.ceiling.prompt', 'Type {table} again to authorise the rewrite', {
                  table: ceilingGate.name,
                }),
                expected: ceilingGate.name,
                hint: t('studio:design.ceiling.hint', 'Type the table name exactly as it appears above.'),
              },
            })}
        confirmLabel={t('studio:design.confirm.confirm', 'Apply changes')}
        cancelLabel={t('studio:design.confirm.cancel', 'Cancel')}
        closeLabel={t('studio:design.confirm.close', 'Close')}
        busy={applying}
        onConfirm={() => void handleApply()}
      />
    </div>
  );
}

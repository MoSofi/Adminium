// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Remedy 3 — add the columns this template needs to the operator's own table.
 *
 * ─── Why it goes through plan 35's doors ──────────────────────────────────
 *
 * Creating a column is DDL against a live customer database, and 35 already
 * owns every question that raises: does this role hold ALTER, how many rows
 * would be rewritten, what exactly will run, and is the plan the operator
 * authorised still the plan that applies. So the flow is `plan` → show the
 * exact statement (`PlanReview`) → `apply` on confirm, and this component
 * re-derives none of it. `AttachmentsColumnSetup` is the same shape for one
 * fixed column; this is that generalised to a set the fit report names.
 *
 * ─── The operator is not asked to name anything (D3) ──────────────────────
 *
 * Naming is where this repair silently fails. `r12-event-timestamp` is a NAME
 * SUFFIX rule, so a column of the right TYPE called `appointment` is one the
 * classifier never tags and the page still refuses — a gate that cannot open,
 * after a change the operator watched succeed. So the name comes from the
 * descriptor, which ships a list of conforming names and a test that every one
 * of them composes.
 *
 * ─── Two halves, because either can fail alone ────────────────────────────
 *
 * After the DDL lands, the overrides are written: the semantic for each new
 * column, plus the ANSWER LIST for the ones whose requirement reaches into an
 * enum's values. Both halves matter and they fail differently:
 *
 *   - a calendar's `event_date` works from its NAME alone, so the override is
 *     insurance against someone later renaming the column;
 *   - a board's `status` does NOT. `r07-status-workflow` needs values, and
 *     `addColumns` cannot carry them (`AddColumn` holds a `DesiredColumn`;
 *     only `DesiredTable` has an `enumValues` map). The override is the only
 *     channel, so a board repair whose override write fails is INCOMPLETE.
 *
 * That is why a failed override write is reported as its own state rather than
 * folded into the DDL error: the column really does exist by then, and telling
 * the operator to run it again would add a second one.
 *
 * ─── What it never does ───────────────────────────────────────────────────
 *
 * It never DROPS anything, it never adds a column for a role that
 * needs a FOREIGN KEY — `personFk` tests the target table's name as well as the
 * reference, so an integer named `employee_id` pointing nowhere satisfies
 * nothing — and it never touches a name that is already taken.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, MonoText } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { applySchemaEdit, planSchemaEdit } from '../remap/design/api.js';
import { PlanReview } from '../remap/design/PlanReview.js';
import type { DesiredColumn, SchemaEdit, SchemaPlan } from '../remap/design/types.js';
import {
  invalidateAfterTag,
  writeRepairOverrides,
  type FitRequirementDto,
} from './fitApi.js';

/**
 * The identifier rule, mirrored from `IDENTIFIER_RE` in
 * `packages/engine/src/ddl/edit.ts`. Mirrored rather than imported for the
 * reason `AttachmentsColumnSetup` gives: the dashboard does not pull the
 * engine's DDL module into a browser chunk.
 */
const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;

/** One column this repair will create, resolved from a requirement. */
export interface PlannedColumn {
  role: string;
  name: string;
  logicalType: string;
  maxLength: number | null;
  semantic: string;
  enumValues: string[] | null;
}

/**
 * Resolve the columns a repair would add.
 *
 * Every suggested name can be TAKEN — by a column that fails the role, which is
 * exactly the table that needs the repair (a text `event_date`, an integer
 * `status`). So the first FREE name wins, and a role whose every name is taken
 * is reported rather than forced: adding `event_date_2` would be this component
 * inventing a name the classifier does not tag.
 */
export function planColumns(
  requirements: readonly FitRequirementDto[],
  existingColumns: readonly { name: string }[],
): { columns: PlannedColumn[]; blocked: FitRequirementDto[] } {
  const taken = new Set(existingColumns.map((column) => column.name));
  const columns: PlannedColumn[] = [];
  const blocked: FitRequirementDto[] = [];

  for (const requirement of requirements) {
    // A foreign key cannot be added blind — it needs a target table, and the
    // rule tests that table's NAME. Offering it here would be offering
    // something that cannot work.
    if (requirement.wants.needsReference === true) {
      blocked.push(requirement);
      continue;
    }
    const name = requirement.wants.suggestedNames.find(
      (candidate) => !taken.has(candidate) && IDENTIFIER_RE.test(candidate),
    );
    if (name === undefined) {
      blocked.push(requirement);
      continue;
    }
    taken.add(name);
    columns.push({
      role: requirement.role,
      name,
      logicalType: requirement.wants.logicalTypes[0] ?? 'text',
      maxLength: requirement.wants.maxLength ?? null,
      semantic: requirement.wants.semantic,
      enumValues: requirement.wants.enumValues ?? null,
    });
  }
  return { columns, blocked };
}

/** The column a repair creates: always NULLABLE, never defaulted. */
function desiredColumn(planned: PlannedColumn): DesiredColumn {
  return {
    name: planned.name,
    logicalType: planned.logicalType as DesiredColumn['logicalType'],
    // NULLABLE, always. A NOT NULL column cannot be added to a table that
    // already has rows without a default, and the planner refuses exactly that
    // by name. It is also honest: the rows that exist have no event date yet.
    nullable: true,
    default: null,
    maxLength: planned.maxLength,
    numericPrecision: null,
    numericScale: null,
    comment: null,
  };
}

function messageOf(reason: unknown): string {
  if (reason instanceof ApiError) return reason.message;
  return reason instanceof Error ? reason.message : String(reason);
}

export interface FitColumnSetupProps {
  connectionId: string;
  table: string;
  /** The active snapshot this plan is built against (the drift check). */
  baseSnapshotId: string | null;
  existingColumns: readonly { name: string }[];
  /** The unmet requirements, as the fit report states them. */
  requirements: readonly FitRequirementDto[];
}

export function FitColumnSetup({
  connectionId,
  table,
  baseSnapshotId,
  existingColumns,
  requirements,
}: FitColumnSetupProps) {
  const client = useQueryClient();
  const [plan, setPlan] = useState<SchemaPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when the DDL landed but the overrides beside it did not. */
  const [halfDone, setHalfDone] = useState<string | null>(null);

  const { columns, blocked } = planColumns(requirements, existingColumns);

  const edit = (): SchemaEdit => ({
    baseSnapshotId: baseSnapshotId ?? '',
    renames: { tables: [], columns: [] },
    upsertTables: [],
    addColumns: columns.map((column) => ({ table, column: desiredColumn(column) })),
    dropTables: [],
  });

  const preview = useMutation({
    mutationFn: () => planSchemaEdit(connectionId, edit()),
    onSuccess: (result) => {
      setError(null);
      setPlan(result);
    },
    onError: (reason: unknown) => {
      setPlan(null);
      setError(messageOf(reason));
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (plan === null) throw new Error('no plan');
      /*
       * `acknowledgeRows: true`, and the reason is not a shortcut.
       *
       * ADDING A NULLABLE COLUMN IS NOT ALWAYS FREE. `AttachmentsColumnSetup`
       * passes `false` under the comment "adding a nullable column rewrites
       * nothing, so no ceiling can fire" — which is true on postgres and FALSE
       * on sqlite, where the dialect has no in-place ALTER for this and the
       * planner rebuilds the table. Verified in a browser: the apply came back
       * "This plan rewrites rows. Confirm the row counts before applying." and
       * the repair could not be completed at all.
       *
       * D18's door is "the API does not assume it — the UI collects it", and
       * this UI does collect it: `PlanReview` directly above the button renders
       * every consequence, row counts included, and this click is the operator
       * answering what it showed them. A CEILING is a different question and is
       * deliberately NOT acknowledged here — one refuses, with the server's own
       * sentence, rather than being waved through on their behalf.
       */
      await applySchemaEdit(connectionId, edit(), plan.checksum, true);
      // DDL FIRST, meanings second. The column exists from here on, so
      // a failure below is reported as a half-done repair rather than as a
      // failed one — telling the operator to run it again would add a second
      // column.
      try {
        await writeRepairOverrides({
          connectionId,
          table,
          columns: columns.map((column) => ({
            column: column.name,
            semanticType: column.semantic,
            ...(column.enumValues === null ? {} : { values: column.enumValues }),
          })),
        });
      } catch (reason: unknown) {
        throw new HalfDone(messageOf(reason));
      }
    },
    onSuccess: async () => {
      setPlan(null);
      setHalfDone(null);
      await invalidateAfterTag(client, connectionId);
    },
    onError: async (reason: unknown) => {
      setPlan(null);
      if (reason instanceof HalfDone) {
        setHalfDone(reason.detail);
        // The schema really did change, so everything derived from it is stale
        // whether or not the meanings landed.
        await invalidateAfterTag(client, connectionId);
        return;
      }
      setError(messageOf(reason));
    },
  });

  if (halfDone !== null) {
    return (
      <Alert
        role="alert"
        tone="warn"
        data-testid="studio-pages-fit-columns-half-done"
        title={t(
          'studio:pages.fit.columns.halfDone',
          'The columns were added, but Adminium could not record what they mean',
        )}
        body={`${t(
          'studio:pages.fit.columns.halfDoneBody',
          'Nothing needs running again — the columns exist. Set their meaning in Studio → Schema, or ask an administrator to.',
        )} ${halfDone}`}
      />
    );
  }

  if (columns.length === 0) {
    return (
      <Alert
        role="status"
        tone="info"
        data-testid="studio-pages-fit-columns-blocked"
        title={t('studio:pages.fit.columns.cannot', 'Adminium cannot add this one for you')}
        body={t(
          'studio:pages.fit.columns.cannotBody',
          'This page needs a link to another table, which has to be set up in Studio → Schema.',
        )}
      />
    );
  }

  return (
    <section className="flex flex-col gap-2" data-testid="studio-pages-fit-columns">
      <div className="flex flex-col">
        <h4 className="text-body-sm font-semibold text-fg">
          {t('studio:pages.fit.columns.title', 'Add what is missing to this table')}
        </h4>
        <span className="text-[11.5px] text-fg-muted">
          {t(
            'studio:pages.fit.columns.help',
            'Adminium adds these columns to your table. You will see the exact statement before anything runs, and nothing is removed.',
          )}
        </span>
      </div>

      <ul className="flex flex-col gap-1" data-testid="studio-pages-fit-columns-list">
        {columns.map((column) => (
          <li key={column.name} className="flex items-baseline gap-2">
            <MonoText className="text-body-sm text-fg">{column.name}</MonoText>
            <span className="text-[11.5px] text-fg-muted">
              {column.maxLength === null
                ? column.logicalType
                : `${column.logicalType}(${String(column.maxLength)})`}
            </span>
          </li>
        ))}
      </ul>

      {blocked.length > 0 ? (
        <p className="text-[11.5px] text-fg-muted" data-testid="studio-pages-fit-columns-partial">
          {t(
            'studio:pages.fit.columns.partial',
            'One thing this page needs cannot be added for you, so it will still be incomplete afterwards.',
          )}
        </p>
      ) : null}

      {error !== null ? (
        <Alert
          role="alert"
          tone="danger"
          data-testid="studio-pages-fit-columns-error"
          title={t('studio:pages.fit.columns.failed', 'That did not work')}
          body={error}
        />
      ) : null}

      {plan === null ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={preview.isPending}
            loading={preview.isPending}
            onClick={() => preview.mutate()}
            data-testid="studio-pages-fit-columns-plan"
          >
            {t('studio:pages.fit.columns.review', 'Review the change')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="studio-pages-fit-columns-plan-review">
          <PlanReview plan={plan} />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={apply.isPending || plan.steps.length === 0 || plan.refusals.length > 0}
              loading={apply.isPending}
              onClick={() => apply.mutate()}
              data-testid="studio-pages-fit-columns-confirm"
            >
              {t('studio:pages.fit.columns.confirm', 'Run it')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPlan(null);
                setError(null);
              }}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <MonoText className="text-caption text-fg-subtle">{table}</MonoText>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The DDL landed and the meanings did not.
 *
 * Its own error type because it is its own OUTCOME, not a failure: the columns
 * exist, re-running would add more, and the way forward is the Column
 * Inspector rather than this button.
 */
class HalfDone extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.name = 'HalfDone';
    this.detail = detail;
  }
}

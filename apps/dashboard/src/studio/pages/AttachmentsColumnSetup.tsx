// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Binding a page's attachments to a COLUMN on the customer's own
 * table.
 *
 * ─── What this is ─────────────────────────────────────────────────────────
 *
 * The owner's model: turning attachments on should give the New/Edit dialog a
 * real upload field, and the files should live in the customer's table — not
 * on Adminium's side. A field in the create dialog is only possible when the
 * value goes into a COLUMN, because there is no record to attach to before
 * Save. So enabling attachments here creates (or adopts) one `text` column
 * holding a JSON list of file references.
 *
 * ─── Why it goes through plan 35's doors ──────────────────────────────────
 *
 * Creating a column is DDL against a live customer database, and 35 already
 * owns every question that raises: does this role hold ALTER, how many rows
 * would be rewritten, what exactly will run, and is the plan the operator
 * authorised still the plan that applies. Re-deriving any of that here would
 * be a second implementation that disagrees the first time a version gate
 * moves. So the flow is: `plan` → show the operator the exact statement
 * (`PlanReview`) → `apply` on confirm.
 *
 * It uses the `addColumns` edit form rather than `upsertTables`: a caller
 * holding only a snapshot cannot restate a whole table faithfully —
 * `logicalType` is a closed enum, so one column of a display-only type makes
 * the request invalid, and a default the vocabulary cannot author comes back
 * `null` and reads as an intentional drop.
 *
 * ─── Ordering, and the window it leaves ───────────────────────────────────
 *
 * D6: DDL first, page second. A page naming a column that does not exist would
 * mint references into nothing; a column with no block is merely unused. So
 * this component applies the DDL and then hands the names back to the screen,
 * which writes them into the page draft — and the operator still has to press
 * Save. If they walk away instead, they are left with an empty unused column,
 * which is the harmless side of that ordering. The card says so rather than
 * pretending the change is already complete.
 *
 * ─── What it never does ───────────────────────────────────────────────────
 *
 * It never DROPS anything. Turning attachments off unbinds the page and leaves
 * the column and its data alone (D7) — dropping is the one step Adminium
 * cannot take back, and it stays a deliberate act in the schema designer with
 * its own confirmation.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, FormField, Input, MonoText } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { applySchemaEdit, planSchemaEdit } from '../remap/design/api.js';
import { PlanReview } from '../remap/design/PlanReview.js';
import type { DesiredColumn, SchemaEdit, SchemaPlan } from '../remap/design/types.js';

/**
 * The identifier rule, mirrored from `IDENTIFIER_RE` in
 * `packages/engine/src/ddl/edit.ts` and enforced again by the route's own Zod.
 *
 * Mirrored rather than imported for the reason every other constant on this
 * screen is: the dashboard does not pull the engine's DDL module into a
 * browser chunk. The server refuses what it refuses either way — this exists
 * so the operator is told before a round trip, not instead of one.
 */
const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;
const IDENTIFIER_MAX = 128;

/** What a column must be to hold a list of references (`FILE_CAPABLE_TYPES`).
 * */
const TEXTISH = new Set(['text', 'varchar']);

export interface AttachmentsColumnSetupProps {
  connectionId: string;
  /** Qualified table id, as the snapshot names it. */
  table: string;
  /** The active snapshot this plan is built against (D2's drift check). */
  baseSnapshotId: string | null;
  /** The source table's columns, for the exists / type checks. */
  existingColumns: readonly { name: string; logicalType?: string | undefined }[];
  /** The column this page is already bound to, when it is bound. */
  boundColumn?: string | undefined;
  /**
   * The page is now bound to `column`. The screen writes the pointer and the
   * column's `file` block into its drafts; nothing is persisted until Save.
   */
  onBound: (column: string) => void;
}

export function AttachmentsColumnSetup({
  connectionId,
  table,
  baseSnapshotId,
  existingColumns,
  boundColumn,
  onBound,
}: AttachmentsColumnSetupProps) {
  const [name, setName] = useState('attachments');
  const [plan, setPlan] = useState<SchemaPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set once a DDL apply succeeded, so the card can say the column is real. */
  const [created, setCreated] = useState(false);

  const trimmed = name.trim();
  const existing = existingColumns.find((column) => column.name === trimmed);
  const nameProblem: string | null =
    trimmed === ''
      ? t('studio:pages.attachments.column.required', 'Give the column a name.')
      : !IDENTIFIER_RE.test(trimmed)
        ? t(
            'studio:pages.attachments.column.invalid',
            'A column name must start with a letter and use only lowercase letters, digits and underscores.',
          )
        : trimmed.length > IDENTIFIER_MAX
          ? t('studio:pages.attachments.column.tooLong', 'That name is too long for a column.')
          : existing !== undefined && !TEXTISH.has(existing.logicalType ?? 'text')
            ? t(
                'studio:pages.attachments.column.wrongType',
                'This table already has a column with that name, and it cannot hold a file reference. Pick another name.',
              )
            : null;

  const edit = (): SchemaEdit => ({
    baseSnapshotId: baseSnapshotId ?? '',
    renames: { tables: [], columns: [] },
    upsertTables: [],
    addColumns: [{ table, column: desiredColumn(trimmed) }],
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
      // `acknowledgeRows: false` — adding a nullable column rewrites nothing,
      // so no ceiling can fire. If one ever did, the apply refuses rather than
      // silently acknowledging on the operator's behalf.
      await applySchemaEdit(connectionId, edit(), plan.checksum, false);
    },
    onSuccess: () => {
      setPlan(null);
      setCreated(true);
      onBound(trimmed);
    },
    onError: (reason: unknown) => {
      setError(messageOf(reason));
    },
  });

  if (boundColumn !== undefined) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="studio-pages-attachments-bound">
        <p className="text-body-sm text-fg">
          {t('studio:pages.attachments.column.bound', 'Files are stored in this table’s {column} column.', {
            column: boundColumn,
          })}
        </p>
        <p className="text-caption text-fg-muted">
          {created
            ? t(
                'studio:pages.attachments.column.createdHint',
                'The column exists now. Save this page to finish wiring it up.',
              )
            : t(
                'studio:pages.attachments.column.boundHint',
                'Turning attachments off later unbinds this page. The column and the files in it are left alone.',
              )}
        </p>
      </div>
    );
  }

  const canAdopt = existing !== undefined && nameProblem === null;

  return (
    <div className="flex flex-col gap-3" data-testid="studio-pages-attachments-setup">
      <FormField
        label={t('studio:pages.attachments.column.label', 'Column that holds the files')}
        helper={
          canAdopt
            ? t(
                'studio:pages.attachments.column.adoptHint',
                'This table already has that column, so nothing is created — it is used as it is.',
              )
            : t(
                'studio:pages.attachments.column.createHint',
                'Adminium adds one text column to this table. You will see the exact statement before anything runs.',
              )
        }
        {...(nameProblem === null ? {} : { error: nameProblem })}
      >
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setPlan(null);
            setError(null);
          }}
          data-testid="studio-pages-attachments-column-name"
        />
      </FormField>

      {error !== null ? (
        <Alert
          role="alert"
          tone="danger"
          data-testid="studio-pages-attachments-error"
          title={t('studio:pages.attachments.column.failed', 'That did not work')}
          body={error}
        />
      ) : null}

      {plan === null ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={nameProblem !== null || preview.isPending}
            loading={preview.isPending}
            onClick={() => {
              if (canAdopt) {
                // Nothing to run: the column is already there and can hold a
                // reference, so this is a page edit and not a schema change.
                onBound(trimmed);
                return;
              }
              preview.mutate();
            }}
            data-testid="studio-pages-attachments-column-go"
          >
            {canAdopt
              ? t('studio:pages.attachments.column.use', 'Use this column')
              : t('studio:pages.attachments.column.create', 'Create the column')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="studio-pages-attachments-plan">
          <PlanReview plan={plan} />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={apply.isPending || plan.steps.length === 0 || plan.refusals.length > 0}
              loading={apply.isPending}
              onClick={() => apply.mutate()}
              data-testid="studio-pages-attachments-column-confirm"
            >
              {t('studio:pages.attachments.column.confirm', 'Run it')}
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
    </div>
  );
}

/** The column this feature always creates (D6): nullable text, no default. */
function desiredColumn(name: string): DesiredColumn {
  return {
    name,
    logicalType: 'text',
    // NULLABLE, always. A NOT NULL column cannot be added to a table that
    // already has rows without a default, and the planner refuses exactly that
    // by name — a record simply has no attachments until it has some.
    nullable: true,
    default: null,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    comment: null,
  };
}

/**
 * The server's own sentence, whenever there is one.
 *
 * A 403 here is the ordinary case rather than an exception: the card cannot
 * know in advance whether this operator holds `schema.ddl` — the dashboard is
 * told a connection's authorability, never a person's grants — so the plan
 * call is how that question gets asked, and its answer already names the
 * missing permission.
 */
function messageOf(reason: unknown): string {
  if (reason instanceof ApiError) return reason.message;
  return reason instanceof Error ? reason.message : String(reason);
}

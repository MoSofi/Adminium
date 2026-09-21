// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Remedy 4 — a new table shaped for this page, then the page bound to it.
 *
 * The last offer on the fit panel and the first one on a create screen that has
 * no table to pick: whatever the operator's schema looks like, this is the
 * route that always ends in a working page. It is also the "I have no table
 * yet but I want a calendar" answer, which is why it lives in its own
 * component rather than inside the panel — the panel only exists once a table
 * has been picked.
 *
 * ─── The engine drafts, this component only renders and runs ──────────────
 *
 * `GET /pages/fit/new-table` returns the table (and, for a scheduler, the
 * people table or existing people link) and PROVES it composes under the name
 * the operator typed. Nothing here decides what a calendar needs; it maps the
 * draft onto plan 35's `upsertTables` vocabulary and goes through the same
 * plan → `PlanReview` → apply doors as every other schema change.
 *
 * ─── After the DDL, the meanings; after the meanings, the page ────────────
 *
 * Three beats, schema first, each reported on its own because each can fail
 * after the one before it succeeded:
 *
 *   1. the table exists (apply);
 *   2. its columns carry their meanings (override write) — for a board this
 *      is not optional, because the status VALUES ride `column.options` and
 *      `upsertTables` is not the channel this plan uses for them;
 *   3. the create form points at the new table (`onCreated`).
 *
 * A failure at 2 is not a failed repair: the table is real, and "run it again"
 * would be refused as a duplicate. It gets its own sentence.
 */

import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, FormField, Input, MonoText, Select } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { studioApi } from '../api.js';
import { applySchemaEdit, planSchemaEdit } from '../remap/design/api.js';
import { PlanReview } from '../remap/design/PlanReview.js';
import type { DesiredTable, SchemaEdit, SchemaPlan } from '../remap/design/types.js';
import {
  invalidateAfterTag,
  newTableDraftQuery,
  writeRepairOverrides,
  type TableDraftDto,
} from './fitApi.js';
import { schemaAuthoringRefusal } from './schemaAuthoringReason.js';

/** The select value for "create a people table in the same edit". */
const NEW_PEOPLE = 'new';

/**
 * The draft, in the Design mode's vocabulary.
 *
 * Every column but the key is NULLABLE and undefaulted: the page's own create
 * form then asks for nothing the operator was never told about, and a NOT NULL
 * column the page does not render would make every insert from it fail.
 */
export function desiredTablesOf(draft: TableDraftDto): DesiredTable[] {
  return draft.tables.map((table) => ({
    id: null,
    // The connection's default schema — the one the draft checked names in.
    schema: null,
    name: table.name,
    comment: null,
    columns: table.columns.map((column) => ({
      name: column.name,
      logicalType: column.logicalType as DesiredTable['columns'][number]['logicalType'],
      nullable: !column.primaryKey,
      // D31's default key, and the only one the CRUD insert path reads back on
      // all three dialects — the same as the designer's `blankTable`.
      default: column.primaryKey ? { kind: 'autoincrement' as const } : null,
      maxLength: column.maxLength,
      numericPrecision: null,
      numericScale: null,
      comment: null,
    })),
    primaryKey: table.columns.filter((column) => column.primaryKey).map((column) => column.name),
    uniques: [],
    indexes: [],
    foreignKeys: table.columns.flatMap((column) =>
      column.references === null
        ? []
        : [
            {
              name: null,
              columns: [column.name],
              // A table id, or the name of a table created in this same edit —
              // the edit layer resolves either and orders the creates by it.
              toTable: column.references.table,
              toColumns: [column.references.column],
              onDelete: null,
              onUpdate: null,
            },
          ],
    ),
    enumValues: {},
  }));
}

function messageOf(reason: unknown): string {
  if (reason instanceof ApiError) return reason.message;
  return reason instanceof Error ? reason.message : String(reason);
}

/** The table exists; what it means, or the snapshot that shows it, did not land. */
class HalfDone extends Error {
  readonly kind: 'meanings' | 'reread';
  constructor(kind: 'meanings' | 'reread', detail: string) {
    super(detail);
    this.name = 'HalfDone';
    this.kind = kind;
  }
}

export interface FitTableSetupProps {
  connectionId: string;
  template: string;
  /** Point the page at the table once it exists. */
  onCreated: (tableId: string) => void;
  /**
   * Render the connection's "cannot take DDL" reason instead of nothing. The
   * fit panel already says it once for remedy 3; the create screen's no-table
   * entry has nobody else to say it (acceptance 6).
   */
  showRefusal?: boolean;
}

export function FitTableSetup({
  connectionId,
  template,
  onCreated,
  showRefusal = false,
}: FitTableSetupProps) {
  const client = useQueryClient();
  const nameId = useId();
  // What the operator typed, and the settled copy the draft is asked about. A
  // request per keystroke would race; 300 ms is below the pause people make
  // before reading the verdict.
  const [typed, setTyped] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [people, setPeople] = useState<string | null>(null);
  const [plan, setPlan] = useState<SchemaPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [halfDone, setHalfDone] = useState<HalfDone | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setName(typed === null || typed.trim() === '' ? null : typed.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  // Same key the create screen and the panel read: the cached reply, carrying
  // the snapshot the plan is built against and whether DDL is possible here.
  const schema = useQuery({
    queryKey: ['studio', 'schema', connectionId] as const,
    queryFn: () => studioApi.getSchema(connectionId),
    retry: false,
  });
  const refusal = schemaAuthoringRefusal(schema.data?.schemaAuthoring);
  const draftQuery = useQuery(
    newTableDraftQuery({
      connectionId,
      template,
      name,
      people,
      enabled: schema.data !== undefined && refusal === null,
    }),
  );
  const draft = draftQuery.data ?? null;
  // A reply for an earlier name is shown while the new one loads, but it must
  // never be the draft that gets planned.
  const settled =
    !draftQuery.isPlaceholderData && !draftQuery.isFetching && (typed ?? '').trim() === (name ?? '');

  const edit = (current: TableDraftDto): SchemaEdit => ({
    baseSnapshotId: schema.data?.snapshotId ?? '',
    renames: { tables: [], columns: [] },
    upsertTables: desiredTablesOf(current),
    addColumns: [],
    dropTables: [],
  });

  const preview = useMutation({
    mutationFn: (current: TableDraftDto) => planSchemaEdit(connectionId, edit(current)),
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
    mutationFn: async (current: TableDraftDto) => {
      if (plan === null) throw new Error('no plan');
      // `acknowledgeRows: true` for the reason `FitColumnSetup` gives: the
      // review directly above the button shows every consequence, and a
      // CREATE has no rows to rewrite, so there is nothing hidden behind it.
      const result = await applySchemaEdit(connectionId, edit(current), plan.checksum, true);
      if (result.status !== 'applied') {
        // `partial` is real: a scheduler draft creates two tables, and the
        // people table can exist while the second failed. The server's own
        // sentence says which.
        throw new Error(result.error ?? result.status);
      }
      const bound = current.tables.at(-1);
      const meanings = (bound?.columns ?? []).filter((column) => column.semantic !== null);
      try {
        if (meanings.length > 0) {
          await writeRepairOverrides({
            connectionId,
            table: current.bindTableId,
            columns: meanings.map((column) => ({
              column: column.name,
              semanticType: column.semantic as string,
              ...(column.enumValues === null ? {} : { values: column.enumValues }),
            })),
          });
        }
      } catch (reason: unknown) {
        throw new HalfDone('meanings', messageOf(reason));
      }
      // No snapshot means the apply ran and the re-read did not, so the table
      // is not in the model a page composes from yet — binding it now would
      // be refused as "not available".
      if (result.snapshotId === null) throw new HalfDone('reread', '');
      return current.bindTableId;
    },
    onSuccess: async (tableId) => {
      setPlan(null);
      await invalidateAfterTag(client, connectionId);
      onCreated(tableId);
    },
    onError: async (reason: unknown) => {
      setPlan(null);
      if (reason instanceof HalfDone) {
        setHalfDone(reason);
        await invalidateAfterTag(client, connectionId);
        return;
      }
      setError(messageOf(reason));
    },
  });

  if (schema.data === undefined) return null;
  if (refusal !== null) {
    return showRefusal ? (
      <Alert
        tone="info"
        role="status"
        data-testid="studio-pages-fit-table-no-ddl"
        title={t('studio:pages.fit.table.noDdl', 'Adminium cannot create a table here')}
        body={refusal}
      />
    ) : null;
  }
  // The template has no repair descriptors (D4), or the draft is not back yet.
  if (draft === null) return null;

  if (halfDone !== null) {
    return (
      <Alert
        role="alert"
        tone="warn"
        data-testid="studio-pages-fit-table-half-done"
        title={
          halfDone.kind === 'meanings'
            ? t(
                'studio:pages.fit.table.halfDone',
                'The table was created, but Adminium could not record what its columns mean',
              )
            : t(
                'studio:pages.fit.table.notReread',
                'The table was created, but Adminium could not read it back yet',
              )
        }
        body={
          halfDone.kind === 'meanings'
            ? `${t(
                'studio:pages.fit.table.halfDoneBody',
                'Nothing needs running again — the table exists. Set its columns’ meaning in Studio → Schema, or ask an administrator to.',
              )} ${halfDone.message}`
            : t(
                'studio:pages.fit.table.notRereadBody',
                'Nothing needs running again. Refresh the schema from Studio → Data connections, then choose the new table here.',
              )
        }
      />
    );
  }

  const nameError =
    draft.nameProblem === 'taken'
      ? t('studio:pages.fit.table.nameTaken', 'A table with this name already exists.')
      : draft.nameProblem === 'invalid'
        ? t(
            'studio:pages.fit.table.nameInvalid',
            'Use lowercase letters, numbers and underscores, starting with a letter.',
          )
        : null;
  const bound = draft.tables.at(-1);
  const peopleTable = draft.tables.length > 1 ? draft.tables[0] : undefined;

  return (
    <section className="flex flex-col gap-3" data-testid="studio-pages-fit-table">
      <div className="flex flex-col">
        <h4 className="text-body-sm font-semibold text-fg">
          {t('studio:pages.fit.table.title', 'Start a new table for this page')}
        </h4>
        <span className="text-[11.5px] text-fg-muted">
          {t(
            'studio:pages.fit.table.help',
            'Adminium creates a table with everything this page needs. You will see the exact statement before anything runs, and your other tables are not touched.',
          )}
        </span>
      </div>

      <FormField
        label={t('studio:pages.fit.table.name', 'Table name')}
        controlId={nameId}
        {...(nameError === null ? {} : { error: nameError })}
      >
        <Input
          mono
          value={typed ?? bound?.name ?? ''}
          error={nameError !== null}
          onChange={(event) => {
            setPlan(null);
            setTyped(event.target.value);
          }}
          data-testid="studio-pages-fit-table-name"
        />
      </FormField>

      {draft.peopleTargets.length > 0 ? (
        <FormField label={t('studio:pages.fit.table.people', 'Assign each row to someone from')}>
          <Select
            value={draft.peopleTarget ?? NEW_PEOPLE}
            onChange={(event) => {
              setPlan(null);
              setPeople(event.target.value);
            }}
            data-testid="studio-pages-fit-table-people"
          >
            {draft.peopleTargets.map((target) => (
              <option key={target.tableId} value={target.tableId}>
                {target.label ?? target.tableId}
              </option>
            ))}
            <option value={NEW_PEOPLE}>
              {t('studio:pages.fit.table.peopleNew', 'A new table of people')}
            </option>
          </Select>
        </FormField>
      ) : null}

      <ul className="flex flex-col gap-1" data-testid="studio-pages-fit-table-columns">
        {draft.tables.map((table) =>
          table.columns
            .filter((column) => !column.primaryKey)
            .map((column) => (
              <li key={`${table.name}.${column.name}`} className="flex items-baseline gap-2">
                <MonoText className="text-body-sm text-fg">{`${table.name}.${column.name}`}</MonoText>
                <span className="text-[11.5px] text-fg-muted">
                  {column.maxLength === null
                    ? column.logicalType
                    : `${column.logicalType}(${String(column.maxLength)})`}
                </span>
              </li>
            )),
        )}
      </ul>

      {peopleTable !== undefined ? (
        <p className="text-[11.5px] text-fg-muted" data-testid="studio-pages-fit-table-people-new">
          {t(
            'studio:pages.fit.table.peopleCreated',
            'Also creates “{table}”, a small table of the people rows are assigned to.',
            { table: peopleTable.name },
          )}
        </p>
      ) : null}

      {nameError === null && !draft.composes && settled ? (
        <Alert
          role="status"
          tone="warn"
          data-testid="studio-pages-fit-table-no-compose"
          title={t(
            'studio:pages.fit.table.noCompose',
            'A table under this name would not work for this page. Try another name.',
          )}
        />
      ) : null}

      {error !== null ? (
        <Alert
          role="alert"
          tone="danger"
          data-testid="studio-pages-fit-table-error"
          title={t('studio:pages.fit.columns.failed', 'That did not work')}
          body={error}
        />
      ) : null}

      {plan === null ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!settled || !draft.composes || preview.isPending}
            loading={preview.isPending}
            onClick={() => preview.mutate(draft)}
            data-testid="studio-pages-fit-table-plan"
          >
            {t('studio:pages.fit.columns.review', 'Review the change')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="studio-pages-fit-table-plan-review">
          <PlanReview plan={plan} />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={apply.isPending || plan.steps.length === 0 || plan.refusals.length > 0}
              loading={apply.isPending}
              onClick={() => apply.mutate(draft)}
              data-testid="studio-pages-fit-table-confirm"
            >
              {t('studio:pages.fit.table.confirm', 'Create the table')}
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
          </div>
        </div>
      )}
    </section>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app update that needs columns on a table the operator already has — asked,
 * shown, run, THEN updated.
 *
 * The installer refuses to alter an existing table, and that rule stands: it
 * is the operator's table and the operator's decision (48 G8-D6). What used to
 * be missing was the decision itself — the update stopped at `COLUMNS_REQUIRED`
 * and a non-expert had nowhere to go. This dialog is where the
 * decision is made: the columns go through plan 35's doors, so the operator
 * sees the exact statement (`PlanReview`), the `schema.ddl` grant is checked
 * by the server, and nothing runs until they click. Only after the columns
 * exist does the update itself run — schema first, app second, so a
 * walk-away between the two leaves unused columns, never an app reading
 * columns that are not there.
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
} from '@adminium/ui';
import { Columns3 } from 'lucide-react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { studioApi } from '../api.js';
import { writeRepairOverrides } from '../pages/fitApi.js';
import { schemaAuthoringRefusal } from '../pages/schemaAuthoringReason.js';
import { applySchemaEdit, planSchemaEdit } from '../remap/design/api.js';
import { PlanReview } from '../remap/design/PlanReview.js';
import type { SchemaEdit, SchemaPlan } from '../remap/design/types.js';
import type { AppAcquisition } from './appAcquisition.js';
import { ddlPreview } from './appsApi.js';

function messageOf(reason: unknown): string {
  if (reason instanceof ApiError) return reason.message;
  return reason instanceof Error ? reason.message : String(reason);
}

export function UpdateColumnsDialog({ state }: { state: AppAcquisition }) {
  const consent = state.columnsConsent;
  if (consent === null) return null;
  return <ColumnsConsentBody state={state} consent={consent} />;
}

function ColumnsConsentBody({
  state,
  consent,
}: {
  state: AppAcquisition;
  consent: NonNullable<AppAcquisition['columnsConsent']>;
}) {
  const edit = consent.plan.missingColumnsEdit;
  const [plan, setPlan] = useState<SchemaPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // The snapshot the plan is built against (the drift check), the table
  // ids the answer lists are keyed by, and whether DDL is possible at all.
  const schema = useQuery({
    queryKey: ['studio', 'schema', consent.connectionId] as const,
    queryFn: () => studioApi.getSchema(consent.connectionId),
    retry: false,
  });
  const refusal = schemaAuthoringRefusal(schema.data?.schemaAuthoring);

  const schemaEdit = (): SchemaEdit => ({
    baseSnapshotId: schema.data?.snapshotId ?? '',
    renames: { tables: [], columns: [] },
    upsertTables: [],
    addColumns: edit?.addColumns ?? [],
    dropTables: [],
  });

  const preview = useMutation({
    mutationFn: () => planSchemaEdit(consent.connectionId, schemaEdit()),
    onSuccess: (result) => {
      setError(null);
      setPlan(result);
    },
    onError: (reason: unknown) => setError(messageOf(reason)),
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (plan === null) throw new Error('no plan');
      // `acknowledgeRows: true` for `FitColumnSetup`'s reason: the review
      // directly above shows every consequence, row counts included.
      const result = await applySchemaEdit(consent.connectionId, schemaEdit(), plan.checksum, true);
      if (result.status !== 'applied') throw new Error(result.error ?? result.status);
      // The answer lists, after the columns exist. A failure here is NOT a
      // reason to stop: the update needs the columns, and it has them — the
      // lists only turn a free-text box into a select.
      const byTable = new Map<string, { column: string; values: string[] }[]>();
      for (const entry of edit?.values ?? []) {
        byTable.set(entry.table, [...(byTable.get(entry.table) ?? []), entry]);
      }
      for (const [ref, columns] of byTable) {
        const id =
          schema.data?.model.tables.find((table) => table.name === ref)?.id ?? ref;
        try {
          await writeRepairOverrides({ connectionId: consent.connectionId, table: id, columns });
        } catch (reason: unknown) {
          setWarning(messageOf(reason));
        }
      }
    },
    onSuccess: () => {
      void state.confirmColumnsUpdate();
    },
    onError: (reason: unknown) => {
      setPlan(null);
      setError(messageOf(reason));
    },
  });

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) state.cancelColumnsUpdate();
      }}
    >
      <ModalHeader
        icon={<Columns3 />}
        title={t('studio:hostedApps.columns.title', 'Update {app} to v{version}', {
          app: consent.key,
          version: consent.to,
        })}
        subtitle={t(
          'studio:hostedApps.columns.subtitle',
          'This version needs columns that tables in your database do not have yet.',
        )}
        closeLabel={t('studio:hostedApps.update.close', 'Close')}
      />
      <ModalBody>
        <div className="flex flex-col gap-3" data-testid="app-update-columns">
          <p className="text-sm text-fg-muted">
            {t(
              'studio:hostedApps.columns.body',
              'Adminium can add them for you. You will see the exact statement before anything runs, nothing is removed, and the app is updated only once the columns exist.',
            )}
          </p>
          <ul className="flex flex-col gap-1">
            {(edit?.addColumns ?? []).map((entry) => (
              <li key={`${entry.table}.${entry.column.name}`} className="flex items-baseline gap-2">
                <MonoText className="text-sm text-fg">{`${entry.table}.${entry.column.name}`}</MonoText>
                <span className="text-xs text-fg-muted">
                  {entry.column.maxLength === null
                    ? entry.column.logicalType
                    : `${entry.column.logicalType}(${String(entry.column.maxLength)})`}
                </span>
              </li>
            ))}
          </ul>
          {consent.plan.create.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-fg-muted">
                {t('studio:hostedApps.columns.alsoCreates', 'The update also creates these tables:')}
              </p>
              {consent.plan.create.map((table) => (
                <pre
                  key={table.ref}
                  className="overflow-x-auto rounded-xl bg-fg p-4 text-xs leading-relaxed text-surface"
                >
                  <code>{ddlPreview(table)}</code>
                </pre>
              ))}
            </div>
          ) : null}
          {refusal !== null ? (
            <Alert
              tone="info"
              role="status"
              data-testid="app-update-columns-no-ddl"
              title={t('studio:hostedApps.columns.noDdl', 'Adminium cannot add these columns here')}
              body={refusal}
            />
          ) : null}
          {plan !== null ? <PlanReview plan={plan} /> : null}
          {error !== null ? (
            <Alert
              tone="danger"
              role="alert"
              data-testid="app-update-columns-error"
              title={t('studio:hostedApps.columns.failed', 'The columns could not be added')}
              body={error}
            />
          ) : null}
          {warning !== null ? (
            <Alert
              tone="warn"
              role="status"
              title={t(
                'studio:hostedApps.columns.valuesFailed',
                'The columns were added, but their allowed values could not be recorded',
              )}
              body={warning}
            />
          ) : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={state.cancelColumnsUpdate}>
          {t('studio:hostedApps.update.cancel', 'Cancel')}
        </Button>
        {plan === null ? (
          <Button
            disabled={schema.data === undefined || refusal !== null || preview.isPending}
            loading={preview.isPending}
            onClick={() => preview.mutate()}
            data-testid="app-update-columns-review"
          >
            {t('studio:pages.fit.columns.review', 'Review the change')}
          </Button>
        ) : (
          <Button
            disabled={apply.isPending || state.busy || plan.steps.length === 0 || plan.refusals.length > 0}
            loading={apply.isPending}
            onClick={() => apply.mutate()}
            data-testid="app-update-columns-confirm"
          >
            {t('studio:hostedApps.columns.confirm', 'Add the columns and update')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

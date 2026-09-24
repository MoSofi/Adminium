// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PlanningCreateDialog — a planning page's own form, for a new row.
 *
 * A calendar's "Add event" writes a title and a date. On a page whose form was
 * designed — an app's appointments: patient, visit type, clinician, a time
 * picked from the clinician's free slots — that composer wrote a stranger's
 * name into whatever column the calendar titled by, and the server refused
 * it. This opens the page's form instead, in the same dialog a list page's
 * New row opens (`RecordFormDialog`), started from what the calendar knows:
 * the day that was clicked.
 *
 * The save is the data API's, with its undo toast; a refusal that names a
 * field is shown on that field, anything else as a toast.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { CrudFormConfig } from '@adminium/engine/config';
import { RecordFormDialog, fieldMessagesOf, type ColumnFacts, type GridColumnSpec } from '@adminium/widgets';

import type { BoundCrudApi } from '../../api/crud.js';
import type { FormColumnFactReply, FormRelationFactReply } from '../../api/pages.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../toasts.js';

export interface PlanningCreateDialogProps {
  crud: BoundCrudApi;
  /** The page's form document, as the page stores it. */
  form: CrudFormConfig;
  /** What the new row starts with (the clicked day), or null when closed. */
  initialValues: Record<string, unknown> | null;
  onClose: () => void;
  /** The page reply's facts about the table: its writable columns and links. */
  formColumns?: readonly FormColumnFactReply[] | undefined;
  formRelations?: readonly FormRelationFactReply[] | undefined;
  columnFacts?: ColumnFacts | undefined;
  /** The table's own singular name ("Appointment"). */
  entity?: string | null | undefined;
  currency?: string | undefined;
  notifyUndoable: (options: { title: string; undoToken: string | null; onUndone?: () => void }) => void;
}

/** `public.appointments` → `appointment`, as the record drawer frames it. */
function entityFromTable(table: string): string {
  const name = table.split('.').pop() ?? table;
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

export function PlanningCreateDialog({
  crud,
  form,
  initialValues,
  onClose,
  formColumns,
  formRelations,
  columnFacts,
  entity,
  currency,
  notifyUndoable,
}: PlanningCreateDialogProps) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const columns = useMemo(() => (formColumns ?? []).map((fact) => fact.spec as unknown as GridColumnSpec), [formColumns]);
  const named = entity ?? entityFromTable(crud.table);

  // The calendar and every list of the table read the new row.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['data', crud.connectionId, crud.table] });
    void queryClient.invalidateQueries({ queryKey: ['widget-data'] });
  };

  const close = () => {
    setErrors({});
    onClose();
  };

  return (
    <RecordFormDialog
      // A fresh form per opening: the day it starts from changes.
      key={JSON.stringify(initialValues)}
      open={initialValues !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      mode="create"
      entity={named}
      tableName={crud.table}
      formId="planning-create-form"
      document={form}
      columns={columns}
      {...(formRelations === undefined ? {} : { relations: formRelations })}
      {...(columnFacts === undefined ? {} : { facts: columnFacts })}
      {...(initialValues === null ? {} : { initialValues })}
      {...(currency === undefined ? {} : { currency })}
      errors={errors}
      saving={saving}
      lookup={crud.lookup?.bind(crud)}
      availability={crud.availability?.bind(crud)}
      onSubmit={(values, links) => {
        setErrors({});
        setSaving(true);
        (links === undefined ? crud.create(values) : crud.create(values, links))
          .then((result) => {
            close();
            invalidate();
            notifyUndoable({
              title: t('mutation.created', 'Record created'),
              undoToken: result.undoToken,
              onUndone: invalidate,
            });
          })
          .catch((reason: unknown) => {
            const fields = fieldMessagesOf(t, reason);
            if (fields !== null) {
              setErrors(fields);
              return;
            }
            toasts.push({
              variant: 'error',
              title: reason instanceof Error ? reason.message : t('settings.notifications.saveFailed', 'Could not save this change.'),
            });
          })
          .finally(() => setSaving(false));
      }}
    />
  );
}

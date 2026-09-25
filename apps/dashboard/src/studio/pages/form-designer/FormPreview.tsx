// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The draft, as the dialog will really draw it.
 *
 * It is the SAME component the product opens on New row — `RecordFormDialog`
 * rendering this document against these column facts — because a preview drawn
 * by anything else is a second renderer that will disagree with the first. What
 * it does not do is write: the submit closes the preview and nothing is sent.
 */
import { useMemo } from 'react';
import { RecordFormDialog } from '@adminium/widgets';
import { gridColumnSpecSchema, type CrudFormConfig, type FormRelationFact } from '@adminium/engine/config';

import { t } from '../../../i18n/t.js';
import type { FormColumnFactReply } from '../../../api/pages.js';

export function FormPreview({
  open,
  onOpenChange,
  document,
  columns,
  relations,
  entity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: CrudFormConfig;
  columns: readonly FormColumnFactReply[];
  relations: readonly FormRelationFact[];
  entity?: string | undefined;
}) {
  const specs = useMemo(
    () =>
      columns.flatMap((fact) => {
        const parsed = gridColumnSpecSchema.safeParse(fact.spec);
        return parsed.success ? [parsed.data] : [];
      }),
    [columns],
  );
  const facts = useMemo(
    () =>
      Object.fromEntries(
        columns.flatMap((fact) => {
          const name = fact.spec.name;
          return typeof name === 'string'
            ? [[name, { filledBy: fact.filledBy, required: fact.required, ...(fact.requiredWhen === undefined ? {} : { requiredWhen: fact.requiredWhen }), writable: fact.writable }]]
            : [];
        }),
      ),
    [columns],
  );

  if (!open) return null;
  return (
    <RecordFormDialog
      open
      onOpenChange={onOpenChange}
      mode="create"
      entity={entity ?? t('studio:pages.form.previewEntity', 'record')}
      tableName=""
      formId="form-designer-preview"
      document={document}
      columns={specs}
      facts={facts}
      relations={relations}
      // A preview writes nothing: the dialog closes and the draft is untouched.
      onSubmit={() => onOpenChange(false)}
    />
  );
}

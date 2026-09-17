// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The header's save chip (comp 334-337, 1586-1588): *Saving…* · *Unsaved
 * changes* · *All changes saved*, plus *Couldn't save* when a PUT fails. The
 * system's `AutosaveIndicator` pill, driven by the explicit Save (O22) —
 * the same four states, announced politely.
 */
import { AutosaveIndicator } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { SaveStatus } from './useEditorDraft.js';

export function SaveChip({ status, error }: { status: SaveStatus; error: string | null }) {
  return (
    <AutosaveIndicator
      data-testid="invoices-save-chip"
      status={status}
      title={status === 'error' && error !== null ? error : undefined}
      savingLabel={t('invoices:editor.saveState.saving', 'Saving…')}
      savedLabel={t('invoices:editor.saveState.saved', 'All changes saved')}
      dirtyLabel={t('invoices:editor.saveState.dirty', 'Unsaved changes')}
      errorLabel={t('invoices:editor.saveState.error', 'Couldn’t save')}
      className="ms-1 shrink-0"
    />
  );
}

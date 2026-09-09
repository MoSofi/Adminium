// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The header's save chip (comp 256-259, 673-675; 43-report-builder.md
 * Appendix A E3): *Saving…* · *Unsaved changes* · *All changes saved*, plus
 * *Couldn't save* when a PUT fails. The system's `AutosaveIndicator` pill,
 * driven by the explicit Save (D4/O6) — the same four states, announced
 * politely.
 */
import { AutosaveIndicator } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { SaveStatus } from './useEditorDraft.js';

export function SaveChip({ status, error }: { status: SaveStatus; error: string | null }) {
  return (
    <AutosaveIndicator
      data-testid="report-save-chip"
      status={status}
      title={status === 'error' && error !== null ? error : undefined}
      savingLabel={t('reportBuilder:editor.saveState.saving', 'Saving…')}
      savedLabel={t('reportBuilder:editor.saveState.saved', 'All changes saved')}
      dirtyLabel={t('reportBuilder:editor.saveState.dirty', 'Unsaved changes')}
      errorLabel={t('reportBuilder:editor.saveState.error', 'Couldn’t save')}
      className="ms-1 shrink-0"
    />
  );
}

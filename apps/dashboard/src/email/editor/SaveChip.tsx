// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The header's save chip (comp 479-482, Appendix A §E1): *Unsaved changes* ·
 * *Saving…* · *All changes saved*, plus *Couldn't save* when a PUT fails. The
 * system's `AutosaveIndicator` pill, re-labelled for explicit save (D1) — the
 * same four states, announced politely.
 */
import { AutosaveIndicator } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { SaveStatus } from './useEditorDraft.js';

export function SaveChip({ status, error }: { status: SaveStatus; error: string | null }) {
  return (
    <AutosaveIndicator
      data-testid="email-save-chip"
      status={status}
      title={status === 'error' && error !== null ? error : undefined}
      savingLabel={t('email:editor.saveState.saving', 'Saving…')}
      savedLabel={t('email:editor.saveState.saved', 'All changes saved')}
      dirtyLabel={t('email:editor.saveState.dirty', 'Unsaved changes')}
      errorLabel={t('email:editor.saveState.error', 'Couldn’t save')}
      className="ms-1 shrink-0"
    />
  );
}

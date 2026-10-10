// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The bar that says what this person may do on this page.
 *
 * A FACT about their role: they may look, draft and preview here, but not
 * save. It has no button and never hides, because there is nothing they can
 * press to change it. On a stock install this is the ordinary case rather
 * than an edge: only a Super Admin can save on these pages.
 *
 * What the ASSISTANT may do is not here. That is the workspace's own
 * switches, in Settings; a button that is held by one says so itself.
 */
import { Lock } from 'lucide-react';

import { t } from '../../i18n/t.js';

export function ReadOnlyBar() {
  return (
    <div data-testid="assistant-readonly" className="flex shrink-0 items-center gap-2.5 border-b border-border bg-warn-soft px-[18px] py-2.5">
      <Lock className="size-3.5 shrink-0 text-warn" aria-hidden="true" />
      <span className="text-[12px] leading-[1.5] text-fg-muted">{t('assistant:readOnly.noWrite', 'Your role can look, draft and preview here, but not save.')}</span>
    </div>
  );
}

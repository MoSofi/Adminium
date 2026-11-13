// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Read-only" after the page title in the Topbar: once a trial has ended
 * (`TrialStrips.tsx`), and on the pages of a trial database over its size
 * limit (`pages/sizeCapNotice.tsx`). Its word is the deferred `trial` group
 * of `common`: both callers wait for it, and neither is in the entry chunk.
 */
import { Lock } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { t } from '../i18n/t.js';

export function ReadOnlyChip({ testId = 'trial-read-only' }: { testId?: string }): ReactNode {
  return (
    <span className="inline-flex shrink-0 items-center gap-[5px] rounded-full bg-surface-3 px-[9px] py-0.5 text-[11.5px] font-bold text-fg-muted" data-testid={testId}>
      <Lock aria-hidden="true" className="size-3" />
      {t('trial.readOnlyChip', 'Read-only')}
    </span>
  );
}

/** Beside the title in the Topbar: the chip goes where pages put theirs (the slot the Topbar, drawn first, holds). */
export function TitleReadOnlyChip({ testId }: { testId?: string }): ReactNode {
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => setSlot(document.querySelector('[data-part="topbar-title-adornment"]')), []);
  return slot === null ? null : createPortal(<ReadOnlyChip {...(testId === undefined ? {} : { testId })} />, slot);
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The bar that says what this session is allowed to do, and the button that
 * changes it.
 *
 * TWO BARS, ONE ANATOMY. The first is a guardrail: actions are locked when the
 * modal opens, and one click unlocks them for the rest of this open. It is not
 * a preference and it is not remembered — the next open starts locked, because
 * the point is that nothing acts until somebody in front of the screen says so.
 *
 * The second is a FACT about the person's role: they may look, draft and
 * preview here, but not save. That bar has no button and never hides, because
 * there is nothing they can press to change it. On a stock install this is the
 * ordinary case rather than an edge — only a Super Admin can save on these
 * pages.
 */
import { Button } from '@adminium/ui';
import { Lock, Unlock } from 'lucide-react';

import { t } from '../../i18n/t.js';

export interface ReadOnlyBarProps {
  name: string;
  /** Whether this session may save at all. `false` draws the roleless bar. */
  canWrite: boolean;
  onEnable: () => void;
}

export function ReadOnlyBar({ name, canWrite, onEnable }: ReadOnlyBarProps) {
  return (
    <div data-testid="assistant-readonly" data-can-write={canWrite ? '' : undefined} className="flex shrink-0 items-center gap-2.5 border-b border-border bg-warn-soft px-[18px] py-2.5">
      <Lock className="size-3.5 shrink-0 text-warn" aria-hidden="true" />
      <span className="text-[12px] leading-[1.5] text-fg-muted">
        {canWrite
          ? t(
              'assistant:readOnly.note',
              '{name} is read-only right now — it can look, draft and preview, but not save, send or create.',
              { name },
            )
          : t('assistant:readOnly.noWrite', 'Your role can look, draft and preview here, but not save.')}
      </span>
      {canWrite ? (
        <Button
          data-testid="assistant-enable"
          type="button"
          size="sm"
          variant="outline"
          onClick={onEnable}
          className="ms-auto shrink-0 border-warn text-warn hover:bg-warn-soft"
          iconLeft={<Unlock aria-hidden="true" />}
        >
          {t('assistant:readOnly.enable', 'Enable actions')}
        </Button>
      ) : null}
    </div>
  );
}

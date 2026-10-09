// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Today's allowance is used up.
 *
 * A bar across the window, where "no provider" is said, because it is the
 * same kind of fact: nothing can be asked until something changes, and here
 * what changes is the day. The day is the same for everybody (it turns over
 * at one instant); the time is shown in the reader's own.
 */
import { getFormatters } from '@adminium/i18n';
import { Hourglass } from 'lucide-react';

import { getI18nInstance, t } from '../../i18n/t.js';

export interface AllowanceBarProps {
  /** The instant the day's use starts again (epoch ms). */
  resetsAt: number;
}

/** `14:00`, in the reader's language and their own time zone. */
export function resetTime(resetsAt: number): string {
  return getFormatters(getI18nInstance()?.language ?? 'en-US').time(resetsAt);
}

export function AllowanceBar({ resetsAt }: AllowanceBarProps) {
  return (
    <div
      role="status"
      data-testid="assistant-allowance-used"
      className="flex shrink-0 items-center gap-2.5 border-b border-border bg-warn-soft px-[18px] py-2.5"
    >
      <Hourglass className="size-3.5 shrink-0 text-warn" aria-hidden="true" />
      <span className="text-[12px] leading-[1.5] text-fg-muted">
        {t('assistant:budget.usedUp', 'Today’s allowance is used up. It starts again at {time}.', { time: resetTime(resetsAt) })}
      </span>
    </div>
  );
}

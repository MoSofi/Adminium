// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the person asked, in their own words.
 *
 * One per turn, kept for the whole session: the comp draws only the latest,
 * because a comp is one moment — but a session has many turns, and scrolling
 * back to what you asked two turns ago is the ordinary thing to want.
 *
 * A turn that ANSWERED a question rather than typing one shows the labels that
 * were picked, for the same reason the model is sent them: an option key says
 * nothing a turn later.
 */
import { ListFilter, MapPin } from 'lucide-react';

import { t } from '../../i18n/t.js';

export interface UserBubbleProps {
  text: string | null;
  pickedLabels: readonly string[];
  /** The page it was asked on, in a conversation that goes from page to page ("on Customers"). */
  askedOn?: string | undefined;
  /** What "these" meant when it was asked ("3 selected", "Filtered rows"). */
  scope?: string | undefined;
}

export function UserBubble({ text, pickedLabels, askedOn, scope }: UserBubbleProps) {
  const body = text !== null && text !== '' ? text : pickedLabels.join(' · ');
  if (body === '') return null;
  return (
    <div className="flex flex-col items-end gap-[5px]">
      {askedOn === undefined ? null : (
        <span data-testid="assistant-asked-on" className="flex items-center gap-1 text-[10.5px] font-semibold text-fg-subtle">
          <MapPin className="size-[11px]" aria-hidden="true" />
          {askedOn}
        </span>
      )}
      <p
        className="max-w-[560px] rounded-lg rounded-ee-[5px] bg-accent px-[15px] py-3 text-[13px] font-medium leading-[1.6] text-pretty text-accent-fg"
        aria-label={text === null ? t('assistant:ask.picked', 'Picked: {labels}', { labels: body }) : undefined}
      >
        {body}
      </p>
      {scope === undefined ? null : (
        <span data-testid="assistant-asked-scope" className="inline-flex items-center gap-[5px] rounded-[20px] border border-border bg-surface px-[9px] py-[3px] text-[11px] font-semibold text-fg-muted">
          <ListFilter className="size-[11px]" aria-hidden="true" />
          {scope}
        </span>
      )}
    </div>
  );
}

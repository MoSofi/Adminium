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
import { t } from '../../i18n/t.js';

export interface UserBubbleProps {
  text: string | null;
  pickedLabels: readonly string[];
}

export function UserBubble({ text, pickedLabels }: UserBubbleProps) {
  const body = text !== null && text !== '' ? text : pickedLabels.join(' · ');
  if (body === '') return null;
  return (
    <div className="flex justify-end">
      <p
        className="max-w-[560px] rounded-lg rounded-ee-[5px] bg-accent px-[15px] py-3 text-[13px] font-medium leading-[1.6] text-pretty text-accent-fg"
        aria-label={text === null ? t('assistant:ask.picked', 'Picked: {labels}', { labels: body }) : undefined}
      >
        {body}
      </p>
    </div>
  );
}

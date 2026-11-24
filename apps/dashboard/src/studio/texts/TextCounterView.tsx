// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The counter as the console draws it (comp X24): encoding in plain words,
 * characters, segments, the room left in this segment, and "estimate".
 *
 * Numbers stay left to right in their own runs inside an Arabic page. Only a
 * change of the segment count is announced, politely: a screen reader does
 * not read the whole line on every keystroke.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { TEXT_MAX_SEGMENTS, type TextEstimate } from './textCounter.js';

export function encodingWord(encoding: TextEstimate['encoding']): string {
  return encoding === 'gsm-7' ? t('studio:texts.counter.standard', 'Standard') : t('studio:texts.counter.unicode', 'Unicode');
}

function Figure({ value, label, testId }: { value: number; label: string; testId: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <bdi dir="ltr" className="font-mono font-semibold" data-testid={testId}>
        {value}
      </bdi>
      <span className="text-fg-muted">{label}</span>
    </span>
  );
}

export function CounterLine({ estimate, testId = 'texts-counter' }: { estimate: TextEstimate; testId?: string | undefined }): ReactNode {
  const [announced, setAnnounced] = useState('');
  const last = useRef(estimate.segments);
  useEffect(() => {
    if (last.current === estimate.segments) return;
    last.current = estimate.segments;
    setAnnounced(t('studio:texts.counter.announce', '{count, plural, one {# segment} other {# segments}}', { count: estimate.segments }));
  }, [estimate.segments]);
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] ${estimate.tooLong ? 'text-danger' : ''}`} data-testid={testId} data-encoding={estimate.encoding} data-segments={estimate.segments}>
      <Badge tone={estimate.encoding === 'gsm-7' ? 'neutral' : 'info'}>{encodingWord(estimate.encoding)}</Badge>
      <Figure value={estimate.characters} label={t('studio:texts.counter.characters', 'characters')} testId={`${testId}-characters`} />
      <Figure value={estimate.segments} label={t('studio:texts.counter.segments', 'segments')} testId={`${testId}-segments`} />
      <Figure value={estimate.left} label={t('studio:texts.counter.left', 'left in this segment')} testId={`${testId}-left`} />
      <span className="text-fg-subtle">{t('studio:texts.counter.estimate', 'estimate')}</span>
      <span className="sr-only" role="status" aria-live="polite">
        {announced}
      </span>
      {estimate.tooLong ? (
        <span className="basis-full font-semibold" role="alert" data-testid={`${testId}-too-long`}>
          {t('studio:texts.counter.tooLong', 'Too long to send. Shorten it. A text over {count} segments is never sent.', { count: TEXT_MAX_SEGMENTS })}
        </span>
      ) : null}
    </div>
  );
}

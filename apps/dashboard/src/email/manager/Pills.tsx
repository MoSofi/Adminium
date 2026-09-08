// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two pills every card and row carries (comp 1384-1386): the language
 * code — warn-tinted while the variation still needs translation — and the
 * derived status.
 */
import { Badge, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { STATUS_TONE, statusLabel, type DocumentStatus, type LocaleFacts } from './model.js';

export interface LangPillProps {
  facts: LocaleFacts;
  needsTranslation: boolean;
  className?: string | undefined;
}

export function LangPill({ facts, needsTranslation, className }: LangPillProps) {
  const label = needsTranslation
    ? `${facts.native} · ${t('email:needsTranslation', 'Needs translation')}`
    : facts.native;
  return (
    <span
      data-testid="email-lang"
      data-needs-translation={needsTranslation ? '' : undefined}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-extrabold tracking-[.04em]',
        needsTranslation ? 'bg-warn-soft text-warn' : 'bg-surface-3 text-fg-muted',
        className,
      )}
    >
      {facts.code}
    </span>
  );
}

export function DocumentStatusPill({ status }: { status: DocumentStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-testid="email-status" data-status={status} className="shrink-0">
      {statusLabel(status)}
    </Badge>
  );
}

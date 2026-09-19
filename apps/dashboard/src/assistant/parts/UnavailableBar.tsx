// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The bar for a modal that cannot work here, and the one thing that would fix
 * it.
 *
 * The comp never drew this state — a comp shows a working product. It matters
 * more than most states do: an operator who opens the assistant on an instance
 * with no provider configured must be told which of the three reasons it is,
 * and whether fixing it is theirs to do.
 *
 * THE LINK IS CONDITIONAL, and that is the point. Only a session that may
 * reach Settings → AI is offered it; everybody else is told to ask an
 * administrator, because a link that 403s is worse than a sentence.
 */
import { Button } from '@adminium/ui';
import { TriangleAlert } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { AssistantUnavailableReason } from '../api.js';

export interface UnavailableBarProps {
  reason: AssistantUnavailableReason | null;
  name: string;
  /** Whether this session holds the grant the Settings → AI page needs. */
  canConfigure: boolean;
  onOpenSettings: () => void;
}

function sentenceFor(reason: AssistantUnavailableReason | null, name: string): string {
  switch (reason) {
    case 'network-disabled':
      return t('assistant:unavailable.network', 'Outbound network features are off on this instance.');
    case 'forbidden':
      return t('assistant:unavailable.forbidden', 'You do not have permission to use {name}.', { name });
    default:
      return t('assistant:unavailable.noProvider', 'No AI provider is configured yet.');
  }
}

export function UnavailableBar({ reason, name, canConfigure, onOpenSettings }: UnavailableBarProps) {
  // Nothing an operator can CONFIGURE fixes "your role may not use this", so
  // that reason neither offers the link nor suggests asking for one — the
  // person who could help is the one who grants roles, not the one who sets
  // up a provider.
  const configurable = reason !== 'forbidden';
  const offerSettings = canConfigure && configurable;
  return (
    <div data-testid="assistant-unavailable" data-reason={reason ?? 'no-provider'} className="flex shrink-0 items-center gap-2.5 border-b border-border bg-warn-soft px-[18px] py-2.5">
      <TriangleAlert className="size-3.5 shrink-0 text-warn" aria-hidden="true" />
      <span className="text-[12px] leading-[1.5] text-fg-muted">
        {sentenceFor(reason, name)}
        {configurable && !offerSettings
          ? ` ${t('assistant:unavailable.askAdmin', 'Ask an administrator to set one up.')}`
          : null}
      </span>
      {offerSettings ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onOpenSettings}
          className="ms-auto shrink-0 border-warn text-warn hover:bg-warn-soft"
        >
          {t('assistant:unavailable.settings', 'Open Settings → AI')}
        </Button>
      ) : null}
    </div>
  );
}

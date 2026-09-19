// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a person can do with a draft, and the two reasons a button might not
 * let them.
 *
 * THE ACTIONS ARE FIXED. Three at most, in this page's own order, decided by
 * the product — not offered by the model. A model that could name its own
 * buttons could name one that writes.
 *
 * TWO DIFFERENT LOCKS, and the difference is worth the two sentences. Actions
 * are locked while the guardrail is on, and *Enable actions* clears that for
 * the rest of this open. A role that cannot save on this page is a different
 * matter: that lock never clears, so its title says what is true rather than
 * inviting a click that would 403.
 *
 * An action that WRITES NOTHING — preview another sample, run the full
 * preview, put a draft on an editor's screen — stays available under both,
 * because neither reason applies to it.
 */
import { Button, cn } from '@adminium/ui';
import { Lock, ScrollText } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { AssistantActionSpec } from '../contexts.js';
import { assistantIcon } from '../icons.js';

export interface ActionsRowProps {
  actions: readonly AssistantActionSpec[];
  /** The guardrail: false until the operator enables actions in this open. */
  enabled: boolean;
  /** Whether this session may save on this page at all. */
  canWrite: boolean;
  name: string;
  busy: boolean;
  onRun: (action: AssistantActionSpec) => void;
}

export function ActionsRow({ actions, enabled, canWrite, name, busy, onRun }: ActionsRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-[9px] border-t border-border bg-surface-2 px-4 py-[13px]">
      <span className="me-auto flex items-center gap-[7px] text-[11px] text-fg-muted">
        <ScrollText className="size-3" aria-hidden="true" />
        {t('assistant:audit.note', 'Every action is logged to Audit Log')}
      </span>
      {actions.map((action) => {
        const needsGrant = action.writes && !canWrite;
        const needsEnable = action.writes && !enabled;
        const locked = needsGrant || needsEnable;
        const Icon = locked ? Lock : assistantIcon(action.icon);
        const title = needsGrant
          ? t('assistant:readOnly.noWriteTitle', 'Your role cannot do this here')
          : needsEnable
            ? t('assistant:readOnly.lockedTitle', 'Enable actions to let {name} do this', { name })
            : action.label;
        return (
          <Button
            data-testid="assistant-action"
            data-action={action.id}
            key={action.id}
            type="button"
            size="sm"
            variant={action.primary && !locked ? 'primary' : 'secondary'}
            title={title}
            disabled={locked || busy}
            onClick={() => {
              onRun(action);
            }}
            className={cn(locked && 'grayscale opacity-45')}
            {...(Icon === null ? {} : { iconLeft: <Icon aria-hidden="true" /> })}
          >
            {action.label}
          </Button>
        );
      })}
    </div>
  );
}

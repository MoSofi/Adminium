// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The fixed card a Designer turn on the operator's AI ends with, in place of
 * the Designer's own words: the request needs customer-facing screens, which
 * that connection does not build, or the AI included with the installation is
 * used up. The server says which (`operator-ai`); every word here is the
 * page's own, never the model's.
 *
 * "Add an AI key" opens Settings → AI, where the person adds their own key to
 * a provider's public API; with it, everything is available again. "Upgrade"
 * leaves for the operator's page in this tab, only where the operator set one.
 *
 * Loaded on its own, the first time a turn ends this way: no other session
 * pays for it.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CircleArrowUp, KeyRound } from 'lucide-react';

import { systemInfoQuery } from '../../app/capabilities.js';
import { t } from '../../i18n/t.js';
import type { OperatorAiCard as Which } from '../api.js';

export const AI_SETTINGS_PATH = '/studio/settings/ai';

const BUTTON = 'inline-flex items-center gap-[7px] rounded-[10px] text-[13px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5';

/** The card's sentence: what happened, then what the person can do, with or without Upgrade. */
export function operatorAiText(which: Which, upgrade: boolean): string {
  const head = which === 'used-up' ? t('designer:operatorAi.usedUp', 'The AI included with this trial is used up.') : t('designer:operatorAi.scope', 'Building customer-facing screens needs your own AI key.');
  const tail = upgrade ? t('designer:operatorAi.keyOrUpgrade', 'Add your own AI key to continue, or Upgrade.') : t('designer:operatorAi.key', 'Add your own AI key to continue.');
  return `${head} ${tail}`;
}

export function OperatorAiCard({ which }: { which: Which }): ReactNode {
  const navigate = useNavigate();
  const upgradeUrl = useQuery(systemInfoQuery()).data?.trial?.upgradeUrl ?? null;
  return (
    <div
      role="group"
      aria-label={t('designer:operatorAi.label', 'AI key needed')}
      data-testid="operator-ai-card"
      data-card={which}
      className="flex flex-col gap-3.5 rounded-[14px] border border-border-strong bg-surface p-4 shadow-md"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent [&_svg]:size-4">
          <KeyRound />
        </span>
        <p className="m-0 text-[13.5px] font-semibold leading-normal text-pretty">{operatorAiText(which, upgradeUrl !== null)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void navigate({ to: AI_SETTINGS_PATH })} className={`${BUTTON} border-0 bg-accent px-[15px] py-[9px] text-accent-fg hover:bg-accent-hover`}>
          <KeyRound aria-hidden="true" />
          {t('designer:operatorAi.addKey', 'Add an AI key')}
        </button>
        {upgradeUrl === null ? null : (
          <a href={upgradeUrl} className={`${BUTTON} border border-border-strong bg-surface px-3.5 py-2 text-fg hover:bg-surface-2`} data-testid="operator-ai-upgrade">
            {t('designer:operatorAi.upgrade', 'Upgrade')}
            <CircleArrowUp aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

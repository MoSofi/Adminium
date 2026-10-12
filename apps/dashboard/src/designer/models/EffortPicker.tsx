// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How hard the picked model is asked to work: a menu beside the model's own,
 * with the levels that model takes and nothing else. A model that takes none
 * shows no menu at all.
 */
import type { ReactNode } from 'react';
import { ChevronDown, Gauge } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { DesignerEffort } from '../api.js';
import type { DesignerModelState } from './ModelButton.js';

const DEFAULT = 'default';

/** A level's name. Written out one by one: a key built from a value is one no check can find. */
export function effortLabel(level: DesignerEffort | null): string {
  if (level === 'low') return t('designer:effort.low', 'Low');
  if (level === 'medium') return t('designer:effort.medium', 'Medium');
  if (level === 'high') return t('designer:effort.high', 'High');
  if (level === 'xhigh') return t('designer:effort.xhigh', 'Extra high');
  if (level === 'max') return t('designer:effort.max', 'Max');
  return t('designer:effort.default', 'Default');
}

function effortLine(level: DesignerEffort | null): string {
  if (level === 'low') return t('designer:effort.lowLine', 'Fastest and cheapest');
  if (level === 'medium') return t('designer:effort.mediumLine', 'A balance of speed and care');
  if (level === 'high') return t('designer:effort.highLine', 'More thought on each step');
  if (level === 'xhigh') return t('designer:effort.xhighLine', 'For hard builds; slower, costs more');
  if (level === 'max') return t('designer:effort.maxLine', 'The most thought; slowest, costs the most');
  return t('designer:effort.defaultLine', 'What the model does by itself');
}

export function EffortPicker({ model }: { model: DesignerModelState }): ReactNode {
  if (model.loading || model.picked === null || model.efforts.length === 0) return null;
  const label = effortLabel(model.effort);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t('designer:effort.label', 'Effort: {effort}', { effort: label })}
        className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-bold text-fg-muted hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg"
      >
        <Gauge aria-hidden="true" className="size-3.5 text-fg-subtle" />
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[268px]" aria-label={t('designer:effort.menu', 'Effort')}>
        <DropdownMenuRadioGroup value={model.effort ?? DEFAULT} onValueChange={(value) => model.pickEffort(value === DEFAULT ? null : (value as DesignerEffort))}>
          <DropdownMenuRadioItem value={DEFAULT} description={effortLine(null)}>
            {effortLabel(null)}
          </DropdownMenuRadioItem>
          {model.efforts.map((level) => (
            <DropdownMenuRadioItem key={level} value={level} description={effortLine(level)}>
              {effortLabel(level)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

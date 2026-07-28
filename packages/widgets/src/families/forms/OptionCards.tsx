/**
 * `option-cards` (annex §10) — single-select card grid: icon tile, title,
 * description; the selected card gets a 2px accent border + accent-soft bg.
 * Powers deploy targets, data sources, templates, import sources and plan
 * selection. Evidence: Adminium Console, Onboarding, Import Wizard, Billing.
 *
 * Wraps @adminium/ui's `RadioGroup` + `RadioCard`, which own the selected
 * styling, the full-card click target and the arrow-key roving selection. The
 * cards MUST live inside a `RadioGroup` — that is what makes ←→ move between
 * them instead of Tab, which is the whole point of a radio card set.
 */

import { IconTile, RadioCard, RadioGroup } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { formIcon } from './forms-icons.js';
import { bindingTargetOf } from './forms-state.js';
import { recordRowsOf, stringField } from './forms-lib.js';
import { optionCardsConfigSchema, optionCardsDemoData } from './forms-config.js';
import type { OptionCardsConfig } from './forms-config.js';
import { useState } from 'react';
import type { WidgetProps } from '../../registry/types.js';

export { optionCardsConfigSchema, optionCardsDemoData };
export type { OptionCardsConfig };

export interface OptionCard {
  key: string;
  label: string;
  description?: string | undefined;
  icon?: string | undefined;
}

/** Project the §3 `record-list` payload onto option cards. */
export function optionsOf(data: unknown, config: OptionCardsConfig): OptionCard[] {
  const rows = recordRowsOf(data);
  const out: OptionCard[] = [];
  for (const [index, row] of rows.entries()) {
    const label = stringField(row, config.labelField);
    if (label === undefined) continue;
    out.push({
      key: stringField(row, config.keyField) ?? `option-${index}`,
      label,
      description: stringField(row, config.descField),
      icon: stringField(row, config.iconField),
    });
  }
  return out;
}

/**
 * Explicit column classes — Tailwind scans source statically, so a computed
 * `grid-cols-${n}` would emit no CSS. Keyed by the schema's 1–4 range.
 */
const COLUMN_CLASSES: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

export function OptionCardsWidget({ config, data, onEvent }: WidgetProps<OptionCardsConfig>) {
  const t = useMaybeT();
  const options = optionsOf(data, config);
  const [value, setValue] = useState<string>(config.value ?? '');
  const target = bindingTargetOf(config.binding);

  if (options.length === 0) return null;

  return (
    <div className="h-full overflow-auto px-4 pb-4" data-widget="option-cards" data-testid={config.testId}>
      <RadioGroup
        aria-label={config.a11yLabel ?? config.title ?? t('ui:widgets.forms.optionCards.a11yLabel', 'Choose an option')}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          if (target === null) return;
          onEvent({
            type: 'mutate',
            intent: 'update',
            connectionId: target.connectionId,
            table: target.table,
            values: { [config.keyField]: next },
          });
        }}
        className={`grid gap-3 ${COLUMN_CLASSES[config.columns] ?? COLUMN_CLASSES[2]}`}
      >
        {options.map((option) => {
          const glyph = formIcon(option.icon);
          return (
            <RadioCard
              key={option.key}
              value={option.key}
              data-part="option-card"
              data-key={option.key}
              title={option.label}
              {...(option.description === undefined ? {} : { description: option.description })}
              {...(glyph === undefined
                ? {}
                : {
                    icon:
                      config.iconStyle === 'tile' ? (
                        <IconTile size="md" tone="accent" icon={glyph} />
                      ) : (
                        <span className="text-fg-muted [&_svg]:size-5">{glyph}</span>
                      ),
                  })}
            />
          );
        })}
      </RadioGroup>
    </div>
  );
}

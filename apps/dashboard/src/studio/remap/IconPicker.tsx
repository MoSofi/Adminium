// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lucide subset grid for the table icon override (`table.label.icon`,
 * 07-meta-store.md §3.15). Kebab-case names, resolved via `lucideByName` so
 * an unknown value can never crash the picker.
 */
import { cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';

/** Curated subset — same vocabulary the generator emits for nav icons. */
export const ICON_SUBSET: readonly string[] = [
  'table',
  'users',
  'user-round',
  'building-2',
  'shopping-cart',
  'package',
  'truck',
  'credit-card',
  'receipt',
  'file-text',
  'folder',
  'calendar',
  'clock',
  'tag',
  'star',
  'heart',
  'mail',
  'message-square',
  'map-pin',
  'globe',
  'database',
  'layers',
  'chart-column',
  'book-open',
];

export interface IconPickerProps {
  /** Selected kebab-case icon name (null = no override). */
  value: string | null;
  onChange: (icon: string | null) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  return (
    <div
      role="group"
      aria-label={t('studio.remap.table.iconPicker', 'Table icon')}
      className="grid grid-cols-8 gap-1"
    >
      {ICON_SUBSET.map((name) => {
        const Icon = lucideByName(name);
        const selected = value === name;
        return (
          <button
            key={name}
            type="button"
            title={name}
            aria-label={name}
            aria-pressed={selected}
            className={cn(
              'flex items-center justify-center rounded-md border p-1.5 text-fg-muted transition-colors',
              selected
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border hover:bg-surface-2 hover:text-fg',
            )}
            onClick={() => onChange(selected ? null : name)}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

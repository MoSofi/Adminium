// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chips over a LIST-VALUED column (D19, comp 253–256, 485–488).
 *
 * ─── What a list-valued column is ──────────────────────────────────────────
 *
 * A `json` column holding an array, or a Postgres `text[]`. Items are strings,
 * at most fifty, and duplicates are refused — by the control, so the person
 * sees it happen, and again by the write path, because a control cannot be the
 * only thing standing between a typo and the database.
 *
 * `itemFormat` is the field's own rule: with `email`, a token that is not an
 * address stays in the input rather than becoming a chip nobody will notice is
 * wrong (the comp's invite box, 485–488).
 */
import { ChipInput } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import type { ControlProps } from './types.js';

/** Fifty is the ceiling; past it a list is a table (D19). */
export const MAX_CHIPS = 50;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.trim() !== '') {
    // A `json` column round-trips as text through an untouched edit field.
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* not JSON: one value, one chip */
    }
    return [value];
  }
  return [];
}

export function ChipsControl(props: ControlProps) {
  const t = useMaybeT();
  const items = asList(props.value);
  const format = props.field?.itemFormat;
  return (
    <ChipInput
      {...(props.id === undefined ? {} : { id: props.id })}
      {...(props['aria-describedby'] === undefined ? {} : { 'aria-describedby': props['aria-describedby'] })}
      {...(props['aria-invalid'] === undefined ? {} : { 'aria-invalid': props['aria-invalid'] })}
      {...(props.error === true ? { error: true as const } : {})}
      {...(props.disabled === true ? { disabled: true } : {})}
      {...(props.field?.placeholder === undefined ? {} : { placeholder: props.field.placeholder })}
      // Accent for a short, meaningful set; neutral for one the person is
      // assembling. The format rule is the tell: an invite box is a list.
      tone={format === undefined ? 'accent' : 'neutral'}
      value={items}
      validate={(chip) => {
        if (items.length >= MAX_CHIPS) return false;
        if (format === 'email') return EMAIL.test(chip);
        if (format === 'url') return URL.canParse(chip);
        return chip.trim() !== '';
      }}
      removeLabel={(chip) => t('ui:formDialog.control.removeChip', 'Remove {value}', { value: chip })}
      onValueChange={(next) => props.onChange(next.slice(0, MAX_CHIPS))}
    />
  );
}

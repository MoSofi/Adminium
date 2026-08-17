// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page-gutter control on the New / Edit page screens.
 *
 * Four states, matching `PageSurface`'s choices plus "leave it alone":
 *
 * - **Default**  — no stored value. The page follows its template's own gutter
 *   (`pages/surfaceDefaults.ts`), so retuning that default later reaches every
 *   page that never opted out. This is what an untouched page has, and what
 *   picking it again restores.
 * - **None**     — flush to the main section on all four sides.
 * - **Standard** — the shared 28 × 24 gutter, scaled by the density axis.
 * - **Custom**   — an explicit x/y pair in pixels.
 *
 * The custom pair is held in local state while "Custom" is selected so that
 * clearing a number input does not immediately publish `0` and yank the page
 * layout; an empty box reads as the axis's standard value until it is filled.
 */
import { useState } from 'react';
import { FormField, Input, Select } from '@adminium/ui';
import type { PagePaddingConfig } from '@adminium/engine/config';

import { t } from '../../i18n/t.js';

/** Mirrors the comfortable-density `--main-pad`, so "Custom" opens on today's value. */
const STANDARD_PAIR = { x: 28, y: 24 } as const;

type Mode = 'default' | 'none' | 'standard' | 'custom';

function modeOf(value: PagePaddingConfig | null): Mode {
  if (value === null) return 'default';
  if (value === 'none') return 'none';
  if (value === 'standard') return 'standard';
  return 'custom';
}

export interface PaddingFieldProps {
  /** `null` = no override stored: follow the template default. */
  value: PagePaddingConfig | null;
  onChange: (next: PagePaddingConfig | null) => void;
}

export function PaddingField({ value, onChange }: PaddingFieldProps) {
  const mode = modeOf(value);
  const [pair, setPair] = useState<{ x: number; y: number }>(
    typeof value === 'object' && value !== null ? value : STANDARD_PAIR,
  );

  const selectMode = (next: Mode) => {
    if (next === 'default') onChange(null);
    else if (next === 'none') onChange('none');
    else if (next === 'standard') onChange('standard');
    else onChange(pair);
  };

  const setAxis = (axis: 'x' | 'y', raw: string) => {
    // An empty box is "not decided yet", not zero — fall back to the standard
    // value for that axis so the page never flashes flush-to-edge mid-typing.
    const parsed = raw.trim() === '' ? STANDARD_PAIR[axis] : Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.min(200, Math.max(0, parsed));
    const next = { ...pair, [axis]: clamped };
    setPair(next);
    onChange(next);
  };

  return (
    <>
      <FormField label={t('studioPages.field.padding', 'Page padding')}>
        <Select
          value={mode}
          onChange={(event) => selectMode(event.target.value as Mode)}
          data-testid="studio-pages-padding"
        >
          <option value="default">
            {t('studioPages.padding.default', 'Default for this template')}
          </option>
          <option value="none">{t('studioPages.padding.none', 'None')}</option>
          <option value="standard">{t('studioPages.padding.standard', 'Standard (28 × 24)')}</option>
          <option value="custom">{t('studioPages.padding.custom', 'Custom…')}</option>
        </Select>
      </FormField>

      {mode === 'custom' ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('studioPages.padding.x', 'Sides (px)')}>
            <Input
              type="number"
              min={0}
              max={200}
              value={String(pair.x)}
              onChange={(event) => setAxis('x', event.target.value)}
              data-testid="studio-pages-padding-x"
            />
          </FormField>
          <FormField label={t('studioPages.padding.y', 'Top and bottom (px)')}>
            <Input
              type="number"
              min={0}
              max={200}
              value={String(pair.y)}
              onChange={(event) => setAxis('y', event.target.value)}
              data-testid="studio-pages-padding-y"
            />
          </FormField>
        </div>
      ) : null}
    </>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The four looks an app's own screens can take, in the page's words, each
 * with a swatch of its page, its ink and its accent. The colours are the ones
 * the server writes into a side's theme.css (`project/apps/look.ts`): a
 * swatch that showed another colour would promise a look that does not come.
 */
import type { ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import type { LookDirection } from '../api.js';

export const LOOK_SWATCH: Record<LookDirection, { bg: string; ink: string; accent: string }> = {
  clean: { bg: '#f6f7f9', ink: '#14171f', accent: '#2f5bea' },
  warm: { bg: '#faf4ea', ink: '#2c1d13', accent: '#a04e26' },
  bold: { bg: '#ffffff', ink: '#0b0b0f', accent: '#d11a33' },
  calm: { bg: '#f2f6f4', ink: '#1e2a26', accent: '#36705f' },
};

export function lookName(direction: string): string {
  switch (direction) {
    case 'clean':
      return t('designer:look.clean', 'Clean');
    case 'warm':
      return t('designer:look.warm', 'Warm');
    case 'bold':
      return t('designer:look.bold', 'Bold');
    case 'calm':
      return t('designer:look.calm', 'Calm');
    case 'surprise':
      return t('designer:look.surprise', 'Surprise me');
    default:
      return direction;
  }
}

export function lookLine(direction: LookDirection): string {
  switch (direction) {
    case 'clean':
      return t('designer:look.cleanLine', 'Neutral greys, a clear blue, crisp corners');
    case 'warm':
      return t('designer:look.warmLine', 'Cream and brown, a serif for headings, round corners');
    case 'bold':
      return t('designer:look.boldLine', 'Black on white, one strong colour, heavy type');
    case 'calm':
      return t('designer:look.calmLine', 'Soft green-grey, light type, room to breathe');
  }
}

/** A small picture of a look: its page, a line of its ink, a dot of its accent. */
export function LookSwatch({ direction }: { direction: LookDirection }): ReactNode {
  const swatch = LOOK_SWATCH[direction];
  // The colours travel as custom properties: they are the look's own, not the dashboard's tokens.
  return (
    <span
      aria-hidden="true"
      style={{ '--look-bg': swatch.bg, '--look-ink': swatch.ink, '--look-accent': swatch.accent }}
      className="flex h-[30px] w-[42px] shrink-0 flex-col justify-center gap-[3px] rounded-md border border-border-strong bg-[var(--look-bg)] px-[6px]"
    >
      <span className="block h-[4px] w-[20px] rounded-full bg-[var(--look-ink)]" />
      <span className="flex items-center gap-[3px]">
        <span className="block h-[7px] w-[16px] rounded-[3px] bg-[var(--look-accent)]" />
        <span className="block h-[3px] w-[8px] rounded-full bg-[var(--look-ink)] opacity-40" />
      </span>
    </span>
  );
}

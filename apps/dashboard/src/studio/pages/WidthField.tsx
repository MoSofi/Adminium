// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The content-column control on the New / Edit page screens, sitting beside
 * {@link PaddingField} in the Appearance card.
 *
 * Same four-state shape as padding minus the custom pair: "Default for this
 * template" is a stored `null`/absent, and every other choice is one of the
 * named container tokens. There is no free-length option ON PURPOSE — the caps
 * are design-system tokens, and a page pinned to an arbitrary 1017px is the
 * thing `PageSurface`'s own docblock warns about.
 *
 * The px figures are IN THE LABELS because "narrow" and "content" mean nothing
 * to someone picking from a select; they are the comfortable-density values of
 * the container tokens (`packages/tokens/src/tailwind.css`) and are the only
 * part of this file that has to be kept in step with them.
 */
import { FormField, Select } from '@adminium/ui';
import type { PageWidthConfig } from '@adminium/engine/config';

import { t } from '../../i18n/t.js';

/** Order is narrow → wide, so the select reads as a scale rather than a set. */
const WIDTHS: readonly { value: PageWidthConfig; key: string; fallback: string }[] = [
  { value: 'narrow', key: 'studioPages.width.narrow', fallback: 'Narrow (720px)' },
  { value: 'content', key: 'studioPages.width.content', fallback: 'Content (900px)' },
  { value: 'page', key: 'studioPages.width.page', fallback: 'Page (1080px)' },
  { value: 'dash', key: 'studioPages.width.dash', fallback: 'Dashboard (1320px)' },
  { value: 'wide', key: 'studioPages.width.wide', fallback: 'Wide (1800px)' },
  { value: 'full', key: 'studioPages.width.full', fallback: 'Full width (no limit)' },
];

export interface WidthFieldProps {
  /** `null` = no override stored: follow the template default. */
  value: PageWidthConfig | null;
  onChange: (next: PageWidthConfig | null) => void;
}

export function WidthField({ value, onChange }: WidthFieldProps) {
  return (
    <FormField
      label={t('studioPages.field.width', 'Content width')}
      helper={t(
        'studioPages.field.widthHint',
        'How wide the page’s content column may grow on a large screen.',
      )}
    >
      <Select
        value={value ?? 'default'}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === 'default' ? null : (next as PageWidthConfig));
        }}
        data-testid="studio-pages-width"
      >
        <option value="default">
          {t('studioPages.width.default', 'Default for this template')}
        </option>
        {WIDTHS.map((w) => (
          <option key={w.value} value={w.value}>
            {t(w.key, w.fallback)}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared preference-axis controls (10-i18n-theming.md §7.3/§7.4): theme and
 * density segmented controls, the accent swatch row, and the locale select
 * with native names from the @adminium/i18n registry. Used by both the
 * per-user Preferences page (/account/preferences) and the super-admin
 * Global Defaults page (/settings/defaults).
 */
import type { ReactNode } from 'react';
import { availableLocales, dirForLocale, localeEntry, type LocaleId } from '@adminium/i18n/registry';
import { isReviewed } from '@adminium/i18n';
import { ACCENTS, type Accent, type Density, type ThemePref } from '@adminium/tokens';
import { SegmentedControl, Select, cn } from '@adminium/ui';

import { t } from '../i18n/t.js';

export const THEME_VALUES: readonly ThemePref[] = ['light', 'dark', 'system'];
export const DENSITY_VALUES: readonly Density[] = ['comfortable', 'compact'];
export const ACCENT_VALUES = Object.keys(ACCENTS) as readonly Accent[];

export function themeLabel(value: ThemePref): string {
  if (value === 'light') return t('prefs.theme.light', 'Light');
  if (value === 'dark') return t('prefs.theme.dark', 'Dark');
  return t('prefs.theme.system', 'System');
}

export function densityLabel(value: Density): string {
  return value === 'compact'
    ? t('prefs.density.compact', 'Compact')
    : t('prefs.density.comfortable', 'Comfortable');
}

/**
 * Accent → literal bundle key (10-i18n-theming.md §2.5). `satisfies` — not a
 * type annotation — so a ninth palette in `ACCENTS` is a compile error here
 * rather than a swatch whose aria-label renders as `prefs.accent.<new>`.
 */
const ACCENT_LABEL_KEY = {
  indigo: 'prefs.accent.indigo',
  blue: 'prefs.accent.blue',
  teal: 'prefs.accent.teal',
  violet: 'prefs.accent.violet',
  rose: 'prefs.accent.rose',
  red: 'prefs.accent.red',
  orange: 'prefs.accent.orange',
  black: 'prefs.accent.black',
} as const satisfies Record<Accent, string>;

export function accentLabel(value: Accent): string {
  return t(ACCENT_LABEL_KEY[value], value.charAt(0).toUpperCase() + value.slice(1));
}

export function localeLabel(value: LocaleId): string {
  return localeEntry(value).native;
}

/**
 * The locales a picker may offer (23 §3.1).
 *
 * `availableLocales()` is the runtime registry — compiled defaults merged
 * under the admin's `adminium_locales` rows — filtered to `enabled`. The
 * currently-selected locale is always included even when it has been
 * disabled: dropping it would silently reassign the user on their next save,
 * and an admin disabling a language should not rewrite anyone's preference
 * behind their back.
 */
function pickerLocales(selected: LocaleId): readonly { id: string; native: string; english: string }[] {
  const list = availableLocales();
  if (list.some((l) => l.id === selected)) return list;
  const { id, native, english } = localeEntry(selected);
  return [...list, { id, native, english }];
}

export function ThemeControl(props: {
  value: ThemePref;
  onChange: (value: ThemePref) => void;
  label: string;
}): ReactNode {
  return (
    <SegmentedControl
      aria-label={props.label}
      value={props.value}
      options={THEME_VALUES.map((value) => ({ value, label: themeLabel(value) }))}
      onValueChange={(value) => props.onChange(value as ThemePref)}
    />
  );
}

export function DensityControl(props: {
  value: Density;
  onChange: (value: Density) => void;
  label: string;
}): ReactNode {
  return (
    <SegmentedControl
      aria-label={props.label}
      value={props.value}
      options={DENSITY_VALUES.map((value) => ({ value, label: densityLabel(value) }))}
      onValueChange={(value) => props.onChange(value as Density)}
    />
  );
}

/**
 * Swatch row (§7.3 "SwatchPicker" comp gap): radiogroup of the 8 palettes.
 *
 * Each swatch must preview the accent it OFFERS, in the theme currently on screen — and the two
 * accent ramps differ (accents.css: `black` is #111111 in light, #c9c9d4 in dark), so painting
 * the JS constant `ACCENTS[accent]` made the preview lie in dark. It cannot read `--accent`
 * either: that is the ACTIVE accent, inherited from <html>. Stamping `data-accent` on the button
 * re-declares `--accent-light`/`--accent-dark` for that one element straight out of accents.css,
 * and the light/dark background pair below picks the same half the theme picks. No JS copy of
 * the palette is involved, so the swatch cannot drift from the tokens.
 */
export function AccentControl(props: {
  value: Accent;
  onChange: (value: Accent) => void;
  label: string;
}): ReactNode {
  return (
    <div role="radiogroup" aria-label={props.label} className="flex items-center gap-2">
      {ACCENT_VALUES.map((accent) => {
        const selected = accent === props.value;
        return (
          <button
            key={accent}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={accentLabel(accent)}
            data-accent={accent}
            onClick={() => props.onChange(accent)}
            className={cn(
              'size-6 rounded-full border border-border transition-shadow',
              'bg-[var(--accent-light)] dark:bg-[var(--accent-dark)]',
              selected && 'ring-2 ring-fg ring-offset-2 ring-offset-surface',
            )}
          />
        );
      })}
    </div>
  );
}

export function LocaleControl(props: {
  value: LocaleId;
  onChange: (value: LocaleId) => void;
  label: string;
}): ReactNode {
  return (
    <div className="max-w-64">
      <Select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as LocaleId)}
      >
        {pickerLocales(props.value).map((locale) => (
          <option key={locale.id} value={locale.id}>
            {locale.id === 'en_US' ? locale.native : `${locale.native} — ${locale.english}`}
          </option>
        ))}
      </Select>
      {isReviewed(props.value) ? null : (
        <p className="mt-1 text-body-sm text-fg-muted">
          {t(
            'prefs.locale.communityDraft',
            'This translation is a community draft — it has not been reviewed by a native speaker yet.',
          )}
        </p>
      )}
      {dirForLocale(props.value) === 'rtl' ? (
        <p className="mt-1 text-body-sm text-fg-muted">
          {t('prefs.locale.directionNote', 'Text direction: right to left (set automatically by the language)')}
        </p>
      ) : null}
    </div>
  );
}

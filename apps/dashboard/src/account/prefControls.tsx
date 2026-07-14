/**
 * Shared preference-axis controls (10-i18n-theming.md §7.3/§7.4): theme and
 * density segmented controls, the accent swatch row, and the locale select
 * with native names from the @adminium/i18n registry. Used by both the
 * per-user Preferences page (/account/preferences) and the super-admin
 * Global Defaults page (/settings/defaults).
 */
import type { ReactNode } from 'react';
import { LOCALES, dirForLocale, type LocaleId } from '@adminium/i18n/registry';
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

export function accentLabel(value: Accent): string {
  return t(`prefs.accent.${value}`, value.charAt(0).toUpperCase() + value.slice(1));
}

export function localeLabel(value: LocaleId): string {
  const entry = LOCALES.find((l) => l.id === value);
  return entry?.native ?? value;
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

/** Swatch row (§7.3 "SwatchPicker" comp gap): radiogroup of the 8 palettes. */
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
            onClick={() => props.onChange(accent)}
            className={cn(
              'size-6 rounded-full border border-border bg-[var(--pref-swatch)] transition-shadow',
              selected && 'ring-2 ring-fg ring-offset-2 ring-offset-surface',
            )}
            style={{ '--pref-swatch': ACCENTS[accent] }}
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
        {LOCALES.map((locale) => (
          <option key={locale.id} value={locale.id}>
            {locale.id === 'en_US' ? locale.native : `${locale.native} — ${locale.english}`}
          </option>
        ))}
      </Select>
      {dirForLocale(props.value) === 'rtl' ? (
        <p className="mt-1 text-body-sm text-fg-muted">
          {t('prefs.locale.directionNote', 'Text direction: right to left (set automatically by the language)')}
        </p>
      ) : null}
    </div>
  );
}

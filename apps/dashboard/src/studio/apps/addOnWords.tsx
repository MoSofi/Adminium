// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How an app's add-ons are put into words, wherever they appear: the install
 * check's Add-ons card, the app's settings page, the Add-ons page's "Used by"
 * and its refusals (`Installed Apps.dc.html`, the O3 additions).
 *
 * One place, because the same row reads the same everywhere: "Required" with
 * a lock, "Suggested", "Needed for: Emailed receipts"; "Comes with Adminium"
 * or "From the add-on catalogue".
 */
import type { ReactNode } from 'react';
import { Badge } from '@adminium/ui';
import { Lock } from 'lucide-react';

import { getI18nInstance, t } from '../../i18n/t.js';
import type { AppAddOnRow, AppNeed, ManifestWords } from './appsApi.js';

/** The reader's language tag, as a manifest spells one (`de-DE`). */
function readerTag(): string {
  return (getI18nInstance()?.language ?? 'en-US').replace(/_/g, '-').toLowerCase();
}

/**
 * A manifest's own words in the reader's language: the exact tag, then the
 * same language in another region, then its en-US (every manifest text has
 * one), then any.
 */
export function manifestWords(words: ManifestWords | undefined): string {
  if (words === undefined) return '';
  const entries = Object.entries(words).filter(([, text]) => typeof text === 'string' && text !== '');
  const tag = readerTag();
  const language = tag.split('-')[0];
  return (
    entries.find(([key]) => key.toLowerCase() === tag)?.[1] ??
    entries.find(([key]) => key.toLowerCase().split('-')[0] === language)?.[1] ??
    words['en-US'] ??
    entries[0]?.[1] ??
    ''
  );
}

/** The lowest version a range lets in, when it has one ("1.1.0" from `>=1.1.0` or `^1.1.0`). */
export function rangeFloor(range: string): string | null {
  const match = /^\s*(?:>=|\^|~)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*(?:<.*)?$/.exec(range);
  return match?.[1] ?? null;
}

/** "{app} needs 1.1.0 or later", or the range itself when it has no plain floor. */
export function needsVersion(app: string, range: string): string {
  const floor = rangeFloor(range);
  return floor === null
    ? t('studio:appAddOns.needsRange', '{app} needs {range}', { app, range })
    : t('studio:appAddOns.needsFloor', '{app} needs {version} or later', { app, version: floor });
}

/** Where the version an add-on would run comes from. */
export function sourceWords(source: AppAddOnRow['source']): string {
  switch (source) {
    case 'bundled':
      return t('studio:appAddOns.source.bundled', 'Comes with Adminium');
    case 'catalog':
      return t('studio:appAddOns.source.catalog', 'From the add-on catalogue');
    case 'upload':
      return t('studio:appAddOns.source.upload', 'Uploaded to this Adminium');
    default:
      return '';
  }
}

/** Why an add-on cannot be had here, said as the comp says it when the catalogue is off. */
export function unavailableSourceWords(catalogueOn: boolean | null): string {
  return catalogueOn === true
    ? t('studio:appAddOns.source.none', 'Doesn’t come with this Adminium, and the add-on catalogue has no version it can use')
    : t('studio:appAddOns.source.off', 'Doesn’t come with this Adminium, and the add-on catalogue is off');
}

/** The feature labels a need names, in the reader's language. */
export function featureWords(features: readonly { label: ManifestWords }[]): string {
  return features.map((feature) => manifestWords(feature.label)).join(', ');
}

/**
 * The pill beside a name: Required (grey, with a lock), Suggested (accent),
 * Needed for: {features} (info blue).
 */
export function NeedPill({ need, features }: { need: AppNeed['need']; features: readonly { label: ManifestWords }[] }): ReactNode {
  const shape = 'gap-1 rounded-[20px] px-2 py-0.5 text-[10.5px] font-bold leading-[normal]';
  if (need === 'requires') {
    return (
      <Badge tone="neutral" className={shape} data-need="requires">
        <Lock aria-hidden className="size-[11px]" />
        {t('studio:appAddOns.pill.required', 'Required')}
      </Badge>
    );
  }
  if (need === 'feature') {
    return (
      <Badge tone="info" className={shape} data-need="feature">
        {t('studio:appAddOns.pill.feature', 'Needed for: {features}', { features: featureWords(features) })}
      </Badge>
    );
  }
  return (
    <Badge tone="accent" className={shape} data-need="suggests">
      {t('studio:appAddOns.pill.suggested', 'Suggested')}
    </Badge>
  );
}

/** "Client Portal", "Client Portal and Point of Sale", "A, B and C" — in the reader's language. */
export function namesList(names: readonly string[]): string {
  try {
    return new Intl.ListFormat(readerTag(), { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

const MARK = '⁣';

/**
 * A translated sentence with some of its values drawn as nodes (a bold name,
 * an inline link), split around markers so translators keep the whole
 * sentence and its word order.
 */
export function sentence(key: string, fallback: string, nodes: Record<string, ReactNode>, args: Record<string, unknown> = {}): ReactNode {
  const marked = Object.fromEntries(Object.keys(nodes).map((name) => [name, `${MARK}${name}${MARK}`]));
  const text = t(key, fallback, { ...args, ...marked });
  const parts = text.split(MARK);
  return parts.map((part, index) => (index % 2 === 1 && part in nodes ? <span key={index}>{nodes[part]}</span> : part));
}

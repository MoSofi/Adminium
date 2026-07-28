/**
 * `filter-chip-bar` (annex §10) — toggle chips with live mono count pills
 * computed from the SIBLING list ("All 24 · Running 3 · Completed 21"); a
 * single-select drives client/server filtering, with optional end-aligned
 * "N of M" meta. Evidence: ~17 comps (AB Experiments, Payments, Audit Log,
 * Ticket Queue, Notifications Center, Search Results, …).
 *
 * Built on @adminium/ui's `ChoiceChips` in SINGLE mode — not on `FilterChip`,
 * despite the name: `FilterChip` is the removable `field · op · value` condition
 * pill from the query builder, whereas this bar is a single-select facet picker,
 * which is exactly `ChoiceChips`'s radiogroup (roving tabindex, ←→ moves and
 * selects, RTL-mirrored).
 *
 * The counts are DERIVED from the bound `record-list` rather than configured —
 * that is the whole point of the widget (annex §10: "live mono count pills
 * computed from the sibling list"): a hard-coded count goes stale the moment a
 * row changes.
 */

import { ChoiceChips, MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useState } from 'react';

import { facetCountsOf, formatCount, recordRowsOf } from './forms-lib.js';
import type { FormTone } from './forms-lib.js';
import { filterChipBarConfigSchema, filterChipBarDemoData } from './forms-config.js';
import type { FilterChipBarConfig } from './forms-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { filterChipBarConfigSchema, filterChipBarDemoData };
export type { FilterChipBarConfig };

/**
 * The sentinel value of the leading "All" chip. Prefixed so it can never
 * collide with a real enum value read out of the data.
 */
export const ALL_KEY = '__all__';

export interface Facet {
  key: string;
  label: string;
  count: number;
  tone?: FormTone | undefined;
}

/**
 * Build the ordered facet list from the bound rows.
 *
 * Config `order` fixes the leading chips and their labels; facets the payload
 * has but the order omits render AFTER, in first-seen order — a new enum value
 * appearing in the data must never become invisible (and therefore
 * unfilterable) just because the config predates it.
 */
export function facetsOf(data: unknown, config: FilterChipBarConfig): { facets: Facet[]; total: number } {
  const rows = recordRowsOf(data);
  const counts = facetCountsOf(rows, config.facetField);

  const ordered = config.order ?? [];
  const orderedKeys = new Set(ordered.map((entry) => entry.key));
  const facets: Facet[] = [];

  for (const entry of ordered) {
    // A configured facet with zero rows still renders — its "0" is meaningful
    // ("Failed 0" is good news), unlike an undiscovered one.
    facets.push({ key: entry.key, label: entry.label ?? entry.key, count: counts.get(entry.key) ?? 0, tone: entry.tone });
  }
  for (const [key, count] of counts) {
    if (!orderedKeys.has(key)) facets.push({ key, label: key, count });
  }

  return { facets, total: rows.length };
}

export function FilterChipBarWidget({ config, data, onEvent }: WidgetProps<FilterChipBarConfig>) {
  const t = useMaybeT();
  const { facets, total } = facetsOf(data, config);
  const [selected, setSelected] = useState<string | null>(config.value ?? null);

  const locale = config.format?.locale;
  const shown = selected === null ? total : (facets.find((facet) => facet.key === selected)?.count ?? 0);
  // A configured template keeps today's `{…}` substitution; the DEFAULT goes
  // through t() with pre-stringified args so the counts render digit-identical
  // in either path (ICU number formatting would add locale grouping).
  const meta =
    config.metaTemplate !== undefined
      ? config.metaTemplate.replace('{shown}', String(shown)).replace('{total}', String(total))
      : t('ui:widgets.forms.filterChipBar.meta', '{shown} of {total}', { shown: String(shown), total: String(total) });

  const select = (key: string | null) => {
    // `ALL_KEY` is the sentinel for "no facet" — ChoiceChips' single mode can
    // return null on deselect, which means the same thing.
    const next = key === ALL_KEY ? null : key;
    setSelected(next);
    // Filtering is a HOST concern: the sibling list re-queries. The widget
    // reports the choice through a drill-through on its own href, which is the
    // only event channel a read-only control has (04 §2.1).
    if (config.href === undefined) return;
    const href = next === null ? config.href : `${config.href}?${config.facetField}=${encodeURIComponent(next)}`;
    onEvent({ type: 'drill-through', href });
  };

  const label = (text: string, count: number) =>
    config.showCounts ? (
      <>
        {text} <MonoText className="text-[10.5px] opacity-70">{formatCount(count, locale)}</MonoText>
      </>
    ) : (
      text
    );

  return (
    <div
      data-widget="filter-chip-bar"
      data-testid={config.testId}
      className="flex h-full flex-wrap items-center gap-1.5 px-4 pb-4"
    >
      <ChoiceChips
        data-part="facet-chips"
        aria-label={config.a11yLabel ?? config.title ?? t('ui:widgets.forms.filterChipBar.a11yLabel', 'Filter')}
        value={selected ?? ALL_KEY}
        onValueChange={select}
        options={[
          { value: ALL_KEY, label: label(config.allLabel ?? t('ui:widgets.forms.filterChipBar.all', 'All'), total) },
          ...facets.map((facet) => ({ value: facet.key, label: label(facet.label, facet.count) })),
        ]}
      />
      {config.showMeta && (
        <MonoText data-part="facet-meta" className="ms-auto text-caption text-fg-subtle">
          {meta}
        </MonoText>
      )}
    </div>
  );
}

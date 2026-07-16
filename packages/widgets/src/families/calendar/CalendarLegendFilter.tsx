import { getFormatters } from '@adminium/i18n';
import { Checkbox, EmptyState, MonoText } from '@adminium/ui';
import { useState } from 'react';

import { eventsOf } from './CalendarMonth.js';
import { calendarLegendFilterConfigSchema, calendarLegendFilterDemoData } from './calendar-config.js';
import { TONE_SOLID_BG, aggregateCategories, resolveLocale } from './calendar-lib.js';
import type { CalendarLegendFilterConfig } from './calendar-config.js';
import type { CalendarEvent } from './calendar-types.js';
import type { WidgetProps } from '../../registry/types.js';

export { calendarLegendFilterConfigSchema, calendarLegendFilterDemoData };
export type { CalendarLegendFilterConfig };

/**
 * `calendar-legend-filter` (annex §5) — per-category rows or chips: a coloured
 * check square/dot, the label, and a mono count; toggling one filters the
 * sibling calendar (Calendar Scheduler, Release Calendar's env chips).
 *
 * The categories are AGGREGATED from the same `calendar-events` payload the
 * calendar binds to (annex: "categories aggregated from events") — the legend is
 * a view of the calendar's data, never a second query, so the counts can never
 * disagree with the grid beside them.
 *
 * Toggling emits the HIDDEN set as a drill-through against `linkTarget`; the
 * host owns the cross-widget wiring (04 §2 — widgets never reach into siblings).
 * The visible/hidden state is client-only view state, so it is not a mutation.
 */

export interface LegendCategory {
  name: string;
  count: number;
  tone: 'neutral' | 'accent' | 'pos' | 'warn' | 'danger' | 'info';
}

export interface CalendarLegendFilterProps {
  categories: readonly LegendCategory[];
  toggleable?: boolean | undefined;
  variant?: 'rows' | 'chips' | undefined;
  /** Categories hidden on first render. */
  defaultHidden?: readonly string[] | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onChange?: ((hidden: string[]) => void) | undefined;
  testId?: string | undefined;
}

export function CalendarLegendFilter({
  categories,
  toggleable = true,
  variant = 'rows',
  defaultHidden,
  locale,
  emptyTitle,
  emptyBody,
  onChange,
  testId,
}: CalendarLegendFilterProps) {
  const tag = resolveLocale(locale);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(defaultHidden ?? []));

  if (categories.length === 0) {
    return (
      <EmptyState
        compact
        preset="nothing-scheduled"
        title={emptyTitle ?? 'No categories yet'}
        body={emptyBody ?? 'Event categories will appear here once events exist.'}
      />
    );
  }

  const toggle = (name: string): void => {
    if (!toggleable) return;
    const next = new Set(hidden);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setHidden(next);
    onChange?.([...next]);
  };

  return (
    <ul
      data-widget="calendar-legend-filter"
      data-testid={testId}
      data-variant={variant}
      className={
        variant === 'chips'
          ? 'flex h-full flex-wrap content-start gap-1.5 overflow-auto p-3'
          : 'h-full space-y-0.5 overflow-auto p-2'
      }
    >
      {categories.map((category) => {
        const on = !hidden.has(category.name);
        const count = getFormatters(tag).number(category.count);
        const swatch = (
          <span
            aria-hidden="true"
            data-part="legend-dot"
            className={`size-2.5 shrink-0 rounded-full ${TONE_SOLID_BG[category.tone]} ${on ? '' : 'opacity-30'}`}
          />
        );
        if (variant === 'chips') {
          return (
            <li key={category.name} data-part="legend-chip" data-on={on ? '' : undefined}>
              <button
                type="button"
                aria-pressed={toggleable ? on : undefined}
                disabled={!toggleable}
                onClick={() => toggle(category.name)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  on ? 'border-border bg-surface-2 text-fg' : 'border-dashed border-border text-fg-subtle'
                } ${toggleable ? 'hover:bg-surface-3' : 'cursor-default'}`}
              >
                {swatch}
                <span className={on ? '' : 'line-through'}>{category.name}</span>
                <MonoText className="text-fg-subtle">{count}</MonoText>
              </button>
            </li>
          );
        }
        return (
          <li key={category.name} data-part="legend-row" data-on={on ? '' : undefined}>
            <label
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${
                toggleable ? 'cursor-pointer hover:bg-surface-2' : ''
              }`}
            >
              {toggleable && (
                <Checkbox
                  checked={on}
                  onCheckedChange={() => toggle(category.name)}
                  aria-label={category.name}
                  className="shrink-0"
                />
              )}
              {swatch}
              <span className={`min-w-0 flex-1 truncate text-body-sm ${on ? 'text-fg' : 'text-fg-subtle'}`}>
                {category.name}
              </span>
              <MonoText className="shrink-0 text-caption text-fg-subtle">{count}</MonoText>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** Aggregate a `calendar-events` payload into legend categories (annex §5). */
export function legendCategoriesOf(data: unknown, config: CalendarLegendFilterConfig): LegendCategory[] {
  const events: CalendarEvent[] = eventsOf(data);
  return aggregateCategories(
    events,
    config.categoryColorMap,
    config.uncategorizedLabel ?? 'Uncategorized',
  );
}

export function CalendarLegendFilterWidget({ config, data, onEvent }: WidgetProps<CalendarLegendFilterConfig>) {
  const target = config.linkTarget;
  return (
    <CalendarLegendFilter
      categories={legendCategoriesOf(data, config)}
      toggleable={config.toggleable}
      variant={config.variant}
      defaultHidden={config.defaultHidden}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(target === undefined
        ? {}
        : {
            onChange: (hidden: string[]) =>
              onEvent({
                type: 'drill-through',
                href: `${config.href ?? ''}#${target}=${encodeURIComponent(hidden.join(','))}`,
              }),
          })}
    />
  );
}

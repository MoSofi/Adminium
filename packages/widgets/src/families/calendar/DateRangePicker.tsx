import { useMaybeT } from '@adminium/i18n/react';
import { MonoText } from '@adminium/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { dateRangePickerConfigSchema, dateRangePickerDemoData } from './calendar-config.js';
import {
  ANCHOR_TODAY,
  DEFAULT_RANGE_PRESETS,
  addDays,
  daysBetween,
  firstJsWeekday,
  fmtDayNumber,
  fmtMonthTitle,
  isInRange,
  isoDayKey,
  monthGrid,
  parseIsoDay,
  resolveLocale,
  resolvePreset,
  weekdayHeaders,
} from './calendar-lib.js';
import type { DateRangePickerConfig } from './calendar-config.js';
import type { DateRangePreset, DateRangeValue } from './calendar-types.js';
import type { WidgetProps } from '../../registry/types.js';

export { dateRangePickerConfigSchema, dateRangePickerDemoData };
export type { DateRangePickerConfig, DateRangePreset, DateRangeValue };

/**
 * `date-range-picker` (annex §5) — a month grid with start/end endpoints, a soft
 * in-range fill, a hover preview, quick presets (7d/30d/QTD…), and a selected
 * summary (Adminium UI Kit). It is a CONTROL: its value feeds the other widgets'
 * queries, so it emits its range and never queries anything itself.
 *
 * Endpoint semantics: the first click sets the start and clears the end; the
 * second closes the range (and swaps the pair if the user picked backwards, so a
 * right-to-left drag — the natural direction under RTL — still yields an
 * ordered pair). A third click starts over.
 *
 * The grid reuses the family's locale-aware week-start machinery (`monthGrid` +
 * `firstJsWeekday` off the @adminium/i18n `weekInfo` layer), so the columns
 * start on Sunday in `en-US`, Monday in `de-DE`, and Saturday in `ar-EG` — never
 * a hardcoded first day.
 */

export interface DateRangePickerProps {
  value?: DateRangeValue | undefined;
  presets?: readonly DateRangePreset[] | undefined;
  showPresets?: boolean | undefined;
  showSummary?: boolean | undefined;
  /** Max selectable span in days (annex `maxRange`); longer picks clamp the end. */
  maxRange?: number | undefined;
  firstDayOfWeek?: number | undefined;
  /** Reference "today" (`YYYY-MM-DD`) the presets resolve against. */
  referenceDate?: string | undefined;
  locale?: string | undefined;
  previousLabel?: string | undefined;
  nextLabel?: string | undefined;
  /** "{n} days selected" summary; `{n}` is substituted. */
  summaryLabel?: string | undefined;
  onChange?: ((value: DateRangeValue) => void) | undefined;
  testId?: string | undefined;
}

/** Next range after clicking `key` — the annex's start/end endpoint dance. */
export function nextRange(current: DateRangeValue, key: string, maxRange?: number): DateRangeValue {
  // Open a new range: nothing picked yet, or the previous one is closed.
  if (current.start === null || current.end !== null) return { start: key, end: null };
  const [start, end] = key < current.start ? [key, current.start] : [current.start, key];
  if (maxRange !== undefined && daysBetween(start, end) > maxRange) {
    // Clamp from the anchor the user actually placed first, so the endpoint they
    // just clicked moves — not the one they deliberately set.
    return key < current.start
      ? { start: addDays(current.start, -(maxRange - 1)), end: current.start }
      : { start: current.start, end: addDays(current.start, maxRange - 1) };
  }
  return { start, end };
}

export function DateRangePicker({
  value,
  presets,
  showPresets = true,
  showSummary = true,
  maxRange,
  firstDayOfWeek,
  referenceDate,
  locale,
  previousLabel,
  nextLabel,
  summaryLabel,
  onChange,
  testId,
}: DateRangePickerProps) {
  const t = useMaybeT();
  const resolvedPreviousLabel = previousLabel ?? t('ui:widgets.calendar.dateRangePicker.previousLabel', 'Previous month');
  const resolvedNextLabel = nextLabel ?? t('ui:widgets.calendar.dateRangePicker.nextLabel', 'Next month');
  // Explicit `presets` (host-translated, annex contract) win untouched; the
  // built-in defaults localize per id under `…dateRangePicker.presets.*`.
  const resolvedPresets = useMemo(
    () =>
      presets ??
      DEFAULT_RANGE_PRESETS.map((preset) => ({
        ...preset,
        label: t(`ui:widgets.calendar.dateRangePicker.presets.${preset.id}`, preset.label),
      })),
    [presets, t],
  );
  const tag = resolveLocale(locale);
  const reference = referenceDate ?? isoDayKey(new Date());
  const [range, setRange] = useState<DateRangeValue>(value ?? { start: null, end: null });
  const [hover, setHover] = useState<string | null>(null);

  const anchor = parseIsoDay(range.start ?? reference);
  const [view, setView] = useState({ year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() });

  const firstJs = firstJsWeekday(tag, firstDayOfWeek);
  const headers = useMemo(() => weekdayHeaders(tag, firstJs), [tag, firstJs]);
  const cells = useMemo(() => monthGrid(view.year, view.month, firstJs), [view, firstJs]);
  const title = fmtMonthTitle(tag, new Date(Date.UTC(view.year, view.month, 1)));

  const commit = (next: DateRangeValue): void => {
    setRange(next);
    setHover(null);
    onChange?.(next);
  };

  const step = (delta: number): void => {
    setView((prev) => {
      const next = new Date(Date.UTC(prev.year, prev.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  };

  // The hover preview only exists while a range is half-open (annex).
  const previewEnd = range.start !== null && range.end === null ? hover : null;
  const activePreset = resolvedPresets.find((preset) => {
    if (range.start === null || range.end === null) return false;
    const resolved = resolvePreset(preset, reference);
    return resolved.start === range.start && resolved.end === range.end;
  });

  // A host-supplied `summaryLabel` keeps the documented `{n}`-template contract;
  // the default routes through the bundle with `n` as an ICU argument.
  const summary =
    range.start !== null && range.end !== null
      ? summaryLabel !== undefined
        ? summaryLabel.replace('{n}', String(daysBetween(range.start, range.end)))
        : t('ui:widgets.calendar.dateRangePicker.summaryLabel', '{n} days selected', {
            n: daysBetween(range.start, range.end),
          })
      : undefined;

  return (
    <div data-widget="date-range-picker" data-testid={testId} className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-body-sm font-bold text-fg">{title}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={resolvedPreviousLabel}
            data-part="range-prev"
            onClick={() => step(-1)}
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            {/* Month navigation is inline-axis motion: the chevrons mirror under
                RTL so "previous" always points at the earlier direction. */}
            <ChevronLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          </button>
          <button
            type="button"
            aria-label={resolvedNextLabel}
            data-part="range-next"
            onClick={() => step(1)}
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <ChevronRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          </button>
        </div>
      </div>

      {showPresets && resolvedPresets.length > 0 && (
        <div data-part="range-presets" className="flex flex-wrap gap-1">
          {resolvedPresets.map((preset) => {
            const on = activePreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                data-part="range-preset"
                data-preset={preset.id}
                aria-pressed={on}
                onClick={() => {
                  const resolved = resolvePreset(preset, reference);
                  const start = parseIsoDay(resolved.start);
                  setView({ year: start.getUTCFullYear(), month: start.getUTCMonth() });
                  commit(resolved);
                }}
                className={`rounded-full border px-2 py-0.5 text-caption transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  on ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-muted hover:bg-surface-2'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}

      <div role="grid" aria-label={title} className="grid gap-0.5">
        <div role="row" className="grid grid-cols-7 gap-0.5">
          {headers.map((label, i) => (
            <div
              key={`${label}-${i}`}
              role="columnheader"
              className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-fg-subtle"
            >
              {label}
            </div>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div role="row" key={week} className="grid grid-cols-7 gap-0.5">
            {cells.slice(week * 7, week * 7 + 7).map((cell) => {
              const isStart = range.start === cell.key;
              const isEnd = range.end === cell.key;
              const inRange = isInRange(cell.key, range.start, range.end);
              const inPreview = isInRange(cell.key, range.start, previewEnd);
              const endpoint = isStart || isEnd;
              return (
                <button
                  type="button"
                  role="gridcell"
                  key={cell.key}
                  aria-label={cell.key}
                  aria-selected={endpoint}
                  data-part="range-day"
                  data-endpoint={endpoint ? '' : undefined}
                  data-in-range={inRange || inPreview ? '' : undefined}
                  onClick={() => commit(nextRange(range, cell.key, maxRange))}
                  onMouseEnter={() => setHover(cell.key)}
                  onFocus={() => setHover(cell.key)}
                  className={[
                    'grid h-8 place-items-center text-caption tabular-nums transition-colors',
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                    // Endpoints get the solid accent; the span between them gets
                    // the soft fill. The rounding is LOGICAL (`rounded-s`/`-e`),
                    // so the pill's caps stay on the range's true ends in RTL.
                    //
                    // The text colour is decided HERE rather than on its own
                    // line: these classes are joined raw (no tailwind-merge), so
                    // a separate `text-fg` would survive alongside
                    // `text-accent-fg`/`text-accent` and stylesheet order, not
                    // this ternary, would pick the winner — which rendered the
                    // body colour on the accent fill.
                    endpoint
                      ? 'bg-accent font-bold text-accent-fg'
                      : inRange || inPreview
                        ? 'bg-accent-soft text-accent'
                        : cell.inMonth
                          ? 'text-fg hover:bg-surface-2'
                          : 'text-fg-subtle hover:bg-surface-2',
                    isStart ? 'rounded-s-md' : '',
                    isEnd ? 'rounded-e-md' : '',
                    !endpoint ? 'rounded-md' : '',
                  ].join(' ')}
                >
                  {fmtDayNumber(tag, cell.day)}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {showSummary && (
        <div data-part="range-summary" className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <MonoText className="truncate text-caption text-fg-muted">
            {range.start === null ? '—' : `${range.start} → ${range.end ?? '…'}`}
          </MonoText>
          {summary !== undefined && <span className="shrink-0 text-caption text-fg-subtle">{summary}</span>}
        </div>
      )}
    </div>
  );
}

/** Project an untrusted `form-state` payload onto the picker's day pair. */
export function rangeValueOf(data: unknown): DateRangeValue {
  const envelope = (typeof data === 'object' && data !== null ? data : {}) as {
    value?: unknown;
    start?: unknown;
    end?: unknown;
  };
  const inner = (typeof envelope.value === 'object' && envelope.value !== null ? envelope.value : envelope) as {
    start?: unknown;
    end?: unknown;
  };
  const day = (raw: unknown): string | null => (typeof raw === 'string' && raw !== '' ? raw.slice(0, 10) : null);
  return { start: day(inner.start), end: day(inner.end) };
}

export function DateRangePickerWidget({ config, data, onEvent }: WidgetProps<DateRangePickerConfig>) {
  /*
   * The reference "today": an explicit `referenceDate` wins, then the shared
   * `format.referenceTime` clock (what pins a VRT capture), else the real date.
   * The demo anchor is NEVER a live fallback — a real page's "Last 7 days" must
   * mean the last 7 real days.
   */
  const reference =
    config.referenceDate ??
    (config.format?.referenceTime === undefined ? undefined : isoDayKey(new Date(config.format.referenceTime)));
  return (
    <DateRangePicker
      value={rangeValueOf(data)}
      showPresets={config.showPresets}
      showSummary={config.showSummary}
      {...(config.presets === undefined ? {} : { presets: config.presets })}
      {...(config.maxRange === undefined ? {} : { maxRange: config.maxRange })}
      {...(config.firstDayOfWeek === undefined ? {} : { firstDayOfWeek: config.firstDayOfWeek })}
      {...(reference === undefined ? {} : { referenceDate: reference })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(config.href === undefined
        ? {}
        : {
            onChange: (value: DateRangeValue) => {
              if (value.start === null || value.end === null) return; // half-open: nothing to bind yet
              onEvent({
                type: 'drill-through',
                href: `${config.href as string}?from=${value.start}&to=${value.end}`,
              });
            },
          })}
    />
  );
}

/** Re-exported so stories/tests can pin the same anchor the generators use. */
export { ANCHOR_TODAY };

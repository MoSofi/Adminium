// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-dashboard` template renderer.
 *
 * Renders a stored `config.layout` (pageLayoutSchema) on the static 12-col
 * DashboardGrid: every item becomes a WidgetHost fed by the
 * DashboardData adapter (one `queryBatch` round trip for all bound
 * widgets, per-item error isolation) or by deterministic demo data when
 * unbound. Responsive stacking below `lg` comes from the grid. Edit mode
 * (dashboard builder) is /M7.
 *
 * A layout whose `toolbar.day` is set draws the page's day control — Today,
 * Yesterday, This week, or a picked day — and hands the choice to every
 * binding as the `day` param. A descriptor's `window.param: 'day'` follows
 * it, on the venue's clock (the server's widget-data compiler).
 */

import { useId, useMemo, useState, type ReactNode } from 'react';
import { useMaybeI18n, useMaybeT } from '@adminium/i18n/react';
import { ArrowRight, CalendarDays, ClipboardList, ExternalLink } from 'lucide-react';
import { Button, cn, Input, Popover, PopoverContent, PopoverTrigger, SegmentedControl } from '@adminium/ui';

import { WidgetHost } from '../../frame/WidgetHost.js';
import { pickLocalized } from '../../lib/localized.js';
import { DashboardGrid } from '../../grid/DashboardGrid.js';
import { pageLayoutSchema, type PageLayout } from '../../page-config/index.js';
import type { WidgetEvent } from '../../registry/types.js';
import { withCurrency } from '../page-currency.js';
import {
  useDashboardData,
  type DashboardDataAdapter,
  type DashboardDataStates,
} from './data-adapter.js';

export interface PageDashboardProps {
  /** The page's `config.layout` document (raw — validated here). */
  layout: unknown;
  /** Transport for bound widgets; absent → full demo mode. */
  adapter?: DashboardDataAdapter | undefined;
  /** Page-control params (e.g. `dateRange.*`) forwarded to every binding. */
  params?: Record<string, unknown> | undefined;
  /** Widget events (drill-through, record-open, mutate) bubble here. */
  onEvent?: ((instanceId: string, event: WidgetEvent) => void) | undefined;
  /** Test/story override — wins over adapter/demo resolution per instance. */
  states?: DashboardDataStates | undefined;
  /**
   * The day the page shows, when its HOST fetches the data: the host passes
   * `states` read for that day, so the choice must reach the host, not stay
   * here. Absent, the page keeps the day itself (it fetches through `adapter`).
   */
  day?: DashboardDay | undefined;
  onDay?: ((day: DashboardDay) => void) | undefined;
  /**
   * The connection's currency, for every widget that names none — merged as
   * the page draws, never into the stored layout, so a dashboard saved here
   * still follows the connection when its currency changes.
   */
  currency?: string | undefined;
  /**
   * Whether the host can open a link's address. An address starting with `@`
   * names something only the host knows (`@staff`: the app's own staff
   * screens) — a host without it, or without an answer for it, gets no
   * button, never a dead one. Absent: every `@` address is hidden and every
   * other one is drawn.
   */
  linkAvailable?: ((href: string) => boolean) | undefined;
  className?: string | undefined;
}

const EMPTY_LAYOUT: PageLayout = { version: 1, items: [] };

/** The day a page shows: a named one, or a picked `YYYY-MM-DD`. */
export type DashboardDay = 'today' | 'yesterday' | 'week' | string;

/**
 * A segment of the Overview comp's day tray (F-OV1; COMP 130-156, `seg` 715):
 * 7/12, r8, 12 px w700 at `normal` line height — the trigger for "Pick a day"
 * wears the same, and the selected look when a picked day is showing.
 */
const SEGMENT = 'h-auto px-3 py-[7px] text-[12px] font-bold leading-[normal]';
const PICK_TRIGGER =
  'inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 py-[7px] text-[12px] font-bold ' +
  'leading-[normal] text-fg-muted transition-colors duration-150 hover:text-fg focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5 [&_svg]:shrink-0';

/** `2026-09-20` as the viewer reads a day ("Sun, 20 Sep"), the date itself, not a moment. */
function dayLabel(day: string): string {
  const lang = typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined;
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

/** Today as `YYYY-MM-DD` on this device — the latest day the picker offers. */
function todayIso(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Today / Yesterday / This week, and a picked day — one tray, as the comp draws
 * it: "Pick a day" is a fourth segment that opens a small popover (a labelled
 * date field, one line on the venue's clock, Cancel / Show day) and, once a
 * day is showing, names that day.
 */
function DayControls({ day, onDay, end }: { day: DashboardDay; onDay: (day: DashboardDay) => void; end?: ReactNode }) {
  const t = useMaybeT();
  const fieldId = useId();
  const named = day === 'today' || day === 'yesterday' || day === 'week';
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-3 px-1 pb-3" data-testid="page-dashboard-day">
      <div className="inline-flex flex-wrap items-center gap-[3px] rounded-[11px] border border-border bg-surface-2 p-[3px]">
        <SegmentedControl
          className="gap-[3px] bg-transparent p-0"
          itemClassName={SEGMENT}
          aria-label={t('ui:templates.dashboard.day.label', 'Day')}
          value={named ? day : ''}
          onValueChange={onDay}
          options={[
            { value: 'today', label: t('ui:templates.dashboard.day.today', 'Today') },
            { value: 'yesterday', label: t('ui:templates.dashboard.day.yesterday', 'Yesterday') },
            { value: 'week', label: t('ui:templates.dashboard.day.week', 'This week') },
          ]}
        />
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) setDraft(named ? '' : day);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              data-part="day-pick"
              className={cn(PICK_TRIGGER, named ? '' : 'bg-surface text-fg shadow-card')}
            >
              <CalendarDays aria-hidden />
              {named ? t('ui:templates.dashboard.day.pick', 'Pick a day') : dayLabel(day)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[250px] rounded-[13px] p-[14px]">
            <label htmlFor={fieldId} className="mb-[7px] block text-[11.5px] font-bold leading-[normal] text-fg-muted">
              {t('ui:templates.dashboard.day.pick', 'Pick a day')}
            </label>
            <Input
              id={fieldId}
              type="date"
              className="font-mono"
              max={todayIso()}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <p className="mt-2 text-[11px] leading-[1.45] text-fg-subtle">
              {t('ui:templates.dashboard.day.pickHelp', 'One day at a time, on the venue’s clock.')}
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
                {t('ui:templates.dashboard.day.cancel', 'Cancel')}
              </Button>
              <Button
                className="flex-1"
                disabled={draft === ''}
                onClick={() => {
                  onDay(draft);
                  setOpen(false);
                }}
              >
                {t('ui:templates.dashboard.day.show', 'Show day')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {end}
    </div>
  );
}

export function PageDashboard({ layout, adapter, params, onEvent, states, day: hostDay, onDay: onHostDay, currency, linkAvailable, className }: PageDashboardProps) {
  const t = useMaybeT();
  const locale = useMaybeI18n()?.locale;
  const parsed = useMemo(() => {
    const result = pageLayoutSchema.safeParse(layout);
    if (result.success) return { layout: result.data, invalid: false };
    return { layout: EMPTY_LAYOUT, invalid: true };
  }, [layout]);

  const [ownDay, setOwnDay] = useState<DashboardDay>('today');
  const day = hostDay ?? ownDay;
  const setDay = onHostDay ?? setOwnDay;
  const withDay = parsed.layout.toolbar?.day === true;
  const pageParams = useMemo(() => (withDay ? { ...params, day } : params), [withDay, params, day]);
  const dataStates = useDashboardData(parsed.layout, adapter, pageParams);

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-dashboard-invalid">
        {t(
          'ui:templates.dashboard.invalidLayout',
          'This dashboard’s stored layout is invalid. Regenerate the page or reset its layout.',
        )}
      </p>
    );
  }

  const stored = parsed.layout.toolbar?.link;
  const link = stored === undefined || !(linkAvailable?.(stored.href) ?? !stored.href.startsWith('@')) ? undefined : stored;
  const linkButton =
    link === undefined ? null : (
      <ToolbarLink
        label={pickLocalized(link.label, link.labels, locale)}
        icon={link.icon ?? 'arrow-right'}
        onOpen={() => onEvent?.(TOOLBAR_INSTANCE, { type: 'drill-through', href: link.href })}
      />
    );

  const grid = (
    <DashboardGrid
      layout={parsed.layout}
      className={className}
      testId="page-dashboard"
      renderItem={(item) => (
        <WidgetHost
          widgetId={item.widget}
          instanceId={item.i}
          config={withCurrency(item.config, currency)}
          data={states?.[item.i] ?? dataStates[item.i] ?? { status: 'loading' }}
          onEvent={onEvent === undefined ? undefined : (event) => onEvent(item.i, event)}
        />
      )}
    />
  );
  if (!withDay && linkButton === null) return grid;
  return (
    <div className="flex flex-col">
      {withDay ? (
        <DayControls day={day} onDay={setDay} end={linkButton} />
      ) : (
        <div className="flex justify-end px-1 pb-3">{linkButton}</div>
      )}
      {grid}
    </div>
  );
}

/** Whose event a page-level link is: no widget's. */
const TOOLBAR_INSTANCE = '__toolbar';

const LINK_ICONS = { 'arrow-right': ArrowRight, 'clipboard-list': ClipboardList, 'external-link': ExternalLink } as const;

/** The page's one link, at the end of its controls: the host opens the route. */
function ToolbarLink({ label, icon, onOpen }: { label: string; icon: keyof typeof LINK_ICONS; onOpen: () => void }) {
  const Icon = LINK_ICONS[icon];
  return (
    <Button variant="secondary" className="ms-auto" data-testid="page-dashboard-link" onClick={onOpen}>
      {label}
      <Icon aria-hidden className="rtl:-scale-x-100" />
    </Button>
  );
}

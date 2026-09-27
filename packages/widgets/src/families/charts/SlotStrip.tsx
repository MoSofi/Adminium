// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '../../lib/i18n.js';
import { MonoText } from '@adminium/ui';

/**
 * A slot limit's day as a strip (`chart-bar` over a `capacity-counts`
 * binding): one bar per slot, as tall as what is taken of its size, what
 * holds keep stacked lighter above it, a dashed line at the size, paused slots
 * hatched, slots already over dimmed and a marker at now — both on the venue's
 * clock the answer carries, never this device's. A closed day says so.
 *
 * The control's week is the same strip a day per bar.
 */

export interface SlotStripRow {
  time?: string | undefined;
  date?: string | undefined;
  size: number | null;
  taken: number;
  held: number;
  paused?: boolean | undefined;
  closed?: boolean | undefined;
}

export interface SlotStripData {
  /** The day counted, or the first of the week's days. */
  date: string | null;
  days: number;
  /** The venue's clock when the answer was made. */
  now: { day: string; minute: number };
  closed: boolean;
  rows: SlotStripRow[];
}

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null);
const num = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** The slot strip a `capacity-counts` answer carries, or null for any other payload. */
export function asSlotStrip(data: unknown): SlotStripData | null {
  const block = rec(rec(data)?.['capacity']);
  if (block === null || block['kind'] !== 'slot' || !Array.isArray(block['rows'])) return null;
  const now = rec(block['now']);
  const minute = num(now?.['minute']);
  if (now === null || typeof now['day'] !== 'string' || minute === null) return null;
  const rows: SlotStripRow[] = [];
  for (const entry of block['rows'] as unknown[]) {
    const row = rec(entry);
    if (row === null) return null;
    rows.push({
      ...(typeof row['time'] === 'string' ? { time: row['time'] } : {}),
      ...(typeof row['date'] === 'string' ? { date: row['date'] } : {}),
      size: num(row['size']),
      taken: num(row['taken']) ?? 0,
      held: num(row['held']) ?? 0,
      ...(row['paused'] === true ? { paused: true } : {}),
      ...(row['closed'] === true ? { closed: true } : {}),
    });
  }
  return {
    date: typeof block['date'] === 'string' ? block['date'] : null,
    days: num(block['days']) ?? 1,
    now: { day: now['day'], minute },
    closed: block['closed'] === true,
    rows,
  };
}

const minuteOf = (time: string): number => {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
};
const nextDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

interface Placed {
  row: SlotStripRow;
  past: boolean;
}

/**
 * Where each slot sits against the venue's now: its start in minutes from the
 * day's midnight (a slot after midnight runs on past 1440), its length the
 * grid's step, and where now falls among them (a fraction of the strip).
 */
export function placeSlots(data: SlotStripData): { placed: Placed[]; now: number | null } {
  const { rows } = data;
  if (data.days > 1) {
    // A day per bar: a day before today is over; today holds the marker.
    const today = rows.findIndex((row) => row.date === data.now.day);
    return {
      placed: rows.map((row) => ({ row, past: row.date !== undefined && row.date < data.now.day })),
      now: today < 0 ? null : (today + data.now.minute / 1440) / rows.length,
    };
  }
  const starts: number[] = [];
  for (const row of rows) {
    let minute = minuteOf(row.time ?? '00:00');
    const last = starts.at(-1);
    while (last !== undefined && minute < last) minute += 1440;
    starts.push(minute);
  }
  const gaps = starts.slice(1).map((start, i) => start - starts[i]!).filter((gap) => gap > 0);
  const step = gaps.length === 0 ? 60 : Math.min(...gaps);
  const day = data.date;
  // Now in the counted day's minutes: after it, before it, or within.
  const now = day === null ? null : data.now.day === day ? data.now.minute : data.now.day === nextDay(day) ? data.now.minute + 1440 : data.now.day > day ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const placed = rows.map((row, i) => ({ row, past: now !== null && starts[i]! + step <= now }));
  const first = starts[0];
  const end = starts.length === 0 ? undefined : starts.at(-1)! + step;
  const within = now !== null && first !== undefined && end !== undefined && Number.isFinite(now) && now >= first && now < end;
  if (!within) return { placed, now: null };
  let index = 0;
  starts.forEach((start, i) => {
    if (start <= now) index = i;
  });
  return { placed, now: (index + (now - starts[index]!) / step) / rows.length };
}

const pct = (part: number, whole: number) => `${String(whole <= 0 ? 0 : Math.max(0, Math.min(100, (part / whole) * 100)))}%`;

export function SlotStrip({ data, label, height, locale }: { data: SlotStripData; label: string; height: number; locale?: string | undefined }) {
  const t = useMaybeT();
  const { placed, now } = placeSlots(data);
  // The scale: the size, or more where a slot holds more than its size.
  const sizes = data.rows.map((row) => row.size).filter((size): size is number => size !== null && size > 0);
  const size = sizes.length === 0 ? null : Math.max(...sizes);
  const scale = Math.max(size ?? 0, ...data.rows.map((row) => row.taken + row.held), 1);
  const every = Math.max(1, Math.ceil(data.rows.length / 12));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const nameOf = (row: SlotStripRow) => (row.date !== undefined && row.time === undefined ? weekday.format(new Date(`${row.date}T00:00:00Z`)) : (row.time ?? ''));

  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="slot-strip" role="group" aria-label={label}>
      {data.closed ? (
        <p role="status" data-part="slot-closed" className="mb-2 rounded-md bg-surface-2 px-3 py-2 text-body-sm text-fg-muted">
          {t('ui:widgets.charts.slotStrip.closed', 'Closed this day: no one can take these slots.')}
        </p>
      ) : null}
      <div className="relative h-[var(--plot-h)]" style={{ '--plot-h': `${String(height)}px` }}>
        {size === null ? null : (
          <div aria-hidden="true" data-part="slot-size-line" className="pointer-events-none absolute inset-x-0 bottom-[var(--size-at)] border-t border-dashed border-fg-muted" style={{ '--size-at': pct(size, scale) }} />
        )}
        <ul className="flex h-full items-end gap-[2px]">
          {placed.map(({ row, past }, i) => {
            const name = nameOf(row);
            const counts =
              row.size === null
                ? t('ui:widgets.charts.slotStrip.slotNoSize', '{slot}: {taken} taken', { slot: name, taken: String(row.taken) })
                : t('ui:widgets.charts.slotStrip.slot', '{slot}: {taken} of {size} taken', { slot: name, taken: String(row.taken), size: String(row.size) });
            const states = [
              row.held > 0 ? t('ui:widgets.charts.slotStrip.held', '{held} held', { held: String(row.held) }) : null,
              row.paused === true ? t('ui:widgets.charts.slotStrip.paused', 'Paused') : null,
              row.closed === true && data.days > 1 ? t('ui:widgets.charts.slotStrip.closedDay', 'Closed') : null,
              past ? t('ui:widgets.charts.slotStrip.past', 'Over') : null,
            ].filter((state): state is string => state !== null);
            const text = [counts, ...states].join(' · ');
            return (
              <li
                key={`${name}-${String(i)}`}
                data-part="slot-bar"
                data-slot={name}
                data-past={past ? 'true' : undefined}
                data-paused={row.paused === true ? 'true' : undefined}
                title={text}
                className={`relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-[3px] ${
                  row.paused === true
                    ? 'bg-[repeating-linear-gradient(45deg,var(--surface-2)_0px,var(--surface-2)_4px,var(--surface-3)_4px,var(--surface-3)_8px)]'
                    : 'bg-surface-2/60'
                } ${past ? 'opacity-50' : ''}`}
              >
                <span className="sr-only">{text}</span>
                {row.held > 0 ? <span aria-hidden="true" data-part="slot-held" className="block h-[var(--held)] w-full bg-accent/35" style={{ '--held': pct(row.held, scale) }} /> : null}
                <span aria-hidden="true" data-part="slot-taken" className="block h-[var(--taken)] w-full rounded-t-[3px] bg-accent" style={{ '--taken': pct(row.taken, scale) }} />
              </li>
            );
          })}
        </ul>
        {now === null ? null : (
          <div data-part="slot-now" className="pointer-events-none absolute inset-y-0 start-[var(--now)] border-s-2 border-danger" style={{ '--now': `${String(now * 100)}%` }}>
            <span className="sr-only">{t('ui:widgets.charts.slotStrip.now', 'Now')}</span>
          </div>
        )}
      </div>
      <div aria-hidden="true" className="mt-1 flex gap-[2px]">
        {placed.map(({ row }, i) => (
          <MonoText key={`${nameOf(row)}-${String(i)}`} className="min-w-0 flex-1 truncate text-center text-caption text-fg-subtle">
            {i % every === 0 ? nameOf(row) : ''}
          </MonoText>
        ))}
      </div>
    </div>
  );
}

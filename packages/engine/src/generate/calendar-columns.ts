// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The columns a calendar page plots by, when somebody names them.
 *
 * Left to itself the calendar rule takes the first event-like date and the
 * table's display column. On a table of appointments that carries a first
 * visit's date of birth before the visit's own start, that plotted every visit
 * on the patient's birthday and titled it with a stranger's name typed on the
 * form. Two things now name the columns instead:
 *
 *  - an app, in its page's `config.calendar` (`{start, end?, title?,
 *    category?}`), where `title` may be a column of a table a foreign key
 *    points at (`patient_id.name`) — the title-through-a-key remedy;
 *  - failing that, the table's booking rule: its `start` is the time a row
 *    takes, so it is the date the calendar plots by (the caller passes it as
 *    `{start}`).
 *
 * The start column is tagged as the event date before the rules run, so a
 * calendar is composed even when the classifier read the column otherwise;
 * then every calendar item is written to read exactly the named columns.
 */

import type { CandidateTableInput } from '@adminium/widgets/generate';
import type { QueryDescriptor } from '@adminium/widgets/page-config';

/** The calendar items that read the columns: the grid, and the agenda beside it. */
const CALENDAR_WIDGETS: readonly string[] = ['calendar-month', 'day-agenda'];

const DATE_TYPES: ReadonlySet<string> = new Set(['date', 'timestamp', 'timestamptz']);

/** The columns a calendar reads, as an app or a booking rule names them. */
export interface CalendarColumns {
  /** The date or time each row is plotted at. */
  start: string;
  /** Where it ends, for a row that spans time. */
  end?: string | undefined;
  /** What each row is called: a column, or `<fk column>.<column>` of the table it points at. */
  title?: string | undefined;
  /** What colours and filters the rows. */
  category?: string | undefined;
}

/** `patient_id.name` → the key column and the column it reads; a plain column → null. */
export function calendarTitleThrough(title: string | undefined): { column: string; label: string } | null {
  if (title === undefined) return null;
  const at = title.indexOf('.');
  return at <= 0 ? null : { column: title.slice(0, at), label: title.slice(at + 1) };
}

/** Why `entry` cannot be plotted by these columns, or null. */
export function calendarColumnsProblem(entry: CandidateTableInput, calendar: CalendarColumns): string | null {
  const columns = new Map(entry.table.columns.map((column) => [column.name, column]));
  const table = entry.table.name;
  for (const [role, name] of [
    ['start', calendar.start],
    ['end', calendar.end],
  ] as const) {
    if (name === undefined) continue;
    const column = columns.get(name);
    if (column === undefined) return `${table} has no column ${name} for the calendar's ${role}`;
    if (!DATE_TYPES.has(column.logicalType)) return `${table}.${name} is not a date or a time, so the calendar cannot plot by it`;
  }
  if (calendar.category !== undefined && !columns.has(calendar.category)) {
    return `${table} has no column ${calendar.category} for the calendar's category`;
  }
  const through = calendarTitleThrough(calendar.title);
  if (calendar.title !== undefined && through === null && !columns.has(calendar.title)) {
    return `${table} has no column ${calendar.title} for the calendar's title`;
  }
  return null;
}

/**
 * The table as the calendar rule should see it: the start column is its event
 * date, and a title column that is the table's own is its display column.
 */
export function calendarEntry(entry: CandidateTableInput, calendar: CalendarColumns): CandidateTableInput {
  const title = calendar.title !== undefined && calendarTitleThrough(calendar.title) === null ? calendar.title : undefined;
  const tagged = entry.classified.columns.some((c) => c.column === calendar.start);
  const columns = entry.classified.columns.map((c) =>
    c.column === calendar.start ? { ...c, semantic: 'event-timestamp', pair: null } : c,
  );
  return {
    table: entry.table,
    classified: {
      ...entry.classified,
      ...(title === undefined ? {} : { displayColumn: title }),
      columns: tagged ? columns : [...columns, { column: calendar.start, semantic: 'event-timestamp' }],
    },
  };
}

/**
 * Every calendar item of a composed envelope, reading the named columns:
 * plotted and sorted by `start`, ended by `end` (or by nothing), titled by
 * `titleColumn`, coloured by `category`, each read by the item's query.
 */
export function applyCalendarColumns(
  envelope: Record<string, unknown>,
  calendar: CalendarColumns,
  titleColumn: string | undefined,
): Record<string, unknown> {
  const config = envelope['config'] as Record<string, unknown>;
  const layout = config['layout'] as { items: { i: string; widget: string; config: Record<string, unknown> }[] };
  const read = [calendar.start, calendar.end, calendar.category, titleColumn].filter((c): c is string => c !== undefined);
  const items = layout.items.map((item) => {
    if (!CALENDAR_WIDGETS.includes(item.widget)) return item;
    const next: Record<string, unknown> = { ...item.config, startColumn: calendar.start };
    delete next['dateColumn'];
    if (calendar.end === undefined) delete next['endColumn'];
    else next['endColumn'] = calendar.end;
    if (titleColumn !== undefined) next['titleColumn'] = titleColumn;
    if (calendar.category !== undefined) next['categoryColumn'] = calendar.category;
    const binding = item.config['binding'] as QueryDescriptor | undefined;
    if (binding !== undefined) {
      const select = binding.select === undefined ? undefined : [...binding.select, ...read.filter((c) => !binding.select!.includes(c))];
      next['binding'] = {
        ...binding,
        ...(select === undefined ? {} : { select }),
        orderBy: [{ column: calendar.start, dir: 'asc' }],
      };
    }
    return { ...item, config: next };
  });
  return { ...envelope, config: { ...config, layout: { ...layout, items } } };
}

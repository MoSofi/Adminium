// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FILTERS A LINK OPENED THIS LIST WITH — one chip each.
 *
 * A metric card that says "Overdue: $3,120" leads here with the overdue
 * invoices only. Without a chip that list would look like the whole table,
 * so every piece of the link is drawn: the ones in force as removable filter
 * chips, and the ones the server left out (a column this table does not have,
 * a value the column cannot hold) as warning chips that SAY they were left
 * out — a link that could not be followed exactly never passes for one that
 * was.
 *
 * The host works the pieces out (on the server: "today" is the venue's) and
 * hands them here as it got them; this only puts them into words.
 */
import { Tag } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

/** One piece of a link, as the server worked it out. */
export type PageCrudLinkFilter =
  | { column: string; raw: string; status: 'applied'; op: string; value: string | null }
  | { column: string; raw: string; status: 'ignored'; reason: string };

type T = ReturnType<typeof useMaybeT>;

export interface LinkFilterChipsProps {
  filters: readonly PageCrudLinkFilter[];
  /** What a person calls a column ("Due on"), and the words for its values. */
  describeColumn: (column: string) => { label: string; valueLabel: (value: string) => string };
  /** Drop one piece (by its position) — the host rewrites the address. */
  onRemove: (index: number) => void;
}

export function LinkFilterChips({ filters, describeColumn, onRemove }: LinkFilterChipsProps) {
  const t = useMaybeT();
  if (filters.length === 0) return null;
  return (
    <>
      {filters.map((filter, index) => {
        const column = describeColumn(filter.column);
        const ignored = filter.status === 'ignored';
        return (
          <Tag
            key={`${filter.column}\u0000${filter.raw}\u0000${String(index)}`}
            tone={ignored ? 'warn' : 'accent'}
            data-testid={ignored ? 'link-filter-ignored' : 'link-filter'}
            onRemove={() => onRemove(index)}
            removeLabel={t('ui:templates.crud.linkFilter.remove', 'Remove {column} filter', { column: column.label })}
          >
            {ignored ? ignoredWords(filter, column.label, t) : appliedWords(filter, column, t)}
          </Tag>
        );
      })}
    </>
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What an applied piece says: the column's name, then the condition in words. */
function appliedWords(
  filter: Extract<PageCrudLinkFilter, { status: 'applied' }>,
  column: { label: string; valueLabel: (value: string) => string },
  t: T,
): string {
  const name = column.label;
  const raw = filter.value ?? '';
  const isDay = raw === 'today' || DAY.test(raw);
  const value = raw === 'today' ? t('ui:templates.crud.linkFilter.today', 'today') : column.valueLabel(raw);
  switch (filter.op) {
    case 'eq':
      return t('ui:templates.crud.linkFilter.eq', '{name} is {value}', { name, value });
    case 'neq':
      return t('ui:templates.crud.linkFilter.neq', '{name} is not {value}', { name, value });
    case 'in':
      return t('ui:templates.crud.linkFilter.in', '{name} is one of {values}', {
        name,
        values: raw
          .split(',')
          .map((item) => column.valueLabel(item.trim()))
          .join(', '),
      });
    case 'gt':
      return isDay
        ? t('ui:templates.crud.linkFilter.after', '{name} after {value}', { name, value })
        : t('ui:templates.crud.linkFilter.gt', '{name} more than {value}', { name, value });
    case 'gte':
      return isDay
        ? t('ui:templates.crud.linkFilter.onOrAfter', '{name} on or after {value}', { name, value })
        : t('ui:templates.crud.linkFilter.gte', '{name} {value} or more', { name, value });
    case 'lt':
      return isDay
        ? t('ui:templates.crud.linkFilter.before', '{name} before {value}', { name, value })
        : t('ui:templates.crud.linkFilter.lt', '{name} less than {value}', { name, value });
    case 'lte':
      return isDay
        ? t('ui:templates.crud.linkFilter.onOrBefore', '{name} on or before {value}', { name, value })
        : t('ui:templates.crud.linkFilter.lte', '{name} {value} or less', { name, value });
    case 'before':
      return t('ui:templates.crud.linkFilter.before', '{name} before {value}', { name, value });
    case 'after':
      return t('ui:templates.crud.linkFilter.after', '{name} after {value}', { name, value });
    case 'month':
      return raw === 'last'
        ? t('ui:templates.crud.linkFilter.lastMonth', '{name} last month', { name })
        : t('ui:templates.crud.linkFilter.thisMonth', '{name} this month', { name });
    case 'set':
      return t('ui:templates.crud.linkFilter.set', '{name} is filled in', { name });
    case 'unset':
      return t('ui:templates.crud.linkFilter.unset', '{name} is empty', { name });
    default:
      return t('ui:templates.crud.filters.chip', '{name}: {values}', { name, values: filter.raw });
  }
}

/** What a left-out piece says: which one, and why it was not used. */
function ignoredWords(filter: Extract<PageCrudLinkFilter, { status: 'ignored' }>, name: string, t: T): string {
  switch (filter.reason) {
    case 'unknown-column':
      return t('ui:templates.crud.linkFilter.ignoredColumn', 'Not filtered by {name}: this list has no such column', { name });
    case 'masked-column':
      return t('ui:templates.crud.linkFilter.ignoredMasked', 'Not filtered by {name}: that column is hidden from you', { name });
    case 'too-many':
      return t('ui:templates.crud.linkFilter.ignoredTooMany', 'Not filtered by {name}: a link can carry 8 filters', { name });
    default:
      return t('ui:templates.crud.linkFilter.ignoredValue', 'Not filtered by {name}: “{filter}” is not a filter this column takes', {
        name,
        filter: filter.raw,
      });
  }
}

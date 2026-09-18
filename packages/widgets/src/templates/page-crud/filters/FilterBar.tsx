// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FILTER BAR: the buttons an admin defined, the chips they produce, and
 * one Clear (D8, F4, F12, F13, F18).
 *
 * ─── Six controls, one menu anatomy ────────────────────────────────────────
 *
 * Every menu is the comp's meta-pill menu (151–178): 12.5px rows in a popover,
 * the chosen one tinted and bold, a 6px dot where a value carries a tone. What
 * differs is only what a row MEANS — one of picks, any of ticks and stays
 * open, yes-no is two rows, a record is the reference picker, and the two
 * ranges are a pair of inputs (F12) or a preset track (F13).
 *
 * ─── The chip says what was chosen, in words ───────────────────────────────
 *
 * `status = seen` is a debugger's chip. This one reads "Status: Seen" — the
 * filter's own name and the value's LABEL — because the person reading it
 * chose from a menu of labels and has no idea what the column is called.
 */
import {
  Button,
  Combobox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Tag,
  type ComboboxOption,
} from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { CrudApi, CrudFilterCondition } from '../crud-api.js';
import type { ControlOption } from '../controls/index.js';
import type { FilterControl } from '../../../page-config/index.js';

/** One filter as the bar renders it: what it is called, and what it offers. */
export interface FilterSpec {
  column: string;
  control: FilterControl;
  /** The button's and the chip's name. */
  label: string;
  /** Rows for `one-of` / `any-of`; empty for every other control. */
  options: readonly ControlOption[];
  /** A reference's picker, rendered inside the menu (D21's control). */
  picker?: ReactNode | undefined;
}

export interface FilterBarProps {
  filters: readonly FilterSpec[];
  /** The conditions in force, which the chips and the menus read back. */
  active: readonly CrudFilterCondition[];
  onChange: (next: CrudFilterCondition[]) => void;
}

/** The date presets the UI Kit's track draws (F13). */
const DATE_PRESETS = [7, 30, 90] as const;

export function FilterBar({ filters, active, onChange }: FilterBarProps) {
  const t = useMaybeT();
  if (filters.length === 0 && active.length === 0) return null;

  const conditionFor = (column: string): CrudFilterCondition | undefined =>
    active.find((condition) => condition.column === column);

  const set = (column: string, condition: CrudFilterCondition | null): void => {
    const rest = active.filter((current) => current.column !== column);
    onChange(condition === null ? rest : [...rest, condition]);
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="filter-bar">
      {filters.map((filter) => (
        <FilterMenu
          key={filter.column}
          filter={filter}
          condition={conditionFor(filter.column)}
          onSet={(condition) => set(filter.column, condition)}
        />
      ))}
      {active.map((condition) => {
        const filter = filters.find((candidate) => candidate.column === condition.column);
        return (
          <Tag
            key={condition.column}
            tone="accent"
            onRemove={() => set(condition.column, null)}
            removeLabel={t('ui:templates.crud.removeFilter', 'Remove {column} filter', {
              column: filter?.label ?? condition.column,
            })}
          >
            {/* The separator is the LOCALE's, not a hard-coded colon: zh-CN
                writes a full-width one and fr-FR puts a space before it. */}
            {t('ui:templates.crud.filters.chip', '{name}: {values}', {
              name: filter?.label ?? condition.column,
              values: describe(condition, filter, t),
            })}
          </Tag>
        );
      })}
      {active.length === 0 ? null : (
        <Button size="sm" variant="ghost" onClick={() => onChange([])} data-testid="filter-clear">
          {t('ui:templates.common.clearFilters', 'Clear filters')}
        </Button>
      )}
    </div>
  );
}

/** What a chip says: labels, never raw values. */
function describe(
  condition: CrudFilterCondition,
  filter: FilterSpec | undefined,
  t: ReturnType<typeof useMaybeT>,
): string {
  const labelOf = (value: unknown): string => {
    const found = filter?.options.find((option) => option.value === String(value));
    return found?.label ?? String(value);
  };
  if (condition.op === 'in' && Array.isArray(condition.value)) {
    return (condition.value as unknown[]).map(labelOf).join(', ');
  }
  if (condition.op === 'between' && Array.isArray(condition.value)) {
    const [from, to] = condition.value as [unknown, unknown];
    return `${String(from)} – ${String(to)}`;
  }
  if (condition.op === 'gte') return t('ui:templates.crud.filters.from', 'from {value}', { value: String(condition.value) });
  if (condition.op === 'lte') return t('ui:templates.crud.filters.to', 'to {value}', { value: String(condition.value) });
  if (filter?.control === 'yes-no') {
    return condition.value === true || condition.value === 'true'
      ? t('ui:templates.crud.filters.yes', 'Yes')
      : t('ui:templates.crud.filters.no', 'No');
  }
  return labelOf(condition.value);
}

function FilterMenu({
  filter,
  condition,
  onSet,
}: {
  filter: FilterSpec;
  condition: CrudFilterCondition | undefined;
  onSet: (condition: CrudFilterCondition | null) => void;
}) {
  const t = useMaybeT();
  const [open, setOpen] = useState(false);
  const chosen = condition === undefined ? null : condition;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* A SET filter wears the comp's own set-chip treatment — accent on
            accent-soft, bolder — rather than a solid accent fill: a toolbar
            with two solid buttons in it reads as two calls to action, and the
            one call to action on this row is New row. */}
        <Button
          size="sm"
          variant="secondary"
          className={chosen === null ? undefined : 'border-accent bg-accent-soft font-bold text-accent'}
          data-testid={`filter-open-${filter.column}`}
        >
          {filter.label}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="min-w-[210px] p-[5px]">
        {filter.control === 'one-of' || filter.control === 'any-of' ? (
          <ChoiceRows filter={filter} condition={chosen} onSet={onSet} onClose={() => setOpen(false)} />
        ) : filter.control === 'yes-no' ? (
          <ul>
            {[true, false].map((value) => (
              <li key={String(value)}>
                <MenuRow
                  current={chosen?.value === value}
                  label={value ? t('ui:templates.crud.filters.yes', 'Yes') : t('ui:templates.crud.filters.no', 'No')}
                  testId={`filter-row-${filter.column}-${String(value)}`}
                  onClick={() => {
                    // Re-clicking the chosen row clears it (comp 611).
                    onSet(chosen?.value === value ? null : { column: filter.column, op: 'eq', value });
                    setOpen(false);
                  }}
                />
              </li>
            ))}
          </ul>
        ) : filter.control === 'record' ? (
          <div className="p-1">{filter.picker}</div>
        ) : filter.control === 'number-range' ? (
          <RangeInputs
            kind="number"
            condition={chosen}
            column={filter.column}
            onSet={onSet}
            fromLabel={t('ui:templates.crud.filters.rangeFrom', 'From')}
            toLabel={t('ui:templates.crud.filters.rangeTo', 'To')}
          />
        ) : (
          <DateRange filter={filter} condition={chosen} onSet={onSet} onClose={() => setOpen(false)} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuRow({
  current,
  label,
  tone,
  tick,
  testId,
  onClick,
}: {
  current: boolean;
  label: string;
  tone?: string | undefined;
  tick?: boolean | undefined;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[12.5px] ${
        current ? 'bg-accent-soft font-bold text-accent' : 'text-fg hover:bg-surface-2'
      }`}
    >
      {tone === undefined ? null : (
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tone] ?? 'bg-fg-subtle'}`} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {tick === true && current ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
    </button>
  );
}

function ChoiceRows({
  filter,
  condition,
  onSet,
  onClose,
}: {
  filter: FilterSpec;
  condition: CrudFilterCondition | null;
  onSet: (condition: CrudFilterCondition | null) => void;
  onClose: () => void;
}) {
  const many = filter.control === 'any-of';
  const chosen = new Set(
    condition === null
      ? []
      : Array.isArray(condition.value)
        ? (condition.value as unknown[]).map((value) => String(value))
        : [String(condition.value)],
  );
  return (
    <ul>
      {filter.options.map((option) => (
        <li key={option.value}>
          <MenuRow
            current={chosen.has(option.value)}
            label={option.label ?? option.value}
            {...(option.tone === undefined ? {} : { tone: option.tone })}
            tick={many}
            testId={`filter-row-${filter.column}-${option.value}`}
            onClick={() => {
              if (!many) {
                onSet(chosen.has(option.value) ? null : { column: filter.column, op: 'eq', value: option.value });
                onClose();
                return;
              }
              // ANY OF stays open: choosing three values is three clicks, and a
              // menu that closed after each would be three journeys.
              const next = new Set(chosen);
              if (next.has(option.value)) next.delete(option.value);
              else next.add(option.value);
              onSet(next.size === 0 ? null : { column: filter.column, op: 'in', value: [...next] });
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * From · To, as two of the comp's inputs (F12).
 *
 * One end is a `gte` or an `lte`; both are a `between`. The server's grammar
 * already has all three, so a half-filled range is a real filter rather than a
 * refusal — which is what somebody typing "everything over 100" means.
 */
function RangeInputs({
  kind,
  column,
  condition,
  onSet,
  fromLabel,
  toLabel,
}: {
  kind: 'number' | 'date';
  column: string;
  condition: CrudFilterCondition | null;
  onSet: (condition: CrudFilterCondition | null) => void;
  fromLabel: string;
  toLabel: string;
}) {
  const [from, to] = boundsOf(condition);
  const commit = (nextFrom: string, nextTo: string): void => {
    const lower = nextFrom.trim();
    const upper = nextTo.trim();
    const cast = (value: string): unknown => (kind === 'number' ? Number(value) : value);
    if (lower === '' && upper === '') return onSet(null);
    if (lower !== '' && upper !== '') {
      return onSet({ column, op: 'between', value: [cast(lower), cast(upper)] });
    }
    return onSet(
      lower !== ''
        ? { column, op: 'gte', value: cast(lower) }
        : { column, op: 'lte', value: cast(upper) },
    );
  };
  return (
    <div className="flex items-end gap-2 p-1">
      <label className="flex flex-1 flex-col gap-1 text-[11.5px] text-fg-muted">
        {fromLabel}
        <Input
          type={kind}
          value={from}
          data-testid={`filter-from-${column}`}
          onChange={(event) => commit(event.target.value, to)}
        />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-[11.5px] text-fg-muted">
        {toLabel}
        <Input
          type={kind}
          value={to}
          data-testid={`filter-to-${column}`}
          onChange={(event) => commit(from, event.target.value)}
        />
      </label>
    </div>
  );
}

function boundsOf(condition: CrudFilterCondition | null): [string, string] {
  if (condition === null) return ['', ''];
  if (condition.op === 'between' && Array.isArray(condition.value)) {
    const [from, to] = condition.value as [unknown, unknown];
    return [String(from), String(to)];
  }
  if (condition.op === 'gte') return [String(condition.value), ''];
  if (condition.op === 'lte') return ['', String(condition.value)];
  return ['', ''];
}

/**
 * The preset track, then Custom (F13).
 *
 * The presets are "the last N days", which is what a person means by 30d and
 * what the server can answer with one `gte` — a `between` would also pin the
 * upper end to the moment the menu was opened, which is a filter that goes
 * stale while it is on screen.
 */
function DateRange({
  filter,
  condition,
  onSet,
  onClose,
}: {
  filter: FilterSpec;
  condition: CrudFilterCondition | null;
  onSet: (condition: CrudFilterCondition | null) => void;
  onClose: () => void;
}) {
  const t = useMaybeT();
  const [custom, setCustom] = useState(condition?.op === 'between' || condition?.op === 'lte');
  return (
    <div className="flex flex-col gap-1">
      <SegmentedControl
        value={custom ? 'custom' : presetOf(condition)}
        onValueChange={(value) => {
          if (value === 'custom') {
            setCustom(true);
            return;
          }
          setCustom(false);
          onSet({ column: filter.column, op: 'gte', value: daysAgo(Number(value)) });
          onClose();
        }}
        options={[
          ...DATE_PRESETS.map((days) => ({
            value: String(days),
            label: t('ui:templates.crud.filters.days', '{days}d', { days }),
          })),
          { value: 'custom', label: t('ui:templates.crud.filters.custom', 'Custom') },
        ]}
        aria-label={filter.label}
      />
      {custom ? (
        <RangeInputs
          kind="date"
          column={filter.column}
          condition={condition}
          onSet={onSet}
          fromLabel={t('ui:templates.crud.filters.rangeFrom', 'From')}
          toLabel={t('ui:templates.crud.filters.rangeTo', 'To')}
        />
      ) : null}
    </div>
  );
}

/** Which preset a `gte` came from, so the track shows it chosen. */
function presetOf(condition: CrudFilterCondition | null): string {
  if (condition === null || condition.op !== 'gte') return '';
  for (const days of DATE_PRESETS) {
    if (daysAgo(days) === String(condition.value)) return String(days);
  }
  return '';
}

/** `YYYY-MM-DD`, N days back, in the reader's own calendar. */
function daysAgo(days: number): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** The 6px dots the comp draws beside a toned row (160, 744). */
const TONE_DOT: Record<string, string> = {
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  accent: 'bg-accent',
  info: 'bg-info',
  muted: 'bg-fg-subtle',
  neutral: 'bg-fg-subtle',
};

/**
 * A reference filter's menu: the picker, over the target (D21).
 *
 * The same control the form uses, because "which customer" is the same
 * question in both places — and because a menu of the first twenty rows of a
 * table with four thousand is a list that looks complete and is not (F14).
 */
export function ReferenceFilterPicker({
  column,
  lookup,
  value,
  onChange,
}: {
  column: { name: string; label: string; fk?: { table: string; column: string; display?: string | undefined } | undefined };
  lookup: CrudApi['lookup'] | undefined;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const t = useMaybeT();
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fk = column.fk;

  useEffect(() => {
    if (lookup === undefined || fk === undefined) return;
    let alive = true;
    void lookup({ table: fk.table, column: fk.column, ...(fk.display === undefined ? {} : { display: fk.display }) }, '').then(
      (loaded) => {
        if (alive) setOptions(loaded.map((option) => ({ value: option.value, label: option.label })));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [lookup, fk?.table, fk?.column, fk?.display]);

  if (lookup === undefined || fk === undefined) return null;
  return (
    <Combobox
      options={options}
      value={value === null || value === undefined ? null : String(value)}
      onValueChange={(next) => onChange(next)}
      emptyText={t('ui:combobox.noMatches', 'No matches')}
      placeholder={t('ui:templates.crud.searchPlaceholder', 'Search {table}…', { table: fk.table })}
      aria-label={column.label}
      filter={(option, query) => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          void lookup(
            { table: fk.table, column: fk.column, ...(fk.display === undefined ? {} : { display: fk.display }) },
            query,
          ).then((loaded) => setOptions(loaded.map((row) => ({ value: row.value, label: row.label }))), () => undefined);
        }, 200);
        return option.label.toLowerCase().includes(query.trim().toLowerCase());
      }}
    />
  );
}

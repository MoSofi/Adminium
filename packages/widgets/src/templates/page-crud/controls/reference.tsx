// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The reference picker, and the two read-only shapes.
 *
 * ─── What the field shows is the FIELD's decision ──────────────────────────
 *
 * Per field: which column is the NAME, up to two DETAIL columns joined by
 * " · ", and whether the row carries an avatar. The settings decide the
 * REQUEST as well as the row: the picker asks the list route for those columns
 * and no others, so a search no longer pulls whole rows — masked columns
 * included — to render one label.
 *
 * ─── Why this is the product's combobox and not a second picker ────────────
 *
 * The comp draws a button carrying the chosen row's avatar and name, which
 * opens a panel with its own search row. `Combobox` draws the same panel —
 * leading slot, name, detail line, tick, "No matches" — and its trigger is the
 * search field itself, which is the one departure: typing starts in the field
 * rather than in the panel. That buys the whole ARIA 1.2 combobox pattern
 * (`aria-activedescendant`, ↑/↓/↵/Esc) and the scroll-lock bypass that makes a
 * list scroll inside a dialog, both already tested. Building a second picker to
 * move the search box up by one row would have meant owning that twice.
 *
 * ─── A target the caller cannot read ───────────────────────────────────────
 *
 * The lookup answers 403 and the field goes DISABLED with the reason naming the
 * table (F16). The alternative — an empty picker — says "there is nothing to
 * choose", which is a different and untrue statement.
 */
import { Combobox, MonoText } from '@adminium/ui';
import type { ComboboxOption } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CrudApi, CrudLookupFields, CrudLookupOption } from '../crud-api.js';
import type { CrudFormColumnField } from '../../../page-config/index.js';
import type { GridColumnSpec } from '../../../families/tables/column-spec.js';
import type { ControlProps } from './types.js';

/** The debounce on the server-side search, unchanged from the old field. */
export const FK_LOOKUP_DEBOUNCE_MS = 200;

/**
 * The lookup spec, carrying the referenced table's display column when
 * generation stamped one. Without it the client has to guess a label from the
 * row's keys, which is wrong for any table whose display column is not in the
 * guess list.
 */
export function lookupFk(fk: NonNullable<GridColumnSpec['fk']>): { table: string; column: string; display?: string } {
  return { table: fk.table, column: fk.column, ...(fk.display === undefined ? {} : { display: fk.display }) };
}

/** The reference settings a field carries, as the lookup wants them. */
function lookupFields(reference: CrudFormColumnField['reference']): CrudLookupFields | undefined {
  if (reference === undefined) return undefined;
  const fields: CrudLookupFields = {};
  if (reference.name !== undefined) fields.name = reference.name;
  if (reference.detail !== undefined && reference.detail.length > 0) fields.detail = reference.detail;
  return Object.keys(fields).length === 0 ? undefined : fields;
}

/** The initials a row's avatar shows: the first letter of its first two words. */
export function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => [...word][0]?.toUpperCase() ?? '').join('') || '?';
}

/** HTTP 403 from the transport, whatever transport it is. */
function isForbidden(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 403;
}

function FkField({
  column,
  field,
  value,
  lookup,
  onChange,
  id,
  label,
}: {
  column: GridColumnSpec;
  field?: CrudFormColumnField | undefined;
  value: unknown;
  lookup: NonNullable<CrudApi['lookup']>;
  onChange: (next: unknown) => void;
  /** A name when there is no visible label — a cell in a line-items table. */
  label?: string | undefined;
  id?: string | undefined;
}) {
  const t = useMaybeT();
  const fk = column.fk as NonNullable<GridColumnSpec['fk']>;
  const reference = field?.reference;
  const fields = lookupFields(reference);
  const withAvatar = reference?.avatar === true;
  const [options, setOptions] = useState<CrudLookupOption[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (query: string, onLoaded: (loaded: CrudLookupOption[]) => void): void => {
    void lookup(lookupFk(fk), query, fields).then(onLoaded, (error: unknown) => {
      // Only a refusal disables the field. A dropped request is a dropped
      // request: the picker keeps whatever it has and the next keystroke tries
      // again, which is what it did before this existed.
      if (isForbidden(error)) setForbidden(true);
    });
  };

  // Initial option load (empty query → first page of choices).
  useEffect(() => {
    let alive = true;
    search('', (loaded) => {
      if (alive) setOptions(loaded);
    });
    return () => {
      alive = false;
    };
    // `search` is rebuilt every render; what it READS is in this list.
  }, [lookup, fk.table, fk.column, fk.display, fields?.name, fields?.detail?.join(',')]);

  const current = value === null || value === undefined ? null : String(value);

  const comboboxOptions: ComboboxOption[] = useMemo(() => {
    const rows = options.map((option) => {
      // The detail line the field asked for, else whatever the host described.
      const description = option.detail ?? option.description;
      return {
        value: option.value,
        label: option.label,
        ...(description === undefined || description === '' ? {} : { description }),
        ...(withAvatar ? { leading: <Initials label={option.label} /> } : {}),
      };
    });
    /*
     * A value the search does not return is still THIS record's value — a row
     * the target no longer has, or one past the first twenty. Showing its raw
     * key keeps the field honest; dropping it would blank a value nobody
     * touched the moment anything else was saved.
     */
    if (current !== null && current !== '' && !rows.some((row) => row.value === current)) {
      rows.unshift({ value: current, label: current });
    }
    return rows;
  }, [options, current, withAvatar]);

  if (forbidden) {
    return (
      <div className="flex flex-col gap-1">
        <input
          {...(id === undefined ? {} : { id })}
          disabled
          readOnly
          className="h-[34px] w-full rounded-md border border-border bg-surface-2 px-3 font-mono text-[13px] text-fg-muted"
          value={current ?? ''}
        />
        <p className="text-caption text-fg-subtle">
          {t('ui:formDialog.reference.noAccess', 'You cannot read {table}, so this cannot be changed here.', {
            table: fk.table,
          })}
        </p>
      </div>
    );
  }

  return (
    <Combobox
      {...(id === undefined ? {} : { id })}
      {...(label === undefined ? {} : { 'aria-label': label })}
      options={comboboxOptions}
      value={current}
      onValueChange={(next) => onChange(next)}
      emptyText={t('ui:combobox.noMatches', 'No matches')}
      placeholder={t('ui:templates.crud.searchPlaceholder', 'Search {table}…', { table: fk.table })}
      // Debounced server-side search on the display column
      // Combobox filters locally as well, so this only widens the option set.
      filter={(option, query) => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          search(query, setOptions);
        }, FK_LOOKUP_DEBOUNCE_MS);
        return option.label.toLowerCase().includes(query.trim().toLowerCase());
      }}
    />
  );
}

/** The comp's 26px gradient circle with the row's initials (212–223). */
function Initials({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent"
    >
      {initialsOf(label)}
    </span>
  );
}



export function ReferenceControl(props: ControlProps) {
  const lookup = props.lookup;
  if (lookup === undefined || props.column.fk === undefined) {
    // No transport, no picker: the raw key, which is what the field has always
    // degraded to rather than pretending to offer a search it cannot run.
    return (
      <input
        {...(props.id === undefined ? {} : { id: props.id })}
        {...(props['aria-label'] === undefined ? {} : { 'aria-label': props['aria-label'] })}
        className="h-[34px] w-full rounded-md border border-border-strong bg-surface-2 px-3 font-mono text-[13px] text-fg"
        value={props.value === null || props.value === undefined ? '' : String(props.value)}
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }
  return (
    <FkField
      column={props.column}
      {...(props.field === undefined ? {} : { field: props.field })}
      value={props.value}
      lookup={lookup}
      onChange={(next) => props.onChange(next)}
      {...(props.id === undefined ? {} : { id: props.id })}
      {...(props['aria-label'] === undefined ? {} : { label: props['aria-label'] })}
    />
  );
}

/**
 * A column the database computes: shown, never sent (comp — the mono value
 * with no chrome). The form keeps drawing it so an edit dialog can say what the
 * row holds, and the submit path skips it.
 */
export function ReadonlyControl(props: ControlProps) {
  const text =
    props.value === null || props.value === undefined
      ? '—'
      : typeof props.value === 'object'
        ? JSON.stringify(props.value)
        : String(props.value);
  return (
    <MonoText {...(props.id === undefined ? {} : { id: props.id })} className="text-body-sm text-fg-muted">
      {text === '' ? '—' : text}
    </MonoText>
  );
}

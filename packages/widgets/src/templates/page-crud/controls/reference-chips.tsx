// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SEVERAL references, as chips over a picker (F8; comp 253–256 inside 215–221).
 *
 * This is the control a link RELATION gets: its value is a list of target keys,
 * and what it writes is rows of a join table rather than a column of this one.
 * The field is a relation's, not a column's, so `RecordForm` hands it a
 * stand-in column carrying the target's table and key — which is all a picker
 * needs, and keeps this a registry entry like every other control rather than a
 * second rendering path.
 *
 * ─── What a chip is called ─────────────────────────────────────────────────
 *
 * `options` are the links this record already has, resolved by the host (the
 * page reply carries them with their names). A key with no option — one just
 * picked from the search, or one whose row has since gone — shows as ITSELF.
 * That is the same rule the single picker follows, and for the same reason: a
 * chip that vanishes because its label could not be found would be a link the
 * person cannot see they are about to save.
 */
import { Combobox, Tag } from '@adminium/ui';
import type { ComboboxOption } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CrudLookupOption } from '../crud-api.js';
import type { ControlOption, ControlProps } from './types.js';
import { FK_LOOKUP_DEBOUNCE_MS, lookupFk } from './reference.js';

/** Fifty chips is a list; past that the record's related tab is the surface. */
export const MAX_LINK_CHIPS = 50;

function asKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
}

export function ReferenceChipsControl(props: ControlProps) {
  const t = useMaybeT();
  const fk = props.column.fk;
  const keys = asKeys(props.value);
  const [found, setFound] = useState<CrudLookupOption[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookup = props.lookup;

  useEffect(() => {
    if (lookup === undefined || fk === undefined) return;
    let alive = true;
    void lookup(lookupFk(fk), '').then(
      (loaded) => {
        if (alive) setFound(loaded);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [lookup, fk?.table, fk?.column, fk?.display]);

  /** Every label this control knows: the record's own links, then the search. */
  const labels = useMemo(() => {
    const map = new Map<string, ControlOption>();
    for (const option of props.options) map.set(option.value, option);
    for (const option of found) {
      if (!map.has(option.value)) {
        map.set(option.value, {
          value: option.value,
          label: option.label,
          ...(option.detail === undefined ? {} : { description: option.detail }),
        });
      }
    }
    return map;
  }, [props.options, found]);

  const remaining: ComboboxOption[] = useMemo(
    () =>
      [...labels.values()]
        .filter((option) => !keys.includes(option.value))
        .map((option) => ({
          value: option.value,
          label: option.label ?? option.value,
          ...(option.description === undefined ? {} : { description: option.description }),
        })),
    [labels, keys],
  );

  const set = (next: string[]): void => props.onChange(next);

  return (
    <div className="flex flex-col gap-2">
      {keys.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1.5" data-testid="reference-chips">
          {keys.map((key) => (
            <li key={key}>
              <Tag
                tone="accent"
                {...(props.disabled === true
                  ? {}
                  : { onRemove: () => set(keys.filter((other) => other !== key)) })}
                removeLabel={t('ui:formDialog.control.removeChip', 'Remove {value}', {
                  value: labels.get(key)?.label ?? key,
                })}
              >
                {labels.get(key)?.label ?? key}
              </Tag>
            </li>
          ))}
        </ul>
      )}
      {lookup === undefined || fk === undefined || keys.length >= MAX_LINK_CHIPS ? null : (
        <Combobox
          {...(props.id === undefined ? {} : { id: props.id })}
          options={remaining}
          value={null}
          onValueChange={(next) => {
            if (next !== null && !keys.includes(next)) set([...keys, next]);
          }}
          emptyText={t('ui:combobox.noMatches', 'No matches')}
          placeholder={t('ui:templates.crud.searchPlaceholder', 'Search {table}…', { table: fk.table })}
          {...(props.disabled === true ? { disabled: true } : {})}
          filter={(option, query) => {
            if (timer.current !== null) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              void lookup(lookupFk(fk), query).then(setFound, () => undefined);
            }, FK_LOOKUP_DEBOUNCE_MS);
            return option.label.toLowerCase().includes(query.trim().toLowerCase());
          }}
        />
      )}
    </div>
  );
}

/**
 * The stand-in column a relation field's control is rendered with.
 *
 * A relation has no column, and every control takes one — so it is given the
 * only things a picker actually reads: what the field is called, and where the
 * records come from. The `rel:` name is never sent anywhere; the links travel
 * under their relation id.
 */
export function relationColumnShape(input: {
  relationId: string;
  label: string;
  targetTable: string;
  targetKey: string;
  targetName?: string | undefined;
}): Record<string, unknown> {
  return {
    name: `rel:${input.relationId}`,
    label: input.label,
    logicalType: 'json',
    nullable: true,
    fk: {
      table: input.targetTable,
      column: input.targetKey,
      // What a chip shows. Without it the picker falls back to the row's first
      // text column, which for a table keyed by a code is the code again.
      ...(input.targetName === undefined ? {} : { display: input.targetName }),
    },
  };
}

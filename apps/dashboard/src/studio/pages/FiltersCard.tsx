// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FILTERS CARD — which questions this page's toolbar can ask.
 *
 * ─── It opens on the filters the page already has ──────────────────────────
 *
 * A page that has never been configured still shows filters: the derivation
 * offers the one or two its own columns justify. So this card opens on THOSE,
 * from the same leaf the running toolbar reads, rather than on an empty list
 * that would make the page look unfiltered while it is not. And a list that
 * still says what the derivation says is not stored — freezing it would stop
 * the toolbar following the table the day a `status` column arrives.
 *
 * ─── Only the controls a column can answer ─────────────────────────────────
 *
 * The control select offers `legalFilterControls(column)`: a boolean has no
 * date range, and a text column no menu of values. Offering one would produce
 * a button that opens onto nothing — the filter equivalent of a dead link.
 *
 * ─── One Save, the screen's ────────────────────────────────────────────────
 *
 * Like the form designer beside it, this card reports its draft upward and
 * persists nothing itself.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, IconButton, Input, MonoText, Select } from '@adminium/ui';
import {
  deriveFilters,
  filterControlFor,
  legalFilterControls,
  MAX_FILTERS,
  type CrudFilterField,
  type FilterColumnFact,
} from '@adminium/engine/config';

import { t } from '../../i18n/t.js';
import type { FormColumnFactReply } from '../../api/pages.js';

export interface FiltersCardProps {
  /** The page's stored `config.filters`, or null when it has none. */
  stored: CrudFilterField[] | null;
  columns: readonly FormColumnFactReply[];
  /** The draft, reported upward on every edit. `null` ⇒ back to derived. */
  onChange: (draft: CrudFilterField[] | null) => void;
}

/**
 * The columns this table can be filtered by at all, in table order.
 *
 * `options` rides BESIDE the spec in the reply and inside it in the shape the
 * leaf reads — merged here, because a column an admin gave a list of allowed
 * values IS a choice column, and reading only the spec would offer it no menu.
 */
function filterableFacts(columns: readonly FormColumnFactReply[]): FilterColumnFact[] {
  return columns.map((column, index) => ({
    spec: { ...column.spec, ...(column.options === undefined ? {} : { options: column.options }) } as never,
    ordinal: column.ordinal ?? index,
  }));
}

export function FiltersCard({ stored, columns, onChange }: FiltersCardProps) {
  const facts = useMemo(() => filterableFacts(columns), [columns]);
  const derived = useMemo(() => deriveFilters({ columns: facts }), [facts]);
  const [draft, setDraft] = useState<CrudFilterField[]>(stored ?? derived);

  const byName = useMemo(() => new Map(facts.map((fact) => [fact.spec.name, fact])), [facts]);
  const used = new Set(draft.map((filter) => filter.column));
  const addable = facts.filter(
    (fact) => !used.has(fact.spec.name) && filterControlFor(fact.spec) !== null,
  );

  /**
   * Report the draft, saying `null` when it is the derived list again — the
   * three-state contract the screen's `filtersDraft` is built on.
   */
  function report(next: CrudFilterField[]): void {
    setDraft(next);
    onChange(JSON.stringify(next) === JSON.stringify(derived) ? null : next);
  }

  function move(index: number, by: -1 | 1): void {
    const target = index + by;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    const [row] = next.splice(index, 1);
    if (row === undefined) return;
    next.splice(target, 0, row);
    report(next);
  }

  function patch(index: number, change: Partial<CrudFilterField>): void {
    report(draft.map((filter, at) => (at === index ? { ...filter, ...change } : filter)));
  }

  return (
    <Card data-testid="filters-card">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-section text-fg">{t('studio:pages.filters.title', 'Filters')}</h2>
          <p className="text-body-sm text-fg-muted">
            {t(
              'studio:pages.filters.subtitle',
              'The questions the toolbar can ask about this table. Untouched, it follows the table.',
            )}
          </p>
        </div>
        {stored === null && draft === derived ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(derived);
              onChange(null);
            }}
            data-testid="filters-reset"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {t('studio:pages.filters.reset', 'Back to the suggested filters')}
          </Button>
        )}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {draft.length === 0 ? (
          <p className="text-body-sm text-fg-subtle">
            {t('studio:pages.filters.empty', 'This page has no filters. Add one below.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {draft.map((filter, index) => {
              const fact = byName.get(filter.column);
              const legal = fact === undefined ? [] : legalFilterControls(fact.spec);
              return (
                <li
                  key={filter.column}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-2 p-2"
                  data-testid="filters-row"
                  data-filter={filter.column}
                >
                  <MonoText className="pb-2 text-[11px] text-fg-subtle">{filter.column}</MonoText>
                  <Input
                    className="min-w-0 flex-1"
                    value={filter.label ?? ''}
                    placeholder={filter.column}
                    aria-label={t('studio:pages.filters.name', 'Name for {column}', {
                      column: filter.column,
                    })}
                    onChange={(event) => {
                      const label = event.target.value;
                      patch(index, label.trim() === '' ? { label: undefined } : { label });
                    }}
                    data-testid={`filters-name-${filter.column}`}
                  />
                  <Select
                    value={filter.control ?? ''}
                    aria-label={t('studio:pages.filters.control', 'Control for {column}', {
                      column: filter.column,
                    })}
                    onChange={(event) =>
                      patch(index, { control: event.target.value as CrudFilterField['control'] })
                    }
                    data-testid={`filters-control-${filter.column}`}
                  >
                    {legal.map((control) => (
                      <option key={control} value={control}>
                        {control}
                      </option>
                    ))}
                  </Select>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    tooltip
                    label={t('studio:pages.filters.up', 'Move {column} up', { column: filter.column })}
                    onClick={() => move(index, -1)}
                    data-testid="filters-up"
                  >
                    <ChevronUp className="size-4" />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    tooltip
                    label={t('studio:pages.filters.down', 'Move {column} down', {
                      column: filter.column,
                    })}
                    onClick={() => move(index, 1)}
                    data-testid="filters-down"
                  >
                    <ChevronDown className="size-4" />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    tooltip
                    label={t('studio:pages.filters.remove', 'Remove {column} filter', {
                      column: filter.column,
                    })}
                    onClick={() => report(draft.filter((_, at) => at !== index))}
                    data-testid="filters-remove"
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}

        {/* A row of six buttons over a table is chrome, and the leaf refuses to
            store more than that — so the picker closes rather than offering an
            add that the save would reject. */}
        {draft.length >= MAX_FILTERS ? (
          <p className="text-body-sm text-fg-subtle">
            {t('studio:pages.filters.full', 'A page shows at most {max} filters.', {
              max: MAX_FILTERS,
            })}
          </p>
        ) : addable.length === 0 ? null : (
          <div className="flex flex-wrap items-end gap-2">
            <Select
              value=""
              aria-label={t('studio:pages.filters.add', 'Add a filter')}
              onChange={(event) => {
                const name = event.target.value;
                const fact = byName.get(name);
                if (fact === undefined) return;
                const control = filterControlFor(fact.spec);
                if (control === null) return;
                report([...draft, { column: name, control }]);
              }}
              data-testid="filters-add"
            >
              <option value="">{t('studio:pages.filters.add', 'Add a filter')}</option>
              {addable.map((fact) => (
                <option key={fact.spec.name} value={fact.spec.name}>
                  {fact.spec.name}
                </option>
              ))}
            </Select>
            <Plus className="mb-2 size-4 text-fg-subtle" aria-hidden="true" />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

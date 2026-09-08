// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The end pane of step 2 — "Add columns" (comp 261-452): the search, the
 * schema warning, the Suggested chips, the "From <table>" rows, the linked
 * tables with their chevrons, the tables that link here with the fold row,
 * the collapsed Calculated forms, and the followed-link view with its
 * breadcrumb and hop note.
 */
import { useMemo, useState } from 'react';
import { Badge, IconButton, SearchInput, Select, cn } from '@adminium/ui';
import { ArrowLeft, ChevronDown, ChevronRight, Link as LinkIcon, Lock, Plus, Sigma, TriangleAlert, X } from 'lucide-react';
import { MEASURE_FNS, type MeasureFn } from '@adminium/engine/config';

import type { SchemaColumn, SchemaReply, SchemaTable } from '../../studio/api.js';
import {
  addableColumns,
  displayableColumns,
  fkColumns,
  findTable,
  inboundLinks,
  numericColumns,
  type InboundLink,
} from '../../studio/pages/columnSpecBuilder.js';
import { CalculatedForms } from './CalculatedForms.js';
import { BADGE_LABEL, FOLD_LABEL, copy } from './copy.js';
import {
  MAX_CALCULATED,
  MAX_FOLD_FACTORS,
  MAX_HOPS,
  MAX_LINKED,
  MAX_TOTALS,
  calculatedCount,
  linkedCount,
  mkBase,
  mkCount,
  mkFold,
  mkLinked,
  suggestionsFor,
  takenNames,
  totalsCount,
  type CalcAuthored,
  type Draft,
  type DraftColumn,
  type LinkHop,
} from './model.js';
import type { Measure } from '@adminium/engine/config';

export interface ColumnBrowserProps {
  schema: SchemaReply;
  table: SchemaTable;
  draft: Draft;
  onAdd: (column: DraftColumn, extra?: { measure?: Measure; field?: undefined }) => void;
  onAddCalc: (authored: CalcAuthored) => void;
  onToast: (message: string) => void;
  /** Whether the pane is a sheet (mobile) with its own close. */
  onClose?: (() => void) | undefined;
  schemaChanged?: boolean | undefined;
}

function matches(query: string, text: string): boolean {
  return query === '' || text.toLowerCase().includes(query);
}

function isPii(column: SchemaColumn): boolean {
  const pii = column.semantics?.flags?.pii;
  return typeof pii === 'string' && pii.length > 0;
}

export function ColumnBrowser({ schema, table, draft, onAdd, onAddCalc, onToast, onClose, schemaChanged }: ColumnBrowserProps) {
  const [query, setQuery] = useState('');
  const [path, setPath] = useState<LinkHop[]>([]);
  const [calcOpen, setCalcOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const taken = useMemo(() => takenNames(draft), [draft]);
  const inFile = useMemo(() => new Set(draft.columns.map((column) => column.id)), [draft]);
  const present = useMemo(
    () => new Set(draft.columns.filter((column) => column.kind === 'base').map((column) => column.spec.name)),
    [draft],
  );

  const linkedSpent = linkedCount(draft) >= MAX_LINKED;
  const totalsSpent = totalsCount(draft) >= MAX_TOTALS;
  const calcSpent = calculatedCount(draft) >= MAX_CALCULATED;

  const reached = path.length === 0 ? table : path[path.length - 1]?.table ?? null;
  const following = path.length > 0;
  // The chain no longer resolves (schema drift mid-edit): say so, honestly.
  const broken = following && (reached === null || findTable(schema, reached.id) === null);

  const suggestions = useMemo(
    () => (following ? [] : suggestionsFor(schema, table).filter((suggestion) => !inFile.has(suggestion.id))),
    [schema, table, following, inFile],
  );
  const baseRows = following ? [] : addableColumns(table, present).filter((column) => matches(q, column.name));
  const outbound = following ? [] : fkColumns(table).filter((column) => matches(q, column.name) || matches(q, linkTitle(schema, column)));
  const inbound = following ? [] : inboundLinks(schema, table).filter((link) => matches(q, link.table.name));
  const reachedRows = following && reached !== null ? displayableColumns(reached).filter((column) => matches(q, column.name)) : [];

  function budgetChip(used: number, max: number, spent: boolean) {
    return (
      <span
        className={cn(
          'rounded-full px-[7px] py-0.5 font-mono text-[10px] font-bold',
          spent ? 'bg-warn-soft text-warn' : 'bg-surface-3 text-fg-subtle',
        )}
      >
        {copy.budget(used, max)}
      </span>
    );
  }

  return (
    <div
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card lg:sticky lg:top-24 lg:max-h-[calc(100vh-140px)]"
      data-testid="export-builder-browser"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <div className="flex-1 text-[13.5px] font-extrabold text-fg">{copy.addColumns()}</div>
        {onClose === undefined ? null : (
          <IconButton variant="bordered" size="md" label={copy.cancel()} onClick={onClose}>
            <X className="size-[15px]" />
          </IconButton>
        )}
      </div>
      <div className="border-b border-border px-4 py-3">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={copy.browserSearch()}
          aria-label={copy.browserSearch()}
          data-testid="export-builder-browser-search"
        />
      </div>

      <div className="overflow-auto pb-3 pt-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" tabIndex={0} role="region" aria-label={copy.addColumns()}>
        {schemaChanged === true || broken ? (
          <div className="mx-4 my-3 flex items-start gap-2 rounded-[11px] border border-warn bg-warn-soft px-3 py-[11px] text-warn">
            <TriangleAlert className="mt-px size-[15px] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-[12px] font-extrabold">{copy.broken()}</div>
              <button
                type="button"
                onClick={() => {
                  setPath([]);
                  setQuery('');
                }}
                className="mt-1.5 text-[11.5px] font-extrabold underline"
              >
                {copy.brokenBack()}
              </button>
            </div>
          </div>
        ) : null}

        {!following ? (
          <>
            {suggestions.length > 0 ? (
              <div className="px-4 pb-1 pt-3">
                <Heading>{copy.suggested()}</Heading>
                <div className="flex flex-wrap gap-[7px]">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.key}
                      type="button"
                      onClick={() => {
                        const built = suggestion.build(taken);
                        onAdd(built.column, built.measure === undefined ? undefined : { measure: built.measure });
                      }}
                      className="nb-ib inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent bg-accent-soft px-[11px] py-[7px] text-[11.5px] font-bold text-accent"
                      data-testid={`export-builder-suggest-${suggestion.key}`}
                    >
                      <Plus className="size-[13px] shrink-0" aria-hidden="true" />
                      <span>{suggestion.label}</span>
                      {/* The comp dims this to 72% (292); at 10px bold on accent-soft that is
                          3.41:1 against WCAG's 4.5:1, so it stays at full accent — the one
                          departure axe forced (41-export-builder.md run record). */}
                      <span className="font-mono text-[10px]">{suggestion.meta}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="px-4 pb-1 pt-3.5">
              <Heading>{copy.fromTable(table.name)}</Heading>
            </div>
            {baseRows.map((column) => (
              <div key={column.name} className="flex items-center gap-2.5 px-4 py-[9px] hover:bg-surface-2">
                <ColumnLine column={column} />
                <IconButton
                  variant="bordered"
                  size="sm"
                  label={copy.addName(column.name)}
                  onClick={() => onAdd(mkBase(table, column))}
                  data-testid={`export-builder-add-${column.name}`}
                >
                  <Plus className="size-3.5" />
                </IconButton>
              </div>
            ))}
            {baseRows.length === 0 ? (
              <div className="px-4 pb-2.5 pt-1 text-[11.5px] text-fg-subtle">{q === '' ? copy.allIn() : copy.noMatch()}</div>
            ) : null}

            <div className="flex items-center gap-2 px-4 pb-1.5 pt-4">
              <Heading>{copy.linked()}</Heading>
              {budgetChip(linkedCount(draft), MAX_LINKED, linkedSpent)}
            </div>
            {outbound.map((column) => (
              <button
                key={column.name}
                type="button"
                onClick={() => {
                  if (linkedSpent) {
                    onToast(copy.limit());
                    return;
                  }
                  const target = column.references == null ? null : findTable(schema, column.references.tableId);
                  if (target === null) return;
                  setPath([{ via: column.name, table: target }]);
                  setQuery('');
                }}
                className={cn('flex w-full items-center gap-[11px] px-4 py-2.5 text-start hover:bg-surface-2', linkedSpent && 'opacity-45')}
                data-testid={`export-builder-follow-${column.name}`}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <LinkIcon className="size-3.5" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-mono text-[12.5px] font-semibold text-fg">{linkTitle(schema, column)}</span>
                  <span className="font-mono text-[10.5px] text-fg-subtle">{copy.via(column.name)}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle rtl:-scale-x-100" aria-hidden="true" />
              </button>
            ))}

            <div className="flex items-center gap-2 px-4 pb-1.5 pt-4">
              <Heading>{copy.inbound()}</Heading>
              {budgetChip(totalsCount(draft), MAX_TOTALS, totalsSpent)}
            </div>
            {inbound.map((link) => (
              <InboundRow
                key={`${link.table.id}.${link.column.name}`}
                link={link}
                spent={totalsSpent}
                hasCount={inFile.has(`a:count:${link.table.id}:${link.column.name}`)}
                onCount={() => {
                  const built = mkCount(link, taken);
                  onAdd(built.column, { measure: built.measure });
                }}
                onFold={(fn, factors) => {
                  const built = mkFold(link, fn, factors, taken);
                  onAdd(built.column, { measure: built.measure });
                }}
                onToast={onToast}
              />
            ))}

            <div className="flex items-center gap-2 px-4 pb-1.5 pt-4">
              <button
                type="button"
                onClick={() => setCalcOpen((open) => !open)}
                aria-expanded={calcOpen}
                className="flex items-center gap-2 text-fg-subtle"
                data-testid="export-builder-calc-toggle"
              >
                {calcOpen ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />}
                <span className="text-[10.5px] font-extrabold uppercase tracking-[.06em]">{copy.calculated()}</span>
              </button>
              {budgetChip(calculatedCount(draft), MAX_CALCULATED, calcSpent)}
            </div>
            {calcOpen ? <CalculatedForms draft={draft} onAdd={onAddCalc} onToast={onToast} spent={calcSpent} /> : null}
          </>
        ) : reached !== null && !broken ? (
          <>
            <div className="flex items-center gap-2 px-4 pb-2.5 pt-3">
              <button
                type="button"
                onClick={() => {
                  setPath((current) => current.slice(0, -1));
                  setQuery('');
                }}
                className="nb-ib inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5 py-1.5 text-[11.5px] font-bold text-fg-muted"
                data-testid="export-builder-crumb-back"
              >
                <ArrowLeft className="size-[13px] rtl:-scale-x-100" aria-hidden="true" />
                {copy.back()}
              </button>
              <span className="min-w-0 truncate font-mono text-[11px] text-fg-muted">
                {[table.name, ...path.flatMap((hop) => [hop.via, hop.table.name])].join(' → ')}
              </span>
            </div>
            <div className="px-4 pb-2 text-[11px] text-fg-subtle">{path.length >= MAX_HOPS ? copy.hopLimit() : copy.hop()}</div>
            {reachedRows.map((column) => {
              const built = mkLinked(path, column, taken);
              const have = inFile.has(built.id);
              const canFollow = column.references != null && path.length < MAX_HOPS;
              const next = column.references == null ? null : findTable(schema, column.references.tableId);
              return (
                <div key={column.name} className="flex items-center gap-2.5 px-4 py-[9px] hover:bg-surface-2">
                  <ColumnLine column={column} maskNote />
                  {canFollow && next !== null ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPath((current) => [...current, { via: column.name, table: next }]);
                        setQuery('');
                      }}
                      className="nb-ib inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-[11px] font-bold text-fg-muted"
                      data-testid={`export-builder-follow-${column.name}`}
                    >
                      {next.name}
                      <ChevronRight className="size-[13px] rtl:-scale-x-100" aria-hidden="true" />
                    </button>
                  ) : null}
                  <IconButton
                    variant="bordered"
                    size="sm"
                    label={copy.addName(column.name)}
                    onClick={() => onAdd(built)}
                    className={cn(have && 'border-accent bg-accent-soft text-accent')}
                    data-testid={`export-builder-add-${column.name}`}
                  >
                    <Plus className="size-3.5" />
                  </IconButton>
                </div>
              );
            })}
          </>
        ) : null}

        {linkedSpent || totalsSpent || calcSpent ? (
          <div className="mx-4 mt-2.5 border-t border-border pt-2.5 text-[11px] text-fg-subtle">{copy.limit()}</div>
        ) : null}
      </div>
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return <span className="mb-1.5 block text-[10.5px] font-extrabold uppercase tracking-[.06em] text-fg-subtle">{children}</span>;
}

function linkTitle(schema: SchemaReply, column: SchemaColumn): string {
  const ref = column.references;
  if (ref == null) return column.name;
  return findTable(schema, ref.tableId)?.name ?? ref.tableId;
}

function ColumnLine({ column, maskNote }: { column: SchemaColumn; maskNote?: boolean }) {
  const pii = isPii(column);
  const readOnly = column.isPrimaryKey === true || column.isGenerated === true;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-[7px]">
        <span className="font-mono text-[12.5px] font-semibold text-fg">{column.name}</span>
        {readOnly ? <Lock className="size-[11px] text-fg-subtle" aria-label={copy.readOnly()} /> : null}
      </div>
      <div className="mt-[3px] flex items-center gap-[7px]">
        <span className="font-mono text-[10.5px] text-fg-subtle">{column.logicalType}</span>
        {pii ? <Badge tone="danger" className="text-[9px] uppercase tracking-[.05em]">{BADGE_LABEL.masked()}</Badge> : null}
      </div>
      {maskNote === true && pii ? <div className="mt-[3px] text-[10.5px] text-warn">{copy.maskedNote()}</div> : null}
    </div>
  );
}

function InboundRow({
  link,
  spent,
  hasCount,
  onCount,
  onFold,
  onToast,
}: {
  link: InboundLink;
  spent: boolean;
  hasCount: boolean;
  onCount: () => void;
  onFold: (fn: Exclude<MeasureFn, 'count'>, factors: SchemaColumn[]) => void;
  onToast: (message: string) => void;
}) {
  const numeric = useMemo(() => numericColumns(link.table), [link.table]);
  const [fn, setFn] = useState<Exclude<MeasureFn, 'count'>>('sum');
  const [chips, setChips] = useState<string[]>([]);
  const single = fn === 'min' || fn === 'max';
  const chosen = chips
    .map((name) => numeric.find((column) => column.name === name))
    .filter((column): column is SchemaColumn => column !== undefined);
  const canAdd = chosen.length > 0 && !spent;
  return (
    <div className={cn('flex flex-col gap-2 border-b border-border px-4 py-[11px]', spent && 'opacity-55')} data-testid={`export-builder-inbound-${link.table.name}`}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-pos-soft text-pos">
          <Sigma className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[12.5px] font-semibold text-fg">{link.table.name}</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-fg-subtle">{copy.via(link.column.name)}</div>
        </div>
        {hasCount ? null : (
          <button
            type="button"
            onClick={() => (spent ? onToast(copy.limit()) : onCount())}
            className="nb-ib inline-flex shrink-0 items-center gap-[5px] rounded-[9px] border border-border-strong bg-surface px-2.5 py-1.5 text-[11.5px] font-bold text-fg-muted"
            data-testid={`export-builder-count-${link.table.name}`}
          >
            <Plus className="size-[13px]" aria-hidden="true" />
            {copy.count()}
          </button>
        )}
      </div>
      {numeric.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2 ps-[38px]">
          <Select
            aria-label={copy.aggregate()}
            value={fn}
            onChange={(event) => {
              const next = event.currentTarget.value as Exclude<MeasureFn, 'count'>;
              setFn(next);
              if (next === 'min' || next === 'max') setChips((current) => current.slice(0, 1));
            }}
            data-testid={`export-builder-fold-fn-${link.table.name}`}
          >
            {MEASURE_FNS.filter((option): option is Exclude<MeasureFn, 'count'> => option !== 'count').map((option) => (
              <option key={option} value={option}>
                {FOLD_LABEL[option]()}
              </option>
            ))}
          </Select>
          {numeric.map((column) => {
            const on = chips.includes(column.name);
            return (
              <button
                key={column.name}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setChips((current) => {
                    if (single) return on ? [] : [column.name];
                    if (on) return current.filter((name) => name !== column.name);
                    if (current.length >= MAX_FOLD_FACTORS) {
                      onToast(copy.fourMax());
                      return current;
                    }
                    return [...current, column.name];
                  })
                }
                className={cn(
                  'rounded-full border px-[9px] py-[5px] font-mono text-[10.5px] font-semibold',
                  on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-fg-muted',
                )}
                data-testid={`export-builder-fold-col-${link.table.name}-${column.name}`}
              >
                {column.name}
              </button>
            );
          })}
          {chosen.length > 1 ? <span className="font-mono text-[11px] font-semibold text-fg">{chosen.map((column) => column.name).join(' × ')}</span> : null}
          <button
            type="button"
            onClick={() => {
              if (chosen.length === 0) {
                onToast(copy.pickNumeric());
                return;
              }
              if (spent) {
                onToast(copy.limit());
                return;
              }
              onFold(fn, chosen);
              setChips([]);
            }}
            className={cn(
              'rounded-[9px] px-3 py-1.5 text-[11.5px] font-extrabold',
              canAdd ? 'bg-accent text-accent-fg' : 'cursor-not-allowed bg-surface-3 text-fg-subtle',
            )}
            data-testid={`export-builder-fold-add-${link.table.name}`}
          >
            {copy.add()}
          </button>
        </div>
      )}
      {spent ? (
        <div className="ps-[38px] text-[10.5px] text-fg-subtle">{copy.limit()}</div>
      ) : single ? (
        <div className="ps-[38px] text-[10.5px] text-fg-subtle">{copy.singleNote()}</div>
      ) : null}
    </div>
  );
}

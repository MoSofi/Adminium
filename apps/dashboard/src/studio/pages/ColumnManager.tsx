// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Column manager for `page-crud` pages — the table's `config.columns[]`.
 *
 * `page-crud` is the one shipped template whose items are not widgets in a
 * grid: its body is a `columns[]` of `gridColumnSpecSchema` entries that
 * `PageCrud` renders as the data grid, and there is no in-page editor for it.
 * That is exactly the "I want to change the columns of the table" gap.
 *
 * What is editable here:
 *
 * - ORDER — a drag handle per row (pointer + keyboard via dnd-kit), the drag
 *   constrained to the list itself; header text; visibility.
 * - MEMBERSHIP — one `+` affordance opens the column browser: the source
 *   table's remaining columns add back exactly the spec regeneration would
 *   produce (`buildColumnDef`), and the same browser walks outbound FK links
 *   into referenced tables for lookup columns. The `+` hides entirely when
 *   nothing is addable (all columns shown and no links to follow) — a picker
 *   with an empty list is noise, not affordance.
 * - LOOKUP COLUMNS — follow an outbound FK chain (invoices → client_id →
 *   clients, optionally a further hop) and show one column of the reached
 *   table. Stored as `lookup: {path, select}` on the spec; the bindings
 *   translate that into the server's `lookup=` params at read time.
 *
 * SAVING is owned by the edit screen: the manager reports its draft through
 * `onDraft` (null when clean, a save closure when dirty) and the screen's one
 * "Save changes" persists everything. The previous split — a "Save columns"
 * button inside this card next to the page-level "Save changes" — silently
 * threw the columns draft away whenever the outer button was pressed first.
 *
 * The rest of `gridColumnSpecSchema` (`logicalType`, `semantic`, `fk`, `pii`,
 * `primaryKey`, …) is derived from the database by the classifier, and
 * hand-editing it would not change the database — it would just make the page
 * lie about the data. Those are composed on add and re-derived by
 * regeneration, never hand-edited here.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { gridColumnSpecSchema } from '@adminium/engine/config';
import { Alert, Badge, Button, IconButton, Input, Switch } from '@adminium/ui';
import { ArrowLeft, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { studioApi, type SchemaColumn, type SchemaTable } from '../api.js';
import {
  addableColumns,
  displayableColumns,
  enumsOf,
  findTable,
  fkColumns,
  inboundLinks,
  specForLookup,
  specForReverse,
  specForTableColumn,
  type InboundLink,
} from './columnSpecBuilder.js';
import { savePageConfig, type PageSummaryDto } from './pagesApi.js';

/** Grid-spec `lookup.path` cap — mirrored here for the browser's Follow gate. */
const MAX_LOOKUP_HOPS = 3;
/** Server cap on `lookup=` params per read (crud/lookups.ts MAX_LOOKUPS) —
 *  a 13th lookup column would 422 every read of the page, so the browser
 *  stops offering links at 12 instead of letting the page break itself. */
const MAX_LOOKUPS = 12;
/** Same cap for `agg=` params (crud/aggregates.ts MAX_AGGREGATES). */
const MAX_REVERSE = 12;

/**
 * The dirty columns draft, reported to the edit screen through `onDraft`.
 * `save` PATCHes the draft body (If-Match `expectedRevision`) and resolves to
 * the fresh page row — the screen chains its identity PATCH on that revision.
 */
export interface ColumnsDraft {
  save: (expectedRevision: number) => Promise<PageSummaryDto>;
}

/**
 * One stored column. Kept structural rather than importing `GridColumnSpec`:
 * the stored entries are the schema's INPUT shape (defaults not yet applied),
 * so most fields are optional on the wire.
 */
interface StoredColumn {
  name: string;
  label?: string;
  hidden?: boolean;
  mono?: boolean;
  sortable?: boolean;
  align?: 'start' | 'end';
  logicalType?: string;
  semantic?: string | null;
  pii?: boolean;
  primaryKey?: boolean;
  lookup?: { path: string[]; select: string };
  reverse?: { table: string; fkColumn: string; agg: string };
  [key: string]: unknown;
}

/**
 * Read the stored `columns[]`, dropping entries the renderer would drop.
 *
 * Mirrors `PageCrudBinding.parseColumns`: per-entry `safeParse`, skip the bad
 * ones, never throw. An editor that crashed on one malformed column would be
 * unusable on exactly the page that needs fixing.
 */
function parseColumns(config: Record<string, unknown>): StoredColumn[] {
  const raw = config['columns'];
  if (!Array.isArray(raw)) return [];
  const out: StoredColumn[] = [];
  for (const entry of raw) {
    if (gridColumnSpecSchema.safeParse(entry).success) out.push(entry as StoredColumn);
  }
  return out;
}

const fmt = (template: string, args: Record<string, string | number>): string =>
  template.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    args[name] === undefined ? match : String(args[name]),
  );

interface ColumnManagerProps {
  pageId: string;
  /** The page's per-template config body. */
  config: Record<string, unknown>;
  /** The envelope's `source` — where re-addable columns and FK chains come from. */
  source: { connectionId: string | null; table: string | null };
  /** Draft reporter: a save closure while the draft differs from the stored
   *  columns, null when clean (also on unmount). The edit screen renders NO
   *  save affordance in this card — its "Save changes" persists the draft. */
  onDraft: (draft: ColumnsDraft | null) => void;
}

export function ColumnManager({ pageId, config, source, onDraft }: ColumnManagerProps) {
  const stored = useMemo(() => parseColumns(config), [config]);
  const [draft, setDraft] = useState<StoredColumn[] | null>(null);
  const columns = draft ?? stored;
  const dirty = draft !== null;

  // Same key as EditPageScreen's table picker — one fetch feeds both.
  const schema = useQuery({
    queryKey: ['studio', 'schema', source.connectionId] as const,
    queryFn: () => studioApi.getSchema(source.connectionId as string),
    enabled: source.connectionId !== null && source.table !== null,
    retry: false,
  });
  const table = useMemo(() => findTable(schema.data, source.table), [schema.data, source.table]);
  const enums = useMemo(() => enumsOf(schema.data), [schema.data]);

  const presentNames = useMemo(() => new Set(columns.map((column) => column.name)), [columns]);
  const addable = useMemo(
    () => (table === null ? [] : addableColumns(table, presentNames)),
    [table, presentNames],
  );
  /** `path.select` signatures of the lookups already on the page — the browser
   *  hides those targets instead of offering a duplicate that would only add
   *  an aliased twin column. */
  const presentLookups = useMemo(
    () =>
      new Set(
        columns
          .filter((column) => column.lookup !== undefined)
          .map((column) => [...(column.lookup as { path: string[] }).path, (column.lookup as { select: string }).select].join('.')),
      ),
    [columns],
  );
  const lookupCount = presentLookups.size;
  /** `table|fkColumn|agg` signatures of the reverse columns already on the page. */
  const presentReverse = useMemo(
    () =>
      new Set(
        columns
          .filter((column) => column.reverse !== undefined)
          .map((column) => {
            const reverse = column.reverse as { table: string; fkColumn: string; agg: string };
            return `${reverse.table}|${reverse.fkColumn}|${reverse.agg}`;
          }),
      ),
    [columns],
  );
  const reverseCount = presentReverse.size;

  /** Column browser: null = closed; path [] = the root view. */
  const [browse, setBrowse] = useState<{ path: string[]; query: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Report the draft upward. Depends on `columns` so the save closure always
  // captures the CURRENT draft; the cleanup clears the report on unmount (the
  // "source changed, contents pending" state swaps this component out).
  useEffect(() => {
    if (!dirty) {
      onDraft(null);
      return () => onDraft(null);
    }
    onDraft({
      save: (expectedRevision: number) =>
        savePageConfig(pageId, { ...config, columns }, expectedRevision),
    });
    return () => onDraft(null);
  }, [dirty, columns, config, pageId, onDraft]);

  function patch(index: number, change: Partial<StoredColumn>): void {
    setDraft(columns.map((column, i) => (i === index ? { ...column, ...change } : column)));
  }

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = columns.findIndex((column) => column.name === active.id);
    const to = columns.findIndex((column) => column.name === over.id);
    if (from === -1 || to === -1) return;
    setDraft(arrayMove([...columns], from, to));
  }

  function addColumn(name: string): void {
    const schemaColumn = table?.columns.find((column) => column.name === name);
    if (schemaColumn === undefined) return;
    setDraft([...columns, specForTableColumn(schemaColumn, enums) as StoredColumn]);
    setBrowse(null);
  }

  function addLookup(target: SchemaColumn): void {
    if (browse === null || browse.path.length === 0) return;
    const spec = specForLookup({ path: browse.path, target, enums, taken: presentNames });
    setDraft([...columns, spec as StoredColumn]);
    setBrowse(null);
  }

  function addReverse(link: InboundLink): void {
    setDraft([...columns, specForReverse({ link, taken: presentNames }) as StoredColumn]);
    setBrowse(null);
  }

  /** The table each hop of the browse path lands on; null when the chain breaks. */
  const pathTables = useMemo<SchemaTable[] | null>(() => {
    if (browse === null || table === null) return null;
    const tables: SchemaTable[] = [];
    let current: SchemaTable = table;
    for (const hop of browse.path) {
      const ref = current.columns.find((column) => column.name === hop)?.references;
      const next = ref == null ? null : findTable(schema.data, ref.tableId);
      if (next === null) return null;
      tables.push(next);
      current = next;
    }
    return tables;
  }, [browse, table, schema.data]);

  const links = table === null ? [] : fkColumns(table);
  const canAddLinked = links.length > 0 && lookupCount < MAX_LOOKUPS;
  // Inbound links whose count is not already a column — offering the same
  // count twice would only add an aliased twin.
  const inbound = useMemo(() => {
    if (table === null) return [];
    return inboundLinks(schema.data, table).filter(
      (link) => !presentReverse.has(`${link.table.id}|${link.column.name}|count`),
    );
  }, [schema.data, table, presentReverse]);
  const canAddReverse = inbound.length > 0 && reverseCount < MAX_REVERSE;
  const canAdd = table !== null && (addable.length > 0 || canAddLinked || canAddReverse);

  // No stored columns AND no schema to add from (source-less page, failed or
  // fruitless schema load) — the original "regenerate to fill them in" state.
  // While the schema is still loading we fall through to the normal layout
  // rather than flashing this alert. Disabled queries stay `isPending`
  // forever, so "still loading" must be scoped to enabled ones.
  const schemaEnabled = source.connectionId !== null && source.table !== null;
  if (stored.length === 0 && table === null && !(schemaEnabled && schema.isPending)) {
    return (
      <Alert
        tone="info"
        data-testid="studio-pages-no-columns"
        title={t('studio:pages.columns.none.title', 'This page has no columns yet')}
        body={t(
          'studio:pages.columns.none.body',
          'Columns are read from the table when the page is generated. Bind this page to a table and regenerate to fill them in.',
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="studio-pages-columns">
      <p className="text-body-sm text-fg-muted">
        {t(
          'studio:pages.columns.help',
          'Drag to reorder columns, rename their headers, and choose which are shown in the table.',
        )}
      </p>

      <div className="rounded-lg border border-border">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={columns.map((column) => column.name)}
            strategy={verticalListSortingStrategy}
          >
            <ul>
              {columns.map((column, index) => (
                <SortableColumnRow
                  key={column.name}
                  column={column}
                  onPatch={(change) => patch(index, change)}
                  onRemove={() => setDraft(columns.filter((_, i) => i !== index))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        {columns.length === 0 ? (
          <p className="text-body-sm p-3 text-fg-muted" data-testid="studio-pages-columns-empty">
            {t('studio:pages.columns.empty', 'No columns yet — add them below.')}
          </p>
        ) : null}

        {table !== null && canAdd ? (
          <div className="border-t border-border p-2">
            {browse === null ? (
              <IconButton
                variant="ghost"
                size="sm"
                tooltip
                label={t('studio:pages.columns.addOpen', 'Add column')}
                onClick={() => setBrowse({ path: [], query: '' })}
                data-testid="studio-pages-add-open"
              >
                <Plus className="size-4" />
              </IconButton>
            ) : (
              <ColumnBrowser
                table={table}
                browse={browse}
                pathTables={pathTables}
                addable={addable}
                canAddLinked={canAddLinked}
                links={links}
                inbound={canAddReverse ? inbound : []}
                presentLookups={presentLookups}
                schemaData={schema.data}
                onQuery={(query) => setBrowse({ ...browse, query })}
                onFollow={(name) => setBrowse({ path: [...browse.path, name], query: '' })}
                onBack={() =>
                  setBrowse(
                    browse.path.length === 0
                      ? null
                      : { path: browse.path.slice(0, -1), query: '' },
                  )
                }
                onCancel={() => setBrowse(null)}
                onPickBase={addColumn}
                onPickLookup={addLookup}
                onPickReverse={addReverse}
              />
            )}
          </div>
        ) : table === null && schema.isError ? (
          <p className="text-body-sm border-t border-border p-3 text-fg-muted">
            {t(
              'studio:pages.columns.schemaUnavailable',
              'Database columns could not be listed, so columns cannot be added back here.',
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SortableColumnRow({
  column,
  onPatch,
  onRemove,
}: {
  column: StoredColumn;
  onPatch: (change: Partial<StoredColumn>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: column.name });

  return (
    <li
      ref={setNodeRef}
      // Custom properties only — the shape `adminium/no-style-prop` allows.
      // dnd-kit's per-frame transform has to reach the element somehow, and
      // Tailwind's arbitrary properties below read exactly these variables.
      style={{
        '--adm-sort-transform': CSS.Transform.toString(transform) ?? 'none',
        '--adm-sort-transition': transition ?? 'none',
      }}
      className={`flex flex-wrap items-center gap-2 border-b border-border bg-surface p-3 last:border-b-0 [transform:var(--adm-sort-transform)] [transition:var(--adm-sort-transition)] ${
        isDragging ? 'relative z-10 shadow-card' : ''
      }`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="nb-ib inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        aria-label={fmt(t('studio:pages.columns.dragHandle', 'Reorder {name}'), {
          name: column.name,
        })}
        data-testid={`studio-pages-drag-${column.name}`}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-body-sm truncate font-mono text-fg-subtle">
            {column.lookup !== undefined
              ? `${column.lookup.path.join(' → ')} → ${column.lookup.select}`
              : column.reverse !== undefined
                ? `${column.reverse.table.split('.').pop() ?? column.reverse.table} ← ${column.reverse.fkColumn}`
                : column.name}
          </span>
          {column.lookup !== undefined ? (
            <Badge tone="info">{t('studio:pages.columns.lookupBadge', 'Linked')}</Badge>
          ) : null}
          {column.reverse !== undefined ? (
            <Badge tone="info">{t('studio:pages.columns.countBadge', 'Count')}</Badge>
          ) : null}
          {column.primaryKey === true ? (
            <Badge tone="neutral">{t('studio:pages.columns.pk', 'Key')}</Badge>
          ) : null}
          {column.pii === true ? (
            <Badge tone="warn">{t('studio:pages.columns.pii', 'PII')}</Badge>
          ) : null}
        </div>
        <Input
          value={column.label ?? ''}
          aria-label={fmt(t('studio:pages.columns.header', 'Header for {name}'), {
            name: column.name,
          })}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </div>

      <label className="flex items-center gap-2">
        <span className="text-body-sm text-fg-muted">
          {t('studio:pages.columns.shown', 'Shown')}
        </span>
        <Switch
          checked={column.hidden !== true}
          aria-label={fmt(t('studio:pages.columns.toggle', 'Show {name} in the table'), {
            name: column.name,
          })}
          onCheckedChange={(checked) => onPatch({ hidden: !checked })}
        />
      </label>

      <IconButton
        variant="ghost"
        size="sm"
        label={fmt(t('studio:pages.columns.remove', 'Remove {name}'), {
          name: column.name,
        })}
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </IconButton>
    </li>
  );
}

/** Case-insensitive substring filter on a column/table name. */
function matches(query: string, name: string): boolean {
  return query === '' || name.toLowerCase().includes(query.toLowerCase());
}

/**
 * The unified column browser behind the `+`.
 *
 * Root view: the source table's remaining columns (one click adds the spec
 * regeneration would produce) and, below them, the outbound links — one row
 * per FK column, named by the table it reaches. Following a link drills into
 * that table's columns; a click there adds a lookup column, and FK columns of
 * the reached table can be followed further (up to the spec's 3-hop cap).
 */
function ColumnBrowser({
  table,
  browse,
  pathTables,
  addable,
  canAddLinked,
  links,
  inbound,
  presentLookups,
  schemaData,
  onQuery,
  onFollow,
  onBack,
  onCancel,
  onPickBase,
  onPickLookup,
  onPickReverse,
}: {
  table: SchemaTable;
  browse: { path: string[]; query: string };
  pathTables: SchemaTable[] | null;
  addable: SchemaColumn[];
  canAddLinked: boolean;
  links: SchemaColumn[];
  /** Offerable inbound links (dupes and over-cap already filtered out). */
  inbound: InboundLink[];
  presentLookups: ReadonlySet<string>;
  schemaData: Parameters<typeof findTable>[0];
  onQuery: (query: string) => void;
  onFollow: (fkColumn: string) => void;
  onBack: () => void;
  onCancel: () => void;
  onPickBase: (name: string) => void;
  onPickLookup: (column: SchemaColumn) => void;
  onPickReverse: (link: InboundLink) => void;
}) {
  const atRoot = browse.path.length === 0;
  const current = atRoot ? table : pathTables?.at(-1);
  if (current === undefined || current === null) {
    // The chain no longer resolves (schema drift mid-edit) — reset honestly.
    return (
      <Alert
        tone="warn"
        title={t('studio:pages.columns.lookupBroken', 'That link no longer resolves')}
        body={t(
          'studio:pages.columns.lookupBrokenBody',
          'The schema changed while you were browsing. Start the link again.',
        )}
      />
    );
  }

  const query = browse.query;
  const searchLabel = t('studio:pages.columns.addSearch', 'Search columns…');

  /** Bare table name a link row is titled by ("clients", not "public.clients"). */
  const linkTitle = (column: SchemaColumn): string => {
    const ref = column.references;
    if (ref == null) return column.name;
    return findTable(schemaData, ref.tableId)?.name ?? ref.tableId;
  };

  const baseRows = atRoot ? addable.filter((column) => matches(query, column.name)) : [];
  const linkRows =
    atRoot && canAddLinked
      ? links.filter((column) => matches(query, column.name) || matches(query, linkTitle(column)))
      : [];
  const inboundRows = atRoot
    ? inbound.filter(
        (link) => matches(query, link.table.name) || matches(query, link.column.name),
      )
    : [];
  const reachedRows = atRoot
    ? []
    : displayableColumns(current).filter(
        (column) =>
          matches(query, column.name) &&
          !presentLookups.has([...browse.path, column.name].join('.')),
      );
  const nothingMatches = atRoot
    ? baseRows.length === 0 && linkRows.length === 0 && inboundRows.length === 0
    : reachedRows.length === 0;

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3"
      data-testid="studio-pages-add-browser"
    >
      <div className="flex items-center gap-2">
        {atRoot ? null : (
          <IconButton
            variant="ghost"
            size="sm"
            label={t('studio:pages.columns.lookupBack', 'Back')}
            onClick={onBack}
          >
            <ArrowLeft className="size-4 rtl:-scale-x-100" />
          </IconButton>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold text-fg">
            {atRoot
              ? t('studio:pages.columns.addTitle', 'Add a column')
              : fmt(t('studio:pages.columns.lookupBrowse', 'Pick what to show from {table}'), {
                  table: current.name,
                })}
          </p>
          {atRoot ? null : (
            <p className="truncate font-mono text-caption text-fg-subtle">
              {[table.name, ...browse.path].join(' → ')}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>

      <Input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder={searchLabel}
        aria-label={searchLabel}
        autoFocus
        data-testid="studio-pages-add-search"
      />

      {nothingMatches && query !== '' ? (
        <p className="text-body-sm p-1 text-fg-muted">
          {fmt(t('studio:pages.columns.addNoMatches', 'No columns match “{query}”.'), { query })}
        </p>
      ) : null}

      {atRoot ? (
        <>
          {baseRows.length > 0 ? (
            <BrowserSection
              heading={fmt(t('studio:pages.columns.addFromTable', 'From {table}'), {
                table: table.name,
              })}
            >
              {baseRows.map((column) => (
                <li key={column.name} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onPickBase(column.name)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    data-testid={`studio-pages-add-pick-${column.name}`}
                  >
                    <span className="text-body-sm min-w-0 flex-1 truncate font-mono text-fg">
                      {column.name}
                    </span>
                    <span className="font-mono text-caption text-fg-subtle">
                      {column.logicalType}
                    </span>
                    <Plus className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </BrowserSection>
          ) : null}

          {linkRows.length > 0 ? (
            <BrowserSection
              heading={t('studio:pages.columns.addFromLinked', 'From linked tables')}
              caption={t(
                'studio:pages.columns.addLinkedHelp',
                'Show a value from the table a link column points to.',
              )}
            >
              {linkRows.map((column) => (
                <li key={column.name} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onFollow(column.name)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    data-testid={`studio-pages-add-follow-${column.name}`}
                  >
                    <span className="text-body-sm min-w-0 flex-1 truncate font-mono text-fg">
                      {linkTitle(column)}
                    </span>
                    <span className="truncate font-mono text-caption text-fg-subtle">
                      {fmt(t('studio:pages.columns.addVia', 'via {column}'), {
                        column: column.name,
                      })}
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-fg-subtle rtl:-scale-x-100"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </BrowserSection>
          ) : null}

          {inboundRows.length > 0 ? (
            <BrowserSection
              heading={t('studio:pages.columns.addLinkedFrom', 'Tables that link here')}
              caption={t(
                'studio:pages.columns.addLinkedFromHelp',
                'Add a count of the rows that point at each record.',
              )}
            >
              {inboundRows.map((link) => (
                <li
                  key={`${link.table.id}.${link.column.name}`}
                  className="border-b border-border last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => onPickReverse(link)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    data-testid={`studio-pages-add-count-${link.table.name}-${link.column.name}`}
                  >
                    <span className="text-body-sm min-w-0 flex-1 truncate font-mono text-fg">
                      {link.table.name}
                    </span>
                    <span className="truncate font-mono text-caption text-fg-subtle">
                      {fmt(t('studio:pages.columns.addVia', 'via {column}'), {
                        column: link.column.name,
                      })}
                    </span>
                    <Badge tone="info">{t('studio:pages.columns.countBadge', 'Count')}</Badge>
                    <Plus className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </BrowserSection>
          ) : null}
        </>
      ) : reachedRows.length > 0 ? (
        <ul className="rounded-md border border-border bg-surface">
          {reachedRows.map((column) => (
            <li
              key={column.name}
              className="flex items-center gap-1 border-b border-border last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onPickLookup(column)}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                data-testid={`studio-pages-lookup-pick-${column.name}`}
              >
                <span className="text-body-sm min-w-0 flex-1 truncate font-mono text-fg">
                  {column.name}
                </span>
                <span className="font-mono text-caption text-fg-subtle">
                  {column.references != null ? `→ ${column.references.tableId}` : column.logicalType}
                </span>
                <Plus className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              </button>
              {column.references != null && browse.path.length < MAX_LOOKUP_HOPS ? (
                <IconButton
                  variant="ghost"
                  size="sm"
                  className="me-2"
                  label={fmt(t('studio:pages.columns.followColumn', 'Follow {name}'), {
                    name: column.name,
                  })}
                  onClick={() => onFollow(column.name)}
                  data-testid={`studio-pages-lookup-follow-${column.name}`}
                >
                  <ChevronRight className="size-4 rtl:-scale-x-100" />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BrowserSection({
  heading,
  caption,
  children,
}: {
  heading: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">{heading}</p>
      {caption === undefined ? null : <p className="text-caption text-fg-subtle">{caption}</p>}
      <ul className="rounded-md border border-border bg-surface">{children}</ul>
    </div>
  );
}

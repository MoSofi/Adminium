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
 * - FILE COLUMNS — one switch per column that could hold a reference, and,
 *   once it is on, the block behind it: what gets written into the column (a
 *   link, Adminium's file id, or the destination's key), where the bytes go,
 *   which types are accepted and how large one may be. Stored as `file: {…}`
 *   (37-files-and-storage.md §3.8). Turning the switch OFF removes the key
 *   rather than writing `file: undefined`, so a page toggled on and off again
 *   is the page it was before anyone touched it (37 D14).
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

import { useId, useMemo, useState, type ReactNode } from 'react';
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
import {
  MEASURE_FNS,
  gridColumnSpecSchema,
  type CrudDerivedConfig,
  type MeasureFn,
} from '@adminium/engine/config';
import {
  Alert,
  Badge,
  Button,
  ChoiceChips,
  FormField,
  IconButton,
  Input,
  Select,
  Switch,
} from '@adminium/ui';
import { ArrowLeft, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';

import { destinationsQuery } from '../storage/storageApi.js';
import { t } from '../../i18n/t.js';
import { studioApi, type SchemaColumn, type SchemaTable } from '../api.js';
import {
  addableColumns,
  displayableColumns,
  enumsOf,
  findTable,
  fkColumns,
  inboundLinks,
  numericColumns,
  specForLookup,
  specForMeasure,
  specForReverse,
  specForTableColumn,
  type InboundLink,
} from './columnSpecBuilder.js';

/** Grid-spec `lookup.path` cap — mirrored here for the browser's Follow gate. */
const MAX_LOOKUP_HOPS = 3;
/** Server cap on `lookup=` params per read (crud/lookups.ts MAX_LOOKUPS) —
 *  a 13th lookup column would 422 every read of the page, so the browser
 *  stops offering links at 12 instead of letting the page break itself. */
const MAX_LOOKUPS = 12;
/**
 * Correlated-subquery cap per read — SHARED by `agg=` counts and `compute=`
 * measures (crud/aggregates.ts MAX_AGGREGATES, 36-derived-columns.md D13).
 *
 * Counting only ONE of the two here is how a page gets authored to the
 * editor's own limit and then 422s on every read: the server budgets them
 * together, so the browser has to as well.
 */
const MAX_PROJECTIONS = 12;

/**
 * The folds the sub-picker offers, in the order it offers them.
 *
 * An exhaustive map of LITERAL keys rather than `t(\`…fold.${fn}\`)`: an
 * assembled key cannot be verified against the eight bundles and renders as a
 * raw dotted string when it misses (10 §2.5). The type checker proves every
 * option has one.
 */
const FOLD_OPTIONS: Record<Exclude<MeasureFn, 'count'>, () => string> = {
  sum: () => t('studio:pages.columns.fold.sum', 'Sum'),
  avg: () => t('studio:pages.columns.fold.avg', 'Average'),
  min: () => t('studio:pages.columns.fold.min', 'Min'),
  max: () => t('studio:pages.columns.fold.max', 'Max'),
};

/** `min`/`max` take exactly one column; `sum`/`avg` may multiply up to four (D17). */
const MAX_FACTORS = 4;

/**
 * The reference shapes a file column may be configured to store, offered in
 * this order because `url` is the default the schema applies and the one
 * generation seeds (37-files-and-storage.md D31).
 *
 * MIRRORED, not imported: the vocabulary is `COLUMN_FILE_REFS` in
 * `packages/widgets/src/page-config/grid-column-spec.ts`.
 */
const FILE_REF_SHAPES = ['url', 'id', 'key'] as const;
type FileRefShape = (typeof FILE_REF_SHAPES)[number];

/**
 * The narrowest column each shape fits in — `REF_MIN_WIDTH` in
 * `apps/server/src/files/refs.ts`, mirrored because the dashboard may not
 * import from `apps/server` at all (dependency-cruiser keeps the server out
 * of the browser bundle) and three integers do not justify a shared package.
 *
 * WHY THE EDITOR ENFORCES THIS AT ALL. A `varchar(40)` cannot hold a
 * 200-character URL, and the engines disagree about what happens when a write
 * tries: some truncate silently, some refuse the statement. Either way it is
 * discovered at upload time by whoever uploaded, with nothing they can do
 * about it. The person choosing the shape is the only one who can act on the
 * number, so the number is shown to them here.
 */
const FILE_REF_MIN_WIDTH: Readonly<Record<FileRefShape, number>> = {
  // `file_` plus 26 Crockford characters.
  id: 31,
  // A dated key with a prefix and an 80-character name part.
  key: 160,
  // An origin plus `/api/v1/files/<id>/content`, or a public base plus a key.
  url: 200,
};

/**
 * Shape names, as literal keys for the reason {@link FOLD_OPTIONS} gives.
 *
 * Named after what the column WILL CONTAIN rather than after the wire token:
 * "key" is meaningless to an operator who has never opened a bucket, and
 * "the key in the destination" is the sentence that tells them whether their
 * other app can use it.
 */
const FILE_REF_LABELS: Record<FileRefShape, () => string> = {
  url: () => t('studio:pages.columns.file.ref.url', 'A link to the file'),
  id: () => t('studio:pages.columns.file.ref.id', "Adminium's file id"),
  key: () => t('studio:pages.columns.file.ref.key', 'The key in the destination'),
};

/**
 * The upload allowlist vocabulary — `SNIFF_TYPE_KEYS` in
 * `apps/server/src/files/sniff.ts`, mirrored for the same reason the widths
 * are. These are the exact tokens a column's `accept` stores and the exact
 * tokens the workspace's own `files.allowedTypes` names, so the chips speak
 * the setting's language rather than a second one that has to be mapped.
 */
const FILE_TYPE_KEYS = [
  'pdf',
  'png',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'svg',
  'zip',
  'office',
  'mp4',
  'mp3',
  'wav',
  'webm',
  'ogg',
  'csv',
  'text',
  'markdown',
  'json',
] as const;
type FileTypeKey = (typeof FILE_TYPE_KEYS)[number];

/**
 * Chip labels. Most are format names that are the same word everywhere, but
 * they still go through `t()`: two of them ("Office documents", "Plain text")
 * are English prose, and a table where sixteen entries are literals and two
 * are keys is the shape that quietly grows a third literal later.
 */
const FILE_TYPE_LABELS: Record<FileTypeKey, () => string> = {
  pdf: () => t('studio:pages.columns.file.type.pdf', 'PDF'),
  png: () => t('studio:pages.columns.file.type.png', 'PNG'),
  jpeg: () => t('studio:pages.columns.file.type.jpeg', 'JPEG'),
  gif: () => t('studio:pages.columns.file.type.gif', 'GIF'),
  webp: () => t('studio:pages.columns.file.type.webp', 'WebP'),
  heic: () => t('studio:pages.columns.file.type.heic', 'HEIC'),
  svg: () => t('studio:pages.columns.file.type.svg', 'SVG'),
  zip: () => t('studio:pages.columns.file.type.zip', 'ZIP'),
  office: () => t('studio:pages.columns.file.type.office', 'Office documents'),
  mp4: () => t('studio:pages.columns.file.type.mp4', 'MP4 video'),
  mp3: () => t('studio:pages.columns.file.type.mp3', 'MP3 audio'),
  wav: () => t('studio:pages.columns.file.type.wav', 'WAV audio'),
  webm: () => t('studio:pages.columns.file.type.webm', 'WebM'),
  ogg: () => t('studio:pages.columns.file.type.ogg', 'Ogg'),
  csv: () => t('studio:pages.columns.file.type.csv', 'CSV'),
  text: () => t('studio:pages.columns.file.type.text', 'Plain text'),
  markdown: () => t('studio:pages.columns.file.type.markdown', 'Markdown'),
  json: () => t('studio:pages.columns.file.type.json', 'JSON'),
};

/**
 * Column types that can carry a reference. A `json` column holding an array of
 * them is refused in v1 and a `binary` column is bytes inside the customer's
 * own database — a different feature — so the switch is not offered on either
 * (37-files-and-storage.md §3.5).
 */
const FILE_CAPABLE_TYPES: ReadonlySet<string> = new Set(['text', 'varchar']);

/** The unit the size cap is authored in; the block stores bytes. */
const BYTES_PER_MB = 1_048_576;

/**
 * `columnFileSchema`'s own floor (`maxBytes: z.number().int().min(1024)`),
 * mirrored here because the dashboard cannot import the server's copy and
 * because a value under it does not fail loudly — it silently deletes the
 * column. See the clamp at the input below.
 */
const MIN_FILE_MAX_BYTES = 1024;

/**
 * A stored `ref` this build does not know about reads as the default.
 *
 * Deliberately forgiving: the vocabulary can only grow, and a page written by
 * a newer build must leave this editor usable rather than render an empty
 * picker whose first keystroke rewrites a shape somebody chose on purpose.
 */
function readRefShape(value: string | undefined): FileRefShape {
  return (FILE_REF_SHAPES as readonly string[]).includes(value ?? '')
    ? (value as FileRefShape)
    : 'url';
}

/**
 * The `file` block of a stored column (`columnFileSchema`, 37 D6/D14).
 *
 * `ref` is optional HERE and required after parsing, because the schema gives
 * it a default: a page may legitimately carry `file: {}` and mean
 * `{ref: 'url'}`. This editor reads through that default and always writes the
 * shape explicitly, so a block it has touched never depends on it again.
 */
export interface StoredFile {
  ref?: string;
  /** Absent = the workspace's default destination, which is what most want. */
  destinationId?: string;
  /** Absent = whatever the workspace accepts. Present, it can only NARROW. */
  accept?: string[];
  maxBytes?: number;
  inline?: boolean;
  /**
   * The column holds a LIST of references rather than one
   * (38-files-library-and-attachments.md D1/D5) — a JSON array in the same
   * text column. Absent = the single-value column 37 shipped.
   */
  multiple?: boolean;
  /** Refuse a write past this many files on one record. `multiple` only. */
  maxCount?: number;
}

/**
 * One stored column. Kept structural rather than importing `GridColumnSpec`:
 * the stored entries are the schema's INPUT shape (defaults not yet applied),
 * so most fields are optional on the wire.
 */
export interface StoredColumn {
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
  /** Outbound FK — the cell renders a chip, which draws its own monogram. */
  fk?: { table: string; column: string; display?: string };
  /** Monogram beside the value. Absent means the column's default (see below). */
  avatar?: boolean;
  lookup?: { path: string[]; select: string };
  reverse?: { table: string; fkColumn: string; agg: string };
  /** Points at a measure or field in `config.derived` (36 §3.2). */
  derived?: { ref: string };
  /** Explicit presentation — a derived value has no semantic to infer one from. */
  display?: { kind: string; currency?: string; decimals?: number; percentScale?: string };
  /** This column holds a FILE, not a string that happens to look like one. */
  file?: StoredFile;
  [key: string]: unknown;
}

/**
 * Drop the `file` key rather than blanking it.
 *
 * `{...column, file: undefined}` leaves the key in the object, and a page
 * toggled on and then off again would no longer be the page it was — which is
 * precisely what 37 D14 promises cannot happen. Every other control on a row
 * writes a value; this is the one that has to unwrite a key.
 */
function withoutFile(column: StoredColumn): StoredColumn {
  const next: StoredColumn = { ...column };
  delete next.file;
  return next;
}

/**
 * Normalize the block for storage: the shape is always written out, and every
 * other field disappears when it has nothing to say.
 *
 * ABSENCE IS THE VOCABULARY, one level down from D14. `accept: []` is not the
 * same document as no `accept` at all — the first is "this column accepts
 * nothing", which no operator ever means, and the second is "whatever the
 * workspace accepts", which is what an empty chip row is saying. Same for a
 * cleared size cap and for an `inline` that is off.
 */
function compactFile(block: {
  ref: FileRefShape;
  destinationId?: string | undefined;
  accept?: readonly string[] | undefined;
  maxBytes?: number | undefined;
  inline?: boolean | undefined;
  multiple?: boolean | undefined;
  maxCount?: number | undefined;
}): StoredFile {
  return {
    ref: block.ref,
    ...(block.destinationId === undefined || block.destinationId === ''
      ? {}
      : { destinationId: block.destinationId }),
    ...(block.accept === undefined || block.accept.length === 0 ? {} : { accept: [...block.accept] }),
    ...(block.maxBytes === undefined ? {} : { maxBytes: block.maxBytes }),
    ...(block.inline === true ? { inline: true } : {}),
    ...(block.multiple === true ? { multiple: true } : {}),
    // Meaningless without `multiple` — a single-value column already holds at
    // most one file — so it is dropped with it rather than left as a number
    // nothing reads.
    ...(block.multiple === true && block.maxCount !== undefined ? { maxCount: block.maxCount } : {}),
  };
}

/**
 * Read the stored `columns[]`, dropping entries the renderer would drop.
 *
 * Mirrors `PageCrudBinding.parseColumns`: per-entry `safeParse`, skip the bad
 * ones, never throw. An editor that crashed on one malformed column would be
 * unusable on exactly the page that needs fixing.
 *
 * Exported because the EDIT SCREEN owns the draft (see {@link ColumnManagerProps}),
 * so it is the one that has to know what "unchanged" means.
 */
export function parseStoredColumns(config: Record<string, unknown>): StoredColumn[] {
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
  /**
   * The page's columns as the edit screen currently holds them — stored, or
   * the draft this card or another surface already changed.
   *
   * CONTROLLED, not internal state with a draft reporter. It used to be the
   * latter, which made this component a writer of the page's config body — fine
   * while columns were the only editable thing in it, and wrong the moment a
   * second surface needed to append one. Two writers of one array have no
   * defined order and no shared view: the derived-numbers card authors a field
   * AND the column that shows it, and under the old model its column would not
   * appear in this list until after a save. The screen owns every part of the
   * body and writes it once (36-derived-columns.md 36-T18).
   */
  columns: readonly StoredColumn[];
  onColumnsChange: (next: StoredColumn[]) => void;
  /** The envelope's `source` — where re-addable columns and FK chains come from. */
  source: { connectionId: string | null; table: string | null };
  /**
   * The page's `config.derived` block as the edit screen currently holds it —
   * stored, or the draft another surface already changed.
   *
   * CONTROLLED rather than reported, unlike `columns`: two surfaces edit this
   * one block (the inbound sub-picker here, the Derived numbers card beside
   * it), and two independent drafts of the same document have no defined merge
   * — whichever the screen applied second would drop the other's measures.
   * One owner, one value, no merge (36-derived-columns.md §3.8).
   */
  derived: CrudDerivedConfig;
  onDerivedChange: (next: CrudDerivedConfig) => void;
}

export function ColumnManager({
  columns,
  onColumnsChange,
  source,
  derived,
  onDerivedChange,
}: ColumnManagerProps) {
  const setDraft = onColumnsChange;

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
  /**
   * The DATABASE column behind each row, when there is one. Only the file
   * section reads it, and only for `maxLength`: the width a shape needs is a
   * fact about the physical column, not about the spec, and the spec does not
   * carry it. A lookup, a count and a page whose schema failed to load simply
   * have no entry, and the section then refuses nothing (it cannot prove a
   * refusal, and guessing one would block a legitimate choice).
   */
  const schemaColumns = useMemo(
    () => new Map((table?.columns ?? []).map((column) => [column.name, column] as const)),
    [table],
  );
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
  /**
   * Every alias this page has already claimed — base columns, lookups,
   * reverse counts, measures and fields share ONE namespace, because they all
   * become row keys and the server refuses a collision by name (D26).
   */
  const takenAliases = useMemo(
    () =>
      new Set([
        ...presentNames,
        ...derived.measures.map((measure) => measure.id),
        ...derived.fields.map((field) => field.id),
      ]),
    [presentNames, derived],
  );
  /** What the shared 12-subquery budget has left for one more projection. */
  const projectionsLeft = MAX_PROJECTIONS - reverseCount - derived.measures.length;

  /** Column browser: null = closed; path [] = the root view. */
  const [browse, setBrowse] = useState<{ path: string[]; query: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function patch(index: number, change: Partial<StoredColumn>): void {
    setDraft(columns.map((column, i) => (i === index ? { ...column, ...change } : column)));
  }

  /**
   * Write or REMOVE one column's `file` block. Separate from {@link patch}
   * because removal is not a value a spread can carry — see {@link withoutFile}.
   */
  function patchFile(index: number, file: StoredFile | undefined): void {
    setDraft(
      columns.map((column, i) =>
        i !== index ? column : file === undefined ? withoutFile(column) : { ...column, file },
      ),
    );
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
    setDraft([...columns, specForReverse({ link, taken: takenAliases }) as StoredColumn]);
    setBrowse(null);
  }

  /**
   * Add a MEASURE and the column that shows it — one authoring act, two
   * halves, written to two different places in the same config body.
   *
   * It does NOT widen the `reverse` block. That vocabulary stays `count`-only
   * for good, which is what lets the client emitter drop any other `agg` token
   * before it reaches the wire without ever suppressing a column this editor
   * just authored (D15).
   */
  function addMeasure(link: InboundLink, fn: MeasureFn, factors: SchemaColumn[]): void {
    const { measure, column } = specForMeasure({ link, fn, factors, taken: takenAliases });
    setDraft([...columns, column as StoredColumn]);
    onDerivedChange({ ...derived, measures: [...derived.measures, measure] });
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
  /*
   * EVERY inbound link is offerable now, whether or not a count already
   * exists. The `|count` dedupe moved DOWN into the sub-picker (it hides the
   * Count option, not the table): filtering the whole link out once someone
   * added a count is what made a sum of the same relation unreachable — the
   * defect this wave started from.
   */
  const inbound = useMemo(
    () => (table === null ? [] : inboundLinks(schema.data, table)),
    [schema.data, table],
  );
  const canAddReverse = inbound.length > 0 && projectionsLeft > 0;
  const canAdd = table !== null && (addable.length > 0 || canAddLinked || canAddReverse);

  // No stored columns AND no schema to add from (source-less page, failed or
  // fruitless schema load) — the original "regenerate to fill them in" state.
  // While the schema is still loading we fall through to the normal layout
  // rather than flashing this alert. Disabled queries stay `isPending`
  // forever, so "still loading" must be scoped to enabled ones.
  const schemaEnabled = source.connectionId !== null && source.table !== null;
  if (columns.length === 0 && table === null && !(schemaEnabled && schema.isPending)) {
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
      {/*
        Says what Mask is, because the word invites the wrong reading. This
        switch decides whether a reader who was ALREADY sent the value has to
        click to see it — it is not access control, and turning it off cannot
        reveal anything the connection withholds (the server nulls those values
        before they leave it, see crud/mask.ts).
      */}
      <p className="text-body-sm text-fg-muted">
        {t(
          'studio:pages.columns.maskHelp',
          'Mask hides a value behind a reveal control for readers allowed to see it. Whether the data leaves the database at all is set on the connection, not here.',
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
                  schemaColumn={schemaColumns.get(column.name)}
                  onPatch={(change) => patch(index, change)}
                  onFileChange={(file) => patchFile(index, file)}
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
                onPickMeasure={addMeasure}
                takenReverse={presentReverse}
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
  schemaColumn,
  onPatch,
  onFileChange,
  onRemove,
}: {
  column: StoredColumn;
  /** The database column behind this row, absent for a projection. */
  schemaColumn: SchemaColumn | undefined;
  onPatch: (change: Partial<StoredColumn>) => void;
  onFileChange: (file: StoredFile | undefined) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: column.name });

  /*
   * WHO GETS THE FILE SWITCH. Only a column that could actually hold a
   * reference: a text or varchar column of the source table. Offering it on
   * every integer, date and reverse count would put a control nobody can use
   * on most rows of most pages, and a `decimal` column that "stores a file" is
   * a page the server would refuse to honour anyway (§3.5).
   *
   * A column that ALREADY carries a block always shows the section, whatever
   * its type says. Generation seeds blocks, schemas drift, and a block this
   * editor hides is a block nobody can turn off — the one state worse than
   * offering the switch too widely.
   */
  const isProjection =
    column.lookup !== undefined || column.reverse !== undefined || column.derived !== undefined;
  const offersFile =
    column.file !== undefined ||
    (!isProjection && FILE_CAPABLE_TYPES.has(column.logicalType ?? 'text'));

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
          {/*
            "Masked", not "PII". The badge reads whatever `pii` currently says,
            and that flag is now an editable per-page display choice — so an
            admin can mask a column no classifier ever called personal, and
            unmask one it did. Naming the badge after the classification made
            it claim something about the DATA; naming it after the treatment
            makes it say what is actually true of this column on this page.
            `tables.pii` on the include-tables screen keeps its name: that one
            really is the classifier's verdict.
          */}
          {column.pii === true ? (
            <Badge tone="warn">{t('studio:pages.columns.masked', 'Masked')}</Badge>
          ) : null}
          {column.file !== undefined ? (
            <Badge tone="info">{t('studio:pages.columns.file.badge', 'File')}</Badge>
          ) : null}
        </div>
        <Input
          value={column.label ?? ''}
          aria-label={fmt(t('studio:pages.columns.header', 'Header for {name}'), {
            name: column.name,
          })}
          onChange={(event) => onPatch({ label: event.target.value })}
        />

        {/*
          Presentation switches, on their own line under the header field
          rather than out on the row's trailing edge with "Shown": that edge is
          where the column-level actions live (is it in the table at all,
          remove it), while these two decide how the value is DRAWN once it is.

          Both are offered on EVERY column. The avatar was briefly limited to
          FK columns, on the reasoning that the chip is where the monogram is
          drawn — which got it backwards: the id column is precisely where a
          monogram is least wanted, and the name column beside it (often a
          lookup across the relation) is where it belongs. So the switch goes
          everywhere and the renderer decides the placement.
        */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="flex items-center gap-2">
            <span className="text-body-sm text-fg-muted">
              {t('studio:pages.columns.mask', 'Mask')}
            </span>
            <Switch
              checked={column.pii === true}
              aria-label={fmt(
                t('studio:pages.columns.maskToggle', 'Hide {name} behind a reveal control'),
                { name: column.name },
              )}
              onCheckedChange={(checked) => onPatch({ pii: checked })}
              data-testid={`studio-pages-mask-${column.name}`}
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="text-body-sm text-fg-muted">
              {t('studio:pages.columns.avatar', 'Avatar')}
            </span>
            <Switch
              // The stored flag is tri-state, so "unset" reads differently per
              // column kind: an FK chip has always drawn a monogram and keeps
              // doing so, everything else has never drawn one. Both write an
              // explicit boolean, which is why the switch is never ambiguous
              // once touched.
              checked={column.fk !== undefined ? column.avatar !== false : column.avatar === true}
              aria-label={fmt(
                t('studio:pages.columns.avatarToggle', 'Show a monogram beside {name}'),
                { name: column.name },
              )}
              onCheckedChange={(checked) => onPatch({ avatar: checked })}
              data-testid={`studio-pages-avatar-${column.name}`}
            />
          </label>

          {offersFile ? (
            <label className="flex items-center gap-2">
              <span className="text-body-sm text-fg-muted">
                {t('studio:pages.columns.file.switch', 'File')}
              </span>
              <Switch
                checked={column.file !== undefined}
                aria-label={fmt(
                  t('studio:pages.columns.file.switchToggle', '{name} stores a file'),
                  { name: column.name },
                )}
                // ON writes the default shape and nothing else (37 D31): every
                // other field of the block means "whatever the workspace says"
                // by being absent, so the smallest honest block is one key.
                onCheckedChange={(checked) => onFileChange(checked ? { ref: 'url' } : undefined)}
                data-testid={`studio-pages-file-${column.name}`}
              />
            </label>
          ) : null}
        </div>

        {column.file === undefined ? null : (
          <ColumnFileSection
            columnName={column.name}
            file={column.file}
            maxLength={schemaColumn?.maxLength ?? null}
            onChange={onFileChange}
          />
        )}
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

/**
 * The `file` block editor for one column (37-files-and-storage.md §3.8).
 *
 * WHY IT MOUNTS WITH THE BLOCK RATHER THAN WITH THE ROW. The destination list
 * is a `storage.manage` read, and an admin who may edit pages need not hold
 * that grant — asking for it on every column of every page would spend a
 * request on page-open and write a 403 into the audit log for an entirely
 * ordinary operator. Mounting the query with the section means the call
 * happens exactly when somebody is choosing a destination, and a refusal
 * degrades to the one option that always exists (the workspace's default)
 * instead of to an error. That is also why the query is silent on failure:
 * there is nothing here for the operator to fix, and the picker without it is
 * still correct — it just offers one choice.
 */
function ColumnFileSection({
  columnName,
  file,
  maxLength,
  onChange,
}: {
  columnName: string;
  file: StoredFile;
  /** The database column's declared width; null when unbounded or unknown. */
  maxLength: number | null;
  onChange: (next: StoredFile) => void;
}) {
  // The SHARED query (`studio/storage/storageApi.ts`) — not a local copy.
  // Three surfaces read this list and React Query keys its cache on the key
  // alone, so a second definition would fight the first over retry policy.
  const destinations = useQuery(destinationsQuery());
  const acceptLabelId = useId();
  const inlineLabelId = useId();
  const multipleLabelId = useId();

  const ref = readRefShape(file.ref);
  const current = {
    ref,
    destinationId: file.destinationId,
    accept: file.accept,
    maxBytes: file.maxBytes,
    inline: file.inline,
    multiple: file.multiple,
    maxCount: file.maxCount,
  };

  /*
   * A destination the operator has turned off is not offered — pointing new
   * uploads at it would author a failure — EXCEPT when it is the one this
   * column already names, which has to stay visible or the picker would
   * silently claim the column uses the default.
   */
  const options = (destinations.data ?? []).filter(
    (option) => option.disabled !== true || option.id === file.destinationId,
  );
  const namedIsUnknown =
    file.destinationId !== undefined && !options.some((option) => option.id === file.destinationId);

  const megabytes =
    file.maxBytes === undefined ? '' : String(Math.round((file.maxBytes / BYTES_PER_MB) * 100) / 100);
  const chosenFits = maxLength === null || maxLength >= FILE_REF_MIN_WIDTH[ref];

  return (
    <div
      className="grid gap-3 rounded-md border border-border bg-surface-2 p-3 sm:grid-cols-2"
      data-testid={`studio-pages-file-block-${columnName}`}
    >
      <FormField
        label={t('studio:pages.columns.file.refLabel', 'Stored value')}
        helper={t(
          'studio:pages.columns.file.refHelp',
          'What is written into this column when a file is uploaded. Values already stored keep working — this only changes the next one.',
        )}
        {...(chosenFits
          ? {}
          : {
              error: t(
                'studio:pages.columns.file.refTooNarrow',
                'This column is too short to hold that value. Pick one it can hold, or widen the column in the database.',
              ),
            })}
      >
        <Select
          value={ref}
          onChange={(event) =>
            onChange(compactFile({ ...current, ref: readRefShape(event.target.value) }))
          }
          data-testid={`studio-pages-file-ref-${columnName}`}
        >
          {FILE_REF_SHAPES.map((shape) => {
            const needs = FILE_REF_MIN_WIDTH[shape];
            const tooNarrow = maxLength !== null && maxLength < needs;
            return (
              <option key={shape} value={shape} disabled={tooNarrow}>
                {tooNarrow
                  ? fmt(
                      t(
                        'studio:pages.columns.file.refWidth',
                        '{shape} — needs {needs} characters, this column holds {holds}',
                      ),
                      { shape: FILE_REF_LABELS[shape](), needs, holds: maxLength },
                    )
                  : FILE_REF_LABELS[shape]()}
              </option>
            );
          })}
        </Select>
      </FormField>

      <FormField
        label={t('studio:pages.columns.file.destinationLabel', 'Destination')}
        helper={t(
          'studio:pages.columns.file.destinationHelp',
          'Where the bytes uploaded through this column are kept.',
        )}
      >
        <Select
          value={file.destinationId ?? ''}
          onChange={(event) =>
            onChange(
              compactFile({
                ...current,
                destinationId: event.target.value === '' ? undefined : event.target.value,
              }),
            )
          }
          data-testid={`studio-pages-file-destination-${columnName}`}
        >
          <option value="">
            {t('studio:pages.columns.file.destinationDefault', 'The default destination')}
          </option>
          {/*
            A destination this reader could not list — no `storage.manage`, or
            it was deleted — is still offered as itself, by id. Dropping it
            would move the selection to "the default" on the next keystroke and
            quietly repoint a column somebody configured deliberately.
          */}
          {namedIsUnknown && file.destinationId !== undefined ? (
            <option value={file.destinationId}>{file.destinationId}</option>
          ) : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        {/*
          Not a `FormField`: its label is an `htmlFor` pointing at one control,
          and this is a group of eighteen. `aria-labelledby` on the group is
          what a screen reader can actually follow.
        */}
        <p id={acceptLabelId} className="text-body-sm font-medium text-fg">
          {t('studio:pages.columns.file.acceptLabel', 'Accepted types')}
        </p>
        <ChoiceChips
          multiple
          aria-labelledby={acceptLabelId}
          value={file.accept ?? []}
          options={FILE_TYPE_KEYS.map((key) => ({ value: key, label: FILE_TYPE_LABELS[key]() }))}
          onValueChange={(next) => onChange(compactFile({ ...current, accept: next }))}
          data-testid={`studio-pages-file-accept-${columnName}`}
        />
        <p className="text-caption text-fg-subtle">
          {t(
            'studio:pages.columns.file.acceptHelp',
            'Leave every type off to accept whatever this workspace accepts. Choosing types can only narrow that list — a column can never accept a type the workspace refuses.',
          )}
        </p>
      </div>

      <FormField
        label={t('studio:pages.columns.file.maxLabel', 'Largest file (MB)')}
        helper={t(
          'studio:pages.columns.file.maxHelp',
          'Leave empty to use the workspace limit. A column can only ask for less.',
        )}
      >
        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={megabytes}
          aria-label={fmt(
            t('studio:pages.columns.file.maxToggle', 'Largest file accepted by {name}, in MB'),
            { name: columnName },
          )}
          onChange={(event) => {
            const entered = Number(event.target.value);
            const bytes = Math.round(entered * BYTES_PER_MB);
            onChange(
              compactFile({
                ...current,
                /*
                 * CLAMPED TO THE SCHEMA'S FLOOR, and it is not cosmetic.
                 * `columnFileSchema` requires `maxBytes ≥ 1024` and
                 * `gridColumnSpecSchema` is `.strict()`, so a smaller value
                 * makes the WHOLE column spec fail to parse — and the page
                 * route drops an unparseable column on read rather than
                 * refusing the write (`routes/pages/envelope.ts`). The
                 * operator would type "0.0005", save, and find the column
                 * gone with nothing said. `min={1}` on a bare number input is
                 * advisory: a person can type any value into it.
                 */
                maxBytes:
                  event.target.value.trim() === '' || !Number.isFinite(entered) || entered <= 0
                    ? undefined
                    : Math.max(bytes, MIN_FILE_MAX_BYTES),
              }),
            );
          }}
          data-testid={`studio-pages-file-max-${columnName}`}
        />
      </FormField>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2">
          <span id={multipleLabelId} className="text-body-sm text-fg-muted">
            {t('studio:pages.columns.file.multipleLabel', 'Hold more than one file')}
          </span>
          <Switch
            checked={file.multiple === true}
            aria-labelledby={multipleLabelId}
            onCheckedChange={(checked) => onChange(compactFile({ ...current, multiple: checked }))}
            data-testid={`studio-pages-file-multiple-${columnName}`}
          />
        </label>
        <p className="text-caption text-fg-subtle">
          {t(
            'studio:pages.columns.file.multipleHelp',
            'The column stores a list of files instead of one. Existing single values keep working — they read as a list of one.',
          )}
        </p>
      </div>

      {file.multiple === true ? (
        <FormField
          label={t('studio:pages.columns.file.maxCountLabel', 'Most files per record')}
          helper={t(
            'studio:pages.columns.file.maxCountHelp',
            'Leave empty to accept as many as a record needs.',
          )}
        >
          <Input
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={file.maxCount === undefined ? '' : String(file.maxCount)}
            aria-label={fmt(t('studio:pages.columns.file.maxCountToggle', 'Most files on one {name}'), {
              name: columnName,
            })}
            onChange={(event) => {
              const entered = Number.parseInt(event.target.value, 10);
              onChange(
                compactFile({
                  ...current,
                  // Clamped to what `columnFileSchema` accepts, for the same
                  // reason the byte cap above is: an out-of-range value makes
                  // the whole column spec unparseable, and the page route
                  // DROPS an unparseable column on read.
                  maxCount:
                    Number.isFinite(entered) && entered > 0 ? Math.min(500, entered) : undefined,
                }),
              );
            }}
            data-testid={`studio-pages-file-max-count-${columnName}`}
          />
        </FormField>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2">
          <span id={inlineLabelId} className="text-body-sm text-fg-muted">
            {t('studio:pages.columns.file.inlineLabel', 'Show it in the table')}
          </span>
          <Switch
            checked={file.inline === true}
            aria-labelledby={inlineLabelId}
            onCheckedChange={(checked) => onChange(compactFile({ ...current, inline: checked }))}
            data-testid={`studio-pages-file-inline-${columnName}`}
          />
        </label>
        <p className="text-caption text-fg-subtle">
          {t(
            'studio:pages.columns.file.inlineHelp',
            'Only images are drawn in the cell. Everything else stays a chip with its name and size, however this is set.',
          )}
        </p>
      </div>
    </div>
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
  onPickMeasure,
  takenReverse,
}: {
  table: SchemaTable;
  browse: { path: string[]; query: string };
  pathTables: SchemaTable[] | null;
  addable: SchemaColumn[];
  canAddLinked: boolean;
  links: SchemaColumn[];
  /** Offerable inbound links (over-cap already filtered out). */
  inbound: InboundLink[];
  /** `table|fkColumn|agg` of the reverse counts already on the page. */
  takenReverse: ReadonlySet<string>;
  presentLookups: ReadonlySet<string>;
  schemaData: Parameters<typeof findTable>[0];
  onQuery: (query: string) => void;
  onFollow: (fkColumn: string) => void;
  onBack: () => void;
  onCancel: () => void;
  onPickBase: (name: string) => void;
  onPickLookup: (column: SchemaColumn) => void;
  onPickReverse: (link: InboundLink) => void;
  onPickMeasure: (link: InboundLink, fn: MeasureFn, factors: SchemaColumn[]) => void;
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
                'Count the rows that point at each record, or add up one of their numbers.',
              )}
            >
              {inboundRows.map((link) => (
                <InboundRow
                  key={`${link.table.id}.${link.column.name}`}
                  link={link}
                  hasCount={takenReverse.has(`${link.table.id}|${link.column.name}|count`)}
                  onPickReverse={onPickReverse}
                  onPickMeasure={onPickMeasure}
                />
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


/**
 * One inbound relation, with the fold sub-picker underneath it.
 *
 * THE DEDUPE LIVES HERE, not one level up. Filtering the whole link out of the
 * browser once a count existed is what made a SUM of the same relation
 * unreachable — you could count a page's invoice items and then never total
 * them. The link always shows; only the Count option disappears.
 */
function InboundRow({
  link,
  hasCount,
  onPickReverse,
  onPickMeasure,
}: {
  link: InboundLink;
  hasCount: boolean;
  onPickReverse: (link: InboundLink) => void;
  onPickMeasure: (link: InboundLink, fn: MeasureFn, factors: SchemaColumn[]) => void;
}) {
  const numeric = useMemo(() => numericColumns(link.table), [link.table]);
  const [fn, setFn] = useState<MeasureFn>('sum');
  const [factors, setFactors] = useState<string[]>([]);
  const single = fn === 'min' || fn === 'max';
  const chosen = factors
    .map((name) => numeric.find((column) => column.name === name))
    .filter((column): column is SchemaColumn => column !== undefined);
  const canAdd = chosen.length > 0 && (!single || chosen.length === 1);

  function toggleFactor(name: string): void {
    setFactors((current) => {
      if (current.includes(name)) return current.filter((entry) => entry !== name);
      // min/max take exactly one column; a factor beyond the fourth is refused
      // by the schema, so the control stops offering one (D17).
      if (single) return [name];
      return current.length >= MAX_FACTORS ? current : [...current, name];
    });
  }

  return (
    <li
      className="border-b border-border last:border-b-0"
      data-testid={`studio-pages-inbound-${link.table.name}-${link.column.name}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-body-sm min-w-0 flex-1 truncate font-mono text-fg">
          {link.table.name}
        </span>
        <span className="truncate font-mono text-caption text-fg-subtle">
          {fmt(t('studio:pages.columns.addVia', 'via {column}'), { column: link.column.name })}
        </span>
        {hasCount ? null : (
          <button
            type="button"
            onClick={() => onPickReverse(link)}
            className="text-caption inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            data-testid={`studio-pages-add-count-${link.table.name}-${link.column.name}`}
          >
            <Badge tone="info">{t('studio:pages.columns.countBadge', 'Count')}</Badge>
            <Plus className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          </button>
        )}
      </div>
      {numeric.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-3 py-2">
          <select
            aria-label={t('studio:pages.columns.foldLabel', 'Aggregate')}
            value={fn}
            onChange={(event) => {
              const next = event.target.value as MeasureFn;
              setFn(next);
              if (next === 'min' || next === 'max') setFactors((current) => current.slice(0, 1));
            }}
            className="text-caption rounded-md border border-border bg-surface px-2 py-1"
            data-testid={`studio-pages-fold-fn-${link.table.name}-${link.column.name}`}
          >
            {MEASURE_FNS.filter(
              (option): option is Exclude<MeasureFn, 'count'> => option !== 'count',
            ).map((option) => (
              <option key={option} value={option}>
                {FOLD_OPTIONS[option]()}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-1">
            {numeric.map((column) => {
              const active = factors.includes(column.name);
              return (
                <button
                  key={column.name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleFactor(column.name)}
                  className={`text-caption rounded-md border px-2 py-1 font-mono focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                    active ? 'border-accent bg-accent-soft text-fg' : 'border-border bg-surface text-fg-muted'
                  }`}
                  data-testid={`studio-pages-fold-col-${link.table.name}-${column.name}`}
                >
                  {column.name}
                </button>
              );
            })}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canAdd}
            onClick={() => onPickMeasure(link, fn, chosen)}
            data-testid={`studio-pages-add-fold-${link.table.name}-${link.column.name}`}
          >
            {t('studio:pages.columns.foldAdd', 'Add')}
          </Button>
          {chosen.length > 1 ? (
            <span className="text-caption text-fg-subtle">
              {/* Multiplied, not summed separately: `sum(qty * rate)` is the
                  gross an invoice never stores. */}
              {chosen.map((column) => column.name).join(' × ')}
            </span>
          ) : null}
        </div>
      )}
    </li>
  );
}

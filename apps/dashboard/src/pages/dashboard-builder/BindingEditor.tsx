/**
 * Binding editor (04-widget-registry.md §5.1 / §6.2) — the surface that authors
 * a widget's `config.binding`.
 *
 * WHY IT EXISTS. `binding` is `.optional()` on the shared widget config schema,
 * so `placement.ts#insertWidget`'s `configSchema.safeParse({})` produces a
 * config with NO `binding` key. `extractBindings` skips such an item, the
 * dashboard hands it `null`, and `page-dashboard` falls through to the widget's
 * own `demoData(seed)` — in production, permanently. Every widget a user drags
 * onto a dashboard was in that state, because nothing anywhere could author a
 * query. This is that surface.
 *
 * WHAT IT AUTHORS IS WHAT THE ENGINE WRITES. All of the translation and every
 * per-shape rule live in `./bindingDraft.ts`, which mirrors the generator's own
 * `descriptor()` helper (packages/widgets/src/registry/candidates.ts); this file
 * is the presentation over it. A hand-authored binding and a generated one are
 * the same object and reach the compiler through the same path.
 *
 * IDENTIFIERS COME FROM THE SNAPSHOT, NEVER FROM TYPING. The server compiles
 * against the connection's active schema snapshot and rejects anything else with
 * a 422 `UNKNOWN_IDENTIFIER` (apps/server/src/widget-data/compiler.ts). A
 * free-text table or column box would therefore be a box for authoring broken
 * bindings, so every identifier control here is a picker over the snapshot and
 * the editor refuses to open a form at all when no snapshot exists.
 */

import { useQuery } from '@tanstack/react-query';
import { Database, Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Combobox,
  FormField,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  NumberStepper,
  Select,
  Spinner,
} from '@adminium/ui';
import type { WidgetDefinition } from '@adminium/widgets';
import type { CompilableDataShape, QueryDescriptor } from '@adminium/engine/config';

import { t } from '../../i18n/t.js';
import { studioApi, type SchemaColumn, type SchemaTable } from '../../studio/api.js';
import {
  BUCKET_UNITS,
  EVENT_SELECT_ROLES,
  FILTER_OPS,
  MEASURE_FNS,
  authorableShapes,
  controlsFor,
  descriptorFromDraft,
  draftFromDescriptor,
  draftIsLossy,
  emptyDraft,
  opTakesValue,
  withShape,
  type BindingDraft,
  type BindingIssue,
  type DraftFilter,
  type EventSelectRole,
  type FilterOp,
  type MeasureFn,
  type ValueKind,
} from './bindingDraft.js';

export interface BindingEditorProps {
  /** The page's connection (`page.source.connectionId`); the descriptor's scope. */
  connectionId: string | null | undefined;
  definition: WidgetDefinition;
  widgetName: string;
  /**
   * The widget's CURRENT binding, read off the SPARSE stored config — never off
   * `validateConfigAgainst(...).config`, which would materialize defaults.
   */
  binding: QueryDescriptor | undefined;
  onSave: (descriptor: QueryDescriptor) => void;
  /** Drop `config.binding` entirely, putting the widget back on demo data. */
  onClear: () => void;
  onClose: () => void;
}

/* ---------------------------------------------------------------- labels */

/**
 * Shape names in the picker. A static map and not a template key: the
 * compilable set is closed and enumerable, so every string here is a literal
 * key the i18n sweep can find.
 */
const SHAPE_LABEL: Record<CompilableDataShape, () => string> = {
  'single-metric': () => t('builder.binding.shape.singleMetric', 'A single number'),
  'metric+delta': () => t('builder.binding.shape.metricDelta', 'A number, compared to the period before'),
  timeseries: () => t('builder.binding.shape.timeseries', 'A value over time'),
  'multi-timeseries': () => t('builder.binding.shape.multiTimeseries', 'One line over time per category'),
  categorical: () => t('builder.binding.shape.categorical', 'A value per category'),
  matrix: () => t('builder.binding.shape.matrix', 'A grid of rows by columns'),
  distribution: () => t('builder.binding.shape.distribution', 'The spread of one column'),
  'record-list': () => t('builder.binding.shape.recordList', 'A list of rows'),
  record: () => t('builder.binding.shape.record', 'One row'),
  stream: () => t('builder.binding.shape.stream', 'A live feed of recent rows'),
  'calendar-events': () => t('builder.binding.shape.calendarEvents', 'Dated events'),
};

const MEASURE_LABEL: Record<MeasureFn, () => string> = {
  count: () => t('builder.binding.fn.count', 'Count of rows'),
  count_distinct: () => t('builder.binding.fn.countDistinct', 'Count of distinct values'),
  sum: () => t('builder.binding.fn.sum', 'Sum'),
  avg: () => t('builder.binding.fn.avg', 'Average'),
  min: () => t('builder.binding.fn.min', 'Minimum'),
  max: () => t('builder.binding.fn.max', 'Maximum'),
};

/**
 * Filter operators. The six comparisons are mathematical symbols, which are the
 * same in every locale and so carry no key; only the word-shaped operators are
 * translated.
 */
const FILTER_OP_LABEL: Record<FilterOp, () => string> = {
  eq: () => '=',
  neq: () => '≠',
  gt: () => '>',
  gte: () => '≥',
  lt: () => '<',
  lte: () => '≤',
  in: () => t('builder.binding.op.in', 'is one of'),
  like: () => t('builder.binding.op.like', 'contains'),
  ilike: () => t('builder.binding.op.ilike', 'contains (any case)'),
  is_null: () => t('builder.binding.op.isNull', 'is empty'),
  not_null: () => t('builder.binding.op.notNull', 'is not empty'),
  between: () => t('builder.binding.op.between', 'is between'),
};

const BUCKET_UNIT_LABEL: Record<(typeof BUCKET_UNITS)[number], () => string> = {
  hour: () => t('builder.binding.unit.hour', 'Hourly'),
  day: () => t('builder.binding.unit.day', 'Daily'),
  week: () => t('builder.binding.unit.week', 'Weekly'),
  month: () => t('builder.binding.unit.month', 'Monthly'),
  quarter: () => t('builder.binding.unit.quarter', 'Quarterly'),
  year: () => t('builder.binding.unit.year', 'Yearly'),
};

const WINDOW_UNIT_LABEL: Record<(typeof BUCKET_UNITS)[number], () => string> = {
  hour: () => t('builder.binding.windowUnit.hour', 'hours'),
  day: () => t('builder.binding.windowUnit.day', 'days'),
  week: () => t('builder.binding.windowUnit.week', 'weeks'),
  month: () => t('builder.binding.windowUnit.month', 'months'),
  quarter: () => t('builder.binding.windowUnit.quarter', 'quarters'),
  year: () => t('builder.binding.windowUnit.year', 'years'),
};

const EVENT_ROLE_LABEL: Record<EventSelectRole, () => string> = {
  date: () => t('builder.binding.event.date', 'Start date column'),
  title: () => t('builder.binding.event.title', 'Title column'),
  category: () => t('builder.binding.event.category', 'Category column (optional)'),
  end: () => t('builder.binding.event.end', 'End date column (optional)'),
};

/* ------------------------------------------------------------- snapshot */

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);
const TEMPORAL_TYPES: ReadonlySet<string> = new Set(['date', 'time', 'timestamp', 'timestamptz']);

/** How a filter operand on this column is typed back out of its text control. */
function valueKindOfColumn(column: SchemaColumn | undefined): ValueKind {
  if (column === undefined) return 'text';
  if (NUMERIC_TYPES.has(column.logicalType)) return 'number';
  if (column.logicalType === 'boolean') return 'boolean';
  return 'text';
}

/** `public.orders`, or bare `orders` on an engine with no schemas. */
function tableKeyOf(table: { schema: string; name: string }): string {
  return table.schema === '' ? table.name : `${table.schema}.${table.name}`;
}

/* -------------------------------------------------------------- controls */

interface ColumnPickerProps {
  label: ReactNode;
  columns: readonly SchemaColumn[];
  value: string;
  onChange: (next: string) => void;
  /** Renders a leading blank row; the label for it (already translated). */
  blankLabel?: string | undefined;
  helper?: ReactNode | undefined;
  error?: ReactNode | undefined;
  disabled?: boolean | undefined;
}

/** One column `<select>` over the snapshot's columns for the chosen table. */
function ColumnPicker({
  label,
  columns,
  value,
  onChange,
  blankLabel,
  helper,
  error,
  disabled,
}: ColumnPickerProps) {
  return (
    <FormField
      label={label}
      {...(helper !== undefined ? { helper } : {})}
      {...(error !== undefined ? { error } : {})}
    >
      <Select
        mono
        disabled={disabled === true || columns.length === 0}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {blankLabel === undefined ? null : <option value="">{blankLabel}</option>}
        {columns.map((column) => (
          <option key={column.name} value={column.name}>
            {column.name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-caption font-bold uppercase tracking-wide text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- editor */

export function BindingEditor({
  connectionId,
  definition,
  widgetName,
  binding,
  onSave,
  onClear,
  onClose,
}: BindingEditorProps) {
  const shapes = useMemo(() => authorableShapes(definition.dataContract), [definition]);

  // Mounted only while open, so the initializer runs once per opening — the
  // form always starts from what is stored rather than from a stale draft.
  const [draft, setDraft] = useState<BindingDraft>(() => {
    if (binding !== undefined) return draftFromDescriptor(binding);
    return emptyDraft(connectionId ?? '', shapes[0] ?? 'single-metric');
  });
  // Issues stay silent until the user asks to save: an editor that opens
  // covered in red errors reads as broken rather than as unfinished.
  const [attempted, setAttempted] = useState(false);

  const schemaQuery = useQuery({
    queryKey: ['builder-binding-schema', connectionId] as const,
    enabled: typeof connectionId === 'string' && connectionId !== '',
    staleTime: 5 * 60_000,
    queryFn: () => studioApi.getSchema(connectionId as string),
  });

  const tables = useMemo<SchemaTable[]>(
    () => (schemaQuery.data?.model.tables ?? []).filter((table) => table.system !== true),
    [schemaQuery.data],
  );
  const currentKey = draft.table === '' ? '' : tableKeyOf({ schema: draft.schema, name: draft.table });
  const currentTable = useMemo(
    () => tables.find((table) => tableKeyOf(table) === currentKey),
    [tables, currentKey],
  );
  const columns = currentTable?.columns ?? [];
  const temporalColumns = useMemo(
    () => columns.filter((column) => TEMPORAL_TYPES.has(column.logicalType)),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => NUMERIC_TYPES.has(column.logicalType)),
    [columns],
  );

  const controls = controlsFor(draft.shape);
  const built = useMemo(() => descriptorFromDraft(draft), [draft]);
  const issues: readonly BindingIssue[] = built.ok ? [] : built.issues;
  const showIssue = useCallback(
    (issue: BindingIssue): boolean => attempted && issues.includes(issue),
    [attempted, issues],
  );

  const lossy = binding !== undefined && draftIsLossy(binding);

  /**
   * Changing the table invalidates every column the form is holding — the
   * compiler resolves each one against THIS table and 422s otherwise, so
   * carrying them over would author a binding guaranteed to fail.
   */
  const pickTable = useCallback((key: string | null): void => {
    setDraft((current) => {
      const [schema = '', name = ''] = key === null || !key.includes('.') ? ['', key ?? ''] : [
        key.slice(0, key.indexOf('.')),
        key.slice(key.indexOf('.') + 1),
      ];
      return {
        ...current,
        schema,
        table: name,
        measureColumn: '',
        groupBy: [],
        bucketColumn: '',
        windowColumn: '',
        select: [],
        orderByColumn: '',
        filters: [],
      };
    });
  }, []);

  const patch = useCallback((next: Partial<BindingDraft>): void => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  const setGroupAt = useCallback((index: number, column: string): void => {
    setDraft((current) => {
      const max = controlsFor(current.shape).groupBy.max;
      const next = Array.from({ length: max }, (_unused, slot) => current.groupBy[slot] ?? '');
      next[index] = column;
      return { ...current, groupBy: next };
    });
  }, []);

  const setEventAt = useCallback((index: number, column: string): void => {
    setDraft((current) => {
      const next = EVENT_SELECT_ROLES.map((_role, slot) => current.select[slot] ?? '');
      next[index] = column;
      return { ...current, select: next };
    });
  }, []);

  const toggleColumn = useCallback((column: string, checked: boolean): void => {
    setDraft((current) => ({
      ...current,
      select: checked
        ? [...current.select, column]
        : current.select.filter((entry) => entry !== column),
    }));
  }, []);

  const patchFilter = useCallback((index: number, next: Partial<DraftFilter>): void => {
    setDraft((current) => ({
      ...current,
      filters: current.filters.map((filter, slot) => (slot === index ? { ...filter, ...next } : filter)),
    }));
  }, []);

  const handleSave = useCallback((): void => {
    const result = descriptorFromDraft(draft);
    if (!result.ok) {
      setAttempted(true);
      return;
    }
    onSave(result.descriptor);
    onClose();
  }, [draft, onSave, onClose]);

  const title = t('builder.binding.title', 'Data source');

  /* ------------------------------------------------------------- gates */

  let gate: ReactNode = null;
  if (shapes.length === 0) {
    gate = (
      <Alert
        tone="info"
        title={t('builder.binding.unbindableTitle', 'This widget can’t query data yet')}
        body={t(
          'builder.binding.unbindableBody',
          'It shows the shape of data the query engine doesn’t build yet, so it renders its own sample content.',
        )}
      />
    );
  } else if (typeof connectionId !== 'string' || connectionId === '') {
    gate = (
      <Alert
        tone="warn"
        title={t('builder.binding.noConnectionTitle', 'This page has no database connection')}
        body={t(
          'builder.binding.noConnectionBody',
          'Widgets can only be bound on a page that belongs to a connection.',
        )}
      />
    );
  } else if (schemaQuery.isPending) {
    gate = (
      <div className="flex items-center gap-2 py-6 text-body-sm text-fg-muted">
        <Spinner label={t('builder.binding.loadingSchema', 'Loading tables…')} />
        {t('builder.binding.loadingSchema', 'Loading tables…')}
      </div>
    );
  } else if (schemaQuery.isError || tables.length === 0) {
    gate = (
      <Alert
        tone="warn"
        role="alert"
        title={t('builder.binding.noSnapshotTitle', 'No schema snapshot for this connection')}
        body={t(
          'builder.binding.noSnapshotBody',
          'Tables and columns come from the connection’s last introspection. Run introspection in Studio, then reopen this editor.',
        )}
      />
    );
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
    >
      <ModalHeader
        icon={<Database className="size-5" aria-hidden="true" />}
        title={title}
        subtitle={widgetName}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        {gate ?? (
          <div className="flex max-h-[60vh] flex-col gap-6 overflow-y-auto">
            {lossy ? (
              <Alert
                tone="warn"
                title={t('builder.binding.lossyTitle', 'This query is more advanced than the editor')}
                body={t(
                  'builder.binding.lossyBody',
                  'Parts of it — extra measures, sorts or page-filter links — aren’t shown here and will be dropped if you save.',
                )}
              />
            ) : null}

            <Section title={t('builder.binding.sectionSource', 'Source')}>
              <FormField
                label={t('builder.binding.table', 'Table or view')}
                {...(showIssue('table')
                  ? { error: t('builder.binding.tableRequired', 'Pick a table to query.') }
                  : {})}
              >
                <Combobox
                  mono
                  options={tables.map((table) => ({
                    value: tableKeyOf(table),
                    label: tableKeyOf(table),
                  }))}
                  value={currentKey === '' ? null : currentKey}
                  onValueChange={pickTable}
                  placeholder={t('builder.binding.tablePlaceholder', 'Search tables…')}
                  emptyText={t('builder.binding.tableEmpty', 'No matching table.')}
                />
              </FormField>

              {shapes.length > 1 ? (
                <FormField
                  // `shapeLabel`, not `shape` — the locale bundles are NESTED
                  // JSON, so a string at `builder.binding.shape` and the object
                  // `builder.binding.shape.*` below cannot both exist.
                  label={t('builder.binding.shapeLabel', 'What this widget shows')}
                  helper={t(
                    'builder.binding.shapeHelper',
                    'Changing this changes which query controls apply.',
                  )}
                >
                  <Select
                    value={draft.shape}
                    onChange={(event) => {
                      setDraft((current) => withShape(current, event.target.value as CompilableDataShape));
                    }}
                  >
                    {shapes.map((shape) => (
                      <option key={shape} value={shape}>
                        {SHAPE_LABEL[shape]()}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
            </Section>

            {controls.measure ? (
              <Section title={t('builder.binding.sectionMeasure', 'Measure')}>
                <FormField label={t('builder.binding.measureFn', 'Calculate')}>
                  <Select
                    value={draft.measureFn}
                    onChange={(event) => patch({ measureFn: event.target.value as MeasureFn })}
                  >
                    {MEASURE_FNS.map((fn) => (
                      <option key={fn} value={fn}>
                        {MEASURE_LABEL[fn]()}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {draft.measureFn === 'count' ? null : (
                  <ColumnPicker
                    label={t('builder.binding.measureColumn', 'Of column')}
                    columns={draft.measureFn === 'count_distinct' ? columns : numericColumns}
                    value={draft.measureColumn}
                    onChange={(next) => patch({ measureColumn: next })}
                    blankLabel={t('builder.binding.columnPlaceholder', 'Choose a column…')}
                    {...(showIssue('measureColumn')
                      ? {
                          error: t(
                            'builder.binding.measureColumnRequired',
                            'This calculation needs a column.',
                          ),
                        }
                      : {})}
                  />
                )}
              </Section>
            ) : null}

            {controls.groupBy.max > 0 ? (
              <Section title={t('builder.binding.sectionBreakdown', 'Breakdown')}>
                {Array.from({ length: controls.groupBy.max }, (_unused, index) => (
                  <ColumnPicker
                    key={index}
                    label={
                      controls.groupBy.max === 1
                        ? t('builder.binding.groupBy', 'Group by')
                        : index === 0
                          ? t('builder.binding.groupByRows', 'Rows')
                          : t('builder.binding.groupByColumns', 'Columns')
                    }
                    columns={columns}
                    value={draft.groupBy[index] ?? ''}
                    onChange={(next) => setGroupAt(index, next)}
                    blankLabel={
                      index < controls.groupBy.min
                        ? t('builder.binding.columnPlaceholder', 'Choose a column…')
                        : t('builder.binding.columnNone', 'None')
                    }
                    {...(showIssue('groupBy') && index < controls.groupBy.min
                      ? { error: t('builder.binding.groupByRequired', 'This view needs a breakdown column.') }
                      : {})}
                  />
                ))}
              </Section>
            ) : null}

            {controls.bucket ? (
              <Section title={t('builder.binding.sectionTime', 'Time axis')}>
                <ColumnPicker
                  label={t('builder.binding.bucketColumn', 'Date column')}
                  columns={temporalColumns}
                  value={draft.bucketColumn}
                  onChange={(next) => patch({ bucketColumn: next })}
                  blankLabel={t('builder.binding.columnPlaceholder', 'Choose a column…')}
                  {...(temporalColumns.length === 0 && currentTable !== undefined
                    ? {
                        helper: t(
                          'builder.binding.noDateColumns',
                          'This table has no date or timestamp column.',
                        ),
                      }
                    : {})}
                  {...(showIssue('bucket')
                    ? { error: t('builder.binding.bucketRequired', 'Pick the column that carries the date.') }
                    : {})}
                />
                <FormField label={t('builder.binding.bucketUnit', 'Group time by')}>
                  <Select
                    value={draft.bucketUnit}
                    onChange={(event) =>
                      patch({ bucketUnit: event.target.value as BindingDraft['bucketUnit'] })
                    }
                  >
                    {BUCKET_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {BUCKET_UNIT_LABEL[unit]()}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </Section>
            ) : null}

            {controls.window === 'off' ? null : (
              <Section title={t('builder.binding.sectionWindow', 'Period')}>
                <ColumnPicker
                  label={t('builder.binding.windowColumn', 'Date column')}
                  columns={temporalColumns}
                  value={draft.windowColumn}
                  onChange={(next) => patch({ windowColumn: next })}
                  blankLabel={
                    controls.window === 'required'
                      ? t('builder.binding.columnPlaceholder', 'Choose a column…')
                      : t('builder.binding.windowNone', 'All time')
                  }
                  {...(showIssue('window')
                    ? {
                        error: t(
                          'builder.binding.windowRequired',
                          'Comparing to the previous period needs a date column.',
                        ),
                      }
                    : {})}
                />
                {draft.windowColumn === '' ? null : (
                  <div className="flex flex-wrap items-end gap-3">
                    <FormField label={t('builder.binding.windowLast', 'Last')} className="w-32">
                      <NumberStepper
                        value={draft.windowLast}
                        min={1}
                        step={1}
                        incrementLabel={t('builder.inspector.increment', 'Increase')}
                        decrementLabel={t('builder.inspector.decrement', 'Decrease')}
                        onValueChange={(next) => patch({ windowLast: next ?? 1 })}
                      />
                    </FormField>
                    <FormField
                      // `windowUnitLabel` for the same nesting reason as
                      // `shapeLabel` above (`builder.binding.windowUnit.*`).
                      label={t('builder.binding.windowUnitLabel', 'Unit')}
                      className="min-w-40 flex-1"
                    >
                      <Select
                        value={draft.windowUnit}
                        onChange={(event) =>
                          patch({ windowUnit: event.target.value as BindingDraft['windowUnit'] })
                        }
                      >
                        {BUCKET_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {WINDOW_UNIT_LABEL[unit]()}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  </div>
                )}
              </Section>
            )}

            {controls.select === 'none' ? null : (
              <Section title={t('builder.binding.sectionColumns', 'Columns')}>
                {controls.select === 'one' ? (
                  <ColumnPicker
                    label={t('builder.binding.valueColumn', 'Value column')}
                    columns={numericColumns}
                    value={draft.select[0] ?? ''}
                    onChange={(next) => patch({ select: next === '' ? [] : [next] })}
                    blankLabel={t('builder.binding.columnPlaceholder', 'Choose a column…')}
                    {...(showIssue('select')
                      ? { error: t('builder.binding.valueColumnRequired', 'Pick the column to measure.') }
                      : {})}
                  />
                ) : controls.select === 'event' ? (
                  <>
                    {EVENT_SELECT_ROLES.map((role, index) => (
                      <ColumnPicker
                        key={role}
                        label={EVENT_ROLE_LABEL[role]()}
                        columns={role === 'date' || role === 'end' ? temporalColumns : columns}
                        value={draft.select[index] ?? ''}
                        onChange={(next) => setEventAt(index, next)}
                        blankLabel={
                          index < 2
                            ? t('builder.binding.columnPlaceholder', 'Choose a column…')
                            : t('builder.binding.columnNone', 'None')
                        }
                      />
                    ))}
                    {showIssue('select') ? (
                      <p className="text-caption text-danger">
                        {t(
                          'builder.binding.eventColumnsRequired',
                          'Events need a start date and a title. An end date also needs a category, because the columns are read in order.',
                        )}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-body-sm text-fg-muted">
                      {t('builder.binding.selectColumns', 'Columns to show')}
                    </legend>
                    {columns.length === 0 ? (
                      <p className="text-body-sm text-fg-muted">
                        {t('builder.binding.pickTableFirst', 'Pick a table to choose its columns.')}
                      </p>
                    ) : (
                      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-xl border border-border p-3">
                        {columns.map((column) => (
                          <label key={column.name} className="flex items-center gap-2 text-body-sm">
                            <Checkbox
                              checked={draft.select.includes(column.name)}
                              onCheckedChange={(next) => toggleColumn(column.name, next === true)}
                            />
                            <span className="font-mono">{column.name}</span>
                            <span className="text-caption text-fg-subtle">{column.logicalType}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {showIssue('select') ? (
                      <p className="text-caption text-danger">
                        {t('builder.binding.selectRequired', 'Choose at least one column to show.')}
                      </p>
                    ) : null}
                  </fieldset>
                )}
              </Section>
            )}

            {controls.order || controls.limit ? (
              <Section title={t('builder.binding.sectionRows', 'Rows')}>
                {controls.order ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-48 flex-1">
                      <ColumnPicker
                        label={t('builder.binding.orderBy', 'Sort by')}
                        columns={columns}
                        value={draft.orderByColumn}
                        onChange={(next) => patch({ orderByColumn: next })}
                        blankLabel={t('builder.binding.orderNone', 'Database order')}
                      />
                    </div>
                    {draft.orderByColumn === '' ? null : (
                      <FormField
                        label={t('builder.binding.orderDir', 'Direction')}
                        className="min-w-40 flex-1"
                      >
                        <Select
                          value={draft.orderByDir}
                          onChange={(event) =>
                            patch({ orderByDir: event.target.value === 'asc' ? 'asc' : 'desc' })
                          }
                        >
                          <option value="desc">{t('builder.binding.orderDesc', 'Newest / highest first')}</option>
                          <option value="asc">{t('builder.binding.orderAsc', 'Oldest / lowest first')}</option>
                        </Select>
                      </FormField>
                    )}
                  </div>
                ) : null}
                {controls.limit ? (
                  <FormField
                    label={t('builder.binding.limit', 'Most rows to fetch')}
                    className="w-40"
                  >
                    <NumberStepper
                      value={draft.limit}
                      min={1}
                      max={1000}
                      step={1}
                      incrementLabel={t('builder.inspector.increment', 'Increase')}
                      decrementLabel={t('builder.inspector.decrement', 'Decrease')}
                      onValueChange={(next) => patch({ limit: next ?? 1 })}
                    />
                  </FormField>
                ) : null}
              </Section>
            ) : null}

            <Section title={t('builder.binding.sectionFilters', 'Filters')}>
              {draft.filters.length === 0 ? (
                <p className="text-body-sm text-fg-muted">
                  {t('builder.binding.noFilters', 'No filters — every row in the table is counted.')}
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {draft.filters.map((filter, index) => (
                    // Filter rows have no stable identity of their own; the index
                    // IS the identity here, and rows are only ever appended or
                    // removed as a whole.
                    <li key={index} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-40 flex-1">
                        <ColumnPicker
                          label={t('builder.binding.filterColumn', 'Column')}
                          columns={columns}
                          value={filter.column}
                          onChange={(next) =>
                            patchFilter(index, {
                              column: next,
                              kind: valueKindOfColumn(columns.find((column) => column.name === next)),
                            })
                          }
                          blankLabel={t('builder.binding.columnPlaceholder', 'Choose a column…')}
                          {...(showIssue('filters') && filter.column === ''
                            ? { error: t('builder.binding.filterColumnRequired', 'Pick a column.') }
                            : {})}
                        />
                      </div>
                      <FormField
                        label={t('builder.binding.filterOp', 'Condition')}
                        className="min-w-36 flex-1"
                      >
                        <Select
                          value={filter.op}
                          onChange={(event) => patchFilter(index, { op: event.target.value as FilterOp })}
                        >
                          {FILTER_OPS.map((op) => (
                            <option key={op} value={op}>
                              {FILTER_OP_LABEL[op]()}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      {opTakesValue(filter.op) ? (
                        <FormField
                          label={t('builder.binding.filterValue', 'Value')}
                          className="min-w-40 flex-1"
                          {...(filter.op === 'in' || filter.op === 'between'
                            ? { helper: t('builder.binding.filterListHelper', 'Separate values with commas.') }
                            : {})}
                        >
                          <Input
                            value={filter.value}
                            onChange={(event) => patchFilter(index, { value: event.target.value })}
                          />
                        </FormField>
                      ) : null}
                      <IconButton
                        size="md"
                        variant="ghost"
                        className="text-danger hover:text-danger"
                        label={t('builder.binding.removeFilter', 'Remove filter')}
                        onClick={() =>
                          patch({ filters: draft.filters.filter((_unused, slot) => slot !== index) })
                        }
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Plus className="size-4" aria-hidden="true" />}
                  disabled={columns.length === 0 || draft.filters.length >= 16}
                  onClick={() =>
                    patch({
                      filters: [...draft.filters, { column: '', op: 'eq', value: '', kind: 'text' }],
                    })
                  }
                >
                  {t('builder.binding.addFilter', 'Add filter')}
                </Button>
              </div>
            </Section>

            {attempted && !built.ok ? (
              <Alert
                tone="danger"
                role="alert"
                title={t('builder.binding.incompleteTitle', 'This query isn’t finished')}
                body={t(
                  'builder.binding.incompleteBody',
                  'Fill in the highlighted fields — a half-written query would fail on the live dashboard.',
                )}
              />
            ) : null}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        {binding === undefined ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="me-auto text-danger hover:text-danger"
            onClick={() => {
              onClear();
              onClose();
            }}
          >
            {t('builder.binding.remove', 'Remove data source')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        {gate === null ? (
          <Button variant="primary" size="sm" onClick={handleSave}>
            {t('builder.binding.save', 'Use this query')}
          </Button>
        ) : null}
      </ModalFooter>
    </Modal>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  evaluateDerivedFields,
  parseCrudDerived,
  type CrudDerivedConfig,
  type DerivedField,
  type FieldExpr,
} from '@adminium/engine/config';
import { Alert, Badge, Button, IconButton, Input } from '@adminium/ui';
import { Trash2 } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { studioApi, type SchemaColumn } from '../api.js';
import { findTable, numericColumns } from './columnSpecBuilder.js';
import type { StoredColumn } from './ColumnManager.js';

/** `{name}` interpolation — the same one-liner the Columns card uses. */
const fmt = (template: string, args: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => String(args[key] ?? match));

/**
 * The "Derived numbers" card — arithmetic and rules over the folds the Columns
 * card authors (36-derived-columns.md §3.8, D30).
 *
 * A CLOSED BUILDER, not a formula field. There is no expression evaluator in
 * the lockfile and both written precedents in this tree refuse expression
 * strings, so what an operator gets is three shapes with pickers rather than a
 * text box: a difference or sum of two numbers, a percentage of one, and a
 * threshold rule. Between them they answer every number the wave was asked
 * for — the discount total, the tax, the total after tax and the free-shipping
 * rule — and each is three choices, not a syntax.
 *
 * THE PREVIEW RUNS THE SHIPPED EVALUATOR. `evaluateDerivedFields` is the same
 * function the server calls on every read, reached through the same
 * `@adminium/engine/config` re-export, so the number shown here cannot drift
 * from the number the grid will show. What is sampled is the INPUTS: each
 * measure and each column a rule reads gets an editable value, because the
 * question this card has to answer is "does my rule do what I think", and that
 * is a question about the formula, not about row 1.
 *
 * TWO HALVES OF ONE ACT. Adding a number writes a FIELD into `config.derived`
 * and the COLUMN that shows it — a field with no column renders nowhere, and a
 * column with no field renders empty. Both go up to the edit screen, which owns
 * the whole config body and writes it once.
 */

/** Digits every derived number is rounded to on output. Money's width. */
const FIELD_SCALE = 2;

type PresetKind = 'combine' | 'percent' | 'rule';

interface DerivedNumbersCardProps {
  columns: readonly StoredColumn[];
  onColumnsChange: (next: StoredColumn[]) => void;
  derived: CrudDerivedConfig;
  onDerivedChange: (next: CrudDerivedConfig) => void;
  /** The envelope's `source` — the same schema query the Columns card runs. */
  source: { connectionId: string | null; table: string | null };
}

/** Every id a field may read: the page's measures, then its earlier fields. */
function operandIds(derived: CrudDerivedConfig, upTo?: number): string[] {
  const fields = upTo === undefined ? derived.fields : derived.fields.slice(0, upTo);
  return [...derived.measures.map((measure) => measure.id), ...fields.map((field) => field.id)];
}

/** `{measure}` or `{field}` — the AST distinguishes them, the picker need not. */
function operandNode(derived: CrudDerivedConfig, id: string): FieldExpr {
  return derived.measures.some((measure) => measure.id === id) ? { measure: id } : { field: id };
}

/** A stored id, sanitized from a label the operator typed. */
function idFor(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^([0-9])/, '_$1')
      .slice(0, 56) || 'value';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}_${String(i)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function DerivedNumbersCard({
  columns,
  onColumnsChange,
  derived,
  onDerivedChange,
  source,
}: DerivedNumbersCardProps) {
  const schema = useQuery({
    queryKey: ['studio', 'schema', source.connectionId] as const,
    queryFn: () => studioApi.getSchema(source.connectionId as string),
    enabled: source.connectionId !== null && source.table !== null,
    retry: false,
  });
  const table = useMemo(() => findTable(schema.data, source.table), [schema.data, source.table]);
  const rowNumbers = useMemo<SchemaColumn[]>(
    () => (table === null ? [] : numericColumns(table)),
    [table],
  );

  const [preset, setPreset] = useState<PresetKind | null>(null);
  const taken = useMemo(
    () => new Set([...columns.map((column) => column.name), ...operandIds(derived)]),
    [columns, derived],
  );

  function add(label: string, expr: FieldExpr, money: boolean): void {
    const id = idFor(label, taken);
    const field: DerivedField = { id, expr, scale: FIELD_SCALE };
    // Validate through the SHIPPED parser before storing: an id that collides,
    // a reference that points forward, an expression past the node or depth
    // budget — every one of them is a hard 422 that blanks the whole page on
    // read, so the editor refuses to author it rather than letting the page
    // break itself.
    const next: CrudDerivedConfig = { ...derived, fields: [...derived.fields, field] };
    // The namespace as the SERVER sees it: real table columns in `columns`,
    // projection aliases in `takenAliases`. A derived column's own name IS its
    // measure's id by construction, so passing every spec name as a base
    // column would report each measure as colliding with itself.
    const checked = parseCrudDerived(next, {
      columns: columns
        .filter(
          (column) =>
            column.derived === undefined &&
            column.lookup === undefined &&
            column.reverse === undefined,
        )
        .map((column) => column.name),
      takenAliases: columns
        .filter((column) => column.lookup !== undefined || column.reverse !== undefined)
        .map((column) => column.name),
    });
    if (!checked.ok) {
      setError(checked.refusal.message);
      return;
    }
    setError(null);
    onDerivedChange(next);
    onColumnsChange([
      ...columns,
      {
        name: id,
        label,
        logicalType: 'decimal',
        semantic: null,
        format: null,
        derived: { ref: id },
        display: money
          ? { kind: 'currency', decimals: FIELD_SCALE }
          : { kind: 'decimal', decimals: FIELD_SCALE },
        pii: false,
        mono: true,
        align: 'end',
        sortable: false,
        hidden: false,
        primaryKey: false,
        nullable: true,
        hasDefault: false,
        unique: false,
        readOnly: true,
        maxLength: null,
        isDisplay: false,
      } as StoredColumn,
    ]);
    setPreset(null);
  }

  const [error, setError] = useState<string | null>(null);

  function removeField(index: number): void {
    const field = derived.fields[index];
    if (field === undefined) return;
    onDerivedChange({ ...derived, fields: derived.fields.filter((_, i) => i !== index) });
    onColumnsChange(columns.filter((column) => column.derived?.ref !== field.id));
  }

  function removeMeasure(index: number): void {
    const measure = derived.measures[index];
    if (measure === undefined) return;
    onDerivedChange({ ...derived, measures: derived.measures.filter((_, i) => i !== index) });
    onColumnsChange(columns.filter((column) => column.derived?.ref !== measure.id));
  }

  /** A field a LATER field reads cannot be removed on its own — refs point back. */
  const referenced = useMemo(() => {
    const names = new Set<string>();
    const walk = (expr: FieldExpr): void => {
      if ('field' in expr) names.add(expr.field);
      else if ('measure' in expr) names.add(expr.measure);
      else if ('op' in expr) {
        walk(expr.args[0]);
        walk(expr.args[1]);
      } else if ('cases' in expr) {
        for (const branch of expr.cases) {
          walk(branch.when.left);
          walk(branch.when.right);
          walk(branch.then);
        }
        walk(expr.else);
      }
    };
    for (const field of derived.fields) walk(field.expr);
    return names;
  }, [derived.fields]);

  const operands = operandIds(derived);
  const hasAny = derived.measures.length > 0 || derived.fields.length > 0;

  return (
    <div className="flex flex-col gap-3" data-testid="studio-pages-derived">
      <p className="text-body-sm text-fg-muted">
        {t(
          'studio:pages.derived.help',
          'Work out numbers from the summaries above and this record’s own columns. They are calculated when the page loads and cannot be sorted.',
        )}
      </p>

      {hasAny ? (
        <ul className="rounded-md border border-border bg-surface">
          {derived.measures.map((measure, index) => (
            <li
              key={measure.id}
              className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
              data-testid={`studio-pages-derived-measure-${measure.id}`}
            >
              <span className="text-body-sm min-w-0 flex-1 truncate font-mono text-fg">
                {measure.id}
              </span>
              <span className="truncate font-mono text-caption text-fg-subtle">
                {`${measure.fn}(${(measure.of?.terms[0]?.factors ?? []).join(' × ') || '*'}) · ${measure.table}`}
              </span>
              <Badge tone="info">{t('studio:pages.derived.foldBadge', 'Fold')}</Badge>
              <IconButton
                label={fmt(t('studio:pages.derived.remove', 'Remove {name}'), { name: measure.id })}
                size="sm"
                variant="ghost"
                disabled={referenced.has(measure.id)}
                onClick={() => removeMeasure(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
          {derived.fields.map((field, index) => (
            <li
              key={field.id}
              className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
              data-testid={`studio-pages-derived-field-${field.id}`}
            >
              <span className="text-body-sm min-w-0 flex-1 truncate font-mono text-fg">
                {field.id}
              </span>
              <Badge tone="accent">{t('studio:pages.derived.fieldBadge', 'Computed')}</Badge>
              <IconButton
                label={fmt(t('studio:pages.derived.remove', 'Remove {name}'), { name: field.id })}
                size="sm"
                variant="ghost"
                disabled={derived.fields.slice(index + 1).some((later) => referencesId(later, field.id))}
                onClick={() => removeField(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <Alert
          tone="info"
          title={t('studio:pages.derived.emptyTitle', 'No computed numbers yet')}
          body={t(
            'studio:pages.derived.emptyBody',
            'Summarize a linked table in the Columns card first — the rules here are built from those numbers.',
          )}
        />
      )}

      {error === null ? null : <Alert tone="danger" title={error} />}

      {operands.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPreset('combine')} data-testid="studio-pages-derived-preset-combine">
            {t('studio:pages.derived.preset.combine', 'Add or subtract two numbers')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPreset('percent')} data-testid="studio-pages-derived-preset-percent">
            {t('studio:pages.derived.preset.percent', 'Percentage of a number')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPreset('rule')} data-testid="studio-pages-derived-preset-rule">
            {t('studio:pages.derived.preset.rule', 'Rule with a threshold')}
          </Button>
        </div>
      )}

      {preset === null ? null : (
        <PresetForm
          kind={preset}
          operands={operands}
          derived={derived}
          rowNumbers={rowNumbers}
          onCancel={() => setPreset(null)}
          onAdd={add}
        />
      )}

      {derived.fields.length === 0 ? null : (
        <Preview derived={derived} />
      )}
    </div>
  );
}

/** Whether `field` reads `id` anywhere in its expression. */
function referencesId(field: DerivedField, id: string): boolean {
  let found = false;
  const walk = (expr: FieldExpr): void => {
    if ('field' in expr) found ||= expr.field === id;
    else if ('measure' in expr) found ||= expr.measure === id;
    else if ('op' in expr) {
      walk(expr.args[0]);
      walk(expr.args[1]);
    } else if ('cases' in expr) {
      for (const branch of expr.cases) {
        walk(branch.when.left);
        walk(branch.when.right);
        walk(branch.then);
      }
      walk(expr.else);
    }
  };
  walk(field.expr);
  return found;
}

function PresetForm({
  kind,
  operands,
  derived,
  rowNumbers,
  onCancel,
  onAdd,
}: {
  kind: PresetKind;
  operands: string[];
  derived: CrudDerivedConfig;
  rowNumbers: SchemaColumn[];
  onCancel: () => void;
  onAdd: (label: string, expr: FieldExpr, money: boolean) => void;
}) {
  const [label, setLabel] = useState('');
  const [left, setLeft] = useState(operands[0] ?? '');
  const [right, setRight] = useState(operands[1] ?? operands[0] ?? '');
  const [op, setOp] = useState<'add' | 'sub'>('sub');
  const [column, setColumn] = useState(rowNumbers[0]?.name ?? '');
  const [threshold, setThreshold] = useState('500');
  const [thenValue, setThenValue] = useState('0');
  const [elseValue, setElseValue] = useState('12.50');

  const decimal = /^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/;
  const numbersOk =
    kind !== 'rule' ||
    (decimal.test(threshold) && decimal.test(thenValue) && decimal.test(elseValue));
  const ready =
    label.trim() !== '' &&
    left !== '' &&
    numbersOk &&
    (kind !== 'combine' || right !== '') &&
    (kind !== 'percent' || column !== '');

  function submit(): void {
    const name = label.trim();
    if (kind === 'combine') {
      onAdd(name, { op, args: [operandNode(derived, left), operandNode(derived, right)] }, true);
      return;
    }
    if (kind === 'percent') {
      // `× column ÷ 100`, never `× (column/100)` inside a fold: the division is
      // a field-level one by a literal, which is the only division the grammar
      // allows anywhere (D6).
      onAdd(
        name,
        {
          op: 'mul',
          args: [operandNode(derived, left), { op: 'div', args: [{ col: column }, { lit: '100' }] }],
        },
        true,
      );
      return;
    }
    onAdd(
      name,
      {
        cases: [
          {
            when: { left: operandNode(derived, left), cmp: 'gte', right: { lit: threshold } },
            then: { lit: thenValue },
          },
        ],
        else: { lit: elseValue },
      },
      true,
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3" data-testid="studio-pages-derived-form">
      <label className="flex flex-col gap-1">
        <span className="text-caption text-fg-muted">
          {t('studio:pages.derived.label', 'Column header')}
        </span>
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          data-testid="studio-pages-derived-label"
        />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <OperandSelect
          label={t('studio:pages.derived.operandA', 'Number')}
          value={left}
          options={operands}
          onChange={setLeft}
          testId="studio-pages-derived-left"
        />
        {kind === 'combine' ? (
          <>
            <select
              aria-label={t('studio:pages.derived.operator', 'Operator')}
              value={op}
              onChange={(event) => setOp(event.target.value === 'add' ? 'add' : 'sub')}
              className="text-caption rounded-md border border-border bg-surface px-2 py-1"
              data-testid="studio-pages-derived-op"
            >
              <option value="sub">{t('studio:pages.derived.minus', 'minus')}</option>
              <option value="add">{t('studio:pages.derived.plus', 'plus')}</option>
            </select>
            <OperandSelect
              label={t('studio:pages.derived.operandB', 'Number')}
              value={right}
              options={operands}
              onChange={setRight}
              testId="studio-pages-derived-right"
            />
          </>
        ) : null}
        {kind === 'percent' ? (
          <label className="flex flex-col gap-1">
            <span className="text-caption text-fg-muted">
              {t('studio:pages.derived.percentOf', 'per cent from this record')}
            </span>
            <select
              value={column}
              onChange={(event) => setColumn(event.target.value)}
              className="text-caption rounded-md border border-border bg-surface px-2 py-1"
              data-testid="studio-pages-derived-column"
            >
              {rowNumbers.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {kind === 'rule' ? (
          <>
            <NumberField
              label={t('studio:pages.derived.atLeast', 'is at least')}
              value={threshold}
              onChange={setThreshold}
              testId="studio-pages-derived-threshold"
            />
            <NumberField
              label={t('studio:pages.derived.thenShow', 'then show')}
              value={thenValue}
              onChange={setThenValue}
              testId="studio-pages-derived-then"
            />
            <NumberField
              label={t('studio:pages.derived.otherwise', 'otherwise')}
              value={elseValue}
              onChange={setElseValue}
              testId="studio-pages-derived-else"
            />
          </>
        ) : null}
      </div>
      {numbersOk ? null : (
        <p className="text-caption text-danger">
          {t(
            'studio:pages.derived.numberHelp',
            'Numbers are plain decimals — 500 or 12.50, never 1,000 or 5e3.',
          )}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={!ready} onClick={submit} data-testid="studio-pages-derived-add">
          {t('studio:pages.derived.add', 'Add column')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('studio:pages.derived.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}

function OperandSelect({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption text-fg-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="text-caption rounded-md border border-border bg-surface px-2 py-1 font-mono"
        data-testid={testId}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption text-fg-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        className="text-caption w-24 rounded-md border border-border bg-surface px-2 py-1 font-mono"
        data-testid={testId}
      />
    </label>
  );
}

/**
 * The live preview. Runs `evaluateDerivedFields` — the function the SERVER
 * calls on every read — over sample inputs the operator can edit, so what is
 * being checked is the formula rather than row 1, and the number shown cannot
 * drift from the number the grid will show.
 */
function Preview({ derived }: { derived: CrudDerivedConfig }) {
  const inputs = useMemo(() => {
    const names = new Set<string>(derived.measures.map((measure) => measure.id));
    const walk = (expr: FieldExpr): void => {
      if ('col' in expr) names.add(expr.col);
      else if ('op' in expr) {
        walk(expr.args[0]);
        walk(expr.args[1]);
      } else if ('cases' in expr) {
        for (const branch of expr.cases) {
          walk(branch.when.left);
          walk(branch.when.right);
          walk(branch.then);
        }
        walk(expr.else);
      }
    };
    for (const field of derived.fields) walk(field.expr);
    return [...names];
  }, [derived]);

  const [sample, setSample] = useState<Record<string, string>>({});
  const row = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const name of inputs) out[name] = sample[name] ?? '100';
    return out;
  }, [inputs, sample]);
  const result = useMemo(
    () => evaluateDerivedFields(derived.fields, { row }),
    [derived.fields, row],
  );

  return (
    <div className="rounded-md border border-border bg-surface p-3" data-testid="studio-pages-derived-preview">
      <h3 className="text-body-sm font-semibold text-fg">
        {t('studio:pages.derived.previewTitle', 'Preview')}
      </h3>
      <p className="text-caption text-fg-muted">
        {t(
          'studio:pages.derived.previewHelp',
          'Sample values, calculated by the same code the page uses.',
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {inputs.map((name) => (
          <NumberField
            key={name}
            label={name}
            value={sample[name] ?? '100'}
            onChange={(next) => setSample((current) => ({ ...current, [name]: next }))}
            testId={`studio-pages-derived-sample-${name}`}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {derived.fields.map((field) => (
          <li key={field.id} className="flex items-center gap-2 font-mono text-caption">
            <span className="text-fg-muted">{field.id}</span>
            <span className="text-fg" data-testid={`studio-pages-derived-value-${field.id}`}>
              {result.values[field.id] ?? '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

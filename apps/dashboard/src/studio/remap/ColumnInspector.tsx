// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Right-pane inspector for a selected column: label override, logical type
 * (read-only — see note), semantic override over the engine SEMANTIC_TAGS
 * with classifier confidence, PII masking toggle, and the enum semantics
 * editor (workflow vs category + per-value label/tone map) when the column
 * is an enum (`column.*` ops).
 *
 * Logical type: adapters map native types onto the closed LOGICAL_TYPES set
 * at introspection time; the v1 override vocabulary has no
 * `column.logicalType` op, so the select renders disabled with the
 * "inferred: X" hint instead of staging an op the server would reject.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LOGICAL_TYPES, SEMANTIC_TAGS } from '@adminium/engine';
import { Badge, FormField, Input, MonoText, SegmentedControl, Select, Switch, Tag, Textarea } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { optionListsQuery } from '../lists/optionListsApi.js';
import { columnDisplayLabel, enumValuesFor, titleCase, type EffectiveColumn, type EffectiveModel, type EffectiveTable } from './model.js';
import { overrideKey, type RemapBuffer } from './useRemapBuffer.js';

/** Tone vocabulary shared with the grid enum chips (widgets column-spec). */
export const ENUM_TONES = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const;

/** Columns whose bounds are numbers rather than lengths. */
const NUMERIC: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);

export interface ColumnInspectorProps {
  model: EffectiveModel;
  table: EffectiveTable;
  column: EffectiveColumn;
  buffer: RemapBuffer;
  fieldError?: string | undefined;
}

/** Where a column's answers come from (D19/D20). */
type OptionsSource = 'any' | 'values' | 'list';

export function ColumnInspector({ model, table, column, buffer, fieldError }: ColumnInspectorProps) {
  /*
   * The workspace's lists, for the picker below. It is a cached, shared query
   * (`optionListsQuery` owns its options), so opening ten columns in a row
   * reads it once — and a reader who cannot see it gets a picker that says so
   * rather than an inspector that fails to render.
   */
  const optionLists = useQuery(optionListsQuery());
  /*
   * The answer source the admin picked, until they leave this column. Null
   * means "whatever the rule says" — see `storedSource` below.
   */
  const [pickedSource, setPickedSource] = useState<OptionsSource | null>(null);
  useEffect(() => setPickedSource(null), [table.id, column.name]);
  const target = { tableName: table.id, columnName: column.name } as const;
  const labelKey = overrideKey({ op: 'column.label', ...target, value: { label: '' } });
  const semanticKey = overrideKey({ op: 'column.semanticType', ...target, value: { semanticType: '' } });
  const piiKey = overrideKey({ op: 'column.pii', ...target, value: { masked: true } });
  const enumKey = overrideKey({ op: 'column.enumLabels', ...target, value: { labels: {} } });

  const labelEntry = buffer.get(labelKey);
  const stagedLabel =
    labelEntry !== null && labelEntry.item.op === 'column.label' ? labelEntry.item.value.label : null;

  const semanticEntry = buffer.get(semanticKey);
  const stagedSemantic =
    semanticEntry !== null && semanticEntry.item.op === 'column.semanticType'
      ? semanticEntry.item.value
      : null;

  const piiEntry = buffer.get(piiKey);
  const stagedPii = piiEntry !== null && piiEntry.item.op === 'column.pii' ? piiEntry.item.value : null;

  const enumEntry = buffer.get(enumKey);
  const stagedEnum =
    enumEntry !== null && enumEntry.item.op === 'column.enumLabels' ? enumEntry.item.value : null;

  const semantics = column.semantics;
  const inferredTag = semantics?.primary ?? 'plain';
  const confidencePct = semantics === null ? null : Math.round(semantics.confidence * 100);
  const piiKind = semantics?.flags.pii ?? null;
  const masked = stagedPii?.masked ?? column.masked ?? semantics?.flags.maskedByDefault === true;

  const enumValues = enumValuesFor(model, column);
  const isEnum = enumValues.length > 0;

  const stagePii = (nextMasked: boolean) => {
    buffer.stage({
      op: 'column.pii',
      ...target,
      value: { masked: nextMasked, ...(piiKind === null ? {} : { kind: piiKind }) },
    });
  };

  const enumLabels = stagedEnum?.labels ?? column.enumLabels ?? {};
  const enumTones = stagedEnum?.tones ?? column.enumTones ?? {};

  const stageEnum = (labels: Record<string, string>, tones: Record<string, string>) => {
    if (Object.keys(labels).length === 0 && Object.keys(tones).length === 0) {
      buffer.drop(enumKey);
      return;
    }
    buffer.stage({
      op: 'column.enumLabels',
      ...target,
      value: { labels, ...(Object.keys(tones).length === 0 ? {} : { tones }) },
    });
  };

  const currentEnumSemantic = stagedSemantic?.semanticType ?? inferredTag;

  /*
   * ─── The four column rules (plan 50 phase C) ──────────────────────────────
   *
   * Staged through the SAME buffer as every other op, so one Save writes the
   * whole document and a rule can be taken back the way a label can. Each
   * reads "what is staged, else what the server resolved", which is what makes
   * an edit visible before it is saved.
   */
  const fillKey = overrideKey({ op: 'column.default', ...target, value: { kind: 'now' } });
  const optionsKey = overrideKey({ op: 'column.options', ...target, value: { values: [] } });
  const requiredKey = overrideKey({ op: 'column.required', ...target, value: { required: true } });
  const validationKey = overrideKey({ op: 'column.validation', ...target, value: {} });

  const fillEntry = buffer.get(fillKey);
  const fill =
    fillEntry !== null && fillEntry.item.op === 'column.default' ? fillEntry.item.value : column.fill;
  const requiredEntry = buffer.get(requiredKey);
  const required =
    requiredEntry !== null && requiredEntry.item.op === 'column.required'
      ? true
      : requiredEntry === null && column.requiredByRule === true;
  const optionsEntry = buffer.get(optionsKey);
  const options =
    optionsEntry !== null && optionsEntry.item.op === 'column.options'
      ? optionsEntry.item.value
      : column.options;
  const optionsText =
    options !== undefined && 'values' in options
      ? options.values.map((option) => option.value).join('\n')
      : '';
  const validationEntry = buffer.get(validationKey);
  const validation =
    (validationEntry !== null && validationEntry.item.op === 'column.validation'
      ? validationEntry.item.value
      : column.validation) ?? {};

  /**
   * What already fills this column without a rule (D5), said where the rule
   * that would switch it off is — otherwise "Leave it to the database" reads
   * as "nothing happens", which for a `created_at` is untrue.
   *
   * Derived from the same three facts the server derives it from — the
   * semantic tag, the logical type and the absence of a database default — so
   * the two cannot disagree about a column that is already handled.
   */
  const implicitlyFilled =
    column.default === null &&
    !column.isGenerated &&
    ((['created-at', 'updated-at'].includes(inferredTag) &&
      ['date', 'time', 'timestamp', 'timestamptz'].includes(column.logicalType)) ||
      (column.isPrimaryKey && column.logicalType === 'uuid'));
  const fillHelper =
    fill === undefined && implicitlyFilled
      ? t('studio:remap.rules.fillImplicit', 'Adminium fills this in automatically.')
      : null;

  const stageFill = (kind: string, extra: Record<string, unknown> = {}): void => {
    if (kind === '') {
      buffer.drop(fillKey);
      return;
    }
    buffer.stage({
      op: 'column.default',
      ...target,
      value: { ...(fill?.kind === kind ? fill : {}), kind, ...extra } as never,
    });
  };

  const stageRequired = (next: boolean): void => {
    // "Not required" is the ABSENCE of the row, never a row saying false: the
    // column's own NOT NULL is the database's to state, not an override's.
    if (next) buffer.stage({ op: 'column.required', ...target, value: { required: true } });
    else buffer.drop(requiredKey);
  };

  /**
   * Where this column's answers come from: nowhere, a list of values typed
   * here, or a named list. Three states rather than two, because "a list I
   * name" and "values I type" store different things and a single textarea
   * could say only one of them.
   *
   * The CHOICE is remembered separately from the rule, because choosing
   * "these values" stores nothing until values are typed: derived from the
   * rule alone, the picker would snap back to "Anything" the moment it was
   * moved, and the box to type in would never appear.
   */
  const storedSource: OptionsSource =
    options === undefined ? 'any' : 'values' in options ? 'values' : 'list';
  const optionsSource = pickedSource ?? storedSource;
  const namedList = options !== undefined && 'list' in options ? options.list : null;

  const stageOptionsSource = (next: OptionsSource): void => {
    setPickedSource(next);
    if (next === 'any') {
      buffer.drop(optionsKey);
      return;
    }
    if (next === 'list') {
      // An unchosen list is not a rule: the picker below stages one the moment
      // a list is chosen, and until then the column accepts what it always did.
      if (namedList === null) buffer.drop(optionsKey);
      else buffer.stage({ op: 'column.options', ...target, value: { list: namedList } });
      return;
    }
    const values = options !== undefined && 'values' in options ? options.values : [];
    if (values.length === 0) buffer.drop(optionsKey);
    else buffer.stage({ op: 'column.options', ...target, value: { values } });
  };

  const stageList = (key: string): void => {
    if (key === '') {
      buffer.drop(optionsKey);
      return;
    }
    buffer.stage({ op: 'column.options', ...target, value: { list: key } });
  };

  const stageOptions = (text: string): void => {
    const values = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (values.length === 0) {
      buffer.drop(optionsKey);
      return;
    }
    buffer.stage({
      op: 'column.options',
      ...target,
      value: { values: values.map((value) => ({ value })) },
    });
  };

  const stageValidation = (patch: Record<string, string>): void => {
    const next: Record<string, unknown> = { ...validation };
    for (const [key, raw] of Object.entries(patch)) {
      if (raw === '') delete next[key];
      else next[key] = key === 'format' ? raw : Number(raw);
    }
    if (Object.keys(next).length === 0) {
      buffer.drop(validationKey);
      return;
    }
    buffer.stage({ op: 'column.validation', ...target, value: next as never });
  };

  return (
    <div className="flex flex-col gap-5" data-testid="column-inspector">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-section text-fg">{stagedLabel ?? columnDisplayLabel(column)}</h3>
        <MonoText className="text-[11px] text-fg-subtle">
          {table.id}.{column.name}
        </MonoText>
        <Tag mono>{column.dbType}</Tag>
        {column.nullable ? <Badge tone="neutral">{t('studio:remap.column.nullable', 'nullable')}</Badge> : null}
      </header>

      <FormField
        label={t('studio:remap.column.labelOverride', 'Display label')}
        helper={t('studio:remap.column.labelHelper', 'Inferred: {name}', { name: titleCase(column.name), })}
        {...(fieldError === undefined ? {} : { error: fieldError })}
      >
        <Input
          value={stagedLabel ?? column.label ?? ''}
          placeholder={titleCase(column.name)}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '') buffer.drop(labelKey);
            else buffer.stage({ op: 'column.label', ...target, value: { label: next } });
          }}
        />
      </FormField>

      <FormField
        label={t('studio:remap.column.logicalType', 'Logical type')}
        helper={t('studio:remap.column.logicalTypeHelper', 'Inferred: {type} (from {dbType}) — mapped by the adapter; not overridable in v1.', { type: column.logicalType, dbType: column.dbType })}
        tag={<Tag mono>{column.logicalType}</Tag>}
      >
        <Select disabled value={column.logicalType} onChange={() => undefined} mono>
          {LOGICAL_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label={t('studio:remap.column.semantic', 'Semantic type')}
        helper={
          semantics === null
            ? t('studio:remap.column.unclassified', 'Not classified yet.')
            : t('studio:remap.column.semanticHelper', 'Classifier: {tag} · {confidence}% confidence · source: {source}', { tag: semantics.primary, confidence: String(confidencePct), source: semantics.source })
        }
      >
        <Select
          value={stagedSemantic?.semanticType ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '') buffer.drop(semanticKey);
            else buffer.stage({ op: 'column.semanticType', ...target, value: { semanticType: next } });
          }}
        >
          <option value="">
            {t('studio:remap.column.semanticInferred', 'inferred: {tag}', { tag: inferredTag })}
          </option>
          {SEMANTIC_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </Select>
      </FormField>

      {stagedSemantic?.semanticType === 'money' ? (
        <FormField
          label={t('studio:remap.column.currency', 'Currency')}
          helper={t('studio:remap.column.currencyHelper', 'ISO 4217 code applied to money formatting.')}
        >
          <Input
            mono
            value={stagedSemantic.currency ?? ''}
            placeholder="USD"
            onChange={(event) => {
              const currency = event.target.value.toUpperCase();
              buffer.stage({
                op: 'column.semanticType',
                ...target,
                value: { semanticType: 'money', ...(currency === '' ? {} : { currency }) },
              });
            }}
          />
        </FormField>
      ) : null}

      <label className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="flex items-center gap-1.5 text-body-sm font-medium text-fg">
            {t('studio:remap.column.pii', 'Mask by default')}
            {piiKind !== null ? <Badge tone="warn">{piiKind}</Badge> : null}
          </span>
          <span className="text-[11.5px] text-fg-muted">
            {t(
              'studio:remap.column.piiHelper',
              'Masked values render redacted; unmasking requires the data.unmask_pii permission and is audit-logged.',
            )}
          </span>
        </span>
        <Switch
          checked={masked}
          aria-label={t('studio:remap.column.pii', 'Mask by default')}
          onCheckedChange={stagePii}
        />
      </label>

      {/*
        * ─── Rules: what the WRITE PATH does ─────────────────────────────────
        *
        * Everything above this line changes what a reader sees. These four
        * change what every writer must satisfy — the create dialog, a CSV
        * import, an automation and the public API — which is why they live
        * behind the same `schema:remap` permission and say so.
        */}
      <section className="flex flex-col gap-3" data-testid="column-rules">
        <div className="flex flex-col">
          <h4 className="text-body-sm font-semibold text-fg">
            {t('studio:remap.rules.title', 'Rules')}
          </h4>
          <span className="text-[11.5px] text-fg-muted">
            {t(
              'studio:remap.rules.help',
              'These apply wherever a row is written — forms, imports, automations and the API — not just in this app.',
            )}
          </span>
        </div>

        <FormField
          label={t('studio:remap.rules.fill', 'Starts as')}
          helper={
            fillHelper === null
              ? t('studio:remap.rules.fillHelp', 'What Adminium puts here when nobody fills it in.')
              : fillHelper
          }
        >
          <Select
            value={fill?.kind ?? ''}
            onChange={(event) => stageFill(event.target.value)}
          >
            <option value="">{t('studio:remap.rules.fillDefault', 'Leave it to the database')}</option>
            <option value="now">{t('studio:remap.rules.fillNow', 'The current date and time')}</option>
            <option value="uuid">{t('studio:remap.rules.fillUuid', 'A new unique id')}</option>
            <option value="current-user">{t('studio:remap.rules.fillUser', 'Who is signed in')}</option>
            <option value="literal">{t('studio:remap.rules.fillLiteral', 'A fixed value')}</option>
            <option value="database">{t('studio:remap.rules.fillDb', 'The database fills it (a trigger)')}</option>
            <option value="none">{t('studio:remap.rules.fillNone', 'Nothing — leave it empty')}</option>
          </Select>
        </FormField>

        {fill?.kind === 'literal' ? (
          <FormField label={t('studio:remap.rules.fillText', 'The value')}>
            <Input
              value={fill.text ?? ''}
              onChange={(event) => stageFill('literal', { text: event.target.value })}
            />
          </FormField>
        ) : null}

        {fill?.kind === 'now' || fill?.kind === 'current-user' ? (
          <label className="flex items-center gap-2">
            <Switch
              checked={fill.onUpdate === true}
              aria-label={t('studio:remap.rules.onUpdate', 'Fill it in again on every change')}
              onCheckedChange={(next) => stageFill(fill.kind, { onUpdate: next })}
            />
            <span className="text-body-sm text-fg">
              {t('studio:remap.rules.onUpdate', 'Fill it in again on every change')}
            </span>
          </label>
        ) : null}

        <label className="flex items-start justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-body-sm font-medium text-fg">
              {t('studio:remap.rules.required', 'Must be filled in')}
            </span>
            <span className="text-[11.5px] text-fg-muted">
              {column.nullable
                ? t('studio:remap.rules.requiredHelp', 'The form asks for it, and a write without it is refused.')
                : t('studio:remap.rules.requiredAlready', 'Your database already requires this column.')}
            </span>
          </span>
          <Switch
            checked={required}
            disabled={!column.nullable}
            aria-label={t('studio:remap.rules.required', 'Must be filled in')}
            onCheckedChange={stageRequired}
          />
        </label>

        {isEnum ? (
          <p className="text-[11.5px] text-fg-muted">
            {t(
              'studio:remap.rules.optionsFromDatabase',
              'Your database fixes the allowed values for this column. Change them in Design.',
            )}
          </p>
        ) : (
          <>
            <FormField
              label={t('studio:remap.rules.optionsSource', 'Allowed values')}
              helper={t(
                'studio:remap.rules.optionsSourceHelp',
                'A list is written once in Studio and used by every column that names it.',
              )}
            >
              <Select
                value={optionsSource}
                onChange={(event) => stageOptionsSource(event.target.value as OptionsSource)}
                data-testid="rules-options-source"
              >
                <option value="any">{t('studio:remap.rules.optionsAnything', 'Anything')}</option>
                <option value="values">{t('studio:remap.rules.optionsInline', 'These values')}</option>
                <option value="list">{t('studio:remap.rules.optionsList', 'A list')}</option>
              </Select>
            </FormField>
            {optionsSource === 'values' ? (
              <FormField
                label={t('studio:remap.rules.optionsValues', 'The values')}
                helper={t('studio:remap.rules.optionsHelp', 'One per line. Leave empty to accept anything.')}
              >
                <Textarea
                  rows={3}
                  value={optionsText}
                  placeholder={'new\nin_progress\ndone'}
                  onChange={(event) => stageOptions(event.target.value)}
                />
              </FormField>
            ) : null}
            {optionsSource === 'list' ? (
              <FormField
                label={t('studio:remap.rules.optionsListLabel', 'List')}
                helper={
                  optionLists.isError
                    ? t('studio:remap.rules.optionsListUnavailable', 'The lists could not be read.')
                    : t('studio:remap.rules.optionsListHelp', 'Edit the lists themselves in Studio \u2192 Lists.')
                }
              >
                <Select
                  value={namedList ?? ''}
                  onChange={(event) => stageList(event.target.value)}
                  data-testid="rules-options-list"
                >
                  <option value="">{t('studio:remap.rules.optionsPickList', 'Choose a list\u2026')}</option>
                  {(optionLists.data ?? []).map((list) => (
                    <option key={list.key} value={list.key}>
                      {list.name}
                    </option>
                  ))}
                  {/* A rule can name a list this workspace no longer has — a
                      project file brought it, or somebody deleted it. Keeping
                      the key in the picker says so, rather than silently
                      showing "Choose a list…" over a rule that still exists. */}
                  {namedList !== null && !(optionLists.data ?? []).some((list) => list.key === namedList) ? (
                    <option value={namedList}>
                      {t('studio:remap.rules.optionsMissingList', '{key} (not in this workspace)', { key: namedList })}
                    </option>
                  ) : null}
                </Select>
              </FormField>
            ) : null}
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <FormField label={t('studio:remap.rules.format', 'Format')}>
            <Select value={validation.format ?? ''} onChange={(event) => stageValidation({ format: event.target.value })}>
              <option value="">{t('studio:remap.rules.formatAny', 'Anything')}</option>
              <option value="email">{t('studio:remap.rules.formatEmail', 'An email address')}</option>
              <option value="url">{t('studio:remap.rules.formatUrl', 'A web address')}</option>
              <option value="phone">{t('studio:remap.rules.formatPhone', 'A phone number')}</option>
            </Select>
          </FormField>
          {NUMERIC.has(column.logicalType) ? (
            <>
              <FormField label={t('studio:remap.rules.min', 'Smallest')}>
                <Input
                  type="number"
                  value={validation.min ?? ''}
                  onChange={(event) => stageValidation({ min: event.target.value })}
                />
              </FormField>
              <FormField label={t('studio:remap.rules.max', 'Largest')}>
                <Input
                  type="number"
                  value={validation.max ?? ''}
                  onChange={(event) => stageValidation({ max: event.target.value })}
                />
              </FormField>
            </>
          ) : (
            <>
              <FormField label={t('studio:remap.rules.minLength', 'Shortest')}>
                <Input
                  type="number"
                  value={validation.minLength ?? ''}
                  onChange={(event) => stageValidation({ minLength: event.target.value })}
                />
              </FormField>
              <FormField label={t('studio:remap.rules.maxLength', 'Longest')}>
                <Input
                  type="number"
                  value={validation.maxLength ?? ''}
                  onChange={(event) => stageValidation({ maxLength: event.target.value })}
                />
              </FormField>
            </>
          )}
        </div>
      </section>

      {isEnum ? (
        <section className="flex flex-col gap-3" data-testid="enum-editor">
          <h4 className="text-body-sm font-semibold text-fg">
            {t('studio:remap.column.enum', 'Enum semantics')}
          </h4>
          <SegmentedControl
            aria-label={t('studio:remap.column.enumKind', 'Enum kind')}
            options={[
              {
                value: 'status-workflow',
                label: t('studio:remap.column.enumWorkflow', 'Workflow'),
                dot: 'accent',
              },
              {
                value: 'category-enum',
                label: t('studio:remap.column.enumCategory', 'Category'),
              },
            ]}
            value={currentEnumSemantic === 'status-workflow' ? 'status-workflow' : 'category-enum'}
            onValueChange={(next) => {
              if (next === currentEnumSemantic) return;
              buffer.stage({ op: 'column.semanticType', ...target, value: { semanticType: next } });
            }}
          />
          <ul className="flex flex-col gap-2">
            {enumValues.map((value) => (
              <li key={value} className="grid grid-cols-[minmax(4rem,1fr)_minmax(6rem,1.4fr)_auto] items-center gap-2">
                <MonoText className="truncate text-[12px]">{value}</MonoText>
                <Input
                  aria-label={t('studio:remap.column.enumLabelFor', 'Label for {value}', { value: value })}
                  value={enumLabels[value] ?? ''}
                  placeholder={titleCase(value)}
                  onChange={(event) => {
                    const labels = { ...enumLabels };
                    if (event.target.value === '') delete labels[value];
                    else labels[value] = event.target.value;
                    stageEnum(labels, enumTones);
                  }}
                />
                <Select
                  aria-label={t('studio:remap.column.enumToneFor', 'Tone for {value}', { value: value })}
                  value={enumTones[value] ?? ''}
                  onChange={(event) => {
                    const tones = { ...enumTones };
                    if (event.target.value === '') delete tones[value];
                    else tones[value] = event.target.value;
                    stageEnum(enumLabels, tones);
                  }}
                >
                  <option value="">{t('studio:remap.column.enumToneAuto', 'auto')}</option>
                  {ENUM_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {tone}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-fg-muted">
            {t(
              'studio:remap.column.enumHelper',
              'Workflow enums drive status pills and board columns; tones map values onto the semantic tint scale.',
            )}
          </p>
        </section>
      ) : null}
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Right-pane inspector for a selected column: label override, logical type
 * (read-only — see note), semantic override over the engine SEMANTIC_TAGS
 * with classifier confidence, PII masking toggle, and the enum semantics
 * editor (workflow vs category + per-value label/tone map) when the column
 * is an enum (07-meta-store.md §3.15 `column.*` ops).
 *
 * Logical type: adapters map native types onto the closed LOGICAL_TYPES set
 * at introspection time; the v1 override vocabulary has no
 * `column.logicalType` op, so the select renders disabled with the
 * "inferred: X" hint instead of staging an op the server would reject.
 */
import { LOGICAL_TYPES, SEMANTIC_TAGS } from '@adminium/engine';
import { Badge, FormField, Input, MonoText, SegmentedControl, Select, Switch, Tag } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { columnDisplayLabel, enumValuesFor, titleCase, type EffectiveColumn, type EffectiveModel, type EffectiveTable } from './model.js';
import { overrideKey, type RemapBuffer } from './useRemapBuffer.js';

/** Tone vocabulary shared with the grid enum chips (widgets column-spec). */
export const ENUM_TONES = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const;

export interface ColumnInspectorProps {
  model: EffectiveModel;
  table: EffectiveTable;
  column: EffectiveColumn;
  buffer: RemapBuffer;
  fieldError?: string | undefined;
}

export function ColumnInspector({ model, table, column, buffer, fieldError }: ColumnInspectorProps) {
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

  return (
    <div className="flex flex-col gap-5" data-testid="column-inspector">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-section text-fg">{stagedLabel ?? columnDisplayLabel(column)}</h3>
        <MonoText className="text-[11px] text-fg-subtle">
          {table.id}.{column.name}
        </MonoText>
        <Tag mono>{column.dbType}</Tag>
        {column.nullable ? <Badge tone="neutral">{t('studio.remap.column.nullable', 'nullable')}</Badge> : null}
      </header>

      <FormField
        label={t('studio.remap.column.labelOverride', 'Display label')}
        helper={t('studio.remap.column.labelHelper', 'Inferred: {name}', { name: titleCase(column.name), })}
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
        label={t('studio.remap.column.logicalType', 'Logical type')}
        helper={t('studio.remap.column.logicalTypeHelper', 'Inferred: {type} (from {dbType}) — mapped by the adapter; not overridable in v1.', { type: column.logicalType, dbType: column.dbType })}
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
        label={t('studio.remap.column.semantic', 'Semantic type')}
        helper={
          semantics === null
            ? t('studio.remap.column.unclassified', 'Not classified yet.')
            : t('studio.remap.column.semanticHelper', 'Classifier: {tag} · {confidence}% confidence · source: {source}', { tag: semantics.primary, confidence: String(confidencePct), source: semantics.source })
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
            {t('studio.remap.column.semanticInferred', 'inferred: {tag}', { tag: inferredTag })}
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
          label={t('studio.remap.column.currency', 'Currency')}
          helper={t('studio.remap.column.currencyHelper', 'ISO 4217 code applied to money formatting.')}
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
            {t('studio.remap.column.pii', 'Mask by default')}
            {piiKind !== null ? <Badge tone="warn">{piiKind}</Badge> : null}
          </span>
          <span className="text-[11.5px] text-fg-muted">
            {t(
              'studio.remap.column.piiHelper',
              'Masked values render redacted; unmasking requires the data.unmask_pii permission and is audit-logged.',
            )}
          </span>
        </span>
        <Switch
          checked={masked}
          aria-label={t('studio.remap.column.pii', 'Mask by default')}
          onCheckedChange={stagePii}
        />
      </label>

      {isEnum ? (
        <section className="flex flex-col gap-3" data-testid="enum-editor">
          <h4 className="text-body-sm font-semibold text-fg">
            {t('studio.remap.column.enum', 'Enum semantics')}
          </h4>
          <SegmentedControl
            aria-label={t('studio.remap.column.enumKind', 'Enum kind')}
            options={[
              {
                value: 'status-workflow',
                label: t('studio.remap.column.enumWorkflow', 'Workflow'),
                dot: 'accent',
              },
              {
                value: 'category-enum',
                label: t('studio.remap.column.enumCategory', 'Category'),
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
                  aria-label={t('studio.remap.column.enumLabelFor', 'Label for {value}', { value: value })}
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
                  aria-label={t('studio.remap.column.enumToneFor', 'Tone for {value}', { value: value })}
                  value={enumTones[value] ?? ''}
                  onChange={(event) => {
                    const tones = { ...enumTones };
                    if (event.target.value === '') delete tones[value];
                    else tones[value] = event.target.value;
                    stageEnum(enumLabels, tones);
                  }}
                >
                  <option value="">{t('studio.remap.column.enumToneAuto', 'auto')}</option>
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
              'studio.remap.column.enumHelper',
              'Workflow enums drive status pills and board columns; tones map values onto the semantic tint scale.',
            )}
          </p>
        </section>
      ) : null}
    </div>
  );
}

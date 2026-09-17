// SPDX-License-Identifier: AGPL-3.0-only
import {
  Checkbox,
  Combobox,
  DateInput,
  FormField,
  Input,
  MonoText,
  SegmentedControl,
  Select,
  Tag,
  Textarea,
} from '@adminium/ui';
import type { ComboboxOption } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { FileField, type FileFieldUpload } from './FileField.js';
import { coerceFieldValue, dateOnlyValue, fieldKindFor, fieldTypeTag, formColumns, isRequired } from './field-mapping.js';
import type { CrudApi, CrudLookupOption, CrudRow } from './crud-api.js';
import { uiToneOf } from '../../families/tables/column-spec.js';
import type { GridColumnSpec } from '../../families/tables/column-spec.js';
import type { ResolvedFile } from '../../families/tables/cells.js';

/**
 * RecordForm — the create/edit form generated from column specs: one
 * `FormField` per editable column with a mono type tag (`varchar`, `enum`,
 * `→ public.team_members` — the UI explains its own generation), control
 * by `fieldKindFor`, FK → async avatar `Combobox` fed by `CrudApi.lookup`
 * (debounced 200 ms), server field errors inline.
 */

export const FK_LOOKUP_DEBOUNCE_MS = 200;

export interface RecordFormProps {
  columns: readonly GridColumnSpec[];
  /** Initial values — the record on edit, {} on create. */
  initialValues?: CrudRow | undefined;
  mode: 'create' | 'edit';
  /** Per-column server errors (unique violation etc.), by column name. */
  errors?: Readonly<Record<string, string>> | undefined;
  /** FK lookup feed (CrudApi.lookup); absent → FK renders a plain input. */
  lookup?: CrudApi['lookup'] | undefined;
  /** Submit with coerced values; the form element id lets footers submit. */
  onSubmit: (values: CrudRow) => void;
  formId?: string | undefined;
  /** Helper copy for unique columns ("Checked against 8,402 rows"). */
  uniqueHelper?: ((column: GridColumnSpec) => ReactNode) | undefined;
  /** Action row rendered INSIDE the form element (submit buttons). */
  footer?: ReactNode | undefined;
  /**
   * Uploads a file and resolves to the reference to store. Absent ⇒ every
   * `file` column renders the plain text input it had before its block was
   * configured — this package has no transport of its own.
   */
  uploadFile?: FileFieldUpload | undefined;
  /** What the current values already name, keyed by the stored value. */
  files?: ReadonlyMap<string, ResolvedFile | null> | undefined;
  /** Workspace upload cap, so the field can refuse before the request starts. */
  maxFileBytes?: number | undefined;
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** datetime-local wants `YYYY-MM-DDTHH:mm`. */
function datetimeLocalValue(value: unknown): string {
  const raw = stringValue(value);
  if (raw === '') return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function FkField({
  column,
  value,
  lookup,
  onChange,
}: {
  column: GridColumnSpec;
  value: unknown;
  lookup: NonNullable<CrudApi['lookup']>;
  onChange: (next: unknown) => void;
}) {
  const t = useMaybeT();
  const fk = column.fk as NonNullable<GridColumnSpec['fk']>;
  const [options, setOptions] = useState<CrudLookupOption[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial option load (empty query → first page of choices).
  useEffect(() => {
    let alive = true;
    void lookup({ table: fk.table, column: fk.column }, '').then((loaded) => {
      if (alive) setOptions(loaded);
    });
    return () => {
      alive = false;
    };
  }, [lookup, fk.table, fk.column]);

  const comboboxOptions: ComboboxOption[] = useMemo(
    () => options.map((option) => ({ value: option.value, label: option.label, description: option.description })),
    [options],
  );

  return (
    <Combobox
      options={comboboxOptions}
      value={value === null || value === undefined ? null : String(value)}
      onValueChange={(next) => onChange(next)}
      emptyText={t('ui:combobox.noMatches', 'No matches')}
      placeholder={t('ui:templates.crud.searchPlaceholder', 'Search {table}…', { table: fk.table })}
      // Debounced server-side search on the display column
      // Combobox filters locally as well, so this only widens the option set.
      filter={(option, query) => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          void lookup({ table: fk.table, column: fk.column }, query).then(setOptions);
        }, FK_LOOKUP_DEBOUNCE_MS);
        return option.label.toLowerCase().includes(query.trim().toLowerCase());
      }}
    />
  );
}

export function RecordForm({
  columns,
  initialValues,
  mode,
  errors,
  lookup,
  onSubmit,
  formId,
  uniqueHelper,
  footer,
  uploadFile,
  files,
  maxFileBytes,
}: RecordFormProps) {
  const t = useMaybeT();
  const fields = useMemo(() => formColumns(columns), [columns]);
  const [values, setValues] = useState<CrudRow>(() => ({ ...(initialValues ?? {}) }));

  const setField = (name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
  };

  const submit = () => {
    const out: CrudRow = {};
    for (const column of fields) {
      const kind = fieldKindFor(column);
      if (kind === 'readonly') continue;
      const raw = values[column.name];
      if (mode === 'create' && (raw === undefined || raw === '') && column.hasDefault) continue; // let the DB default apply
      if (raw === undefined && mode === 'edit') continue; // untouched
      out[column.name] = coerceFieldValue(column, raw);
    }
    onSubmit(out);
  };

  return (
    <form
      id={formId}
      data-part="record-form"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {fields.map((column) => {
        const kind = fieldKindFor(column);
        const required = isRequired(column);
        const error = errors?.[column.name];
        const value = values[column.name];
        const common = {
          label: column.label,
          required,
          tag: <Tag mono>{fieldTypeTag(column)}</Tag>,
          ...(error !== undefined ? { error } : {}),
          ...(error === undefined && column.unique && uniqueHelper !== undefined
            ? { helper: uniqueHelper(column) }
            : {}),
        };

        if (kind === 'readonly') {
          return (
            <FormField key={column.name} {...common}>
              <MonoText className="text-body-sm text-fg-muted">{stringValue(value) || '—'}</MonoText>
            </FormField>
          );
        }
        if (kind === 'file') {
          const stored = value === null || value === undefined ? '' : String(value);
          return (
            <FormField key={column.name} {...common}>
              {/*
                A list column's chips are keyed by each ENTRY, so it needs the
                whole resolved map; the single field wants the one entry its
                own value names. Passing both costs nothing and keeps each mode
                reading exactly what it can use.
              */}
              <FileField
                column={column}
                value={value}
                {...(uploadFile === undefined ? {} : { upload: uploadFile })}
                {...(files === undefined ? {} : { resolvedByRef: files })}
                {...(files?.get(stored) === undefined ? {} : { resolved: files.get(stored) })}
                {...(column.file?.maxBytes ?? maxFileBytes) === undefined
                  ? {}
                  : { maxBytes: column.file?.maxBytes ?? maxFileBytes }}
                onChange={(next) => setField(column.name, next)}
              />
            </FormField>
          );
        }
        if (kind === 'fk' && lookup !== undefined) {
          return (
            <FormField key={column.name} {...common}>
              <FkField column={column} value={value} lookup={lookup} onChange={(next) => setField(column.name, next)} />
            </FormField>
          );
        }
        if (kind === 'segmented') {
          return (
            <FormField key={column.name} {...common}>
              <SegmentedControl
                options={(column.enumValues ?? []).map((member) => {
                  const tone = column.enumTones?.[member];
                  return {
                    value: member,
                    label: member,
                    ...(tone === undefined ? {} : { dot: uiToneOf(tone) }),
                  };
                })}
                {...(typeof value === 'string' ? { value } : {})}
                onValueChange={(next) => setField(column.name, next)}
              />
            </FormField>
          );
        }
        if (kind === 'select') {
          return (
            <FormField key={column.name} {...common}>
              <Select
                value={stringValue(value)}
                onChange={(event) => setField(column.name, event.target.value === '' ? null : event.target.value)}
              >
                <option value="">{column.nullable ? '—' : t('ui:combobox.placeholder', 'Select…')}</option>
                {(column.enumValues ?? []).map((member) => (
                  <option key={member} value={member}>
                    {member}
                  </option>
                ))}
              </Select>
            </FormField>
          );
        }
        if (kind === 'checkbox') {
          return (
            <FormField key={column.name} {...common}>
              <Checkbox
                checked={value === true}
                onCheckedChange={(checked) => setField(column.name, checked === true)}
              />
            </FormField>
          );
        }
        if (kind === 'date' || kind === 'time' || kind === 'datetime') {
          return (
            <FormField key={column.name} {...common}>
              <DateInput
                type={kind === 'datetime' ? 'datetime-local' : kind}
                value={kind === 'datetime' ? datetimeLocalValue(value) : kind === 'date' ? dateOnlyValue(value) : stringValue(value)}
                onChange={(event) => setField(column.name, event.target.value)}
              />
            </FormField>
          );
        }
        if (kind === 'textarea' || kind === 'json') {
          return (
            <FormField key={column.name} {...common}>
              <Textarea
                value={stringValue(value)}
                rows={kind === 'json' ? 5 : 3}
                onChange={(event) => setField(column.name, event.target.value)}
              />
            </FormField>
          );
        }
        return (
          <FormField key={column.name} {...common}>
            <Input
              type={kind === 'number' ? 'number' : kind === 'email' ? 'email' : kind === 'url' ? 'url' : 'text'}
              value={stringValue(value)}
              {...(column.maxLength !== null ? { maxLength: column.maxLength } : {})}
              // Without this, number inputs default to step=1 and any
              // fractional decimal/money value (412.50) is step-invalid —
              // native validation then silently blocks the form's submit.
              {...(kind === 'number' ? { step: 'any' } : {})}
              onChange={(event) => setField(column.name, event.target.value)}
            />
          </FormField>
        );
      })}
      {footer}
    </form>
  );
}

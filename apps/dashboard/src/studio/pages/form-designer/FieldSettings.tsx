// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One field's settings, inline under its row.
 *
 * ─── Only what this column can actually be ─────────────────────────────────
 *
 * The control select offers `legalControls(column)` and nothing else: a date
 * column has no "segmented" and a boolean has no "currency", and offering them
 * would be a choice that renders as a text box. The same leaf answers the
 * dialog and the server, so what is offered here is what will be rendered.
 *
 * ─── The column's RULES are shown, and are not editable here ───────────────
 *
 * What fills a column, whether it is required and what it accepts are the
 * TABLE's business (Studio → Schema), not this page's: a rule edited here would
 * silently change every other page that shows the column. They are printed
 * read-only, with the link, because a designer who cannot see them ends up
 * adding a form-level "required" that contradicts one.
 */
import { FormField, Input, Select, Switch } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { FormColumnFactReply } from '../../../api/pages.js';
import type { CrudFormColumnField } from '@adminium/engine/config';

import type { DesignerField } from './model.js';

/** The controls this column may legally be given, from the shared leaf. */
export interface FieldSettingsProps {
  field: DesignerField;
  /** The table's own column names — a calendar's availability may scope by one. */
  columns?: readonly string[] | undefined;
  /** The column behind the field; absent for a relation field. */
  fact?: FormColumnFactReply | undefined;
  legal: readonly string[];
  /** Opens Studio → Schema at this connection, where the rules live. */
  onOpenRules?: (() => void) | undefined;
  onPatch: (patch: Partial<DesignerField>) => void;
}

const SPANS = [1, 2, 3] as const;

export function FieldSettings({ field, fact, columns, legal, onOpenRules, onPatch }: FieldSettingsProps) {
  /*
   * A RECAP has no settings here yet: it is a sentence and an expression, and
   * offering a control select over it would be offering to turn it into
   * something it is not. It still travels through the designer whole — the
   * list can move it and remove it — so a designer that opened and saved never
   * loses one.
   */
  if ('recap' in field) {
    return (
      <div className="border-t border-border bg-surface-2 p-3" data-testid="form-field-settings">
        <p className="text-caption text-fg-subtle">
          {t(
            'studio:pages.form.field.recapHelp',
            'A summary box. Its wording is edited in the page’s JSON for now.',
          )}
        </p>
      </div>
    );
  }
  const isColumn = 'column' in field;
  const rules = fact === undefined ? null : describeRules(fact);

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-surface-2 p-3" data-testid="form-field-settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('studio:pages.form.field.control', 'Control')}>
          <Select
            value={field.control ?? ''}
            onChange={(event) => onPatch({ control: event.target.value } as Partial<DesignerField>)}
            data-testid="form-field-control"
          >
            {legal.map((control) => (
              <option key={control} value={control}>
                {control}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('studio:pages.form.field.label', 'Label')}>
          <Input
            value={field.label ?? ''}
            placeholder={isColumn ? field.column : ''}
            onChange={(event) => onPatch({ label: event.target.value } as Partial<DesignerField>)}
            data-testid="form-field-label"
          />
        </FormField>
        <FormField label={t('studio:pages.form.field.help', 'Help text')}>
          <Input
            value={field.help ?? ''}
            onChange={(event) => onPatch({ help: event.target.value } as Partial<DesignerField>)}
          />
        </FormField>
        <FormField
          label={t('studio:pages.form.field.span', 'Width')}
          helper={t('studio:pages.form.field.spanHelp', 'How many of the section’s columns this field takes.')}
        >
          <Select
            value={String(field.span ?? 1)}
            onChange={(event) => onPatch({ span: Number(event.target.value) as 1 | 2 | 3 } as Partial<DesignerField>)}
            data-testid="form-field-span"
          >
            {SPANS.map((span) => (
              <option key={span} value={span}>
                {String(span)}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      {isColumn ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('studio:pages.form.field.placeholder', 'Placeholder')}>
              <Input
                value={field.placeholder ?? ''}
                onChange={(event) => onPatch({ placeholder: event.target.value } as Partial<DesignerField>)}
              />
            </FormField>
            <FormField
              label={t('studio:pages.form.field.initial', 'Starting value')}
              helper={t(
                'studio:pages.form.field.initialHelp',
                'What a NEW record starts with. An edit never applies it.',
              )}
            >
              <Select
                value={initialKindOf(field)}
                onChange={(event) => onPatch({ initial: initialFor(event.target.value) } as Partial<DesignerField>)}
                data-testid="form-field-initial"
              >
                <option value="">{t('studio:pages.form.field.initialNone', 'Nothing')}</option>
                <option value="now">{t('studio:pages.form.field.initialNow', 'The current date and time')}</option>
                <option value="today">{t('studio:pages.form.field.initialToday', 'Today')}</option>
                <option value="current-user">
                  {t('studio:pages.form.field.initialUser', 'Who is signed in')}
                </option>
                <option value="literal">{t('studio:pages.form.field.initialLiteral', 'A fixed value')}</option>
              </Select>
            </FormField>
            {initialKindOf(field) === 'literal' ? (
              <FormField label={t('studio:pages.form.field.initialValue', 'The value')}>
                <Input
                  value={String((field.initial as { value?: unknown } | undefined)?.value ?? '')}
                  onChange={(event) =>
                    onPatch({ initial: { kind: 'literal', value: event.target.value } } as Partial<DesignerField>)
                  }
                  data-testid="form-field-initial-value"
                />
              </FormField>
            ) : null}
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-body-sm font-medium text-fg">
                {t('studio:pages.form.field.required', 'Ask for it')}
              </span>
              <span className="text-[11.5px] text-fg-muted">
                {t(
                  'studio:pages.form.field.requiredHelp',
                  'The form refuses to save without it. What the DATABASE requires is set in Schema.',
                )}
              </span>
            </span>
            <Switch
              checked={field.required === true}
              aria-label={t('studio:pages.form.field.required', 'Ask for it')}
              onCheckedChange={(next) =>
                onPatch({ required: next ? (true as const) : undefined } as Partial<DesignerField>)
              }
            />
          </label>

          {/*
            A CALENDAR's two extra questions. They appear only for the control
            that has them: a start, an end and a step are meaningless on a text
            box, and a settings panel that offers every field every setting is
            how a designer stops being readable.
          */}
          {field.control === 'calendar' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                label={t('studio:pages.form.field.slotsStart', 'Times from')}
                helper={t(
                  'studio:pages.form.field.slotsHelp',
                  'Leave the times empty for a day picker with no times.',
                )}
              >
                <Input
                  type="time"
                  value={('column' in field ? field.slots?.start : undefined) ?? ''}
                  onChange={(event) => onPatch(patchSlots(field, { start: event.target.value }))}
                  data-testid="form-field-slots-start"
                />
              </FormField>
              <FormField label={t('studio:pages.form.field.slotsEnd', 'until')}>
                <Input
                  type="time"
                  value={('column' in field ? field.slots?.end : undefined) ?? ''}
                  onChange={(event) => onPatch(patchSlots(field, { end: event.target.value }))}
                  data-testid="form-field-slots-end"
                />
              </FormField>
              <FormField label={t('studio:pages.form.field.slotsEvery', 'every')}>
                <Select
                  value={String(('column' in field ? field.slots?.minutes : undefined) ?? 30)}
                  onChange={(event) =>
                    onPatch(patchSlots(field, { minutes: Number(event.target.value) as 15 | 30 | 60 }))
                  }
                  data-testid="form-field-slots-every"
                >
                  <option value="15">15</option>
                  <option value="30">30</option>
                  <option value="60">60</option>
                </Select>
              </FormField>
              <FormField
                className="sm:col-span-3"
                label={t('studio:pages.form.field.availability', 'Already taken when')}
                helper={t(
                  'studio:pages.form.field.availabilityHelp',
                  'Another row holds the same time. Pick a column to narrow it to one room, one person, one machine. Left off, nothing is shown as taken.',
                )}
              >
                <Select
                  value={availabilityValue(field)}
                  onChange={(event) => onPatch(patchAvailability(event.target.value))}
                  data-testid="form-field-availability"
                >
                  <option value="">{t('studio:pages.form.field.availabilityOff', 'Do not check')}</option>
                  <option value="*">
                    {t('studio:pages.form.field.availabilityAny', 'Any row holds that time')}
                  </option>
                  {(columns ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          ) : null}
        </>
      ) : null}

      {rules === null ? null : (
        <p className="text-caption text-fg-subtle" data-testid="form-field-rules">
          {rules}{' '}
          {onOpenRules === undefined ? null : (
            <button
              type="button"
              className="underline underline-offset-2 hover:text-fg"
              onClick={onOpenRules}
            >
              {t('studio:pages.form.field.rulesLink', 'Change in Schema')}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

function initialKindOf(field: DesignerField): string {
  if (!('column' in field)) return '';
  return field.initial?.kind ?? '';
}

function initialFor(kind: string): CrudFormColumnField['initial'] {
  if (kind === 'now' || kind === 'today') return { kind };
  if (kind === 'current-user') return { kind: 'current-user', field: 'id' };
  if (kind === 'literal') return { kind: 'literal', value: '' };
  return undefined;
}

/** The column's rules, as one read-only sentence. */
function describeRules(fact: FormColumnFactReply): string | null {
  const parts: string[] = [];
  if (fact.filledBy === 'adminium') parts.push(t('studio:pages.form.field.ruleFilled', 'Adminium fills it in'));
  if (fact.filledBy === 'database') parts.push(t('studio:pages.form.field.ruleDatabase', 'the database fills it in'));
  if (fact.required) parts.push(t('studio:pages.form.field.ruleRequired', 'the database requires it'));
  if (fact.options !== undefined) {
    parts.push(
      'list' in fact.options
        ? t('studio:pages.form.field.ruleList', 'only values from the list {key}', { key: fact.options.list })
        : t('studio:pages.form.field.ruleValues', 'only a fixed set of values'),
    );
  }
  if (fact.validation !== undefined) parts.push(t('studio:pages.form.field.ruleChecks', 'extra checks apply'));
  if (parts.length === 0) return null;
  return t('studio:pages.form.field.rules', 'This column: {rules}.', { rules: parts.join(', ') });
}

/**
 * A slot setting, merged onto whatever is there.
 *
 * Emptying either time REMOVES the block rather than storing a half one: a
 * `start` with no `end` describes no slots at all, and the renderer would draw
 * an empty grid where a plain day picker was meant.
 */
function patchSlots(
  field: DesignerField,
  change: Partial<{ start: string; end: string; minutes: 15 | 30 | 60 }>,
): Partial<DesignerField> {
  const slots = 'column' in field ? field.slots : undefined;
  const next = { start: '', end: '', minutes: 30 as 15 | 30 | 60, ...slots, ...change };
  if (next.start === '' || next.end === '') return { slots: undefined } as Partial<DesignerField>;
  return { slots: next } as Partial<DesignerField>;
}

/** `''` off, `'*'` any row, anything else the column that scopes the question. */
function patchAvailability(value: string): Partial<DesignerField> {
  if (value === '') return { availability: undefined } as Partial<DesignerField>;
  if (value === '*') return { availability: {} } as Partial<DesignerField>;
  return { availability: { resource: value } } as Partial<DesignerField>;
}

/** The availability select's own value: off, any row, or a named column. */
function availabilityValue(field: DesignerField): string {
  const rule = 'column' in field ? field.availability : undefined;
  if (rule === undefined) return '';
  return rule.resource ?? '*';
}

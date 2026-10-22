// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FILL F3 — what an action needs to run.
 *
 * The comp's inspector configures a step's NAME, its description, its
 * condition, its branch labels and its error behaviour — and nothing an
 * action needs to actually do anything. A rule built from the comp alone
 * would have a "Send email" step with no template and no recipient.
 *
 * So: one card per action kind, in the Condition card's own anatomy
 * (`surface-2` panel, 11.5 px/700 heading, the same inputs and gaps). The
 * fields are exactly what the runner reads (`automations/actions/*` on the
 * server) — no more, so nothing on screen is a promise the runner cannot
 * keep, and no fewer, so no step can be saved half-configured without the
 * person seeing which box is empty.
 *
 * The one table picker here (Create record's target) is a searchable
 * `Combobox` — **D25**, the same rule as the New-rule modal and the trigger
 * inspector — and it lists ONE connection's tables, for the reason
 * `connectionId` is a prop: see `RecordSettings`.
 */

import { Button, ChipInput, Combobox, Input, Select, Switch, Textarea, type ComboboxOption } from '@adminium/ui';
import { AtSign, CircleAlert, Columns3, Link2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';

import { getI18nInstance, t } from '../../../i18n/t.js';
import { createCrudApi } from '../../../api/crud.js';
import type { SourceStepInput, SourceTable, Sources } from '../../api.js';
import { addOnNameOf, columnOfInput, inLanguage, inputMode, stepOf, type StepAction } from '../../model/addOnSteps.js';
import type { Action, DigestSection, WriteValue } from '../../model/graph.js';
import { columnOfValue, holdsAddresses, linkedColumns, placeholderRows, templateOf, varsFor, type PlaceholderRow } from '../../model/placeholders.js';
import { writeValueText } from '../../model/summaries.js';
import { Card, Field } from './primitives.js';

export interface ActionSettingsProps {
  action: Action;
  sources: Sources | null;
  /** The record this rule is about — the source of "this record's column". */
  table: SourceTable | null;
  /**
   * The connection every write of this rule lands in — the TRIGGER's.
   * `runner.ts`'s `openSource` opens the connection of the record the run is
   * about and `record-write.ts` resolves `action.table` inside it, so a table
   * from any other connection is one this step could never write.
   */
  connectionId: string | null;
  onChange: (patch: Partial<Action>) => void;
}

export function ActionSettings(props: ActionSettingsProps): ReactNode {
  switch (props.action.kind) {
    case 'email':
      return <EmailSettings {...props} action={props.action} />;
    case 'notification':
      return <NotificationSettings {...props} action={props.action} />;
    case 'digest':
      return <DigestSettings {...props} action={props.action} />;
    case 'record.create':
      return <RecordSettings {...props} action={props.action} />;
    case 'record.update':
      return <RecordSettings {...props} action={props.action} />;
    case 'webhook':
      return <WebhookSettings {...props} action={props.action} />;
    case 'document.render':
      // Shown, never edited: the mapping owns what is drawn and who gets it.
      return (
        <Card title={t('automations:pick.document', 'Draw document')}>
          <p className="text-xs text-fg-muted">
            {t(
              'automations:insp.documentNote',
              'This step belongs to a document mapping. Change what it draws, and who it is emailed to, in Studio › Document mappings.',
            )}
          </p>
        </Card>
      );
    case 'add-on.step':
      return <AddOnStepSettings {...props} action={props.action} />;
    default:
      return null;
  }
}

// --- a step an add-on gives (comp `Milo Automations` 5a, 5c) ------------------

/**
 * The step's fields are the add-on's own: read from its description
 * (`Sources`), never written here. An input that takes a text, an address or
 * a number is filled from a column of the record — its own, or one a link
 * leads to — or with what is typed; a choice is one of the add-on's options;
 * a record is a row of the add-on's own table.
 */
function AddOnStepSettings({ action, sources, table, connectionId, onChange }: ActionSettingsProps & { action: StepAction }): ReactNode {
  const step = stepOf(sources, connectionId, action);
  const name = addOnNameOf(step, action);
  if (step === null) {
    return (
      <Card title={name}>
        <p role="alert" className="flex items-start gap-[7px] text-[12px] font-semibold leading-[1.5] text-danger" data-testid="add-on-step-gone">
          <CircleAlert className="mt-0.5 size-[13px] shrink-0" aria-hidden="true" />
          <span>{t('automations:addOn.gone', 'The add-on {name} is no longer installed.', { name })}</span>
        </p>
        <p className="text-xs text-fg-muted">
          {t('automations:addOn.goneNote', 'The step keeps its settings. If the add-on comes back, the step works again; until then the rule cannot be switched on.')}
        </p>
      </Card>
    );
  }
  const set = (key: string, value: string): void => {
    const next = { ...action.inputs };
    if (value === '') delete next[key];
    else next[key] = value;
    onChange({ inputs: next });
  };
  return (
    <Card title={t('automations:picker.addOnStep', '{addOn}: {step}', { addOn: name, step: inLanguage(step.name) })}>
      <p className="text-xs text-fg-muted" data-testid="add-on-step-does">{inLanguage(step.does)}</p>
      {step.canCreate ? null : (
        <p role="alert" className="text-[12px] font-semibold leading-[1.5] text-warn" data-testid="add-on-step-no-right">
          {t('automations:addOn.noRight', 'Your role may not add rows for {name}, so a rule of yours cannot use this step.', { name })}
        </p>
      )}
      {step.inputs.map((input) => (
        <StepInputField key={input.key} input={input} value={action.inputs[input.key] ?? ''} table={table} connectionId={connectionId} onChange={(value) => set(input.key, value)} />
      ))}
    </Card>
  );
}

/** Every column a rule can read for an input: the record's own, then the ones a link leads to. Addresses first for an address. */
function inputColumnOptions(table: SourceTable | null, kind: SourceStepInput['kind'], current: string | null): ComboboxOption[] {
  if (kind === 'email') return recipientOptions(table, current ?? '');
  if (table === null) return [];
  const here = t('automations:email.thisTable', 'This table · {table}', { table: table.label });
  const out: ComboboxOption[] = table.columns.map((column) => ({
    value: column.name,
    label: column.name,
    description: column.label === column.name ? here : `${column.label} · ${here}`,
    leading: <Columns3 className="size-[13px] text-fg-subtle" aria-hidden="true" />,
  }));
  for (const group of linkedColumns(table)) {
    for (const column of group.columns) {
      out.push({ value: column.name, label: column.name.replace('.', ' → '), description: column.label, leading: <Link2 className="size-[13px] text-fg-subtle" aria-hidden="true" /> });
    }
  }
  return out;
}

function StepInputField({ input, value, table, connectionId, onChange }: { input: SourceStepInput; value: string; table: SourceTable | null; connectionId: string | null; onChange: (value: string) => void }): ReactNode {
  const label = inLanguage(input.label);
  const title = input.required ? label : t('automations:addOn.optional', '{label} (optional)', { label });
  const testId = `add-on-input-${input.key}`;
  if (input.kind === 'choice') {
    return (
      <Field label={title}>
        <Select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId}>
          <option value="">{t('automations:addOn.choose', 'Choose…')}</option>
          {(input.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {inLanguage(option.label)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (input.kind === 'record') {
    return (
      <div role="group" aria-label={title} className="block">
        <span className="mb-1.5 block text-[11.5px] font-bold">{title}</span>
        <RowPicker input={input} value={value} connectionId={connectionId} label={label} onChange={onChange} testId={testId} />
      </div>
    );
  }
  return <ColumnOrTyped input={input} value={value} table={table} label={label} title={title} testId={testId} onChange={onChange} />;
}

/** One field, two ways to fill it: a column of the record, or what is typed. Which one is the person's choice, kept while the step is open. */
function ColumnOrTyped({ input, value, table, label, title, testId, onChange }: { input: SourceStepInput; value: string; table: SourceTable | null; label: string; title: string; testId: string; onChange: (value: string) => void }): ReactNode {
  const column = columnOfInput(value);
  const [chosen, setChosen] = useState<'column' | 'text' | null>(null);
  // What is filled in says how it was filled; the person's own choice only decides an empty field.
  const mode = value.trim() === '' ? (chosen ?? inputMode(input, value)) : inputMode(input, value);
  const notAddress = input.kind === 'email' && column !== null && holdsAddresses(table, column) === false;
  return (
    // A group, not a label: two controls share the caption, and each says itself what it is.
    <div role="group" aria-label={title} className="block">
      <span className="mb-1.5 block text-[11.5px] font-bold">{title}</span>
      <Select
        value={mode}
        aria-label={t('automations:addOn.fillWith', 'Fill {label} with', { label })}
        onChange={(event) => {
          setChosen(event.target.value === 'column' ? 'column' : 'text');
          // What was there belongs to the other way of filling it.
          onChange('');
        }}
        data-testid={`${testId}-mode`}
      >
        <option value="column">{t('automations:addOn.fromColumn', 'A column of the record')}</option>
        <option value="text">{input.kind === 'email' ? t('automations:addOn.typedAddress', 'A typed address') : input.kind === 'number' ? t('automations:addOn.typedNumber', 'A typed number') : t('automations:email.ph.text', 'A text')}</option>
      </Select>
      <div className="mt-1.5">
        {mode === 'column' ? (
          <Combobox
            options={inputColumnOptions(table, input.kind, column)}
            value={column}
            onValueChange={(next) => onChange(next === null ? '' : `{{record.${next}}}`)}
            placeholder={t('automations:email.findColumn', 'Find a column…')}
            emptyText={t('automations:email.noColumn', 'No column matches.')}
            aria-label={label}
            error={notAddress}
            mono
            data-testid={testId}
          />
        ) : (
          <Input value={value} type={input.kind === 'number' ? 'number' : input.kind === 'email' ? 'email' : 'text'} aria-label={label} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
        )}
      </div>
      {notAddress ? (
        <p role="alert" className="mt-[7px] flex items-start gap-[7px] text-[12px] font-semibold leading-[1.5] text-danger">
          <CircleAlert className="mt-0.5 size-[13px] shrink-0" aria-hidden="true" />
          <span>{t('automations:email.notAddress', '{column} is not an address. Choose a column that holds one.', { column: column ?? '' })}</span>
        </p>
      ) : null}
    </div>
  );
}

/** A row of the add-on's own table, found by typing: what a `record` input is given is the row's key. */
function RowPicker({ input, value, connectionId, label, onChange, testId }: { input: SourceStepInput; value: string; connectionId: string | null; label: string; onChange: (value: string) => void; testId: string }): ReactNode {
  const table = input.table ?? null;
  const key = input.tableKey ?? null;
  const ready = connectionId !== null && table !== null && key !== null;
  const rows = useQuery({
    queryKey: ['automations', 'add-on-rows', connectionId, table, key],
    queryFn: () => createCrudApi(connectionId as string, table as string).lookup?.({ table: table as string, column: key as string }, '') ?? Promise.resolve([]),
    enabled: ready,
    staleTime: 30_000,
  });
  if (!ready) return <p className="text-xs text-fg-muted">{t('automations:addOn.noRows', 'The add-on’s table is not there to choose from.')}</p>;
  const options: ComboboxOption[] = (rows.data ?? []).map((row) => ({ value: row.value, label: row.label, ...(row.detail === undefined ? {} : { description: row.detail }) }));
  // What the rule already names stays choosable when it is not among the first rows read.
  if (value !== '' && !options.some((option) => option.value === value)) options.unshift({ value, label: value });
  return (
    <Combobox
      options={options}
      value={value === '' ? null : value}
      onValueChange={(next) => onChange(next ?? '')}
      placeholder={t('automations:addOn.findRow', 'Find one…')}
      emptyText={t('automations:addOn.noRow', 'Nothing matches.')}
      aria-label={label}
      data-testid={testId}
    />
  );
}

// --- email (D15) ------------------------------------------------------------

function EmailSettings({
  action,
  sources,
  table,
  onChange,
}: ActionSettingsProps & { action: Extract<Action, { kind: 'email' }> }): ReactNode {
  const to = action.to;
  const off = sources?.templatesOff ?? 0;
  const template = templateOf(sources, action);
  const rows = placeholderRows(action, template, table);
  const setVar = (name: string, value: string | null): void => {
    const next = { ...(action.vars ?? {}) };
    if (value === null) delete next[name];
    else next[name] = value;
    onChange({ vars: next } as Partial<Action>);
  };
  return (
    <Card title={t('automations:pick.email', 'Send email')}>
      <Field label={t('automations:email.template', 'Template')}>
        <Select
          value={action.templateKey ?? ''}
          onChange={(event) => {
            const templateKey = event.target.value === '' ? null : event.target.value;
            // What the step fills belongs to the template it was filled for.
            const picked = sources?.templates.find((row) => row.key === templateKey) ?? null;
            onChange({ templateKey, vars: varsFor(action, picked) } as Partial<Action>);
          }}
          data-testid="email-template"
        >
          <option value="">{t('automations:email.template', 'Template')}</option>
          {(sources?.templates ?? []).map((template) => (
            <option key={template.key} value={template.key}>
              {template.name}
            </option>
          ))}
        </Select>
        {off === 0 ? null : (
          // A template that is off in every language is not in the list: said, so nobody wonders where it went.
          <p className="mt-1 text-[11px] leading-[1.45] text-fg-subtle" data-testid="email-templates-off">
            {t('automations:email.templatesOff', '{count, plural, one {# template is} other {# templates are}} switched off and not shown.', { count: off })}{' '}
            <a href="/email-templates" className="font-bold text-accent underline-offset-2 hover:underline">
              {t('automations:email.templatesOffLink', 'Open Email templates')}
            </a>
          </p>
        )}
      </Field>

      <Field label={t('automations:email.to', 'To')}>
        <Select
          value={to === null ? '' : to.kind}
          onChange={(event) => {
            const kind = event.target.value;
            if (kind === 'field') onChange({ to: { kind: 'field', column: '' } });
            else if (kind === 'fixed') onChange({ to: { kind: 'fixed', addresses: [] } });
            else if (kind === 'staff') onChange({ to: { kind: 'staff', column: '' } });
            else if (kind === 'listed') onChange({ to: { kind: 'listed', table: '' } });
            else onChange({ to: null });
          }}
          data-testid="email-to-kind"
        >
          <option value="">{t('automations:email.to', 'To')}</option>
          <option value="field">{t('automations:email.toField', "This record's email")}</option>
          <option value="staff">{t('automations:email.toStaff', 'The person on this record')}</option>
          {/* Offered where the table lists people against its rows, and kept for a step that already says it. */}
          {(table?.listings?.length ?? 0) > 0 || to?.kind === 'listed' ? <option value="listed">{t('automations:listed.option', 'The people listed on this record')}</option> : null}
          <option value="fixed">{t('automations:email.toFixed', 'Addresses')}</option>
        </Select>
      </Field>

      {to?.kind === 'staff' ? (
        <StaffColumnField table={table} value={to.column} onChange={(column) => onChange({ to: { kind: 'staff', column } })} testId="email-to-staff" />
      ) : null}

      {to?.kind === 'listed' ? <ListingField table={table} value={to.table} onChange={(listed) => onChange({ to: { kind: 'listed', table: listed } })} testId="email-to-listed" /> : null}

      {to?.kind === 'field' ? (
        <Field label={t('automations:email.column', 'Column')}>
          {/* The columns that hold an address: this table's first, then the ones a link leads to
              (the order's customer's). Whatever else the table has follows, for a column the
              schema's reading got wrong; choosing one is warned of, not refused. */}
          <Combobox
            options={recipientOptions(table, to.column)}
            value={to.column === '' ? null : to.column}
            onValueChange={(column) => {
              onChange({ to: { kind: 'field', column: column ?? '' } });
            }}
            placeholder={t('automations:email.findColumn', 'Find a column…')}
            emptyText={t('automations:email.noColumn', 'No column matches.')}
            aria-label={t('automations:email.addressColumns', 'Address columns')}
            error={holdsAddresses(table, to.column) === false}
            mono
            data-testid="email-to-column"
          />
          {holdsAddresses(table, to.column) === false ? (
            <p role="alert" className="mt-[7px] flex items-start gap-[7px] text-[12px] font-semibold leading-[1.5] text-danger" data-testid="email-to-not-address">
              <CircleAlert className="mt-0.5 size-[13px] shrink-0" aria-hidden="true" />
              <span>{t('automations:email.notAddress', '{column} is not an address. Choose a column that holds one.', { column: to.column })}</span>
            </p>
          ) : null}
        </Field>
      ) : null}

      {to?.kind === 'fixed' ? (
        <Field label={t('automations:email.toFixed', 'Addresses')}>
          <ChipInput
            value={to.addresses}
            placeholder={t('automations:email.addresses', 'Add an address…')}
            removeLabel={(chip) => `${t('automations:rec.remove', 'Remove this value')} ${chip}`}
            onValueChange={(addresses) => {
              onChange({ to: { kind: 'fixed', addresses } });
            }}
            data-testid="email-to-fixed"
          />
        </Field>
      ) : null}

      {rows.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="email-placeholders">
          <div className="text-[11.5px] font-bold">{t('automations:email.placeholders', 'Placeholders')}</div>
          <div className="text-[11px] text-fg-subtle">
            {template?.ownedByApp === true
              ? t(
                  'automations:email.ph.appOwned',
                  'This template belongs to an app, which fills these itself when it sends. A rule fills only what is marked here.',
                )
              : t('automations:email.ph.hint', 'What the template reads, and what fills each one.')}
          </div>
          {rows.map((row) => (
            <PlaceholderLine key={row.name} row={row} value={action.vars?.[row.name]} table={table} onChange={setVar} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * What an email step may be addressed to, in the order a person looks for
 * it: this table's address columns, the address columns of the rows its
 * links lead to, then the table's other columns. Each says where it is from
 * on its second line, as the picker has no headings of its own.
 */
function recipientOptions(table: SourceTable | null, current: string): ComboboxOption[] {
  if (table === null) return [];
  const here = t('automations:email.thisTable', 'This table · {table}', { table: table.label });
  const own = (column: SourceTable['columns'][number], address: boolean): ComboboxOption => ({
    value: column.name,
    label: column.name,
    description: column.label === column.name ? here : `${column.label} · ${here}`,
    leading: address ? <AtSign className="size-[13px] text-fg-subtle" aria-hidden="true" /> : <Columns3 className="size-[13px] text-fg-subtle" aria-hidden="true" />,
  });
  const out: ComboboxOption[] = table.columns.filter((column) => column.emailLike).map((column) => own(column, true));
  for (const link of table.links ?? []) {
    const through = table.columns.find((column) => column.name === link.column)?.label ?? link.column;
    for (const column of link.columns) {
      const name = `${link.column}.${column.name}`;
      // Of a linked row only what holds an address, and whatever the step already names.
      if (!column.emailLike && name !== current) continue;
      out.push({
        value: name,
        label: `${link.column} → ${column.name}`,
        description: t('automations:email.fromLink', 'From {link} · {table}.{column}', { link: through, table: link.label, column: column.name }),
        leading: <Link2 className="size-[13px] text-fg-subtle" aria-hidden="true" />,
      });
    }
  }
  out.push(...table.columns.filter((column) => !column.emailLike).map((column) => own(column, false)));
  return out;
}

/**
 * One placeholder: its name, what fills it, and — where the record does not —
 * the choice of a column or a text. The choice is ONE select, because "which
 * column" and "no column, this text" are the same question to the person
 * answering it; the text box appears only for the answer that needs it.
 */
function PlaceholderLine({
  row,
  value,
  table,
  onChange,
}: {
  row: PlaceholderRow;
  value: string | undefined;
  table: SourceTable | null;
  onChange: (name: string, value: string | null) => void;
}): ReactNode {
  const token = `{{${row.name}}}`;
  const filled = row.state === 'record' || row.state === 'rule';
  const column = value === undefined ? null : columnOfValue(value, table);
  const mode = value === undefined ? '' : column === null ? 'text' : `column:${column}`;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface px-2.5 py-2" data-testid={`email-ph-${row.name}`}>
      <div className="flex items-center justify-between gap-2">
        <code className="min-w-0 truncate font-mono text-[11.5px]">{token}</code>
        <span
          className={`shrink-0 text-[11px] font-bold ${row.state === 'unfilled' ? 'text-warn' : 'text-fg-muted'}`}
          data-testid={`email-ph-state-${row.name}`}
        >
          {row.state === 'record'
            ? t('automations:email.ph.record', 'From this record')
            : row.state === 'rule'
              ? t('automations:email.ph.rule', 'Filled by the rule')
              : row.state === 'mapped'
                ? t('automations:email.ph.mapped', 'Filled by this step')
                : row.state === 'backup'
                  ? t('automations:email.ph.backup', 'Has its own backup text')
                  : t('automations:email.ph.unfilled', 'Not filled')}
        </span>
      </div>
      {filled ? null : (
        <>
          <Select
            value={mode}
            aria-label={t('automations:email.ph.fillWith', 'Fill {token} with', { token })}
            onChange={(event) => {
              const next = event.target.value;
              if (next === '') onChange(row.name, null);
              else if (next === 'text') onChange(row.name, column === null ? (value ?? '') : '');
              else onChange(row.name, `{{record.${next.slice('column:'.length)}}}`);
            }}
            data-testid={`email-ph-fill-${row.name}`}
          >
            <option value="">{t('automations:email.ph.unfilled', 'Not filled')}</option>
            <option value="text">{t('automations:email.ph.text', 'A text')}</option>
            {(table?.columns ?? []).map((candidate) => (
              <option key={candidate.name} value={`column:${candidate.name}`}>
                {candidate.label}
              </option>
            ))}
            {linkedColumns(table).map((group) => (
              <optgroup key={group.link} label={group.label}>
                {group.columns.map((candidate) => (
                  <option key={candidate.name} value={`column:${candidate.name}`}>
                    {candidate.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {mode === 'text' ? (
            <Input
              value={value ?? ''}
              aria-label={t('automations:email.ph.textFor', 'Text for {token}', { token })}
              onChange={(event) => {
                onChange(row.name, event.target.value);
              }}
              data-testid={`email-ph-text-${row.name}`}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// --- notification (D20) -----------------------------------------------------

function NotificationSettings(props: ActionSettingsProps & { action: Extract<Action, { kind: 'notification' }> }): ReactNode {
  const { action, sources, onChange } = props;
  const to = action.to;
  const mode = to === null ? '' : 'roles' in to ? 'roles' : 'column' in to ? 'column' : 'listed' in to ? 'listed' : 'users';
  return (
    <Card title={t('automations:pick.notification', 'Send notification')}>
      <Field label={t('automations:notif.to', 'Send to')}>
        <Select
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'roles') onChange({ to: { roles: [] } });
            else if (next === 'users') onChange({ to: { users: [] } });
            else if (next === 'column') onChange({ to: { column: '' } });
            else if (next === 'listed') onChange({ to: { listed: '' } });
            else onChange({ to: null });
          }}
          data-testid="notif-mode"
        >
          <option value="">{t('automations:notif.to', 'Send to')}</option>
          <option value="column">{t('automations:notif.column', 'The person on this record')}</option>
          {(props.table?.listings?.length ?? 0) > 0 || mode === 'listed' ? <option value="listed">{t('automations:listed.option', 'The people listed on this record')}</option> : null}
          <option value="roles">{t('automations:notif.roles', 'Everyone with a role')}</option>
          <option value="users">{t('automations:notif.users', 'Specific people')}</option>
        </Select>
      </Field>

      {to !== null && 'column' in to ? (
        <StaffColumnField table={props.table} value={to.column} onChange={(column) => onChange({ to: { column } })} testId="notif-column" />
      ) : null}

      {to !== null && 'listed' in to ? <ListingField table={props.table} value={to.listed} onChange={(listed) => onChange({ to: { listed } })} testId="notif-listed" /> : null}

      {to !== null && 'roles' in to ? (
        <Field label={t('automations:notif.roles', 'Everyone with a role')}>
          <Select
            multiple
            value={to.roles}
            onChange={(event) => {
              onChange({
                to: { roles: [...event.target.selectedOptions].map((option) => option.value) },
              });
            }}
            data-testid="notif-roles"
          >
            {(sources?.roles ?? []).map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {/* An app's rule tells each person in their language; words typed here are one text for everybody. */}
      {action.locales !== undefined && Object.keys(action.locales).length > 0 ? (
        <p className="text-[11px] leading-[1.45] text-fg-subtle" data-testid="notif-languages">
          {t('automations:notif.languages', 'Also written in {languages}: each person is told in theirs. Changing the title or the message here writes it in one language for everybody.', { languages: languageNames(Object.keys(action.locales)) })}
        </p>
      ) : null}
      <Field label={t('automations:notif.title', 'Title')}>
        <Input
          value={action.title}
          onChange={(event) => {
            onChange({ title: event.target.value, locales: undefined });
          }}
          data-testid="notif-title"
        />
      </Field>
      <Field label={t('automations:notif.body', 'Message')}>
        <Textarea
          rows={3}
          value={action.body ?? ''}
          onChange={(event) => {
            onChange({ body: event.target.value === '' ? null : event.target.value, locales: undefined });
          }}
          data-testid="notif-body"
        />
      </Field>
      <div className="flex items-center gap-3 rounded-[11px] border border-border bg-surface px-3.5 py-3">
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold">{t('automations:notif.urgent', 'Urgent')}</div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">{t('automations:notif.urgentBody', 'Told at once, also in a person’s quiet hours')}</div>
        </div>
        <Switch
          checked={action.urgent === true}
          onCheckedChange={(checked) => onChange({ urgent: checked ? true : undefined } as Partial<Action>)}
          aria-label={t('automations:notif.urgent', 'Urgent')}
          data-testid="notif-urgent"
        />
      </div>
    </Card>
  );
}

/** The staff columns a step may tell: this table's own, then the ones a link leads to. */
export function staffColumnOptions(table: SourceTable | null): { value: string; label: string }[] {
  if (table === null) return [];
  const own = table.columns.filter((column) => column.staff === true).map((column) => ({ value: column.name, label: column.label }));
  const linked = (table.links ?? []).flatMap((link) => {
    const through = table.columns.find((column) => column.name === link.column)?.label ?? link.column;
    return link.columns.filter((column) => column.staff === true).map((column) => ({ value: `${link.column}.${column.name}`, label: `${through} → ${column.label}` }));
  });
  return [...own, ...linked];
}

/** Languages by tag, named in the reader's own language (`de-DE` → German). */
function languageNames(tags: readonly string[]): string {
  const language = getI18nInstance()?.language ?? 'en-US';
  const names = tags.map((tag) => {
    try {
      return new Intl.DisplayNames([language], { type: 'language' }).of(tag) ?? tag;
    } catch {
      return tag;
    }
  });
  try {
    return new Intl.ListFormat([language], { type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/** Which person of the record a step tells: one of its staff columns. An empty one tells nobody, and the run says so. */
function StaffColumnField({ table, value, onChange, testId }: { table: SourceTable | null; value: string; onChange: (column: string) => void; testId: string }): ReactNode {
  const options = staffColumnOptions(table);
  return (
    <Field label={t('automations:notif.columnPick', 'Which person')}>
      <Select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId}>
        <option value="">{t('automations:notif.columnChoose', 'Choose a column…')}</option>
        {/* A column the step already names stays listed, whatever the table says of it now. */}
        {value !== '' && !options.some((option) => option.value === value) ? <option value={value}>{value}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {options.length === 0 ? (
        <p className="mt-1 text-[11px] leading-[1.45] text-fg-subtle" data-testid={`${testId}-none`}>
          {t('automations:notif.columnNone', 'This table has no column that holds a staff member.')}
        </p>
      ) : (
        <p className="mt-1 text-[11px] leading-[1.45] text-fg-subtle">{t('automations:notif.columnEmpty', 'A record with nobody in that column tells nobody, and the run says so.')}</p>
      )}
    </Field>
  );
}

/** Which table's people: one that lists people against the record's rows. Only those who can open the record are told. */
function ListingField({ table, value, onChange, testId }: { table: SourceTable | null; value: string; onChange: (listed: string) => void; testId: string }): ReactNode {
  const options = table?.listings ?? [];
  return (
    <Field label={t('automations:listed.pick', 'Listed in')}>
      <Select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId}>
        <option value="">{t('automations:listed.choose', 'Choose a table…')}</option>
        {/* A table the step already names stays listed, whatever the table says of it now. */}
        {value !== '' && !options.some((option) => option.table === value) ? <option value={value}>{value}</option> : null}
        {options.map((option) => (
          <option key={option.table} value={option.table}>
            {option.label}
          </option>
        ))}
      </Select>
      <p className="mt-1 text-[11px] leading-[1.45] text-fg-subtle">
        {t('automations:listed.help', 'Of the people listed, only those who can sign in and open this record are told. A record that lists nobody tells nobody, and the run says so.')}
      </p>
    </Field>
  );
}

// --- a summary for each person ----------------------------------------------

function DigestSettings({ action, sources, connectionId, onChange }: ActionSettingsProps & { action: Extract<Action, { kind: 'digest' }> }): ReactNode {
  const tables = (sources?.connections.find((row) => row.id === connectionId) ?? sources?.connections[0] ?? null)?.tables ?? [];
  const setSections = (sections: DigestSection[]): void => onChange({ sections } as Partial<Action>);
  const patch = (index: number, change: Partial<DigestSection>): void => setSections(action.sections.map((section, i) => (i === index ? { ...section, ...change } : section)));
  return (
    <Card title={t('automations:pick.digest', 'Send each person a summary')}>
      <p className="text-[11px] leading-[1.5] text-fg-subtle">
        {t('automations:digest.help', 'One email for each person, listing only the rows that are theirs and that they may read. It is sent at the time each person chose for summaries, or when the rule runs.')}
      </p>
      <Field label={t('automations:email.template', 'Template')}>
        <Select value={action.templateKey ?? ''} onChange={(event) => onChange({ templateKey: event.target.value === '' ? null : event.target.value } as Partial<Action>)} data-testid="digest-template">
          <option value="">{t('automations:email.template', 'Template')}</option>
          {(sources?.templates ?? []).map((template) => (
            <option key={template.key} value={template.key}>
              {template.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('automations:notif.roles', 'Everyone with a role')}>
        <Select
          multiple
          value={action.to?.roles ?? []}
          onChange={(event) => onChange({ to: { roles: [...event.target.selectedOptions].map((option) => option.value) } } as Partial<Action>)}
          data-testid="digest-roles"
        >
          {(sources?.roles ?? []).map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
      </Field>
      {action.sections.map((section, index) => {
        const of = tables.find((row) => row.id === section.table) ?? null;
        return (
          <div key={index} className="flex flex-col gap-2 rounded-[11px] border border-border bg-surface px-3 py-2.5" data-testid={`digest-section-${String(index)}`}>
            <Field label={t('automations:digest.sectionKey', 'Section name (the template’s rows block names it)')}>
              <Input value={section.key} onChange={(event) => patch(index, { key: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} data-testid={`digest-key-${String(index)}`} />
            </Field>
            <Field label={t('automations:rec.table', 'Table')}>
              <Select
                value={section.table}
                // Another table has other columns: what chose this one's rows goes with it.
                onChange={(event) => setSections(action.sections.map(({ within: _within, ...kept }, i) => (i === index ? { ...kept, table: event.target.value, owner: '', where: [], orderBy: null } : action.sections[i]!)))}
                data-testid={`digest-table-${String(index)}`}
              >
                <option value="">{t('automations:digest.chooseTable', 'Choose a table…')}</option>
                {tables
                  .filter((row) => row.canRead && row.columns.some((column) => column.staff === true))
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('automations:digest.owner', 'Rows where this person is')}>
              <Select value={section.owner} onChange={(event) => patch(index, { owner: event.target.value })} data-testid={`digest-owner-${String(index)}`}>
                <option value="">{t('automations:notif.columnChoose', 'Choose a column…')}</option>
                {(of?.columns ?? [])
                  .filter((column) => column.staff === true)
                  .map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.label}
                    </option>
                  ))}
              </Select>
            </Field>
            {section.where.length === 0 ? null : (
              <p className="text-[11px] leading-[1.45] text-fg-subtle" data-testid={`digest-where-${String(index)}`}>
                {t('automations:digest.conditions', '{count, plural, one {And # more condition, kept as it is.} other {And # more conditions, kept as they are.}}', { count: section.where.length })}
              </p>
            )}
            {section.within === undefined ? null : (
              <p className="text-[11px] leading-[1.45] text-fg-subtle" data-testid={`digest-within-${String(index)}`}>
                {'this' in section.within
                  ? t('automations:digest.withinYear', 'Only the rows of this year by {column}, on the business’s calendar. Kept as it is.', { column: of?.columns.find((column) => column.name === section.within?.column)?.label ?? section.within.column })
                  : t('automations:digest.withinDays', '{count, plural, one {Only the rows of today by {column}, on the business’s calendar. Kept as it is.} other {Only the rows of the last # days by {column}, on the business’s calendar. Kept as it is.}}', {
                      count: section.within.lastDays,
                      column: of?.columns.find((column) => column.name === section.within?.column)?.label ?? section.within.column,
                    })}
              </p>
            )}
            <Field label={t('automations:digest.limit', 'At most this many rows')}>
              <Input
                type="number"
                min={1}
                max={50}
                value={String(section.limit)}
                onChange={(event) => patch(index, { limit: Math.min(50, Math.max(1, Math.trunc(Number(event.target.value) || 1))) })}
                data-testid={`digest-limit-${String(index)}`}
              />
            </Field>
            <Button variant="ghost" size="sm" onClick={() => setSections(action.sections.filter((_, i) => i !== index))} data-testid={`digest-remove-${String(index)}`}>
              {t('automations:digest.removeSection', 'Remove this section')}
            </Button>
          </div>
        );
      })}
      {action.sections.length >= 6 ? null : (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSections([...action.sections, { key: `section-${String(action.sections.length + 1)}`, table: '', owner: '', where: [], orderBy: null, limit: 20 }])}
          data-testid="digest-add"
        >
          {t('automations:digest.addSection', 'Add a section')}
        </Button>
      )}
      <div className="flex items-center gap-3 rounded-[11px] border border-border bg-surface px-3.5 py-3">
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold">{t('automations:digest.sendEmpty', 'Send when there is nothing to list')}</div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">{t('automations:digest.sendEmptyBody', 'Off: a person with no row in any section gets no email')}</div>
        </div>
        <Switch checked={action.sendEmpty} onCheckedChange={(checked) => onChange({ sendEmpty: checked } as Partial<Action>)} aria-label={t('automations:digest.sendEmpty', 'Send when there is nothing to list')} data-testid="digest-send-empty" />
      </div>
    </Card>
  );
}

// --- record create / update (D17) ------------------------------------------

function RecordSettings({
  action,
  sources,
  table,
  connectionId,
  onChange,
}: ActionSettingsProps & {
  action: Extract<Action, { kind: 'record.create' } | { kind: 'record.update' }>;
}): ReactNode {
  const fieldId = useId();
  const isCreate = action.kind === 'record.create';
  // See `connectionId` on the props: the write lands in the trigger's
  // connection, so those are the tables — this used to flatten every
  // connection's and offer rows the runner could never resolve.
  const written =
    sources?.connections.find((row) => row.id === connectionId) ?? sources?.connections[0] ?? null;
  const target = isCreate ? (written?.tables.find((row) => row.id === action.table) ?? null) : table;
  const columns = (target?.columns ?? []).filter((column) => !column.pii);
  const entries = Object.entries(action.values);

  const setValue = (column: string, value: WriteValue | null): void => {
    const next: Record<string, WriteValue> = { ...action.values };
    if (value === null) delete next[column];
    else next[column] = value;
    onChange({ values: next } as Partial<Action>);
  };

  return (
    <Card
      title={
        isCreate
          ? t('automations:pick.create', 'Create record')
          : t('automations:pick.update', 'Update field')
      }
    >
      {isCreate ? (
        <Field label={t('automations:rec.table', 'Table')} htmlFor={`${fieldId}-table`}>
          <Combobox
            id={`${fieldId}-table`}
            value={action.table === null || action.table === '' ? null : action.table}
            onValueChange={(next) => {
              if (next === null || next === '') return;
              // The values are columns of the OLD table: keeping them would
              // write names the new one does not have.
              onChange({ table: next, values: {} } as Partial<Action>);
            }}
            options={(written?.tables ?? [])
              .filter((row) => row.canCreate)
              .map((row) => ({ value: row.id, label: row.label }))}
            placeholder={t('automations:modal.tablePlaceholder', 'Search tables…')}
            emptyText={t('automations:modal.tableEmpty', 'No matching table')}
          />
        </Field>
      ) : null}

      {isCreate ? (
        <Field label={t('automations:rec.name', 'Name of the new row, for later steps (optional)')}>
          <Input
            value={action.kind === 'record.create' ? (action.name ?? '') : ''}
            placeholder="deal"
            onChange={(event) => {
              const name = event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 40);
              onChange({ name: name === '' ? undefined : name } as Partial<Action>);
            }}
            data-testid="rec-name"
          />
          {action.kind === 'record.create' && action.name !== undefined ? (
            <p className="mt-1 text-[11px] leading-[1.45] text-fg-subtle" data-testid="rec-name-hint">
              {t('automations:rec.nameHint', 'A later step reads it as {token}', { token: `{{steps.${action.name}.column}}` })}
            </p>
          ) : null}
        </Field>
      ) : null}

      <div className="text-[11px] text-fg-subtle">
        {t('automations:rec.tokenHint', 'Use {token} to copy from the record', {
          token: '{{record.column}}',
        })}
      </div>

      {entries.map(([column, value]) => (
        <div key={column} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={t('automations:rec.column', 'Column')}>
              <Select
                value={column}
                onChange={(event) => {
                  setValue(column, null);
                  setValue(event.target.value, value);
                }}
                data-testid={`rec-column-${column}`}
              >
                {columns.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="min-w-0 flex-1">
            <Field label={t('automations:rec.value', 'Value')}>
              {typeof value === 'string' ? (
                <Input
                  value={value}
                  onChange={(event) => {
                    setValue(column, event.target.value);
                  }}
                  data-testid={`rec-value-${column}`}
                />
              ) : (
                <div className="flex min-h-9 items-center rounded-md border border-border-strong bg-surface px-3 text-[12.5px] text-fg-muted">
                  {writeValueText(value)}
                </div>
              )}
            </Field>
          </div>
          <button
            type="button"
            aria-label={t('automations:rec.remove', 'Remove this value')}
            onClick={() => {
              setValue(column, null);
            }}
            className="mb-1 text-[11px] font-bold text-fg-subtle hover:text-danger"
            data-testid={`rec-remove-${column}`}
          >
            ×
          </button>
        </div>
      ))}

      <div className="flex gap-2">
        <Select
          value=""
          aria-label={t('automations:rec.addValue', 'Add a value')}
          onChange={(event) => {
            if (event.target.value !== '') setValue(event.target.value, '');
          }}
          data-testid="rec-add-value"
        >
          <option value="">{t('automations:rec.addValue', 'Add a value')}</option>
          {columns
            .filter((column) => !(column.name in action.values))
            .map((column) => (
              <option key={column.name} value={column.name}>
                {column.label}
              </option>
            ))}
        </Select>
        {/* `{ now: true }` is a MARKER, not a timestamp: three dialects have
            three right answers and the runner picks one (D17). */}
        <Select
          value=""
          aria-label={t('automations:rec.now', 'Now')}
          onChange={(event) => {
            if (event.target.value !== '') setValue(event.target.value, { now: true });
          }}
          data-testid="rec-add-now"
        >
          <option value="">{t('automations:rec.now', 'Now')}</option>
          {columns
            .filter((column) => column.dateLike && !(column.name in action.values))
            .map((column) => (
              <option key={column.name} value={column.name}>
                {column.label}
              </option>
            ))}
        </Select>
      </div>
    </Card>
  );
}

// --- webhook and its Slack preset (D19) ------------------------------------

function WebhookSettings({
  action,
  onChange,
}: ActionSettingsProps & { action: Extract<Action, { kind: 'webhook' }> }): ReactNode {
  const slack = action.bodyKind === 'slack';
  return (
    <Card
      title={
        slack ? t('automations:pick.slack', 'Slack message') : t('automations:pick.webhook', 'Call webhook')
      }
    >
      <Field
        label={slack ? t('automations:hook.slackUrl', 'Slack webhook URL') : t('automations:hook.url', 'URL')}
      >
        <Input
          value={action.url ?? ''}
          onChange={(event) => {
            onChange({ url: event.target.value === '' ? null : event.target.value });
          }}
          data-testid="hook-url"
        />
      </Field>

      {slack ? (
        <Field label={t('automations:hook.slackText', 'Message')}>
          <Textarea
            rows={3}
            value={action.body ?? ''}
            onChange={(event) => {
              onChange({ body: event.target.value === '' ? null : event.target.value });
            }}
            data-testid="hook-slack-text"
          />
        </Field>
      ) : (
        <>
          <Field label={t('automations:hook.method', 'Method')}>
            <Select
              value={action.method}
              onChange={(event) => {
                onChange({ method: event.target.value as 'POST' | 'PUT' });
              }}
              data-testid="hook-method"
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </Select>
          </Field>
          <Field label={t('automations:hook.body', 'Body')}>
            <Select
              value={action.bodyKind}
              onChange={(event) => {
                onChange({ bodyKind: event.target.value as 'json' | 'text' });
              }}
              data-testid="hook-body-kind"
            >
              <option value="json">{t('automations:hook.bodyJson', 'JSON (event, rule, record)')}</option>
              <option value="text">{t('automations:hook.bodyText', 'Custom text')}</option>
            </Select>
          </Field>
          {action.bodyKind === 'text' ? (
            <Textarea
              rows={3}
              value={action.body ?? ''}
              aria-label={t('automations:hook.body', 'Body')}
              onChange={(event) => {
                onChange({ body: event.target.value === '' ? null : event.target.value });
              }}
              data-testid="hook-body"
            />
          ) : null}
          <Field label={t('automations:hook.headerName', 'Name')}>
            <Input
              value={action.headerName ?? ''}
              onChange={(event) => {
                onChange({ headerName: event.target.value === '' ? null : event.target.value });
              }}
              data-testid="hook-header-name"
            />
          </Field>
          <Field label={t('automations:hook.headerValue', 'Value')}>
            {/*
             * Write-only. A saved value never comes back from the server, so the
             * dots say one is there and typing replaces it; left empty, the
             * saved one stays. Clearing the header name drops it.
             */}
            <Input
              type="password"
              autoComplete="new-password"
              value={action.headerValue ?? ''}
              {...(action.headerValueSet === true ? { placeholder: '••••••••' } : {})}
              disabled={action.headerName === null}
              onChange={(event) => {
                onChange({ headerValue: event.target.value === '' ? undefined : event.target.value });
              }}
              data-testid="hook-header-value"
            />
          </Field>
        </>
      )}
    </Card>
  );
}

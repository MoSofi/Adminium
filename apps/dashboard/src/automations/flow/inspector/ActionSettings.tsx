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

import { ChipInput, Combobox, Input, Select, Textarea } from '@adminium/ui';
import { useId, type ReactNode } from 'react';

import { t } from '../../../i18n/t.js';
import type { SourceTable, Sources } from '../../api.js';
import type { Action, WriteValue } from '../../model/graph.js';
import { columnOfValue, placeholderRows, templateOf, varsFor, type PlaceholderRow } from '../../model/placeholders.js';
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
    default:
      return null;
  }
}

// --- email (D15) ------------------------------------------------------------

function EmailSettings({
  action,
  sources,
  table,
  onChange,
}: ActionSettingsProps & { action: Extract<Action, { kind: 'email' }> }): ReactNode {
  const to = action.to;
  const columns = table?.columns ?? [];
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
      </Field>

      <Field label={t('automations:email.to', 'To')}>
        <Select
          value={to === null ? '' : to.kind}
          onChange={(event) => {
            const kind = event.target.value;
            if (kind === 'field') onChange({ to: { kind: 'field', column: '' } });
            else if (kind === 'fixed') onChange({ to: { kind: 'fixed', addresses: [] } });
            else onChange({ to: null });
          }}
          data-testid="email-to-kind"
        >
          <option value="">{t('automations:email.to', 'To')}</option>
          <option value="field">{t('automations:email.toField', "This record's email")}</option>
          <option value="fixed">{t('automations:email.toFixed', 'Addresses')}</option>
        </Select>
      </Field>

      {to?.kind === 'field' ? (
        <Field label={t('automations:email.column', 'Column')}>
          <Select
            value={to.column}
            onChange={(event) => {
              onChange({ to: { kind: 'field', column: event.target.value } });
            }}
            data-testid="email-to-column"
          >
            <option value="">{t('automations:email.column', 'Column')}</option>
            {/* The address column first: the classifier already knows which
                columns look like an email (`emailLike` on the wire). */}
            {[...columns].sort((a, b) => Number(b.emailLike) - Number(a.emailLike)).map((column) => (
              <option key={column.name} value={column.name}>
                {column.label}
              </option>
            ))}
          </Select>
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

function NotificationSettings({
  action,
  sources,
  onChange,
}: ActionSettingsProps & { action: Extract<Action, { kind: 'notification' }> }): ReactNode {
  const to = action.to;
  const mode = to === null ? '' : 'roles' in to ? 'roles' : 'users';
  return (
    <Card title={t('automations:pick.notification', 'Send notification')}>
      <Field label={t('automations:notif.to', 'Send to')}>
        <Select
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'roles') onChange({ to: { roles: [] } });
            else if (next === 'users') onChange({ to: { users: [] } });
            else onChange({ to: null });
          }}
          data-testid="notif-mode"
        >
          <option value="">{t('automations:notif.to', 'Send to')}</option>
          <option value="roles">{t('automations:notif.roles', 'Everyone with a role')}</option>
          <option value="users">{t('automations:notif.users', 'Specific people')}</option>
        </Select>
      </Field>

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

      <Field label={t('automations:notif.title', 'Title')}>
        <Input
          value={action.title}
          onChange={(event) => {
            onChange({ title: event.target.value });
          }}
          data-testid="notif-title"
        />
      </Field>
      <Field label={t('automations:notif.body', 'Message')}>
        <Textarea
          rows={3}
          value={action.body ?? ''}
          onChange={(event) => {
            onChange({ body: event.target.value === '' ? null : event.target.value });
          }}
          data-testid="notif-body"
        />
      </Field>
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
                <div className="flex h-9 items-center rounded-md border border-border-strong bg-surface px-3 text-[12.5px] text-fg-muted">
                  {t('automations:rec.now', 'Now')}
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

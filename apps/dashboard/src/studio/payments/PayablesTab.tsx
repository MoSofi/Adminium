// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → What can be paid.
 *
 * Tables built on the invoice format can be paid with no setup. Any other
 * table is set up here in three steps, with three real rows previewed as the
 * pay page would read them, worked out by the server on every change:
 *
 *   1. How much is owed: the amount column (a whole-number column asks
 *      whether it holds whole amounts or cents, and nothing is chosen for
 *      the person), the currency (a column, the connection's own, or one
 *      fixed code), and the number the customer knows the record by.
 *   2. How payments land: kept by Adminium (the default; the table stays as
 *      it is), or written into the table's own payments table, mapped column
 *      by column with a column that is unique for each payment and the
 *      table's balance column. Setting a status when paid or refunded in
 *      full is optional and starts off.
 *   3. What the pay page shows: only the columns ticked here, never a
 *      personal one; the customer's email (for sending the pay link) and
 *      country (for the rules on Ways to pay).
 *
 * The server checks everything again when the table is turned on: who may
 * (read and update every row of it) and what may be mapped.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Lock, Table2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  FormField,
  IconTile,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Select,
  Switch,
} from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { studioApi, type SchemaColumn, type SchemaTable } from '../api.js';
import {
  PAYMENTS_PAYABLES_QUERY_KEY,
  checkPayable,
  markPayable,
  patchPayable,
  payableIssuesOf,
  paymentsPayablesQuery,
  stopPayable,
  type OwnPaymentsMapping,
  type PayableCheck,
  type PayableIssue,
  type PayableMapping,
  type PayableProfileView,
} from './paymentsApi.js';
import { money } from './paymentsWords.js';

const NUMBERS = new Set(['integer', 'bigint', 'decimal']);
const WHOLE = new Set(['integer', 'bigint']);

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return t('studio:payments.error.unknown', 'That did not work. Try again.');
}

function shortName(tableId: string): string {
  return tableId.replace(/^[^.]+\./, '');
}

function isPersonal(column: SchemaColumn): boolean {
  return (column.semantics?.flags?.pii ?? null) !== null || column.semantics?.flags?.secret === true || column.semantics?.flags?.maskedByDefault === true;
}

/** One sentence per problem the server found, beside the field it is about. */
export function issueSentence(issue: PayableIssue): string {
  const column = issue.column ?? '';
  switch (issue.code) {
    case 'TABLE_UNAVAILABLE':
      return t('studio:payments.payables.issue.table', 'This table cannot be made payable: it is private, left out of the schema, or not there any more.');
    case 'NO_SUCH_COLUMN':
      return t('studio:payments.payables.issue.noColumn', 'The column {column} is not in the table any more. Choose another.', { column });
    case 'NOT_A_MONEY_COLUMN':
      return t('studio:payments.payables.issue.notMoney', '{column} does not hold an amount Adminium can count exactly. Choose a whole-number or decimal column.', { column });
    case 'NEEDS_UNIT':
      return t('studio:payments.payables.issue.unit', 'Say whether {column} holds whole amounts or cents.', { column });
    case 'TOO_FEW_DECIMALS':
      return t('studio:payments.payables.issue.decimals', '{column} keeps fewer decimal places than the currency needs. Choose another column.', { column });
    case 'NO_CURRENCY':
      return t('studio:payments.payables.issue.currency', "The connection has no currency set. Choose a currency column or one fixed currency, or set the connection's currency in its regional settings.");
    case 'REFERENCE_NOT_UNIQUE':
      return t('studio:payments.payables.issue.unique', 'Choose the column that is unique for each payment.');
    case 'NO_METHOD_VALUES':
      return t('studio:payments.payables.issue.methodValues', 'Say what each way to pay is written as in {column}.', { column });
    case 'METHOD_VALUE_UNKNOWN':
      return t('studio:payments.payables.issue.methodValueUnknown', '{column} has no such value. Choose one from its list for each way to pay.', { column });
    case 'STATUS_NOT_A_CHOICE':
      return t('studio:payments.payables.issue.statusChoice', '{column} has no list of values. Choose a status column with its own list.', { column });
    case 'STATUS_NOT_WRITABLE':
      return t('studio:payments.payables.issue.statusWritable', 'Adminium may not set {column}: it is a key, a link, worked out by Adminium, or personal.', { column });
    case 'STATUS_VALUE_UNKNOWN':
      return t('studio:payments.payables.issue.statusValue', '{column} has no such value. Choose one from its list.', { column });
    case 'FIELD_PERSONAL':
      return t('studio:payments.payables.issue.personal', '{column} is personal and is never shown on the pay page.', { column });
  }
}

function mayMarkSentence(reason: PayableCheck['mayMark']['reason'], table: string): string | null {
  switch (reason) {
    case 'read':
      return t('studio:payments.payables.may.read', 'You need permission to read {table} to set it up.', { table });
    case 'update':
      return t('studio:payments.payables.may.update', 'You need permission to edit {table} to set it up.', { table });
    case 'row-limit':
      return t('studio:payments.payables.may.rowLimit', 'You see only some rows of {table}, so you cannot make every row of it payable.', { table });
    case 'column-limit':
      return t('studio:payments.payables.may.columnLimit', 'You may read or change only some columns of {table}, so you cannot set it up.', { table });
    case 'payments-create':
      return t('studio:payments.payables.may.create', 'You need permission to add rows to the payments table to set it up.');
    case null:
      return null;
  }
}

// ─── The wizard ─────────────────────────────────────────────────────────────

interface Draft {
  connectionId: string;
  tableId: string;
  mapping: PayableMapping;
  /** Which currency choice is picked: a column, the connection's, or one code. */
  currencyKind: 'column' | 'connection' | 'fixed';
  statusOn: boolean;
}

const START: PayableMapping = {
  label: null,
  amount: { column: '', unit: null },
  currency: { connection: true },
  due: null,
  payments: { kind: 'kept' },
  status: null,
  customerEmail: null,
  customerCountry: null,
  pageFields: [],
};

const OWN_START: OwnPaymentsMapping = {
  kind: 'table',
  table: '',
  link: '',
  amount: '',
  date: '',
  method: { column: '', values: {} },
  note: null,
  voided: null,
  reference: '',
  amountUnit: 'units',
};

/** The way-to-pay values a payments table is written with. */
const METHOD_KEYS = ['card', 'bank-transfer', '*'] as const;

function methodKeyLabel(key: (typeof METHOD_KEYS)[number]): string {
  switch (key) {
    case 'card':
      return t('studio:payments.payables.method.card', 'Cards and wallets');
    case 'bank-transfer':
      return t('studio:payments.payables.method.bank', 'Bank debits and transfers');
    case '*':
      return t('studio:payments.payables.method.other', 'Any other online way');
  }
}

function ColumnSelect({ columns, value, onChange, label, id, testId, required, error }: { columns: SchemaColumn[]; value: string; onChange: (next: string) => void; label: string; id: string; testId?: string; required?: boolean; error?: string | null }) {
  return (
    <FormField label={label} controlId={id} required={required} error={error ?? undefined}>
      <Select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId}>
        <option value="">{t('studio:payments.payables.chooseColumn', 'Choose a column')}</option>
        {columns.map((column) => (
          <option key={column.name} value={column.name}>
            {column.name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

function Wizard({ onClose, onDone }: { onClose: () => void; onDone: (table: string) => void }) {
  const client = useQueryClient();
  // The same key the connections hub reads, so the two share one fetch.
  const connections = useQuery({ queryKey: ['studio', 'connections'] as const, queryFn: () => studioApi.listConnections() });
  const [draft, setDraft] = useState<Draft>({ connectionId: '', tableId: '', mapping: START, currencyKind: 'connection', statusOn: false });
  const [step, setStep] = useState(1);
  const schema = useQuery({
    queryKey: ['payments', 'payables', 'schema', draft.connectionId] as const,
    queryFn: () => studioApi.getSchema(draft.connectionId),
    enabled: draft.connectionId !== '',
  });
  const tables = (schema.data?.model.tables ?? []).filter((table) => table.system !== true);
  const table: SchemaTable | undefined = tables.find((one) => one.id === draft.tableId);
  const columns = table?.columns ?? [];
  const mapping = draft.mapping;
  const own = mapping.payments.kind === 'table' ? mapping.payments : null;
  const paymentsTable = own === null ? undefined : tables.find((one) => one.id === own.table);
  const amountColumn = columns.find((column) => column.name === mapping.amount.column);
  const needsUnit = amountColumn !== undefined && WHOLE.has(amountColumn.logicalType);
  const set = (patch: Partial<PayableMapping>) => setDraft({ ...draft, mapping: { ...mapping, ...patch } });
  const setOwn = (patch: Partial<OwnPaymentsMapping>) => own !== null && set({ payments: { ...own, ...patch } });

  const ready = draft.tableId !== '' && mapping.amount.column !== '';
  const check = useQuery({
    queryKey: ['payments', 'payables', 'check', draft.connectionId, draft.tableId, JSON.stringify(mapping)] as const,
    queryFn: () => checkPayable(draft.connectionId, draft.tableId, mapping),
    enabled: ready,
    retry: false,
  });
  const issues = check.data?.issues ?? [];
  const issueAt = (path: string): string | null => {
    const found = issues.find((issue) => issue.path === path || issue.path.startsWith(`${path}.`));
    return found === undefined ? null : issueSentence(found);
  };
  const save = useMutation({
    mutationFn: () => markPayable(draft.connectionId, draft.tableId, mapping),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: PAYMENTS_PAYABLES_QUERY_KEY });
      onDone(shortName(draft.tableId));
    },
  });
  const savedIssues = payableIssuesOf(save.error);

  // What each step needs before Next.
  const stepPaths: Record<number, string[]> = { 1: ['amount', 'currency', 'label', 'due', 'table'], 2: ['payments', 'status', 'due'], 3: ['pageFields', 'label', 'customerEmail', 'customerCountry'] };
  const stepBlocked = (at: number): boolean => {
    // A check that failed has proved nothing: no step goes on from it.
    if (!ready || check.isPending || check.isError) return true;
    if (at === 1 && needsUnit && mapping.amount.unit === null) return true;
    if (at === 2 && own !== null && (own.table === '' || own.link === '' || own.amount === '' || own.date === '' || own.method.column === '' || own.reference === '' || mapping.due === null)) return true;
    return issues.some((issue) => stepPaths[at]!.some((path) => issue.path === path || issue.path.startsWith(`${path}.`)));
  };
  const refusal = check.data === undefined ? null : mayMarkSentence(check.data.mayMark.reason, table?.name ?? shortName(draft.tableId));
  const statusColumn = columns.find((column) => column.name === mapping.status?.column);
  const statusValues = statusColumn === undefined ? null : statusColumn.logicalType === 'boolean' ? ['true', 'false'] : statusColumn.logicalType === 'enum' ? ((schema.data?.model.enums ?? []).find((one) => one.id === statusColumn.enumRef)?.values ?? null) : null;

  const steps = [t('studio:payments.payables.step1', 'How much is owed'), t('studio:payments.payables.step2', 'How payments land'), t('studio:payments.payables.step3', 'What the pay page shows')];

  return (
    <Card data-testid="payments-wizard">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile icon={<Table2 />} />
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold uppercase text-fg-muted">{t('studio:payments.payables.setUpTable', 'Set up a table')}</p>
          <h2 className="text-[16.5px] font-extrabold">{table?.name ?? t('studio:payments.payables.chooseTableTitle', 'Choose a table')}</h2>
        </div>
        <Button variant="ghost" onClick={onClose}>
          {t('studio:payments.ways.cancel', 'Cancel')}
        </Button>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <FormField label={t('studio:payments.payables.connection', 'Connection')} className="min-w-[180px] flex-1">
            <Select value={draft.connectionId} onChange={(event) => setDraft({ ...draft, connectionId: event.target.value, tableId: '', mapping: START })} data-testid="payments-wizard-connection">
              <option value="">{t('studio:payments.payables.chooseConnection', 'Choose a connection')}</option>
              {(connections.data ?? []).map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('studio:payments.payables.table', 'Table')} className="min-w-[180px] flex-1">
            <Select value={draft.tableId} disabled={draft.connectionId === ''} onChange={(event) => setDraft({ ...draft, tableId: event.target.value, mapping: START })} data-testid="payments-wizard-table">
              <option value="">{t('studio:payments.payables.chooseTable', 'Choose a table')}</option>
              {tables.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.label ?? one.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <ol className="flex flex-wrap gap-3 text-[12.5px]">
          {steps.map((name, index) => (
            <li key={name} aria-current={step === index + 1 ? 'step' : undefined} className={step === index + 1 ? 'font-bold' : 'text-fg-muted'}>
              {index + 1}. {name}
            </li>
          ))}
        </ol>
        {table === undefined ? null : (
          <div className="flex flex-wrap gap-5">
            <div className="flex min-w-[300px] flex-[1_1_420px] flex-col gap-4">
              {step === 1 ? (
                <section className="flex flex-col gap-3" aria-label={steps[0]}>
                  <ColumnSelect
                    id="payments-wizard-amount"
                    testId="payments-wizard-amount"
                    label={t('studio:payments.payables.amount', 'Amount')}
                    columns={columns.filter((column) => NUMBERS.has(column.logicalType))}
                    value={mapping.amount.column}
                    onChange={(next) => set({ amount: { column: next, unit: null } })}
                    error={issueAt('amount')}
                  />
                  {needsUnit ? (
                    <fieldset className="flex flex-col gap-2 rounded-md bg-surface-2 p-3" data-testid="payments-wizard-unit">
                      <legend className="text-[12.5px] font-semibold">
                        {t('studio:payments.payables.unitQuestion', 'Is 12000 “twelve thousand” or “120.00”?')}
                      </legend>
                      <RadioGroup value={mapping.amount.unit ?? ''} onValueChange={(next) => set({ amount: { ...mapping.amount, unit: next === 'minor' ? 'minor' : 'units' } })}>
                        <Radio value="units" label={t('studio:payments.payables.wholeAmounts', 'Whole amounts')} description={t('studio:payments.payables.wholeHelp', '12000 is twelve thousand.')} />
                        <Radio value="minor" label={t('studio:payments.payables.cents', 'Cents')} description={t('studio:payments.payables.centsHelp', '12000 is one hundred and twenty.')} />
                      </RadioGroup>
                    </fieldset>
                  ) : null}
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-[12.5px] font-semibold">{t('studio:payments.payables.currency', 'Currency')}</legend>
                    <RadioGroup
                      value={draft.currencyKind}
                      onValueChange={(next) => {
                        const kind = next === 'column' ? 'column' : next === 'fixed' ? 'fixed' : 'connection';
                        setDraft({ ...draft, currencyKind: kind, mapping: { ...mapping, currency: kind === 'connection' ? { connection: true } : kind === 'fixed' ? { fixed: 'EUR' } : { column: '' } } });
                      }}
                    >
                      <Radio value="connection" label={t('studio:payments.payables.currencyConnection', "The connection's currency")} />
                      <Radio value="column" label={t('studio:payments.payables.currencyColumn', 'From a column')} />
                      <Radio value="fixed" label={t('studio:payments.payables.currencyFixed', 'Always one currency')} />
                    </RadioGroup>
                    {'column' in mapping.currency ? (
                      <ColumnSelect id="payments-wizard-currency" label={t('studio:payments.payables.currencyColumnLabel', 'Currency column')} columns={columns.filter((column) => !NUMBERS.has(column.logicalType))} value={mapping.currency.column} onChange={(next) => set({ currency: { column: next } })} />
                    ) : null}
                    {'fixed' in mapping.currency ? (
                      <FormField label={t('studio:payments.payables.currencyCode', 'Currency code')}>
                        <Input dir="ltr" className="w-28 font-mono uppercase" maxLength={3} value={mapping.currency.fixed} onChange={(event) => set({ currency: { fixed: event.target.value.toUpperCase() } })} />
                      </FormField>
                    ) : null}
                    {issueAt('currency') !== null ? <p className="text-[12.5px] text-danger">{issueAt('currency')}</p> : null}
                  </fieldset>
                  <ColumnSelect id="payments-wizard-label" label={t('studio:payments.payables.label', 'The number the customer knows it by')} columns={columns.filter((column) => !isPersonal(column))} value={mapping.label ?? ''} onChange={(next) => set({ label: next === '' ? null : next })} error={issueAt('label')} />
                </section>
              ) : null}
              {step === 2 ? (
                <section className="flex flex-col gap-3" aria-label={steps[1]}>
                  <RadioGroup
                    aria-label={steps[1]}
                    value={own === null ? 'kept' : 'table'}
                    onValueChange={(next) => set(next === 'table' ? { payments: OWN_START } : { payments: { kind: 'kept' }, due: null })}
                  >
                    <Radio value="kept" label={t('studio:payments.payables.kept', 'Adminium keeps the payments')} description={t('studio:payments.payables.keptHelp', 'Adminium records each payment against its row. Your tables stay as they are.')} />
                    <Radio value="table" label={t('studio:payments.payables.own', 'This table has its own payments table')} description={t('studio:payments.payables.ownHelp', 'Each payment is written as a row in a table you choose.')} />
                  </RadioGroup>
                  {own !== null ? (
                    <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-3" data-testid="payments-wizard-own">
                      <FormField label={t('studio:payments.payables.paymentsTable', 'Payments table')} required>
                        <Select value={own.table} onChange={(event) => setOwn({ ...OWN_START, table: event.target.value })} data-testid="payments-wizard-own-table">
                          <option value="">{t('studio:payments.payables.chooseTable', 'Choose a table')}</option>
                          {tables.filter((one) => one.id !== draft.tableId).map((one) => (
                            <option key={one.id} value={one.id}>
                              {one.label ?? one.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      {paymentsTable !== undefined ? (
                        <>
                          <ColumnSelect id="payments-wizard-own-link" required label={t('studio:payments.payables.link', 'The column naming the record')} columns={paymentsTable.columns} value={own.link} onChange={(next) => setOwn({ link: next })} error={issueAt('payments.link')} />
                          <ColumnSelect id="payments-wizard-own-amount" required label={t('studio:payments.payables.amount', 'Amount')} columns={paymentsTable.columns.filter((column) => NUMBERS.has(column.logicalType))} value={own.amount} onChange={(next) => setOwn({ amount: next })} error={issueAt('payments.amount')} />
                          <ColumnSelect id="payments-wizard-own-date" required label={t('studio:payments.payables.date', 'Date')} columns={paymentsTable.columns} value={own.date} onChange={(next) => setOwn({ date: next })} error={issueAt('payments.date')} />
                          <ColumnSelect id="payments-wizard-own-method" required label={t('studio:payments.payables.wayToPay', 'Way to pay')} columns={paymentsTable.columns} value={own.method.column} onChange={(next) => setOwn({ method: { ...own.method, column: next } })} error={issueAt('payments.method')} />
                          {own.method.column !== '' ? (
                            <fieldset className="flex flex-col gap-2">
                              <legend className="text-[12.5px] font-semibold">{t('studio:payments.payables.methodValues', 'What each way to pay is written as')}</legend>
                              {METHOD_KEYS.map((key) => (
                                <FormField key={key} label={methodKeyLabel(key)}>
                                  <Input value={own.method.values[key] ?? ''} onChange={(event) => {
                                    const values = { ...own.method.values };
                                    if (event.target.value.trim() === '') delete values[key];
                                    else values[key] = event.target.value;
                                    setOwn({ method: { ...own.method, values } });
                                  }} />
                                </FormField>
                              ))}
                            </fieldset>
                          ) : null}
                          <ColumnSelect id="payments-wizard-own-note" label={t('studio:payments.payables.note', 'Note')} columns={paymentsTable.columns} value={own.note ?? ''} onChange={(next) => setOwn({ note: next === '' ? null : next })} />
                          <ColumnSelect id="payments-wizard-own-voided" label={t('studio:payments.payables.voided', 'Voided flag')} columns={paymentsTable.columns.filter((column) => column.logicalType === 'boolean')} value={own.voided ?? ''} onChange={(next) => setOwn({ voided: next === '' ? null : next })} />
                          <ColumnSelect
                            id="payments-wizard-own-reference"
                            testId="payments-wizard-own-reference"
                            required
                            label={t('studio:payments.payables.unique', 'Unique for each payment')}
                            columns={paymentsTable.columns}
                            value={own.reference}
                            onChange={(next) => setOwn({ reference: next })}
                            error={issueAt('payments.reference') ?? (own.reference === '' ? t('studio:payments.payables.issue.unique', 'Choose the column that is unique for each payment.') : null)}
                          />
                          <p className="text-[12px] text-fg-muted">{t('studio:payments.payables.uniqueHelp', 'Adminium uses it so a payment is never written twice.')}</p>
                          <FormField label={t('studio:payments.payables.ownUnit', 'The payments table counts')}>
                            <Select value={own.amountUnit} onChange={(event) => setOwn({ amountUnit: event.target.value === 'minor' ? 'minor' : 'units' })}>
                              <option value="units">{t('studio:payments.payables.wholeAmounts', 'Whole amounts')}</option>
                              <option value="minor">{t('studio:payments.payables.cents', 'Cents')}</option>
                            </Select>
                          </FormField>
                        </>
                      ) : null}
                      <ColumnSelect
                        id="payments-wizard-due"
                        required
                        label={t('studio:payments.payables.balance', 'Balance column of {table}', { table: table.name })}
                        columns={columns.filter((column) => NUMBERS.has(column.logicalType))}
                        value={mapping.due?.column ?? ''}
                        onChange={(next) => set({ due: next === '' ? null : { column: next } })}
                        error={issueAt('due') ?? (mapping.due === null ? t('studio:payments.payables.balanceNeeded', 'A table that keeps its own payments names its balance, or a paid record would read as still owed.') : null)}
                      />
                    </div>
                  ) : null}
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-[12.5px] font-semibold">{t('studio:payments.payables.optional', 'Optional')}</legend>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="payments-wizard-status-on"
                        checked={draft.statusOn}
                        onCheckedChange={(checked) => setDraft({ ...draft, statusOn: checked === true, mapping: { ...mapping, status: checked === true ? { column: '', paid: '', refunded: null } : null } })}
                      />
                      <label htmlFor="payments-wizard-status-on" className="text-[13px]">
                        {t('studio:payments.payables.statusPaid', 'When it is paid in full, set Status to')}
                      </label>
                    </div>
                    {mapping.status !== null ? (
                      <div className="flex flex-col gap-2 ps-6">
                        <ColumnSelect id="payments-wizard-status" label={t('studio:payments.payables.statusColumn', 'Status column')} columns={columns.filter((column) => !isPersonal(column) && column.isPrimaryKey !== true)} value={mapping.status.column} onChange={(next) => set({ status: { column: next, paid: '', refunded: null } })} error={issueAt('status')} />
                        {statusValues !== null ? (
                          <>
                            <FormField label={t('studio:payments.payables.statusPaidValue', 'Value when paid in full')}>
                              <Select value={mapping.status.paid} onChange={(event) => mapping.status !== null && set({ status: { ...mapping.status, paid: event.target.value } })}>
                                <option value="">{t('studio:payments.ways.choose', 'Choose…')}</option>
                                {statusValues.map((value) => (
                                  <option key={value} value={value}>
                                    {value}
                                  </option>
                                ))}
                              </Select>
                            </FormField>
                            <FormField label={t('studio:payments.payables.statusRefunded', 'When it is refunded in full, set Status to')}>
                              <Select value={mapping.status.refunded ?? ''} onChange={(event) => mapping.status !== null && set({ status: { ...mapping.status, refunded: event.target.value === '' ? null : event.target.value } })}>
                                <option value="">{t('studio:payments.payables.leaveAsIs', 'Leave it as it is')}</option>
                                {statusValues.map((value) => (
                                  <option key={value} value={value}>
                                    {value}
                                  </option>
                                ))}
                              </Select>
                            </FormField>
                          </>
                        ) : mapping.status.column !== '' ? (
                          <FormField label={t('studio:payments.payables.statusPaidValue', 'Value when paid in full')}>
                            <Input value={mapping.status.paid} onChange={(event) => mapping.status !== null && set({ status: { ...mapping.status, paid: event.target.value } })} />
                          </FormField>
                        ) : null}
                      </div>
                    ) : null}
                  </fieldset>
                </section>
              ) : null}
              {step === 3 ? (
                <section className="flex flex-col gap-3" aria-label={steps[2]}>
                  <fieldset className="flex flex-col gap-2" data-testid="payments-wizard-fields">
                    <legend className="text-[12.5px] font-semibold">{t('studio:payments.payables.pageFields', 'Columns allowed on the pay page')}</legend>
                    {columns.map((column) => {
                      const personal = isPersonal(column);
                      const id = `payments-wizard-field-${column.name}`;
                      return (
                        <div key={column.name} className="flex items-center gap-2">
                          <Checkbox
                            id={id}
                            aria-disabled={personal ? 'true' : undefined}
                            aria-describedby={personal ? `${id}-why` : undefined}
                            checked={!personal && mapping.pageFields.includes(column.name)}
                            onCheckedChange={(checked) => {
                              if (personal) return;
                              set({ pageFields: checked === true ? [...mapping.pageFields, column.name] : mapping.pageFields.filter((one) => one !== column.name) });
                            }}
                          />
                          <label htmlFor={id} className="text-[13px]">
                            {column.name}
                          </label>
                          {personal ? (
                            <span id={`${id}-why`} className="flex items-center gap-1 text-[12px] text-fg-muted">
                              <Lock className="size-3" aria-hidden="true" />
                              {t('studio:payments.payables.personal', 'Personal: never shown')}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                    <p className="text-[11.5px] text-fg-muted">{t('studio:payments.payables.amountShown', 'The amount and currency are always shown.')}</p>
                    {issueAt('pageFields') !== null ? <p className="text-[12.5px] text-danger">{issueAt('pageFields')}</p> : null}
                  </fieldset>
                  <ColumnSelect id="payments-wizard-email" label={t('studio:payments.payables.email', 'Customer email (for sending the pay link)')} columns={columns} value={mapping.customerEmail ?? ''} onChange={(next) => set({ customerEmail: next === '' ? null : next })} />
                  <ColumnSelect id="payments-wizard-country" label={t('studio:payments.payables.country', 'Customer country')} columns={columns} value={mapping.customerCountry ?? ''} onChange={(next) => set({ customerCountry: next === '' ? null : next })} />
                  <p className="text-[12px] text-fg-muted">{t('studio:payments.payables.countryHelp', 'Used by the rules on Ways to pay.')}</p>
                </section>
              ) : null}
            </div>
            <aside className="flex min-w-[260px] flex-[1_1_340px] flex-col gap-2 rounded-md bg-surface-2 p-3" aria-label={t('studio:payments.payables.preview', 'Preview')} data-testid="payments-wizard-preview">
              <h3 className="text-[13px] font-bold">{t('studio:payments.payables.preview', 'Preview')}</h3>
              <p className="text-[12px] text-fg-muted">{t('studio:payments.payables.previewOf', 'Three rows from {table}', { table: table.name })}</p>
              <p aria-live="polite" className="sr-only">
                {check.data === undefined ? '' : t('studio:payments.payables.previewSummary', '{count, plural, one {# problem} other {# problems}}', { count: issues.length })}
              </p>
              {!ready ? <p className="text-[12.5px] text-fg-muted">{t('studio:payments.payables.previewWaiting', 'Choose the amount to see three rows.')}</p> : null}
              {check.isError ? <p className="text-[12.5px] text-danger">{errorText(check.error)}</p> : null}
              {ready && check.data !== undefined && issues.length === 0 && !check.data.mayMark.ok ? (
                <p className="text-[12.5px] text-fg-muted" data-testid="payments-wizard-preview-hidden">
                  {t('studio:payments.payables.previewHidden', 'Rows are shown only to someone who may set this table up.')}
                </p>
              ) : null}
              {issues.length > 0 ? (
                <ul className="flex flex-col gap-1 text-[12.5px] text-danger" data-testid="payments-wizard-issues">
                  {issues.map((issue) => (
                    <li key={`${issue.code}-${issue.path}-${issue.column ?? ''}`}>{issueSentence(issue)}</li>
                  ))}
                </ul>
              ) : null}
              <ul className="flex flex-col gap-1">
                {(check.data?.preview ?? []).map((row) => (
                  <li key={row.rowKey} className="text-[12.5px]">
                    <span dir="ltr" className="font-mono">
                      {row.label}
                    </span>{' '}
                    →{' '}
                    {row.refusal === null ? (
                      <span dir="ltr" className="font-mono">
                        {money(row.due, row.currency)} {row.currency}
                      </span>
                    ) : (
                      <span className="text-fg-muted">{row.refusal.message}</span>
                    )}
                    {mapping.status !== null && mapping.status.paid !== '' && row.refusal === null ? (
                      <span className="text-fg-muted"> → {t('studio:payments.payables.becomes', 'when paid, {column} becomes {value}', { column: mapping.status.column, value: mapping.status.paid })}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        )}
        {refusal !== null ? (
          <p className="text-[12.5px] font-semibold" data-testid="payments-wizard-refusal">
            {refusal}
          </p>
        ) : null}
        {savedIssues !== null ? (
          <ul role="alert" className="flex flex-col gap-1 text-[12.5px] text-danger">
            {savedIssues.map((issue) => (
              <li key={`${issue.code}-${issue.path}`}>{issueSentence(issue)}</li>
            ))}
          </ul>
        ) : save.isError ? (
          <Alert tone="danger" role="alert" title={errorText(save.error)} />
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" aria-disabled={step === 1 ? 'true' : undefined} onClick={() => step > 1 && setStep(step - 1)}>
            {t('studio:payments.payables.back', 'Back')}
          </Button>
          <span className="text-[12.5px] text-fg-muted">{t('studio:payments.payables.stepOf', 'Step {step} of 3', { step })}</span>
          {step < 3 ? (
            <Button aria-disabled={stepBlocked(step) ? 'true' : undefined} data-testid="payments-wizard-next" onClick={() => !stepBlocked(step) && setStep(step + 1)}>
              {t('studio:payments.payables.next', 'Next')}
            </Button>
          ) : (
            <Button
              aria-disabled={stepBlocked(3) || refusal !== null || save.isPending ? 'true' : undefined}
              data-testid="payments-wizard-save"
              onClick={() => !(stepBlocked(3) || refusal !== null || save.isPending) && save.mutate()}
            >
              {t('studio:payments.payables.turnOn', 'Turn on payments')}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// ─── The list ───────────────────────────────────────────────────────────────

function ProfileRow({ profile, canManage, tableName }: { profile: PayableProfileView; canManage: boolean; tableName: string }) {
  const client = useQueryClient();
  const [stopping, setStopping] = useState(false);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => patchPayable(profile.id, { enabled }),
    onSuccess: async () => client.invalidateQueries({ queryKey: PAYMENTS_PAYABLES_QUERY_KEY }),
  });
  const stop = useMutation({
    mutationFn: () => stopPayable(profile.id),
    onSuccess: async () => {
      setStopping(false);
      await client.invalidateQueries({ queryKey: PAYMENTS_PAYABLES_QUERY_KEY });
    },
  });
  return (
    <tr className="border-t border-border" data-testid={`payments-payable-${profile.id}`}>
      <td className="py-2 pe-3 text-[13px] font-semibold">{tableName}</td>
      <td className="py-2 pe-3">
        {!profile.valid ? (
          <Badge tone="warn">{t('studio:payments.payables.needsSaving', 'Needs setting up again')}</Badge>
        ) : (
          <Badge tone={profile.enabled ? 'pos' : 'neutral'}>{profile.enabled ? t('studio:payments.payables.on', 'Can be paid') : t('studio:payments.payables.paused', 'Paused')}</Badge>
        )}
        <span className="ms-2 text-[12px] text-fg-muted">{profile.payments === 'table' ? t('studio:payments.payables.intoOwn', 'Into its own payments table') : t('studio:payments.payables.keptShort', 'Adminium keeps the payments')}</span>
      </td>
      <td className="py-2 text-end">
        {canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Switch aria-label={t('studio:payments.payables.pauseLabel', 'Payments for {table}', { table: tableName })} checked={profile.enabled} disabled={toggle.isPending || !profile.valid} onCheckedChange={(next) => toggle.mutate(next)} />
            <Button variant="secondary" size="sm" onClick={() => setStopping(true)}>
              {t('studio:payments.payables.stop', 'Stop')}
            </Button>
          </div>
        ) : null}
        <Modal open={stopping} onOpenChange={(open) => (open ? null : setStopping(false))}>
          <ModalHeader title={t('studio:payments.payables.stopTitle', 'Stop payments for {table}?', { table: tableName })} closeLabel={t('studio:payments.close', 'Close')} />
          <ModalBody>
            <p className="text-[13px]">{t('studio:payments.payables.stopBody', 'Its rows can no longer be paid, and pay links already sent for them stop working. Payments already made stay recorded.')}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setStopping(false)}>
              {t('studio:payments.payables.keep', 'Keep it payable')}
            </Button>
            <Button disabled={stop.isPending} onClick={() => stop.mutate()} data-testid="payments-payable-stop-confirm">
              {t('studio:payments.payables.stop', 'Stop')}
            </Button>
          </ModalFooter>
        </Modal>
        {toggle.isError || stop.isError ? <p role="alert" className="text-[12.5px] text-danger">{errorText(toggle.error ?? stop.error)}</p> : null}
      </td>
    </tr>
  );
}

export function PayablesTab({ canManage }: { canManage: boolean }): ReactNode {
  const list = useQuery(paymentsPayablesQuery());
  const [wizard, setWizard] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (list.isPending) return <p className="text-[13px] text-fg-muted">{t('studio:payments.loading', 'Loading…')}</p>;
  if (list.isError) return <Alert tone="danger" role="alert" title={errorText(list.error)} />;
  const { profiles, shapes } = list.data;
  return (
    <div className="flex flex-col gap-5" data-testid="payments-payables">
      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <IconTile icon={<Table2 />} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14.5px] font-bold">{t('studio:payments.payables.title', 'What can be paid')}</h2>
            <p className="text-[12.5px] text-fg-muted">{t('studio:payments.payables.intro', 'Customers can pay a row from these tables with a pay link.')}</p>
          </div>
          {canManage && !wizard ? (
            <Button onClick={() => { setDone(null); setWizard(true); }} data-testid="payments-payables-set-up">
              {t('studio:payments.payables.setUp', 'Set up a table')}
            </Button>
          ) : null}
        </CardHeader>
        <CardBody>
          <p role="status" className="text-[12.5px]" data-testid="payments-payables-done">
            {done === null ? null : t('studio:payments.payables.done', '{table} can be paid now.', { table: done })}
          </p>
          {shapes.length === 0 && profiles.length === 0 ? (
            <p className="text-[13px] text-fg-muted" data-testid="payments-payables-empty">{t('studio:payments.payables.empty', 'No table can be paid yet. Set one up, or install an app built on the invoice format.')}</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-[12px] text-fg-muted">
                  <th className="py-1 pe-3 text-start font-semibold">{t('studio:payments.payables.table', 'Table')}</th>
                  <th className="py-1 pe-3 text-start font-semibold">{t('studio:payments.payables.canBePaid', 'Can be paid')}</th>
                  <th className="py-1 text-end font-semibold">{t('studio:payments.payables.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {shapes.map((shape) => (
                  <tr key={`${shape.connectionId}:${shape.tableName}`} className="border-t border-border" data-testid={`payments-shape-${shape.tableName}`}>
                    <td className="py-2 pe-3 text-[13px] font-semibold">{shortName(shape.tableName)}</td>
                    <td className="py-2 pe-3">
                      <Badge tone="pos">{t('studio:payments.payables.ready', 'Ready')}</Badge>
                      <span className="ms-2 text-[12px] text-fg-muted">
                        {shape.version >= 2
                          ? t('studio:payments.payables.builtOn', 'Built on the invoice format')
                          : t('studio:payments.payables.needsUpdate', 'Built on the invoice format. Online payments need the app’s update; payments by hand work.')}
                      </span>
                    </td>
                    <td />
                  </tr>
                ))}
                {profiles.map((profile) => (
                  <ProfileRow key={profile.id} profile={profile} canManage={canManage} tableName={shortName(profile.tableName)} />
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      {wizard ? (
        <Wizard
          onClose={() => setWizard(false)}
          onDone={(table) => {
            setWizard(false);
            setDone(table);
          }}
        />
      ) : null}
    </div>
  );
}

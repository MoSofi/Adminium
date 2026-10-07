// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RECORD'S TAB OF AN ADD-ON'S ROWS — the stock links of a dish, the cards
 * used on an order — listed and edited where their owner is looked at.
 *
 * The rows are the add-on's own, found by a pair each one stores: the stored
 * name of this record's table and this record's key. Everything here goes
 * through the ordinary data routes, as the reader's own grants allow: a cell
 * of an editable column is saved on Enter or on leaving it, and a refusal
 * stays on the cell with what was typed; "Add" picks a row of the table the
 * tab links to and makes a row for this record; removing one can be undone.
 * Where a table is itself the row asked about, the one row is a small form.
 *
 * The line above the rows is the add-on's own stock words for this record,
 * said only from what the answer carries: a reader who is not shown the
 * figure sees the word alone.
 */
import { Alert, Badge, Button, Combobox, Input, Modal, ModalBody, ModalFooter, ModalHeader, Select, Spinner, Switch } from '@adminium/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import { fieldIssueMessage, isDeletePreview } from '@adminium/widgets';

import { api } from '../app/api.js';
import { createCrudApi, FieldRefusedError } from '../api/crud.js';
import type { FormColumnFactReply, RecordTabFact } from '../api/pages.js';
import { t } from '../i18n/t.js';
import { useUndoToast } from '../pages/toasts.js';
import { addOnWords } from './messages.js';

type Row = Record<string, unknown>;

export interface WordsAnswer {
  id: string;
  state: 'in' | 'low' | 'out';
  left?: number;
  exact?: string;
  first?: { item: string; unit: string };
  soon?: true;
}

const PAGE = 10;
const nameOf = (fact: FormColumnFactReply): string => String(fact.spec.name ?? '');
const labelOf = (fact: FormColumnFactReply): string => (typeof fact.spec['label'] === 'string' && fact.spec['label'] !== '' ? fact.spec['label'] : nameOf(fact));

type Kind = 'choice' | 'switch' | 'number' | 'text';
function choicesOf(fact: FormColumnFactReply): { value: string; label: string }[] | null {
  if (fact.options !== undefined && 'values' in fact.options) return fact.options.values.map((one) => ({ value: one.value, label: one.label ?? one.value }));
  const values = fact.spec['enumValues'];
  if (Array.isArray(values)) return values.map((value) => ({ value: String(value), label: fact.enumLabels?.[String(value)] ?? String(value) }));
  return null;
}
function kindOf(fact: FormColumnFactReply): Kind {
  if (choicesOf(fact) !== null) return 'choice';
  const type = String(fact.spec['logicalType'] ?? 'text');
  if (type === 'boolean') return 'switch';
  return type === 'integer' || type === 'bigint' || type === 'decimal' || type === 'float' ? 'number' : 'text';
}
const shown = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** What a refused write said: of this column when it names one, else of the write as a whole. */
function refusalOf(caught: unknown, column: string): string {
  if (caught instanceof FieldRefusedError) {
    const said = caught.fieldIssues[column] ?? Object.values(caught.fieldIssues)[0];
    if (said !== undefined) return fieldIssueMessage(t, said as never);
  }
  return caught instanceof Error ? caught.message : String(caught);
}

/** One value's control, as its column says: a number, one of a list, a switch, or text. */
function ValueControl({ fact, value, onChange, onCommit, disabled, invalid, describedBy }: { fact: FormColumnFactReply; value: unknown; onChange: (next: unknown) => void; onCommit?: (next: unknown) => void; disabled?: boolean; invalid?: boolean; describedBy?: string }): ReactNode {
  const kind = kindOf(fact);
  const label = labelOf(fact);
  const aria = { 'aria-label': label, ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }) };
  if (kind === 'switch') {
    return (
      <Switch
        {...aria}
        checked={value === true || value === 1 || value === '1' || value === 'true'}
        disabled={disabled}
        onCheckedChange={(next) => {
          onChange(next);
          onCommit?.(next);
        }}
      />
    );
  }
  if (kind === 'choice') {
    return (
      <Select
        {...aria}
        value={shown(value)}
        disabled={disabled}
        error={invalid === true}
        onChange={(event) => {
          onChange(event.target.value);
          onCommit?.(event.target.value);
        }}
      >
        {fact.required ? null : <option value="" />}
        {(choicesOf(fact) ?? []).map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      {...aria}
      value={shown(value)}
      disabled={disabled}
      error={invalid === true}
      inputMode={kind === 'number' ? 'decimal' : 'text'}
      dir={kind === 'number' ? 'ltr' : undefined}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onCommit?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit?.((event.target as HTMLInputElement).value);
      }}
    />
  );
}

/** A cell that is edited where it stands: saved on Enter or on leaving it; a refusal stays with what was typed. */
function EditCell({ fact, row, onSave }: { fact: FormColumnFactReply; row: Row; onSave: (value: unknown) => Promise<void> }): ReactNode {
  const name = nameOf(fact);
  const [typed, setTyped] = useState<unknown>(undefined);
  const [refused, setRefused] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stored = row[name];
  const value = typed === undefined ? stored : typed;
  const noteId = `linked-refusal-${String(row['__key'])}-${name}`;
  const commit = (next: unknown): void => {
    if (saving || shown(next) === shown(stored)) {
      if (refused === null) setTyped(undefined);
      return;
    }
    setSaving(true);
    onSave(next)
      .then(() => {
        setRefused(null);
        setTyped(undefined);
      })
      .catch((caught: unknown) => {
        // What was typed stays in the cell, with why it was not kept.
        setTyped(next);
        setRefused(refusalOf(caught, name));
      })
      .finally(() => setSaving(false));
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <ValueControl
        fact={fact}
        value={value}
        disabled={saving}
        invalid={refused !== null}
        {...(refused === null ? {} : { describedBy: noteId })}
        onChange={(next) => {
          setTyped(next);
          setRefused(null);
        }}
        onCommit={commit}
      />
      {refused === null ? null : (
        <p id={noteId} role="alert" className="text-[12px] text-danger">
          {refused}
        </p>
      )}
    </div>
  );
}

/** The add-on's stock words for this record, said only from what the answer carries. */
export function summaryWords(answer: WordsAnswer, mode: 'list' | 'form'): { line: string; first: string | null; soon: boolean } {
  const state = answer.state === 'out' ? t('ui:pages.linked.out', 'Out') : answer.state === 'low' ? t('ui:pages.linked.low', 'Low') : t('ui:pages.linked.in', 'In stock');
  // A reader who is not shown the figure sees the word alone.
  if (answer.exact === undefined) return { line: state, first: null, soon: false };
  const line =
    mode === 'form' && answer.first !== undefined
      ? t('ui:pages.linked.onHand', '{exact} {unit} on hand', { exact: answer.exact, unit: answer.first.unit })
      : mode === 'form'
        ? t('ui:pages.linked.onHandBare', '{exact} on hand', { exact: answer.exact })
        : t('ui:pages.linked.enough', 'Enough for {exact} more', { exact: answer.exact });
  return { line, first: mode === 'list' && answer.first !== undefined ? t('ui:pages.linked.first', '{item} runs out first', { item: answer.first.item }) : null, soon: answer.soon === true };
}

export interface LinkedRowsTabProps {
  tab: RecordTabFact;
  connectionId: string;
  /** The key of the record the page shows. */
  recordId: string;
}

export default function LinkedRowsTab({ tab, connectionId, recordId }: LinkedRowsTabProps): ReactNode {
  const crud = useMemo(() => createCrudApi(connectionId, tab.tableId), [connectionId, tab.tableId]);
  const queryClient = useQueryClient();
  const undoToast = useUndoToast();
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState<number | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** The pair every row of this record carries: which table, which row. */
  const pair = useMemo(() => ({ [tab.match.table]: tab.match.tableRef, [tab.match.row]: recordId }), [tab.match, recordId]);
  const rowsKey = useMemo(() => ['data', connectionId, tab.tableId, 'linked', tab.match.tableRef, recordId] as const, [connectionId, tab.tableId, tab.match.tableRef, recordId]);

  const rows = useQuery({
    queryKey: [...rowsKey, page],
    queryFn: () =>
      crud.list({
        where: { and: [{ column: tab.match.table, op: 'eq', value: tab.match.tableRef }, { column: tab.match.row, op: 'eq', value: recordId }] },
        // What a picked row is called, beside its key.
        lookup: tab.add.map((pick) => `${pick.fk}__label:${pick.fk}.${pick.label}`),
        order: [{ column: tab.key, dir: 'asc' }],
        limit: PAGE,
        offset: page * PAGE,
        count: 'exact',
      }),
  });
  const list = rows.data?.data ?? [];
  const total = rows.data?.page?.total ?? list.length;
  const words = useQuery({
    queryKey: ['words', tab.addOn, tab.summary?.words ?? '', tab.match.tableRef, recordId],
    // Said of a record that has something linked; a record with nothing has nothing to say.
    enabled: tab.summary !== null && list.length > 0,
    queryFn: async () => {
      const search = new URLSearchParams({ table: tab.match.tableRef, ids: recordId });
      const reply = await api.get<{ data: WordsAnswer[] }>(`/api/v1/words/${encodeURIComponent(tab.addOn)}/${encodeURIComponent(tab.summary?.words ?? '')}?${search.toString()}`);
      return reply.data[0] ?? null;
    },
  });
  const changed = (): void => {
    void queryClient.invalidateQueries({ queryKey: rowsKey });
    void queryClient.invalidateQueries({ queryKey: ['words', tab.addOn] });
  };
  const keyOf = (row: Row): string => String(row[tab.key]);
  const display = (row: Row, fact: FormColumnFactReply): string => {
    const name = nameOf(fact);
    const label = row[`${name}__label`];
    if (label !== null && label !== undefined && label !== '') return String(label);
    const choice = choicesOf(fact)?.find((one) => one.value === shown(row[name]));
    return choice?.label ?? shown(row[name]);
  };
  const run = (work: Promise<unknown>): void => {
    setFailed(null);
    work.then(changed).catch((caught: unknown) => setFailed(caught instanceof Error ? caught.message : String(caught)));
  };
  const remove = (row: Row): void => {
    setFailed(null);
    crud
      .remove(keyOf(row), { confirm: true })
      .then((reply) => {
        changed();
        undoToast({ title: t('ui:pages.linked.removed', 'Removed'), undoToken: isDeletePreview(reply) ? null : reply.undoToken, onUndone: changed });
      })
      .catch((caught: unknown) => setFailed(caught instanceof Error ? caught.message : String(caught)));
  };

  const editable = new Set(tab.can.update ? tab.edit : []);
  const mayAdd = tab.can.create && (tab.add.length > 0 || tab.mode === 'form');
  const summary = words.data === null || words.data === undefined || list.length === 0 ? null : summaryWords(words.data, tab.mode);
  const emptyWords = addOnWords(tab.addOn, tab.emptyKey, tab.empty ?? t('ui:pages.linked.empty', 'Nothing is linked yet.'));

  const head = (
    <div className="flex flex-wrap items-center gap-2" data-part="linked-head">
      {summary === null ? null : (
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-muted" data-part="linked-summary">
          <span className="font-semibold text-fg">{summary.line}</span>
          {summary.first === null ? null : <span>{summary.first}</span>}
          {summary.soon ? <Badge tone="warn">{t('ui:pages.linked.soon', 'Expires soon')}</Badge> : null}
        </p>
      )}
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {tab.actions
          .filter((action) => action.can)
          .map((action) => (
            <Button key={action.id} size="sm" variant="secondary" onClick={() => setActing(action.id)}>
              {addOnWords(tab.addOn, action.labelKey, action.label)}
            </Button>
          ))}
        {mayAdd && (tab.mode === 'list' || list.length === 0) ? (
          <Button
            size="sm"
            onClick={() => {
              // A row that is the record's one row, with nothing to pick: made as it is asked for.
              if (tab.add.length === 0) run(crud.create({ ...pair }));
              else setAdding(tab.add.length === 1 ? 0 : -1);
            }}
          >
            {t('ui:pages.linked.add', 'Add')}
          </Button>
        ) : null}
      </div>
    </div>
  );

  const picker =
    adding === null ? null : (
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-2 p-3" data-part="linked-add">
        {adding === -1 ? (
          <div role="group" aria-label={t('ui:pages.linked.which', 'What do you want to add?')} className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-fg-muted">{t('ui:pages.linked.which', 'What do you want to add?')}</span>
            {tab.add.map((pick, index) => (
              <Button key={pick.fk} size="sm" variant="secondary" onClick={() => setAdding(index)}>
                {labelOf(tab.columns.find((fact) => nameOf(fact) === pick.fk) ?? { spec: { name: pick.fk }, filledBy: null, required: false, writable: true })}
              </Button>
            ))}
          </div>
        ) : (
          <PickOne
            connectionId={connectionId}
            pick={tab.add[adding]!}
            onPicked={(value) => {
              const pick = tab.add[adding]!;
              setAdding(null);
              // The pair is this record's, whatever was picked: the picked row only says WHAT is linked.
              run(crud.create({ [pick.fk]: value, ...pair }));
            }}
          />
        )}
        <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
          {t('ui:pages.record.cancel', 'Cancel')}
        </Button>
      </div>
    );

  const action = tab.actions.find((one) => one.id === acting);
  return (
    <div className="flex flex-col gap-3" data-testid={`linked-rows-${tab.id}`}>
      {head}
      {failed === null ? null : <Alert tone="danger" title={failed} />}
      {picker}
      {rows.isPending ? (
        <Spinner label={t('ui:pages.linked.loading', 'Loading…')} />
      ) : rows.isError ? (
        <Alert tone="danger" title={t('ui:pages.linked.failed', 'This could not be loaded.')} />
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-fg-muted" data-part="linked-empty">
          {emptyWords}
        </p>
      ) : tab.mode === 'form' ? (
        <OneRow tab={tab} row={list[0]!} editable={editable} display={display} onSave={(name, value) => crud.update(keyOf(list[0]!), { [name]: value }).then(changed)} {...(tab.remove && tab.can.delete ? { onRemove: () => remove(list[0]!) } : {})} />
      ) : (
        <>
          <table className="w-full border-separate border-spacing-0 text-[13px] max-[760px]:block" data-part="linked-table">
            <thead className="max-[760px]:hidden">
              <tr>
                {tab.columns.map((fact) => (
                  <th key={nameOf(fact)} scope="col" className="border-b border-border px-3 py-2 text-start text-[11.5px] font-bold uppercase tracking-[0.04em] text-fg-subtle">
                    {labelOf(fact)}
                  </th>
                ))}
                {tab.remove && tab.can.delete ? <th scope="col" className="border-b border-border px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="max-[760px]:flex max-[760px]:flex-col max-[760px]:gap-2">
              {list.map((row) => (
                // Under 760 px each row is a card: its cells one under the other, each with its column's name.
                <tr key={keyOf(row)} data-row={keyOf(row)} className="max-[760px]:flex max-[760px]:flex-col max-[760px]:gap-2 max-[760px]:rounded-xl max-[760px]:border max-[760px]:border-border max-[760px]:p-3">
                  {tab.columns.map((fact) => (
                    <td key={nameOf(fact)} className="border-b border-border px-3 py-2 align-top max-[760px]:border-0 max-[760px]:p-0">
                      <span className="mb-1 hidden text-[11.5px] font-bold uppercase tracking-[0.04em] text-fg-subtle max-[760px]:block">{labelOf(fact)}</span>
                      {editable.has(nameOf(fact)) ? (
                        <EditCell fact={fact} row={{ ...row, __key: keyOf(row) }} onSave={(value) => crud.update(keyOf(row), { [nameOf(fact)]: value }).then(changed)} />
                      ) : (
                        <span className="break-words">{display(row, fact)}</span>
                      )}
                    </td>
                  ))}
                  {tab.remove && tab.can.delete ? (
                    <td className="border-b border-border px-3 py-2 text-end align-top max-[760px]:border-0 max-[760px]:p-0">
                      <Button size="sm" variant="ghost" onClick={() => remove(row)}>
                        {t('ui:pages.linked.remove', 'Remove')}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {total > PAGE ? (
            <div className="flex items-center justify-end gap-2 text-[12.5px] text-fg-muted" data-part="linked-pages">
              <span>{t('ui:pages.linked.range', '{from}–{to} of {total}', { from: page * PAGE + 1, to: page * PAGE + list.length, total })}</span>
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                {t('ui:pages.linked.previous', 'Previous')}
              </Button>
              <Button size="sm" variant="ghost" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>
                {t('ui:pages.linked.next', 'Next')}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {action === undefined ? null : (
        <ActionForm
          title={addOnWords(tab.addOn, action.labelKey, action.label)}
          fields={action.form}
          onClose={() => setActing(null)}
          onSubmit={async (values) => {
            // A row of the action's own table, for the same record.
            await createCrudApi(connectionId, action.tableId).create({ ...values, ...pair });
            setActing(null);
            changed();
          }}
        />
      )}
    </div>
  );
}

/** Picks one row of the table the tab links to. */
function PickOne({ connectionId, pick, onPicked }: { connectionId: string; pick: RecordTabFact['add'][number]; onPicked: (value: string) => void }): ReactNode {
  const options = useQuery({
    queryKey: ['data', connectionId, pick.table, 'pick', pick.label],
    queryFn: () => createCrudApi(connectionId, pick.table).lookup!({ table: pick.table, column: pick.key, display: pick.label }, ''),
  });
  return (
    <Combobox
      aria-label={t('ui:pages.linked.pick', 'Pick one')}
      placeholder={t('ui:pages.linked.pick', 'Pick one')}
      emptyText={options.isPending ? t('ui:pages.linked.loading', 'Loading…') : t('ui:pages.linked.nothing', 'Nothing to pick')}
      options={(options.data ?? []).map((option) => ({ value: option.value, label: option.label }))}
      onValueChange={(value) => {
        if (value !== null) onPicked(value);
      }}
    />
  );
}

/** The record's one row, as a small form: each value saved as it is changed. */
function OneRow({ tab, row, editable, display, onSave, onRemove }: { tab: RecordTabFact; row: Row; editable: ReadonlySet<string>; display: (row: Row, fact: FormColumnFactReply) => string; onSave: (name: string, value: unknown) => Promise<void>; onRemove?: () => void }): ReactNode {
  const fields = tab.form.flatMap((name) => tab.columns.find((fact) => nameOf(fact) === name) ?? []);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4" data-part="linked-form">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((fact) => (
          <div key={nameOf(fact)} className="flex min-w-0 flex-col gap-1">
            <dt className="text-[11.5px] font-bold uppercase tracking-[0.04em] text-fg-subtle">{labelOf(fact)}</dt>
            <dd>{editable.has(nameOf(fact)) ? <EditCell fact={fact} row={{ ...row, __key: String(row[tab.key]) }} onSave={(value) => onSave(nameOf(fact), value)} /> : <span className="break-words text-[13px]">{display(row, fact)}</span>}</dd>
          </div>
        ))}
      </dl>
      {onRemove === undefined ? null : (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onRemove}>
            {t('ui:pages.linked.remove', 'Remove')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A small form that makes one row: what a button of the tab asks for. */
function ActionForm({ title, fields, onClose, onSubmit }: { title: string; fields: readonly FormColumnFactReply[]; onClose: () => void; onSubmit: (values: Row) => Promise<void> }): ReactNode {
  const [values, setValues] = useState<Row>({});
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const submit = (): void => {
    const missing = fields.filter((fact) => fact.required && shown(values[nameOf(fact)]) === '');
    if (missing.length > 0) {
      setRefused(Object.fromEntries(missing.map((fact) => [nameOf(fact), t('ui:pages.record.fieldRequired', 'Fill this in first.')])));
      return;
    }
    setWorking(true);
    setFailed(null);
    onSubmit(values)
      .catch((caught: unknown) => {
        const asked = caught instanceof FieldRefusedError ? Object.entries(caught.fieldIssues).filter(([name]) => fields.some((fact) => nameOf(fact) === name)) : [];
        // A refusal of a value the form asked for stays on its field; anything else is said above the form.
        if (asked.length > 0) setRefused(Object.fromEntries(asked.map(([name, issue]) => [name, fieldIssueMessage(t, issue as never)])));
        else setFailed(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setWorking(false));
  };
  return (
    <Modal open size="sm" onOpenChange={(open) => (open ? undefined : onClose())}>
      <ModalHeader title={title} closeLabel={t('ui:pages.record.cancel', 'Cancel')} />
      <ModalBody>
        <form
          id="linked-action"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {failed === null ? null : <Alert tone="danger" title={failed} />}
          {fields.map((fact) => {
            const name = nameOf(fact);
            return (
              <label key={name} className="flex flex-col gap-1 text-[13px]">
                <span className="font-semibold">{labelOf(fact)}</span>
                <ValueControl
                  fact={fact}
                  value={values[name]}
                  invalid={refused[name] !== undefined}
                  {...(refused[name] === undefined ? {} : { describedBy: `linked-action-${name}` })}
                  onChange={(next) => {
                    setValues((held) => ({ ...held, [name]: next }));
                    setRefused(({ [name]: _gone, ...rest }) => rest);
                  }}
                />
                {refused[name] === undefined ? null : (
                  <span id={`linked-action-${name}`} role="alert" className="text-[12px] text-danger">
                    {refused[name]}
                  </span>
                )}
              </label>
            );
          })}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('ui:pages.record.cancel', 'Cancel')}
        </Button>
        <Button type="submit" form="linked-action" disabled={working}>
          {working ? t('ui:pages.record.working', 'Working…') : title}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

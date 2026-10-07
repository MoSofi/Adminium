// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LIST'S OWN BULK ACTION — one an app's manifest declares: one row of a
 * child table for every row ticked ("Reorder", "Reissue").
 *
 * Pressing it reads the ticked rows again from the server (the confirm never
 * shows what the grid happened to hold), leaves out the ones the action is
 * not for, and asks once — the rows it is about, and whatever the action's
 * form asks for, the same for every row. Then ONE call makes the rows, one
 * save each on the server; the reply says what became of each. A row that
 * was refused is said with its reason; nothing is retried by itself.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Button, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';
import type { PageCrudBulkAction } from '@adminium/widgets';

import { api, ApiError } from '../app/api.js';
import type { BulkActionFact } from '../api/pages.js';
import { t } from '../i18n/t.js';
import { recordRefusal } from './recordRefusal.js';

/** The most rows one press is for. */
export const BULK_ROWS_MAX = 200;

type Row = Readonly<Record<string, unknown>>;

interface EachReply {
  results: { index?: number; ok: boolean; error?: { code: string; message?: string; details?: unknown } }[];
}

type Step =
  | { at: 'notice'; action: BulkActionFact; words: string }
  | { at: 'confirm'; action: BulkActionFact; rows: Row[]; left: number; values: Record<string, string>; busy: boolean }
  | { at: 'done'; action: BulkActionFact; made: number; refused: { row: Row; words: string }[]; notRun: number };

const filled = (text: string, count: number): string => text.replace(/\{count\}/g, String(count));
const shown = (value: unknown): string => (value === null || value === undefined || value === '' ? '—' : String(value));
function humanized(column: string): string {
  const words = column.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ManifestBulkActions {
  /** For the list's bulk bar, after a project's own. */
  bulk: PageCrudBulkAction[];
  dialog: ReactNode;
}

export function useManifestBulkActions(input: {
  connectionId: string | null;
  /** The list's table id, and the column a row is known by. */
  table: string | undefined;
  keyColumn?: string;
  actions: readonly BulkActionFact[] | undefined;
  /** Rows were made: the list is read again. */
  onDone: () => void;
}): ManifestBulkActions {
  const { connectionId, table, keyColumn = 'id', actions, onDone } = input;
  const [step, setStep] = useState<Step | null>(null);
  const base = connectionId === null ? '' : `/api/v1/data/${encodeURIComponent(connectionId)}`;

  const start = useCallback(
    async (action: BulkActionFact, ids: readonly string[]): Promise<void> => {
      if (table === undefined) return;
      if (ids.length > BULK_ROWS_MAX) {
        setStep({ at: 'notice', action, words: t('ui:pages.bulk.tooMany', 'Select {max} rows or fewer.', { max: BULK_ROWS_MAX }) });
        return;
      }
      try {
        // Read again, by key: only the columns the confirm shows and the one the action is told apart by.
        const select = [...new Set([keyColumn, ...action.confirm.columns, ...(action.where === undefined ? [] : [action.where.column])])];
        const search = new URLSearchParams({ where: JSON.stringify({ column: keyColumn, op: 'in', value: ids }), select: select.join(','), limit: String(BULK_ROWS_MAX) });
        const reply = await api.get<{ data: Row[] }>(`${base}/${encodeURIComponent(table)}?${search.toString()}`);
        const byKey = new Map(reply.data.map((row) => [String(row[keyColumn]), row]));
        // In the list's own order, as ticked.
        const read = ids.map((id) => byKey.get(String(id))).filter((row): row is Row => row !== undefined);
        const where = action.where;
        const kept = where === undefined ? read : read.filter((row) => String(row[where.column]) === String(where.eq));
        if (kept.length === 0) {
          setStep({ at: 'notice', action, words: t('ui:pages.bulk.none', 'None of the rows ticked is one this is for.') });
          return;
        }
        setStep({ at: 'confirm', action, rows: kept, left: ids.length - kept.length, values: Object.fromEntries(action.child.form.map((column) => [column, ''])), busy: false });
      } catch (error) {
        setStep({ at: 'notice', action, words: recordRefusal(error) });
      }
    },
    [base, keyColumn, table],
  );

  const make = useCallback(
    async (confirm: Extract<Step, { at: 'confirm' }>): Promise<void> => {
      const { action, rows } = confirm;
      setStep({ ...confirm, busy: true });
      const typed = Object.fromEntries(Object.entries(confirm.values).filter(([, value]) => value !== ''));
      try {
        // ONE call: the server makes the rows one save each, in this order, and answers for each.
        const reply = await api.post<EachReply>(`${base}/${encodeURIComponent(action.child.table)}/one-by-one`, {
          creates: rows.map((row) => ({ ...typed, ...(action.set ?? {}), [action.child.via]: row[keyColumn] })),
        });
        const refused: { row: Row; words: string }[] = [];
        let made = 0;
        let notRun = 0;
        rows.forEach((row, index) => {
          const result = reply.results[index];
          if (result === undefined || result.error?.code === 'NOT_RUN') notRun += 1;
          else if (result.ok) made += 1;
          else refused.push({ row, words: recordRefusal(new ApiError(409, result.error?.code ?? 'REFUSED', result.error?.message ?? '', null, result.error?.details)) });
        });
        setStep({ at: 'done', action, made, refused, notRun });
        onDone();
      } catch (error) {
        // The whole call failed, or its answer never came: nothing can be said of any row.
        const words = error instanceof ApiError && error.status !== 429 && error.status < 500 ? recordRefusal(error) : t('ui:pages.bulk.unknown', 'Nothing is known to be made. Look at the list and press again.');
        setStep({ at: 'notice', action, words });
        onDone();
      }
    },
    [base, keyColumn, onDone],
  );

  const bulk = useMemo<PageCrudBulkAction[]>(
    () => (connectionId === null || table === undefined ? [] : (actions ?? []).map((action) => ({ key: `manifest:${action.id}`, label: action.label, disabled: step !== null && step.at === 'confirm' && step.busy, run: (ids) => void start(action, ids) }))),
    [actions, connectionId, table, start, step],
  );

  const close = (): void => setStep(null);
  const dialog =
    step === null ? null : (
      <Modal open size="md" onOpenChange={(open) => (open || (step.at === 'confirm' && step.busy) ? undefined : close())}>
        <ModalHeader title={step.at === 'confirm' ? filled(step.action.confirm.title, step.rows.length) : step.action.label} closeLabel={t('ui:action.close', 'Close')} />
        {step.at === 'notice' ? (
          <>
            <ModalBody>
              <p role="alert" className="text-body text-fg">
                {step.words}
              </p>
            </ModalBody>
            <ModalFooter>
              <Button onClick={close}>{t('ui:pages.bulk.close', 'Close')}</Button>
            </ModalFooter>
          </>
        ) : step.at === 'done' ? (
          <>
            <ModalBody>
              <div className="flex flex-col gap-3 text-body text-fg">
                <p>{filled(step.action.done, step.made)}</p>
                {step.refused.length === 0 ? null : (
                  <div role="alert">
                    <p>{t('ui:pages.bulk.refused', '{count} could not be made:', { count: step.refused.length })}</p>
                    <ul className="mt-1 list-disc ps-5 text-body-sm">
                      {step.refused.map((entry, index) => (
                        <li key={index}>
                          <strong>{shown(entry.row[step.action.confirm.columns[0] ?? keyColumn])}</strong> — {entry.words}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {step.notRun === 0 ? null : <p>{t('ui:pages.bulk.notReached', '{count} not reached — press again for these.', { count: step.notRun })}</p>}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button onClick={close}>{t('ui:pages.bulk.close', 'Close')}</Button>
            </ModalFooter>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void make(step);
            }}
          >
            <ModalBody>
              <div className="flex flex-col gap-4">
                <p className="text-body text-fg">{filled(step.action.confirm.body, step.rows.length)}</p>
                {step.left === 0 ? null : (
                  <p className="text-body-sm text-fg-muted">{t('ui:pages.bulk.leftOut', '{left} of {count} are left out: this is not for them.', { left: step.left, count: step.left + step.rows.length })}</p>
                )}
                {step.action.confirm.columns.length === 0 ? null : (
                  <div className="max-h-56 overflow-auto rounded-md border border-border">
                    <table className="w-full text-start text-body-sm">
                      <thead>
                        <tr>
                          {step.action.confirm.columns.map((column) => (
                            <th key={column} scope="col" className="px-3 py-1.5 text-start font-semibold text-fg-muted">
                              {humanized(column)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {step.rows.map((row, index) => (
                          <tr key={index} className="border-t border-border">
                            {step.action.confirm.columns.map((column) => (
                              <td key={column} className="px-3 py-1.5 text-fg">
                                {shown(row[column])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {step.action.child.form.map((column) => (
                  <FormField key={column} label={humanized(column)}>
                    <Input value={step.values[column] ?? ''} onChange={(event) => setStep({ ...step, values: { ...step.values, [column]: event.target.value } })} />
                  </FormField>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="secondary" disabled={step.busy} onClick={close}>
                {t('ui:pages.bulk.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={step.busy}>
                {step.busy ? t('ui:pages.bulk.working', 'Working…') : step.action.label}
              </Button>
            </ModalFooter>
          </form>
        )}
      </Modal>
    );
  return { bulk, dialog };
}

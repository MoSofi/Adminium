// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHY A RECORD'S ACTION WAS REFUSED, in the reader's words.
 *
 * The server refuses with a code, a sentence in English and what it says of
 * the row. A record page says one sentence in the reader's language for each
 * case it knows, and the server's own sentence for the rest. It never prints
 * a value the server's details did not carry: a role that does not read the
 * state column is told nothing of the state, because the server left it out.
 */
import { ApiError } from '../app/api.js';
import { inReadersWords } from '../api/ledgerRefusal.js';
import { t } from '../i18n/t.js';

type Details = Readonly<Record<string, unknown>>;

/** A table's id as a refusal names it, read as words (`public.shop_order_lines` → `shop order lines`). */
function rowsOf(table: unknown): string {
  return String(table ?? '')
    .replace(/^.*\./, '')
    .replace(/_/g, ' ');
}

export function recordRefusal(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  const details = (typeof error.details === 'object' && error.details !== null ? error.details : {}) as Details;
  switch (error.code) {
    case 'STATE_MOVE_REFUSED': {
      // Counted rows it waits for; a role it is kept for; a row somebody moved on; anything else it waits for.
      if (typeof details['requires'] === 'string' && typeof details['min'] === 'number') {
        return t('ui:pages.record.needsRows', 'Add at least {n} row(s) of {rows} first.', { n: details['min'], rows: rowsOf(details['requires']) });
      }
      if (Array.isArray(details['roles'])) return t('ui:pages.record.roles', 'Your role may not do this.');
      if (typeof details['named'] === 'string' && typeof details['from'] === 'string') {
        return t('ui:pages.record.moved', 'Someone else changed this record; it is {state} now. Look again.', { state: details['from'] });
      }
      if (typeof details['from'] === 'string' && details['from'] === details['to']) return t('ui:pages.record.already', 'This is already done.');
      return details['requires'] !== undefined ? t('ui:pages.record.waits', 'This cannot be done yet.') : error.message;
    }
    case 'ROW_CHANGED':
      return t('ui:pages.record.rowChanged', 'This record changed while you were looking at it. Look again.');
    case 'RECORD_LOCKED':
      return t('ui:pages.record.locked', 'This record is locked, so this cannot be changed.');
    case 'COLUMN_FORBIDDEN':
    case 'TABLE_FORBIDDEN':
    case 'FORBIDDEN':
      return t('ui:pages.record.forbidden', 'Your role may not change this.');
    case 'NOT_FOUND':
      return t('ui:pages.record.notFound', 'This record, or this action, is no longer there.');
    case 'ADJUST_REFUSED':
    case 'POSTING_REFUSED': {
      // The ledger's own sentence, as every other save of the dashboard says it.
      const said = inReadersWords(error);
      return said instanceof Error ? said.message : error.message;
    }
    default:
      return error.message;
  }
}

/** The fields a refusal names, each with what to say under it; null when it names none. */
export function refusedFields(error: unknown): Record<string, string> | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const fields = (error.details as { fields?: unknown } | null | undefined)?.fields;
  if (typeof fields !== 'object' || fields === null) return null;
  const out: Record<string, string> = {};
  for (const [column, issue] of Object.entries(fields as Record<string, { code?: unknown; message?: unknown }>)) {
    out[column] = typeof issue?.message === 'string' ? issue.message : issue?.code === 'required' ? t('ui:pages.record.fieldRequired', 'Fill this in first.') : error.message;
  }
  return Object.keys(out).length === 0 ? null : out;
}

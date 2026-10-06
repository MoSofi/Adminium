// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO IS TOLD WHAT IS LEFT.
 *
 * A ledger's refusal may say how much is left and of what ("3 left, Sugar").
 * Both are read from the add-on's own rows, so they are told only to somebody
 * who may read every table the action stands on; everybody else is told the
 * reason and the line, and no figure. The refusal carries those tables beside
 * its details (never in them), and the two places a refusal leaves the server
 * through — the error a save answers, the answer of a quote — ask here.
 */
import { AppError } from '../errors.js';
import { postingAnswers, readersOf, type LedgerReaders, type PostedOutcome, type PostingAnswer } from '../crud/ledger-write.js';

type Can = ((permission: string) => Promise<boolean>) | undefined;

const FIGURES = ['left', 'item'] as const;

/** Whether the caller may read every one of those tables. Nobody known, or no tables named: no. */
export async function readsLedger(can: Can, readers: LedgerReaders | undefined): Promise<boolean> {
  if (typeof can !== 'function' || readers === undefined || readers.tables.length === 0) return false;
  for (const table of readers.tables) if (!(await can(`table:${readers.connectionId}:${table}:read`))) return false;
  return true;
}

/** Takes the figures out of a ledger's refusal, in place, for a caller who may not read where they come from. */
export async function hideLedgerFigures(error: unknown, can: Can): Promise<void> {
  if (!(error instanceof AppError) || error.code !== 'POSTING_REFUSED') return;
  const details = error.details as Record<string, unknown> | undefined;
  if (typeof details !== 'object' || details === null || !FIGURES.some((key) => key in details)) return;
  // Asked whether the caller may read them; a question that fails is answered no.
  if (await readsLedger(can, readersOf(error)).catch(() => false)) return;
  const told = { ...details };
  for (const key of FIGURES) delete told[key];
  Object.defineProperty(error, 'details', { value: told, configurable: true });
}

/** What each posting of a save or a quote says, with a refused quote's figures for a caller who may read them. */
export async function answersFor(can: Can, outcomes: readonly PostedOutcome[] | undefined): Promise<PostingAnswer[] | undefined> {
  const answers = postingAnswers(outcomes);
  if (answers === undefined || outcomes === undefined) return answers;
  for (const [index, outcome] of outcomes.entries()) {
    const quote = outcome.quote;
    if (quote === undefined || (quote.left === undefined && quote.item === undefined)) continue;
    if (!(await readsLedger(can, outcome.readers))) continue;
    answers[index] = { ...answers[index]!, ...(quote.left === undefined ? {} : { left: quote.left }), ...(quote.item === undefined ? {} : { item: quote.item }) };
  }
  return answers;
}

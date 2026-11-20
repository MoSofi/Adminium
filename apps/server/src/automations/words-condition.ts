// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE THAT ASKS AN ADD-ON'S WORDS — "is the variant this request is
 * about back in stock?" — in a condition or branch step.
 *
 * The record names the row through one of its links (`of`); the add-on's
 * words (`inventory:stock`) are asked about that row, by the same path the
 * staff's and the public pages' stock words take (`planWords`): what the
 * add-on decides, read from its own tables, nothing written, nothing locked.
 * No step or hook of the add-on runs for a rule.
 *
 * ─── WHEN IT CANNOT BE TOLD, IT IS FALSE ──────────────────────────────────
 *
 * A public page reads an add-on that cannot answer as "in", so it never says
 * "sold out" for an add-on that is off. A rule is the other way round: what
 * it does next is mail somebody. So every case where the answer is not known
 * makes the condition FALSE, `is_not` included:
 *
 *  - the add-on is not installed, or switched off for the rule's app;
 *  - it cannot answer (its words gone, its code failing, its tables gone);
 *  - the record's link is empty;
 *  - the add-on answers but does not count the row (no figure: a variant
 *    linked to no stock item reads "in" on a page, and is no restock here).
 *
 * `in` holds when the add-on counts the row and at least one whole unit is
 * left: a "low" with one or more left is in; a "low" kept below zero for
 * staff (none left, but not stopped) is not. `low` is the add-on's own word.
 * `out` holds when it counts the row and none is left.
 */
import type { AutomationCondition } from '@adminium/meta';
import { ledgersOf } from '@adminium/manifest';

import type { Row } from '../crud/mask.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { planWords, WordsUnavailable, type WordsLine } from '../crud/ledger-write.js';
import type { Kysely } from 'kysely';
import type { SourceDatabase } from '../connections/manager.js';
import type { LedgerRuntime } from '../ledgers/registry.js';
import { wordsFitTable } from '../routes/public/words-availability.js';
import { relatedTarget } from './related.js';

/** What a rule's words condition reads: `<add-on>:<words>` and the record's link. */
export interface WordsAsk {
  words: string;
  of: string;
}

/** Where a run asks: the record's connection, its view and handle, its app, and its clock. */
export interface WordsAskContext {
  ledgers: LedgerRuntime | undefined;
  view: SnapshotView;
  db: Kysely<SourceDatabase>;
  timezone: string;
  /** The app whose rule asks; null for a rule of the workspace's own. */
  app: string | null;
  /** The record's table and the record, re-read. */
  table: ResolvedTable;
  row: Row;
  now: Date;
}

/**
 * The add-on's line about the row the record's `of` link names, or null when
 * it cannot be told (see the header). Never throws for the add-on's sake: a
 * failing add-on is a false condition, not a failed run.
 */
export async function askWords(ask: WordsAsk, ctx: WordsAskContext): Promise<WordsLine | null> {
  const ledgers = ctx.ledgers;
  if (ledgers === undefined) return null;
  const value = ctx.row[ask.of];
  if (value === null || value === undefined || value === '') return null;
  const target = relatedTarget(ctx.view, ctx.table, ask.of);
  if (target === null) return null;
  const link = target.table;
  const addOn = ask.words.slice(0, ask.words.indexOf(':'));
  const id = ask.words.slice(ask.words.indexOf(':') + 1);
  const connectionId = ctx.view.connectionId;
  try {
    // What is installed, as it stands now: an add-on switched off a moment ago answers nothing.
    await ledgers.refresh?.();
    if (ctx.app !== null && ctx.app !== addOn && ledgers.onFor?.(connectionId, addOn, ctx.app) !== true) return null;
    const manifest = ledgers.manifestOf(connectionId, addOn);
    if (manifest === null) return null;
    const declared = (((manifest.addOn as { words?: unknown } | undefined)?.words ?? []) as { id: string; ledger: string; action: string; input: string }[]).find((one) => one.id === id);
    const ledger = declared === undefined ? null : (ledgers.ledgerOf?.(ctx.view, addOn, declared.ledger) ?? null);
    const action = declared === undefined ? undefined : ledgersOf(manifest).find((one) => one.id === declared.ledger)?.actions[declared.action];
    if (declared === undefined || ledger === null || action === undefined) return null;
    // Words over an item are asked of the items' own table, and of no other.
    if (!wordsFitTable(ledger, action, declared.input, link.id)) return null;
    const [line] = await planWords(ledgers, {
      view: ctx.view,
      db: ctx.db,
      timezone: ctx.timezone,
      addOn,
      words: id,
      tableRef: ledgers.refOf(connectionId, link.id),
      keys: [String(value)],
      origin: 'system',
      now: ctx.now,
    });
    return line ?? null;
  } catch (error) {
    if (error instanceof WordsUnavailable) return null;
    throw error;
  }
}

/** Whether a line holds the condition's state; a line that is no answer holds nothing, `is_not` included. */
export function wordsHold(condition: Pick<AutomationCondition, 'op' | 'right'>, line: WordsLine | null): boolean {
  // Counted: the add-on gave a figure for the row. Without one it does not count the row at all.
  if (line === null || line.left === undefined) return false;
  const left = Number(line.left);
  if (!Number.isFinite(left)) return false;
  const state = condition.right === 'in' ? left >= 1 : condition.right === 'low' ? line.state === 'low' : condition.right === 'out' ? left < 1 : null;
  if (state === null) return false;
  if (condition.op === 'is') return state;
  if (condition.op === 'is_not') return !state;
  return false;
}

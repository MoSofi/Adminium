// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH REDUCTIONS A STORED ORDER TOOK — pure.
 *
 * A save says which reductions applied from the add-on's answer. A read of
 * the order afterwards — a guest opening their order again, the reply of a
 * create sent twice — says the same from the rows that were kept for it: one
 * row for each thing applied to each line, with the name it had when it was
 * applied. Here those rows are put back into the shape an answer has, so the
 * one grouping every door uses (`replies.ts`) tells them.
 *
 * What is told is what a save tells: a name in the reader's language, a kind,
 * an amount, whether it was typed, and for a voucher the last four of what
 * was typed. Never an id, the reason staff wrote, or a whole code. A line is
 * named only where the caller is told how (a create sent again names it by
 * its place in what was sent, as the first answer did); otherwise by nothing.
 */
import type { AdjustApplied } from '@adminium/add-on-contracts';

import type { Row } from '../mask.js';
import { booleanOf } from '../write-values.js';
import { appliedReply, type AppliedReply } from './replies.js';

const KINDS: ReadonlySet<string> = new Set(['offer', 'code', 'voucher', 'pack', 'staff']);
const empty = (value: unknown): boolean => value === null || value === undefined || value === '';
const text = (value: unknown): string | null => (empty(value) ? null : String(value));

/** A stored name: every language it was kept in, or the one name it was kept as. */
function nameOf(stored: unknown): AdjustApplied['name'] {
  if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) return Object.fromEntries(Object.entries(stored as Record<string, unknown>).map(([locale, name]) => [locale, String(name ?? '')]));
  if (typeof stored !== 'string') return '';
  // An engine that keeps json as text hands the text back.
  if (stored.startsWith('{') || stored.startsWith('"')) {
    try {
      return nameOf(JSON.parse(stored));
    } catch {
      return stored;
    }
  }
  return stored;
}

/** Where the add-on keeps what was applied, by column. */
export interface AppliedColumns {
  line: string;
  offer: string;
  code: string;
  voucher: string;
  name: string;
  kind: string;
  amount: string;
  typed: string;
}

/**
 * The reductions of one stored order, as a reply carries them. `rows`: its
 * rows of what was applied, oldest first. `codes`: the codes typed on it that
 * found a voucher, for the last four. `guest`: a customer reads — what staff
 * took off by hand has no name (the page says its own word for one).
 */
export function storedReductions(input: { rows: readonly Row[]; columns: AppliedColumns; codes: readonly { typed: string; voucher: string }[]; locale: string; places: number; guest: boolean; lineOf?: ((line: string) => string | null) | undefined }): AppliedReply[] {
  const { columns } = input;
  const applied: AdjustApplied[] = [];
  for (const row of input.rows) {
    const kind = String(row[columns.kind] ?? '');
    if (!KINDS.has(kind)) continue;
    applied.push({ line: String(row[columns.line] ?? ''), offer: text(row[columns.offer]), code: text(row[columns.code]), voucher: text(row[columns.voucher]), name: nameOf(row[columns.name]), kind: kind as AdjustApplied['kind'], amount: String(row[columns.amount] ?? '0'), typed: booleanOf(row[columns.typed]) === true });
  }
  const out = appliedReply(
    { applied, told: [], codes: input.codes.map((code) => ({ typed: code.typed, kind: 'voucher' as const, id: code.voucher })) },
    { locale: input.locale, places: input.places, lineOf: (line) => input.lineOf?.(line) ?? null, columnOf: () => '' },
  ).applied;
  return input.guest ? out.map((entry) => (entry.kind === 'staff' ? { ...entry, name: '' } : entry)) : out;
}

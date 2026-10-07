// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW'S OWN LINK, MADE AGAIN BY ITS PERSON.
 *
 * A row's own link (a stay's confirmation link, an order's) opens it to
 * whoever holds the link. Its person, signed in by email, may make a new one
 * ("Make a new link": a link forwarded by mistake) and — where the app says
 * so — "delete my details" stops every one of their rows' links.
 *
 * Both are one thing: the row's code column gets a new code, through the one
 * write path, as a server action (the only writer whose value for a code
 * column is taken). Every session the old code opened carries that code's
 * hash and is checked against the row on each request, so each stops at
 * once; nothing else needs ending. A new code that meets another row's (one
 * in 2^80) is made again.
 *
 * The code is Adminium's, not content a lock keeps: a collected order, a
 * departed stay still get a new code — and nothing else of the row changes.
 * It is written as the system's, on the person's asking.
 */
import { generateCode, isUniqueViolation } from '../crud/decided-columns.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { WriteContext, WriteTarget } from '../crud/write-context.js';
import type { RecordWriteService, UpdateOutcome } from '../crud/write-service.js';

/** A code column Adminium makes: its prefix and length, or null for any other column. */
export function codeRuleOf(table: ResolvedTable, column: string): { prefix: string; length: number } | null {
  const rule = table.table.columns.find((candidate) => candidate.name === column)?.code;
  return rule === undefined ? null : { prefix: rule.prefix ?? '', length: rule.length };
}

/**
 * Give one row's own link a new code: the row as it now stands (`after`).
 * Throws what the write throws (a hook's refusal, a grant the connection's
 * role lacks); null when the row is gone or the column holds no code.
 */
export async function renewOwnLink(input: {
  writes: Pick<RecordWriteService, 'update'> & Partial<Pick<RecordWriteService, 'codeRules'>>;
  target: WriteTarget;
  row: Row;
  column: string;
  context: WriteContext;
  announce: (outcome: UpdateOutcome) => Promise<void>;
}): Promise<Row | null> {
  const rule = codeRuleOf(input.target.table, input.column);
  if (rule === null) return null;
  const pk = Object.fromEntries(input.target.table.primaryKey.map((column) => [column, input.row[column]]));
  const avoid = (await input.writes.codeRules?.(input.target))?.find((code) => code.column === input.column)?.avoid;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const outcome = await input.writes.update({
        target: input.target,
        pk,
        values: { [input.column]: generateCode(rule.prefix, rule.length, avoid) },
        before: input.row,
        // A server action: the one writer whose value for a code column is taken, and the renewal no lock refuses.
        context: { ...input.context, origin: 'action', actor: { kind: 'system', id: null, label: 'system' }, renewing: [input.column] },
        skipIfNone: true,
        announce: input.announce,
      });
      return outcome.count === 0 ? null : outcome.after;
    } catch (error) {
      // Another row holds the same code: made again, a few times at most.
      if (!isUniqueViolation(error) || attempt >= 2) throw error;
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A message a producer's `dropWhen` dropped while it waited, told apart from
 * one still counting for the producer's "once": a producer that holds its
 * messages a few seconds (`holdSeconds`) is waiting for a move that may be
 * taken back (an order marked ready by mistake). Once it is dropped, the row
 * moving on again queues a fresh message — the dropped one never stops it.
 *
 * A dropped message is `skipped` with one of the producer's drop reasons, in
 * the outbox's reason column, or its error column's sentence for it when the
 * outbox keeps no reason column; with neither, any skipped message of the
 * kind is taken for a dropped one.
 */
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import type { Outbox, OutboxProducer } from '@adminium/manifest';

import { skipSentence } from './timing.js';

/** The condition a row of the log meets while it still counts: not a message the producer dropped. */
export function notDropped(
  cols: Outbox['columns'],
  producer: OutboxProducer,
): (eb: ExpressionBuilder<never, never>) => Expression<SqlBool> {
  const reasons = [...new Set((producer.dropWhen ?? []).map((drop) => drop.reason))];
  const column = cols.skipReason ?? cols.error;
  const said = cols.skipReason !== undefined ? reasons : reasons.map((reason) => skipSentence(reason));
  return (eb) => {
    const kept = eb(sql.ref(cols.status), '<>', 'skipped');
    if (reasons.length === 0) return eb.or([kept, eb(sql.ref(cols.status), '=', 'skipped')]);
    if (column === undefined) return kept;
    return eb.or([kept, eb(sql.ref(column), 'is', null), eb(sql.ref(column), 'not in', said)]);
  };
}

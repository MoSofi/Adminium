// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The state a staff writer saw a row in (`from` on a change): the change is
 * made only while the row is still there — a row another screen moved on
 * since is refused (409 `STATE_MOVE_REFUSED`, naming both), never moved from
 * where it is now. A move marked `undo` is made only by a write that names
 * it (`crud/undo-moves.ts`).
 */
import { ValidationFailedError } from '../errors.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { attachExpect } from './states.js';

/** The values, carrying the state the writer saw as a condition of the change; unchanged without one. */
export function withSeenState(table: ResolvedTable, values: Row, from: string | undefined): Row {
  if (from === undefined) return values;
  const states = table.table?.states;
  if (states === undefined) {
    throw new ValidationFailedError('This table keeps no states, so a change names none it saw.', { fields: { from: { code: 'not-allowed' } } });
  }
  return attachExpect(values, { [states.column]: from });
}

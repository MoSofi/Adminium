// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A MESSAGE ABOUT A PERSON WHO DELETED THEIR DETAILS goes nowhere.
 *
 * A message may have been queued with its address already written — a
 * reminder due later, a batch waiting for its window, one held for a few
 * seconds — before the person asked to be forgotten. Their order keeps its
 * own copy of the address (for the door and the desk), and so may a ticket
 * they hold; none of those is a reason to write to them again. So, as each
 * message goes, the person it is about is read as they are now:
 *
 *  - a message linking a person (the outbox's recipient) who is forgotten is
 *    not sent, whatever address it names;
 *  - a message to an address a row holds (a ticket's holder) is not sent when
 *    that address is the copy of a forgotten person's: a column withheld
 *    unless one is its holder, or a stamp copied when the holder changed.
 *
 * "Forgotten" is the person table's own `forget` (see `public-api/forgets-on.ts`):
 * a table no entry lets a person forget themselves from never skips anything
 * here, so what any other app sends is as it was.
 */
import type { Outbox } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { forgetOf, isForgotten, type TableForgets } from '../public-api/forgets-on.js';
import { withholdRulesOf, type TableWithholds } from '../public-api/withhold.js';
import type { Addressed } from './recipient.js';
import { rowOf } from './recipient.js';

/** Whether this column of a table is the copy of the person its link `via` names. */
function copiedFrom(view: SnapshotView, withholds: TableWithholds, tableId: string, column: string, via: string): boolean {
  if (withholdRulesOf(withholds, tableId).some((rule) => rule.unlessHolder === via && rule.columns.includes(column))) return true;
  const stamp = view.table(tableId).table.columns.find((candidate) => candidate.name === column)?.stamp;
  if (stamp === undefined) return false;
  const triggers = Array.isArray(stamp.on) ? stamp.on : [stamp.on];
  return triggers.some((trigger) => typeof trigger === 'object' && ('columns' in trigger ? trigger.columns.includes(via) : trigger.column === via));
}

/** Whether the message goes to (or is about) a person who deleted their details. */
export async function toForgotten(
  ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; forgets: TableForgets; withholds: TableWithholds },
  definition: Outbox,
  row: Row,
  addressed: Addressed | null,
  /** The producer's column recipient, when the message goes to an address a row holds. */
  column: string | undefined,
): Promise<boolean> {
  const people = ctx.view.table(definition.recipient.table).id;
  const rule = forgetOf(ctx.forgets, people);
  if (rule === undefined) return false;
  const email = definition.recipient.email;
  const onRow = addressed?.byColumn;
  if (onRow !== undefined && column !== undefined) {
    const producing = await rowOf(ctx.db, ctx.view, onRow.table, onRow.id);
    if (producing === null) return false;
    for (const relation of ctx.view.model.relations) {
      if (relation.through !== null || relation.from.tableId !== onRow.table || relation.to.tableId !== people || relation.from.columns.length !== 1) continue;
      const via = relation.from.columns[0]!;
      if (!copiedFrom(ctx.view, ctx.withholds, onRow.table, column, via)) continue;
      const person = await rowOf(ctx.db, ctx.view, people, producing[via]);
      if (person !== null && isForgotten(rule, person, email)) return true;
    }
    return false;
  }
  if (addressed?.bySetting === true) return false;
  const person = addressed?.person ?? (await rowOf(ctx.db, ctx.view, people, row[definition.recipient.via]));
  return person !== null && isForgotten(rule, person, email);
}

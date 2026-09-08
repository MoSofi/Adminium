// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "HOW MANY RELATED ROWS?" — one COUNT, the only related-record question v1
 * answers (42-automations-and-workflow-logs.md FILL F5).
 *
 * It exists because both of the owner's examples turn on it: "did they claim
 * the offer?" is `count(offer_claims where user_id = this.id) > 0`, and "is
 * this the first time this patient missed an appointment?" is a count over
 * the SAME table narrowed by one more leaf. Neither is expressible as a
 * comparison on a column of the record.
 *
 * The counted table is resolved against the snapshot like every other
 * identifier, so a rule can only ever count a table the connection actually
 * has, and the optional extra leaf compiles through the same filter DSL as a
 * schedule scan.
 */

import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import type { AutomationCondition } from '@adminium/meta';

import type { SourceDatabase } from '../connections/manager.js';
import { compileFilter } from '../crud/filters.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { toRecordFilter } from './relative-time.js';

export interface RelatedCountInput {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  dialect: Dialect;
  /** Qualified snapshot id of the table being counted. */
  table: string;
  matchColumn: string;
  matchValue: unknown;
  where?: AutomationCondition | undefined;
  now: number;
}

export async function countRelatedRows(input: RelatedCountInput): Promise<number> {
  const table = input.view.table(input.table);
  const column = table.columns.get(input.matchColumn);
  if (column === undefined) {
    throw new Error(`Unknown column ${JSON.stringify(input.matchColumn)} on ${table.id}`);
  }
  let query = input.db
    .selectFrom(table.id)
    .select(({ fn }) => fn.countAll<number>().as('n'))
    .where(input.db.dynamic.ref(column.name), '=', input.matchValue as never);
  if (input.where) {
    const filter = toRecordFilter(input.where, { table, dialect: input.dialect, now: input.now });
    query = query.where((eb) =>
      compileFilter(
        eb as never,
        {
          view: input.view,
          table,
          // The count is a NUMBER, not a row: nothing about a masked column
          // leaks through "how many", so the count runs unmasked and the
          // caller never sees a value either way.
          canReadPii: true,
          dynamic: input.db.dynamic,
          dialect: input.dialect,
        },
        filter,
      ),
    );
  }
  const row = await query.executeTakeFirst();
  return Number(row?.n ?? 0);
}

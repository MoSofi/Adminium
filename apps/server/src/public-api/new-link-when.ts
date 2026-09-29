// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send it again" through a row's own link: another link of the row (the one
 * a confirmation email carries) is made again only while the row holds what
 * the entry names (`newLink.when`, an order still waiting to be confirmed),
 * and never while that link is stopped.
 *
 * Judged twice: on the row as read, for the answer, and again in the renewal's
 * own UPDATE, so a row that moved on between the two (the buyer confirmed a
 * moment ago) gets no new code and no email. Both judge a text the same way:
 * exactly, as it is spelled — MySQL's own `=` ignores case, so there the
 * statement compares the bytes.
 */
import { createHmac } from 'node:crypto';

import type { StateCondition } from '@adminium/manifest';
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';

import { compileFilter, type CompileFilterContext, type RecordFilter } from '../crud/filters.js';
import type { Row } from '../crud/mask.js';
import { holds } from '../crud/state-conditions.js';
import { capValue } from './anonymous-caps.js';
import { sameValue } from '../crud/write-values.js';

/** Whether the row holds every condition (none: always), and the link it makes again is not stopped. */
export function newLinkWhenHolds(where: readonly StateCondition[] | undefined, row: Row, stopped?: string): boolean {
  if (stopped !== undefined && sameValue(true, row[stopped])) return false;
  return (where ?? []).every((condition) => holds(condition, row));
}

type Eb = ExpressionBuilder<never, never>;

/**
 * The same judgement for the renewal's WHERE, or null for none. An empty text
 * counts as empty, as `holds` reads it; a text is compared exactly.
 */
export function newLinkStillHolds(ctx: CompileFilterContext, where: readonly StateCondition[] | undefined, stopped?: string): ((eb: Eb) => Expression<SqlBool>) | null {
  const conditions = where ?? [];
  if (conditions.length === 0 && stopped === undefined) return null;
  const text = (column: string) => ['text', 'varchar'].includes(ctx.table.columns.get(column)?.logicalType ?? '');
  return (eb: Eb) => {
    const parts: Expression<SqlBool>[] = conditions.map((c) => {
      const exact = ctx.dialect === 'mysql' && (typeof c.eq === 'string' || (c.in ?? []).some((value) => typeof value === 'string'));
      if (exact) {
        const bytes = sql`binary ${sql.ref(c.column)}`;
        return c.eq !== undefined ? eb(bytes as never, '=', c.eq as never) : eb(bytes as never, 'in', [...c.in!] as never);
      }
      return compileFilter(eb as never, ctx, filterOf(c, text(c.column)));
    });
    if (stopped !== undefined) parts.push(compileFilter(eb as never, ctx, { or: [{ column: stopped, op: 'is_null' }, { column: stopped, op: 'eq', value: false }] }));
    return eb.and(parts as never) as Expression<SqlBool>;
  };
}

function filterOf(c: StateCondition, text: boolean): RecordFilter {
  if (c.isNull === true) return text ? { or: [{ column: c.column, op: 'is_null' }, { column: c.column, op: 'eq', value: '' }] } : { column: c.column, op: 'is_null' };
  if (c.isNull === false) return text ? { and: [{ column: c.column, op: 'not_null' }, { column: c.column, op: 'neq', value: '' }] } : { column: c.column, op: 'not_null' };
  if (c.eq !== undefined) return { column: c.column, op: 'eq', value: c.eq };
  if (c.in !== undefined) return { column: c.column, op: 'in', value: [...c.in] };
  if (c.gt !== undefined) return { column: c.column, op: 'gt', value: c.gt };
  if (c.gte !== undefined) return { column: c.column, op: 'gte', value: c.gte };
  if (c.lt !== undefined) return { column: c.column, op: 'lt', value: c.lt };
  return { column: c.column, op: 'lte', value: c.lte };
}

/** The renewal's email could not be queued (no address any more): the renewal is rolled back with it. */
export class NewLinkUnsent extends Error {
  constructor() {
    super('the new link could not be emailed');
    this.name = 'NewLinkUnsent';
  }
}

/**
 * Where a resend through a row's own link is counted against its mailbox:
 * the address as the public API counts one (`capValue`: lower case, the
 * `+tag` and Gmail's dots dropped), keyed, over every row of the table.
 */
export function newLinkMailboxSubject(key: Buffer, connectionId: string, table: string, address: string): string {
  return `new-link-to:${createHmac('sha256', key).update(JSON.stringify([connectionId, table, capValue(address) ?? address])).digest('hex')}`;
}

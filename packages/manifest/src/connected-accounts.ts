// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `table.connectedAccounts` — each row of this table may connect its own
 * outside account (a team member's calendar) through the add-ons it names.
 *
 *  - `from`: the add-ons, each one the app requires or suggests;
 *  - `address`: the column holding where a connect link is sent. A link goes
 *    to the row's own address and never to one typed when sending;
 *  - `name`: the column naming the person, so a connect page can say whose
 *    calendar it is for;
 *  - `active`: a boolean column. A row switched off, like a row deleted, has
 *    its connection ended by the engine.
 *
 * Who may act on a row is the row limits' answer: this names the rows, and a
 * role's `accounts:@:…` grants name the actions.
 */
import { z } from 'zod';

import { refSchema, type ReferenceIssue, type TableIndex, type TableShape } from './refs.js';

const ADD_ON_KEY = /^[a-z][a-z0-9-]{1,79}$/;

export const connectedAccountsSchema = z
  .object({
    from: z.array(z.string().regex(ADD_ON_KEY)).min(1).max(8),
    address: refSchema.optional(),
    /** The column that names the person on the connect page. */
    name: refSchema.optional(),
    active: refSchema.optional(),
  })
  .strict();
export type ConnectedAccountsRule = z.infer<typeof connectedAccountsSchema>;

export function connectedAccountsIssues(
  table: TableShape,
  rule: ConnectedAccountsRule,
  index: TableIndex,
  named: ReadonlySet<string>,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const here = (...rest: (string | number)[]) => at('connectedAccounts', ...rest);
  rule.from.forEach((key, i) => {
    if (!named.has(key)) out.push({ path: here('from', i), message: `"${key}" is an add-on the app neither requires nor suggests` });
    if (rule.from.indexOf(key) !== i) out.push({ path: here('from', i), message: `"${key}" is named twice` });
  });
  if (rule.address !== undefined) {
    const column = index.column(table.ref, rule.address);
    if (column === undefined) out.push({ path: here('address'), message: `"${table.ref}" has no column "${rule.address}"` });
    else if (column.type !== 'text') out.push({ path: here('address'), message: `"${table.ref}.${rule.address}" must hold an e-mail address` });
  }
  if (rule.name !== undefined && index.column(table.ref, rule.name) === undefined) {
    out.push({ path: here('name'), message: `"${table.ref}" has no column "${rule.name}"` });
  }
  if (rule.active !== undefined) {
    const column = index.column(table.ref, rule.active);
    if (column === undefined) out.push({ path: here('active'), message: `"${table.ref}" has no column "${rule.active}"` });
    else if (column.type !== 'bool') out.push({ path: here('active'), message: `"${table.ref}.${rule.active}" must be a boolean` });
  }
  return out;
}

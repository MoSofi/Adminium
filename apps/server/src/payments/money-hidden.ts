// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER A PERSON'S READ OF A PAYABLE LEAVES ITS MONEY OUT.
 *
 * A role may read a record but not its money (a packer reads an order's
 * items and address, never what it cost). Every staff route that would tell
 * the money of a record — the Payment panel and its list badges, recording a
 * payment by hand, a pay link made or emailed (its page shows what is due),
 * a charge on a card reader (it is for what is due) — asks this first, and a
 * person it answers yes for is told nothing of it.
 *
 * The money is the columns the figures are read from: an invoice shape's
 * `total` and `balance`, a payable's amount and due columns. Without a
 * resolution to judge by, it is hidden: never a figure read past a limit.
 */
import type { FastifyRequest } from 'fastify';

import type { PayableSources } from './payables.js';
import type { PermissionSet } from '../rbac/resolver.js';
import { readLimitOf } from '../rbac/read-limits.js';

/** The columns a payable's figures (and its label) are read from; null when it is no payable. */
async function payableColumns(sources: PayableSources, connectionId: string, tableId: string): Promise<{ money: string[]; label: string | null } | null> {
  if ((await sources.shapeOf(connectionId, tableId)) !== null) return { money: ['total', 'balance'], label: 'number' };
  const mapping = (await sources.profile(connectionId, tableId))?.mapping ?? null;
  if (mapping === null) return null;
  return { money: [mapping.amount.column, ...(mapping.due === null ? [] : [mapping.due.column])], label: mapping.label };
}

/** Whether this person's read limit on the table hides its money (see the header). */
export async function moneyHidden(request: FastifyRequest, sources: PayableSources, connectionId: string, table: { id: string; columns: ReadonlyMap<string, unknown> }): Promise<boolean> {
  const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
  if (set === undefined) return true;
  const limit = readLimitOf(set, connectionId, table.id);
  if (limit === null) return false;
  const columns = await payableColumns(sources, connectionId, table.id);
  // A payable we cannot read the columns of is hidden; a table that is no payable has no money to hide.
  if (columns === null) return (await sources.profile(connectionId, table.id)) !== null;
  return columns.money.some((column) => table.columns.has(column) && !limit.has(column));
}

/** Whether this person's read limit hides the column a payable is labelled by (a customer's name, say): the panel then names it by its key. */
export async function labelHidden(request: FastifyRequest, sources: PayableSources, connectionId: string, table: { id: string; columns: ReadonlyMap<string, unknown> }): Promise<boolean> {
  const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
  if (set === undefined) return true;
  const limit = readLimitOf(set, connectionId, table.id);
  if (limit === null) return false;
  const label = (await payableColumns(sources, connectionId, table.id))?.label ?? null;
  return label !== null && table.columns.has(label) && !limit.has(label);
}

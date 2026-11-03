// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DESIGN RULE, AS A WRITE READS IT — pure: no database, no add-on, no clock.
 *
 * An order line's table may say that an add-on checks the design a line
 * names (`table.check`): which column links the line to its design, and
 * which child rows say the features the line pays for. This file turns the
 * stored rule into what the write path asks of it on every save:
 *
 *  - on the LINE's table, the rule itself: its key, its design link, and the
 *    columns whose change asks the question again;
 *  - on the table of PAID FEATURES, which line each row belongs to, and the
 *    columns whose change asks that line's question again.
 *
 * Whether the rule is LIVE is not said here: that is asked of the ledger
 * registry on every write.
 */
import type { EffectiveModel, EffectiveTable, TableCheck } from '../../connections/effective-schema.js';

/** The design rule of an order line's table. */
export interface CompiledCheck {
  rule: TableCheck;
  /** The line's own key column. */
  key: string;
  /** The line's link to its design. */
  design: string;
  /** Where the line keeps the features it pays for: a child table, its link to the line, its feature column. */
  paid?: { table: string; via: string; feature: string };
}

/** A table whose rows are features some line pays for: the line's table, its key, and this table's two columns. */
export interface CheckParent {
  line: string;
  lineKey: string;
  via: string;
  feature: string;
}

/** The table's design rule, or undefined when it has none, or none that can be read (a line with no one key). */
export function compileCheck(table: Pick<EffectiveTable, 'primaryKey' | 'check'> | undefined): CompiledCheck | undefined {
  const rule = table?.check;
  if (rule === undefined || table === undefined || table.primaryKey.length !== 1) return undefined;
  return { rule, key: table.primaryKey[0]!, design: rule.design, ...(rule.paid === undefined ? {} : { paid: { ...rule.paid } }) };
}

/** The lines whose features this table's rows are. */
export function checkParentsOf(model: Pick<EffectiveModel, 'tables'> | undefined, table: Pick<EffectiveTable, 'id'> | undefined): CheckParent[] {
  if (model === undefined || table === undefined || !Array.isArray(model.tables)) return [];
  const out: CheckParent[] = [];
  for (const line of model.tables) {
    const paid = line.check?.paid;
    if (paid === undefined || paid.table !== table.id || line.primaryKey.length !== 1) continue;
    out.push({ line: line.id, lineKey: line.primaryKey[0]!, via: paid.via, feature: paid.feature });
  }
  return out;
}

/** Whether a change of these columns asks a line's question again: its design link, or a paid row's line or feature. */
export const asksAgain = (changed: Iterable<string>, columns: readonly string[]): boolean => {
  for (const column of changed) if (columns.includes(column)) return true;
  return false;
};

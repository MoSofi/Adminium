// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A table's name, for a person.
 *
 * A page with no label of its own still has to say what it holds, and the
 * only thing it knows is the table's id — `main.order_items`. Printed as it
 * is, a dialog read "New order_item", a field hint "→ main.clients" and a
 * subtitle "Creates one row in main.orders": the schema is the database's
 * business, and an underscore is not a space. These two are what every such
 * fallback reads; a label somebody chose always wins over both.
 */

/** `main.order_items` → `order items`. */
export function plainTableName(table: string): string {
  const name = table.split('.').pop() ?? table;
  return name.replace(/_+/g, ' ').trim();
}

/** `main.order_items` → `order item`: one row of it. */
export function entityFromTable(table: string): string {
  const name = plainTableName(table);
  return name.endsWith('s') && name.length > 1 ? name.slice(0, -1) : name;
}

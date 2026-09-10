// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The mapping editor's rules (34-invoices-add-on.md §3.7 steps 2–4; 34-T14).
 *
 * Pure functions, tested on their own, because this is where the page's real
 * decisions live: which columns may fill which slot, which tables are worth
 * offering first, and what "unmapped" means for a slot that has a default.
 *
 * ─── THE EDITOR KNOWS NO INVOICE CONCEPT ───────────────────────────────────
 *
 * Nothing here mentions tax, totals or line items. A slot is a `type` and a
 * `required` flag; a column is a logical type and a semantic tag. That is the
 * whole vocabulary, and it is what lets a folio provider or a certificate
 * provider drive this same page unchanged — which is the claim §7.5 makes
 * about the pipeline and this page has to keep on the screen.
 *
 * ─── SUGGESTION, NEVER SELECTION ───────────────────────────────────────────
 *
 * Every ranking below orders a list; none of them picks. The engine's
 * `line-items` inference in particular is a hint (§3.7 step 3) — a one-FK
 * child like `invoice_items` has to be chosen explicitly, because a wrong
 * guess here silently maps a document to the wrong rows and looks like
 * success.
 */

import type { OutlineSlot } from './api.js';

/**
 * What the editor needs to know about one source column.
 *
 * A SUPERSET of `SourceColumn` from `/automations/sources`, which this page
 * reuses rather than adding a second introspection endpoint: that route
 * already returns every connection's tables with their columns AND the
 * caller's per-table grants, which is steps 2, 3 and 7 of §3.7 in one call.
 * `semantic` is the one thing it does not carry, so it is optional and the
 * ranking degrades to the logical type without it.
 */
export interface ColumnFacts {
  name: string;
  label: string;
  logicalType: string;
  /** The engine's semantic tag: `money`, `email`, `currency`, `status-workflow`… */
  semantic?: string | undefined;
  nullable: boolean;
  primaryKey?: boolean | undefined;
  /** Masked or secret. A document may READ one; the panel says which (D16). */
  pii?: boolean | undefined;
}

export interface TableFacts {
  id: string;
  label: string;
  columns: readonly ColumnFacts[];
  /**
   * Tables whose rows point AT this one, with the column that does it.
   *
   * The server has already dropped every edge a mapping cannot store (a
   * composite key, or one referencing a column the pipeline does not join on),
   * so everything here is pickable. `lineItems` is the engine's guess, and it
   * only ever orders the list.
   */
  children?: readonly { table: string; column: string; lineItems?: boolean }[] | undefined;
  /** Whether the CALLER may read it — step 7's input, resolved server-side. */
  canRead?: boolean | undefined;
}

/**
 * Tables the profile reads that the CALLER cannot (§3.7 step 7, D16).
 *
 * Shown before saving, not discovered at render: a profile mapped by somebody
 * who cannot read one of its tables produces documents that fail for them and
 * work for an administrator, which is the most confusing possible outcome.
 */
export function unreadableTables(
  tables: readonly TableFacts[],
  reads: readonly string[],
): string[] {
  const byId = new Map(tables.map((table) => [table.id, table]));
  return reads.filter((id) => byId.get(id)?.canRead === false);
}

/**
 * Which columns may fill a slot of this type.
 *
 * PERMISSIVE BY DESIGN, with a preferred set surfaced first. A text slot
 * accepts any column, because a document draws whatever somebody points at it
 * and refusing a `varchar` for being an enum would be the editor having an
 * opinion about the operator's data. What the semantic tags buy is ORDER: the
 * right column is at the top rather than the only one on the list.
 */
export function columnsForSlot(
  slot: Pick<OutlineSlot, 'type'>,
  columns: readonly ColumnFacts[],
): { preferred: ColumnFacts[]; rest: ColumnFacts[] } {
  const prefers = (column: ColumnFacts): boolean => {
    switch (slot.type) {
      case 'money':
        return column.semantic === 'money' || /^(decimal|numeric|money)$/i.test(column.logicalType);
      case 'percent':
        return /^(decimal|numeric|real|double)$/i.test(column.logicalType);
      case 'email':
        return column.semantic === 'email';
      case 'currency':
        return column.semantic === 'currency' || /currency|ccy/i.test(column.name);
      case 'date':
        return /^(date|timestamp|datetime)/i.test(column.logicalType);
      case 'number':
        return /^(int|integer|bigint|smallint|decimal|numeric)/i.test(column.logicalType);
      case 'text[]':
      case 'text':
        return /^(varchar|text|char|citext)/i.test(column.logicalType);
      default:
        return false;
    }
  };
  const preferred = columns.filter(prefers);
  const rest = columns.filter((column) => !prefers(column));
  return { preferred, rest };
}

/**
 * Tables worth offering first as a document's header (§3.7 step 2).
 *
 * A table carrying a `money` column, or one with a child table pointing at it,
 * is what a document is usually drawn from. Everything else stays on the list,
 * below — a deployment whose invoices live in a table with no money column is
 * unusual, not wrong, and an editor that hid it would be unusable there.
 */
export function rankTables(tables: readonly TableFacts[]): TableFacts[] {
  const score = (table: TableFacts): number => {
    const hasMoney = table.columns.some((column) => column.semantic === 'money');
    const hasChildren = (table.children ?? []).length > 0;
    return (hasMoney ? 2 : 0) + (hasChildren ? 1 : 0);
  };
  return [...tables].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
}

/**
 * May this slot be given a value typed into the editor (§3.7 step 4)?
 *
 * OPTIONAL SCALARS, and slots the engine fills — the plan's own scope, plus
 * O26's line that a `default: sequence` slot may be overridden by an authored
 * value as well as by a column.
 *
 * A REQUIRED slot with no default is deliberately not on the list. Its whole
 * purpose is to carry something from the row being drawn, and a constant there
 * makes every document from the mapping say the same thing in the one field
 * that was supposed to tell them apart — which reads as a working mapping.
 * A collection is excluded because a typed value is a value, not a list.
 */
export function mayTypeValue(slot: Pick<OutlineSlot, 'type' | 'required' | 'default'>): boolean {
  if (slot.type === 'collection') return false;
  return !slot.required || slot.default !== undefined;
}

/**
 * The child tables worth offering first for a collection slot (§3.7 step 3).
 *
 * SUGGESTION, NEVER SELECTION — the list is ordered and never shortened. The
 * engine's `line-items` role needs two foreign keys plus qty × rate numerics,
 * so a one-FK child like `invoice_items` is untagged and would vanish from a
 * picker that filtered on it; a wrong guess there maps a document to the wrong
 * rows and looks like success.
 */
export function rankChildTables(
  children: readonly { table: string; column: string; lineItems?: boolean }[],
): { table: string; column: string; lineItems?: boolean }[] {
  return [...children].sort(
    (a, b) =>
      Number(b.lineItems === true) - Number(a.lineItems === true) || a.table.localeCompare(b.table),
  );
}

export type SlotBinding =
  | { kind: 'unmapped' }
  | { kind: 'column'; column: string }
  | { kind: 'lookup'; ref: string; column: string }
  | { kind: 'literal'; value: string }
  | {
      kind: 'collection';
      table: string;
      fkColumn: string;
      columns: Record<string, string>;
    };

export type Bindings = Record<string, SlotBinding>;

/**
 * Can this profile be saved?
 *
 * A REQUIRED slot must be bound — unless it has a `default`, which the ENGINE
 * fills (`sequence`, `now`, `connection`, `setting`). Getting that backwards
 * would block every save on a document number nobody has minted yet, which is
 * all of them at authoring time.
 */
export function unboundRequiredSlots(
  slots: readonly OutlineSlot[],
  bindings: Bindings,
): string[] {
  return slots
    .filter((slot) => slot.required && slot.default === undefined)
    .filter((slot) => (bindings[slot.id] ?? { kind: 'unmapped' }).kind === 'unmapped')
    .map((slot) => slot.id);
}

/** The wire shape the profile stores — only BOUND slots appear. */
export function toMapping(bindings: Bindings): Record<string, unknown> {
  const mapping: Record<string, unknown> = {};
  for (const [slotId, binding] of Object.entries(bindings)) {
    switch (binding.kind) {
      case 'column':
        mapping[slotId] = { column: binding.column };
        break;
      case 'lookup':
        mapping[slotId] = { ref: binding.ref, column: binding.column };
        break;
      case 'collection':
        mapping[slotId] = {
          collection: {
            table: binding.table,
            fkColumn: binding.fkColumn,
            columns: binding.columns,
          },
        };
        break;
      case 'literal':
      case 'unmapped':
        /*
         * NEITHER REACHES `mapping`, and they mean different things.
         *
         * `unmapped` is "the provider decides what an absent slot means" — for
         * the invoices provider that is no tax line at all (D20), which is the
         * only honest answer to a rate nobody entered.
         *
         * `literal` is a value typed HERE, and it belongs in `options` rather
         * than in the mapping: `mapping` says which columns are read, and a
         * literal is read from nothing. Keeping them apart is what lets the
         * editor show a bound field as its column name and a typed one as its
         * value, so an operator can see at a glance which half of the document
         * is live (O20).
         */
        break;
    }
  }
  return mapping;
}

/** The typed per-profile overrides, which live beside the mapping (§3.7 step 4). */
export function toLiterals(bindings: Bindings): Record<string, string> {
  const literals: Record<string, string> = {};
  for (const [slotId, binding] of Object.entries(bindings)) {
    if (binding.kind === 'literal') literals[slotId] = binding.value;
  }
  return literals;
}

/** Read a stored profile back into the editor's own shape. */
export function fromMapping(
  mapping: Record<string, unknown>,
  literals: Record<string, string> = {},
): Bindings {
  const bindings: Bindings = {};
  for (const [slotId, raw] of Object.entries(mapping)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const value = raw as Record<string, unknown>;
    if ('collection' in value) {
      const collection = value.collection as {
        table: string;
        fkColumn: string;
        columns: Record<string, string>;
      };
      bindings[slotId] = { kind: 'collection', ...collection };
    } else if ('ref' in value) {
      bindings[slotId] = {
        kind: 'lookup',
        ref: String(value.ref),
        column: String(value.column),
      };
    } else if ('column' in value) {
      bindings[slotId] = { kind: 'column', column: String(value.column) };
    }
  }
  for (const [slotId, value] of Object.entries(literals)) {
    bindings[slotId] = { kind: 'literal', value };
  }
  return bindings;
}

/**
 * Every table this profile reads — what the grants step resolves over.
 *
 * The same computation the SERVER does (`documents/subject.ts`'s
 * `mappedTables`), restated here rather than fetched, because the editor needs
 * it for a mapping that has not been saved yet. The two agreeing is asserted
 * by this module's own test against the same shapes.
 */
export function tablesRead(bindings: Bindings, headerTable: string): string[] {
  const tables = new Set<string>([headerTable]);
  for (const binding of Object.values(bindings)) {
    if (binding.kind === 'collection') tables.add(binding.table);
  }
  return [...tables];
}

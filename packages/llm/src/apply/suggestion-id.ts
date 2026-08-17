// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stable suggestion identity (06-llm-assist.md §8.1).
 *
 * Every atomic suggestion gets a deterministic id so accept/reject state
 * survives a reload and re-application is idempotent. Ids are pure functions of
 * the suggestion's coordinates — no timestamps, no counters, no ordering — so
 * the same suggestion always maps to the same id regardless of when or in what
 * order it is produced.
 *
 * Scheme (§8.1):
 *   label:public.orders                  table label+description+icon bundle
 *   label:public.orders.total_cents      column label+description bundle
 *   key:public.orders                    displayColumn + naturalKey
 *   enum:public.orders.status
 *   relation:public.orders.product_id->public.products.id
 *   pii:public.customers.email
 *   template:public.orders:page-queue-inbox
 *   group:sales
 *   dashboard:revenue
 *   widget:revenue:chart-line-area:3     dashboardId:widgetId:rank
 *   copy:public.orders                   microcopy bundle
 */

/** The id-prefix vocabulary. `label` is shared by table- and column-label ids. */
export const SUGGESTION_ID_PREFIXES = [
  'label',
  'key',
  'enum',
  'relation',
  'pii',
  'template',
  'group',
  'dashboard',
  'widget',
  'copy',
] as const;

export type SuggestionIdPrefix = (typeof SUGGESTION_ID_PREFIXES)[number];

// ─── Constructors ────────────────────────────────────────────────────────────

/** `label:<table>` — the table's label + description + icon bundle. */
export function tableLabelId(table: string): string {
  return `label:${table}`;
}

/** `label:<table>.<column>` — a column's label + description bundle. */
export function columnLabelId(table: string, column: string): string {
  return `label:${table}.${column}`;
}

/** `key:<table>` — the displayColumn + naturalKey bundle. */
export function keyId(table: string): string {
  return `key:${table}`;
}

/** `enum:<table>.<column>` — enum semantics for one column. */
export function enumId(table: string, column: string): string {
  return `enum:${table}.${column}`;
}

/**
 * `relation:<fromTable>.<fromCols>-><toTable>.<toCols>` — one inferred/confirmed
 * relation. Composite endpoints join their columns with `,` so multi-column FKs
 * stay distinct and stable.
 */
export function relationId(
  fromTable: string,
  fromColumns: readonly string[],
  toTable: string,
  toColumns: readonly string[],
): string {
  return `relation:${fromTable}.${fromColumns.join(',')}->${toTable}.${toColumns.join(',')}`;
}

/** `pii:<table>.<column>` — a column's PII flag + masking suggestion. */
export function piiId(table: string, column: string): string {
  return `pii:${table}.${column}`;
}

/** `template:<table>:<template>` — one page-template recommendation for a table. */
export function templateId(table: string, template: string): string {
  return `template:${table}:${template}`;
}

/** `group:<slug>` — a navigation group. */
export function groupId(group: string): string {
  return `group:${group}`;
}

/** `dashboard:<slug>` — a dashboard. */
export function dashboardId(dashboard: string): string {
  return `dashboard:${dashboard}`;
}

/** `widget:<dashboard>:<widget>:<rank>` — one widget within a dashboard. */
export function widgetId(dashboard: string, widget: string, rank: number): string {
  return `widget:${dashboard}:${widget}:${rank}`;
}

/** `copy:<table>` — the micro-copy bundle (empty state + subtitle) for a table. */
export function copyId(table: string): string {
  return `copy:${table}`;
}

// ─── Discriminated dispatcher ────────────────────────────────────────────────

/**
 * A reference to any atomic suggestion. `suggestionId(ref)` turns it into the
 * stable §8.1 id — the single entry point diff.ts / apply.ts use so the id
 * scheme lives in exactly one place.
 */
export type SuggestionRef =
  | { readonly kind: 'table-label'; readonly table: string }
  | { readonly kind: 'column-label'; readonly table: string; readonly column: string }
  | { readonly kind: 'key'; readonly table: string }
  | { readonly kind: 'enum'; readonly table: string; readonly column: string }
  | {
      readonly kind: 'relation';
      readonly fromTable: string;
      readonly fromColumns: readonly string[];
      readonly toTable: string;
      readonly toColumns: readonly string[];
    }
  | { readonly kind: 'pii'; readonly table: string; readonly column: string }
  | { readonly kind: 'template'; readonly table: string; readonly template: string }
  | { readonly kind: 'group'; readonly group: string }
  | { readonly kind: 'dashboard'; readonly dashboard: string }
  | {
      readonly kind: 'widget';
      readonly dashboard: string;
      readonly widget: string;
      readonly rank: number;
    }
  | { readonly kind: 'copy'; readonly table: string };

export function suggestionId(ref: SuggestionRef): string {
  switch (ref.kind) {
    case 'table-label':
      return tableLabelId(ref.table);
    case 'column-label':
      return columnLabelId(ref.table, ref.column);
    case 'key':
      return keyId(ref.table);
    case 'enum':
      return enumId(ref.table, ref.column);
    case 'relation':
      return relationId(ref.fromTable, ref.fromColumns, ref.toTable, ref.toColumns);
    case 'pii':
      return piiId(ref.table, ref.column);
    case 'template':
      return templateId(ref.table, ref.template);
    case 'group':
      return groupId(ref.group);
    case 'dashboard':
      return dashboardId(ref.dashboard);
    case 'widget':
      return widgetId(ref.dashboard, ref.widget, ref.rank);
    case 'copy':
      return copyId(ref.table);
  }
}

/** Extract the leading `<prefix>:` token of a suggestion id, if it is a known prefix. */
export function suggestionIdPrefix(id: string): SuggestionIdPrefix | null {
  const colon = id.indexOf(':');
  if (colon <= 0) return null;
  const prefix = id.slice(0, colon);
  return (SUGGESTION_ID_PREFIXES as readonly string[]).includes(prefix)
    ? (prefix as SuggestionIdPrefix)
    : null;
}

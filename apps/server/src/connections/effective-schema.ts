/**
 * Effective schema = active snapshot + active override ops applied in
 * created_at order, later ops winning per (op, table, column) target
 * (07-meta-store.md §3.15; M3-T06 read path). Pure functions — no I/O.
 *
 * The returned model is the snapshot's `DatabaseModel` JSON with
 * display-layer fields attached (`label`, `hidden`, `excluded`, …). It is a
 * reply/derived shape and is never re-parsed by the strict engine schema.
 */

import type { ColumnModel, DatabaseModel, Relation, SemanticTag, TableModel } from '@adminium/engine';
import type { SchemaOverride } from '@adminium/meta';

export interface EffectiveColumn extends ColumnModel {
  label?: string;
  hidden?: boolean;
  /** Resolved mask state (overrides > classifier default). */
  masked?: boolean;
  enumLabels?: Record<string, string>;
  enumTones?: Record<string, string>;
}

export interface EffectiveTable extends Omit<TableModel, 'columns'> {
  columns: EffectiveColumn[];
  label?: string;
  labelPlural?: string;
  icon?: string;
  excluded?: boolean;
  keyField?: string;
}

export interface EffectiveRelation extends Relation {
  label?: string;
}

export interface EffectiveModel extends Omit<DatabaseModel, 'tables' | 'relations'> {
  tables: EffectiveTable[];
  relations: EffectiveRelation[];
}

function tableId(table: TableModel): string {
  return table.id;
}

/** Locale every connection resolves L10n bundles to in v1 (06 §6.1: always required). */
const DEFAULT_LOCALE = 'en_US';

/** Resolve one §8.3 locale→string map to `locale`, falling back to en_US. */
function resolveLocalized(map: unknown, locale: string): string | null {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return null;
  const rec = map as Record<string, unknown>;
  const candidate = rec[locale] ?? rec[DEFAULT_LOCALE];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/**
 * Resolve a USER-authored label, which may be either shape
 * (23-runtime-translations.md §8).
 *
 * Until now a user rename was a bare string, so an operator who renamed
 * "Records" to "Patients" got one language forever — while `llm.label` rows
 * were already locale maps. That asymmetry is most of what "translations for
 * the micro-SaaS" means in practice, because data labels are the first thing
 * an operator changes.
 *
 * Both shapes are accepted permanently, not transitionally: a bare string is
 * the correct storage for a single-language workspace, and every existing row
 * is one. `''` keeps its established meaning of an explicit clear.
 */
function resolveUserLabel(value: unknown, locale: string): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  return resolveLocalized(value, locale);
}

/**
 * Effective table-label map (`tableName` → label) from active override rows.
 * Provenance user > llm > heuristic (06 §8.3): a user `table.label` row beats
 * an accepted `llm.label` bundle for the same table REGARDLESS of created_at
 * order; within one origin, later rows win (§3.15). `llm.label` values are
 * localized bundles — resolved to the connection's default locale (en_US).
 *
 * Shared by {@link applyOverrides} (the read path) and the generation
 * pipeline (`generate/run.ts` overlays it onto the parsed model so generated
 * page titles — and through `adminium_pages`, the sidebar nav — carry
 * renames).
 */
export function activeTableLabels(
  overrides: readonly SchemaOverride[],
  defaultLocale: string = DEFAULT_LOCALE,
): Map<string, string> {
  const labels = new Map<string, string>();
  const userLabeled = new Set<string>();
  for (const row of overrides) {
    if (row.status !== 'active') continue;
    const op: string = row.op;
    if (op === 'table.label') {
      // ANY active user row locks the table against llm bundles — including a
      // degenerate empty label (the write path now rejects '', but legacy rows
      // may exist). '' acts as an explicit clear so §3.15 later-row-wins holds
      // verbatim without ever emitting a label the engine's min(1) forbids.
      userLabeled.add(row.tableName);
      const label = resolveUserLabel(row.value.label, defaultLocale);
      if (label !== null) {
        labels.set(row.tableName, label);
      } else {
        labels.delete(row.tableName);
      }
    } else if (op === 'llm.label' && row.columnName === null && !userLabeled.has(row.tableName)) {
      const resolved = resolveLocalized(row.value.label, defaultLocale);
      if (resolved !== null) labels.set(row.tableName, resolved);
    }
  }
  return labels;
}

/**
 * Fold the `relation.add` / `relation.remove` ops of a set of active
 * overrides onto a relation list, in created_at order (§3.15 later-row-wins,
 * so add-then-remove and remove-then-add both mean what they read like).
 *
 * An accepted relation enters at `kind: 'override'`, `confidence: 1` — 05 §6:
 * a human decision is as certain as a declared foreign key, and outranks the
 * 0.8 gate every downstream detector applies. A removal matches
 * STRUCTURALLY, on (fromTable, fromColumn, toTable), not by id, which is what
 * lets it suppress a `declared-fk` and an `inferred-name` alike.
 *
 * Extracted from {@link applyOverrides} because the read path was the only
 * caller: `generate/run.ts` re-parsed the raw snapshot and never saw these
 * ops, so a relation a user accepted in the Studio remap editor showed up in
 * the schema browser and then vanished from the next regeneration. Both paths
 * now fold the same ops the same way.
 */
export function applyRelationOverrides(
  relations: readonly Relation[],
  overrides: readonly SchemaOverride[],
): Relation[] {
  let result: Relation[] = [...relations];
  for (const row of overrides) {
    if (row.status !== 'active') continue;
    const value: Record<string, unknown> = row.value;
    if ((row.op as string) === 'relation.add') {
      const from = row.tableName;
      const relation: Relation = {
        id: `override:${from}.${String(value.fromColumn)}->${String(value.toTable)}`,
        kind: 'override',
        cardinality:
          value.cardinality === 'many-to-one' ? 'one-to-many' : (value.cardinality as never),
        from: { tableId: from, columns: [value.fromColumn as string] },
        to: { tableId: value.toTable as string, columns: [value.toColumn as string] },
        through: null,
        onDelete: null,
        onUpdate: null,
        selfReferential: from === value.toTable,
        confidence: 1,
      };
      // An accepted relation SUPERSEDES the inferred one it was accepted
      // from: rule 1 emits `inferred-name:orders(customer_id)->customers(id)`
      // for the same pair, and keeping both would leave two edges between the
      // same two tables — a duplicate FK chip on every card, and a duplicated
      // join in the generated list page.
      result = [
        ...result.filter(
          (r) =>
            r.id !== relation.id &&
            !(
              r.through === null &&
              r.from.tableId === relation.from.tableId &&
              r.from.columns.length === 1 &&
              r.from.columns[0] === relation.from.columns[0] &&
              r.to.tableId === relation.to.tableId
            ),
        ),
        relation,
      ];
    } else if ((row.op as string) === 'relation.remove') {
      result = result.filter(
        (r) =>
          !(
            r.from.tableId === row.tableName &&
            r.from.columns.includes(value.fromColumn as string) &&
            r.to.tableId === value.toTable
          ),
      );
    }
  }
  return result;
}

export interface ApplyOverridesOptions {
  /** Locale `llm.label` L10n bundles resolve to; en_US in v1. */
  defaultLocale?: string;
}

/** Apply active override rows (already in created_at order) onto a snapshot model. */
export function applyOverrides(
  model: DatabaseModel,
  overrides: readonly SchemaOverride[],
  opts: ApplyOverridesOptions = {},
): EffectiveModel {
  const locale = opts.defaultLocale ?? DEFAULT_LOCALE;
  const effective = structuredClone(model) as unknown as EffectiveModel;
  // Relation add/remove resolves up-front from the ONE shared resolver
  // (`generate/run.ts` calls the same one), so `relation.label` below labels
  // the final set regardless of the order the two rows were written in.
  effective.relations = applyRelationOverrides(effective.relations, overrides);
  const tables = new Map<string, EffectiveTable>(effective.tables.map((t) => [tableId(t as TableModel), t]));
  const columnOf = (table: EffectiveTable | undefined, name: string | null): EffectiveColumn | undefined =>
    table?.columns.find((c) => c.name === name);

  // Provenance user > llm for COLUMN labels too: a user `column.label` row
  // locks its column against the llm bundle regardless of created_at order.
  const userLabeledColumns = new Set<string>();
  for (const row of overrides) {
    if (row.status === 'active' && (row.op as string) === 'column.label' && row.columnName !== null) {
      userLabeledColumns.add(`${row.tableName}\u0000${row.columnName}`);
    }
  }

  for (const row of overrides) {
    if (row.status !== 'active') continue;
    const table = tables.get(row.tableName);
    const value: Record<string, unknown> = row.value;
    switch (row.op as string) {
      case 'table.label': {
        if (table === undefined) break;
        // Empty label = explicit clear (legacy rows only — the write path
        // rejects ''); mirrors activeTableLabels so both paths agree. A
        // locale map resolves for the viewer's locale (23 §8).
        const label = resolveUserLabel(value.label, locale);
        if (label !== null) table.label = label;
        else delete table.label;
        const plural = resolveUserLabel(value.labelPlural, locale);
        if (plural !== null) table.labelPlural = plural;
        if (typeof value.icon === 'string') table.icon = value.icon;
        break;
      }
      case 'table.exclude': {
        if (table !== undefined) table.excluded = value.excluded === true;
        break;
      }
      case 'table.keyField': {
        if (table !== undefined) table.keyField = value.column as string;
        break;
      }
      case 'column.label': {
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        // Same '' = explicit clear normalization as table.label, and the same
        // both-shapes resolution; the row still locks the column against llm
        // bundles via userLabeledColumns.
        const label = resolveUserLabel(value.label, locale);
        if (label !== null) column.label = label;
        else delete column.label;
        break;
      }
      case 'column.semanticType': {
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        const semantics = column.semantics ?? {
          primary: 'plain' as const,
          flags: { secret: false, pii: null, maskedByDefault: false },
          format: null,
          pair: null,
          confidence: 1,
          source: 'override' as const,
        };
        column.semantics = {
          ...semantics,
          primary: value.semanticType as SemanticTag,
          confidence: 1,
          source: 'override',
        };
        break;
      }
      case 'column.enumLabels': {
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        column.enumLabels = value.labels as Record<string, string>;
        if (value.tones !== undefined) column.enumTones = value.tones as Record<string, string>;
        break;
      }
      case 'column.pii': {
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        column.masked = value.masked === true;
        if (column.semantics !== null && typeof value.kind === 'string') {
          column.semantics = {
            ...column.semantics,
            flags: { ...column.semantics.flags, pii: value.kind as never, maskedByDefault: value.masked === true },
          };
        }
        break;
      }
      case 'column.hidden': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.hidden = value.hidden === true;
        break;
      }
      case 'llm.label': {
        // §8.3 label bundle (origin 'llm'): `value.label` is a locale→string
        // map; table-scoped when columnName is null, column-scoped otherwise.
        // Silently skipped before M11 — the accepted rename never reached the
        // effective model. TABLE labels are folded in by the post-loop
        // `activeTableLabels` pass (single home for the user>llm precedence);
        // only the column scope is handled here.
        if (row.columnName === null) break;
        if (userLabeledColumns.has(`${row.tableName}\u0000${row.columnName}`)) break;
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        const resolved = resolveLocalized(value.label, locale);
        if (resolved !== null) column.label = resolved;
        break;
      }
      case 'relation.label': {
        const relation = effective.relations.find(
          (r) => r.from.tableId === row.tableName && r.from.columns.includes(value.fromColumn as string),
        );
        if (relation !== undefined) relation.label = value.label as string;
        break;
      }
    }
  }

  // Table labels last, from the ONE precedence-aware resolver — a user
  // `table.label` beats an accepted `llm.label` bundle whichever came first.
  for (const [name, label] of activeTableLabels(overrides, locale)) {
    const table = tables.get(name);
    if (table !== undefined) table.label = label;
  }

  return effective;
}

/**
 * Column mask/secret resolution for the serialization layer (08 §5.3).
 * Source of truth: `column.pii` override rows; classifier `maskedByDefault`
 * fills in when no row targets the column. `secret` columns are
 * hard-excluded (05 §7.1 rule 1) and not unmaskable.
 */
export interface TableColumnPolicy {
  masked: ReadonlySet<string>;
  secret: ReadonlySet<string>;
}

export function columnPolicyFor(table: EffectiveTable): TableColumnPolicy {
  const masked = new Set<string>();
  const secret = new Set<string>();
  for (const column of table.columns) {
    const semantics = column.semantics;
    if (semantics?.flags.secret === true || semantics?.primary === 'secret') {
      secret.add(column.name);
      continue;
    }
    const maskedByOverride = column.masked;
    const maskedByDefault = semantics?.flags.maskedByDefault === true;
    if (maskedByOverride ?? maskedByDefault) masked.add(column.name);
  }
  return { masked, secret };
}

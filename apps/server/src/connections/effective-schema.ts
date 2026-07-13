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

/** Apply active override rows (already in created_at order) onto a snapshot model. */
export function applyOverrides(model: DatabaseModel, overrides: readonly SchemaOverride[]): EffectiveModel {
  const effective = structuredClone(model) as unknown as EffectiveModel;
  const tables = new Map<string, EffectiveTable>(effective.tables.map((t) => [tableId(t as TableModel), t]));
  const columnOf = (table: EffectiveTable | undefined, name: string | null): EffectiveColumn | undefined =>
    table?.columns.find((c) => c.name === name);

  for (const row of overrides) {
    if (row.status !== 'active') continue;
    const table = tables.get(row.tableName);
    const value: Record<string, unknown> = row.value;
    switch (row.op) {
      case 'table.label': {
        if (table === undefined) break;
        table.label = value.label as string;
        if (typeof value.labelPlural === 'string') table.labelPlural = value.labelPlural;
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
        if (column !== undefined) column.label = value.label as string;
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
      case 'relation.add': {
        const from = row.tableName;
        const relation: EffectiveRelation = {
          id: `override:${from}.${String(value.fromColumn)}->${String(value.toTable)}`,
          kind: 'override',
          cardinality: value.cardinality === 'many-to-one' ? 'one-to-many' : (value.cardinality as never),
          from: { tableId: from, columns: [value.fromColumn as string] },
          to: { tableId: value.toTable as string, columns: [value.toColumn as string] },
          through: null,
          onDelete: null,
          onUpdate: null,
          selfReferential: from === value.toTable,
          confidence: 1,
        };
        effective.relations = [
          ...effective.relations.filter((r) => r.id !== relation.id),
          relation,
        ];
        break;
      }
      case 'relation.remove': {
        effective.relations = effective.relations.filter(
          (r) =>
            !(
              r.from.tableId === row.tableName &&
              r.from.columns.includes(value.fromColumn as string) &&
              r.to.tableId === value.toTable
            ),
        );
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

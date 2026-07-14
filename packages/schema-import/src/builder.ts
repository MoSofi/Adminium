/**
 * Intermediate model builder shared by all parsers. Parsers register table /
 * column / enum / relation DRAFTS with loose (possibly unqualified, possibly
 * dangling) references; `finalize()` resolves them, drops anything dangling
 * with a warning (an importable file must never fail because one FK points at
 * a table that is not in the file), synthesizes `Relation` entries from
 * column-level references, computes stats, and validates the result through
 * `parseDatabaseModel` so referential integrity is guaranteed at the boundary.
 */
import {
  parseDatabaseModel,
  type AdapterCapabilities,
  type Cardinality,
  type ColumnDefault,
  type DatabaseModel,
  type Dialect,
  type EnumDef,
  type FkAction,
  type LogicalType,
} from '@adminium/engine';

import { FORMAT_TO_IR, type Format } from './types.js';
import type { WarningList } from './warnings.js';

export interface ReferenceDraft {
  /** Target table name — may be unqualified or schema-qualified. */
  table: string;
  /** Target column; defaults to the target's primary key (or `id`). */
  column?: string | undefined;
  onDelete?: FkAction | null | undefined;
  onUpdate?: FkAction | null | undefined;
  /** Force cardinality (OneToOne decorators etc.); inferred otherwise. */
  cardinality?: Cardinality | undefined;
}

export interface ColumnDraft {
  name: string;
  dbType?: string | undefined;
  logicalType?: LogicalType | undefined;
  nullable?: boolean | undefined;
  default?: ColumnDefault | undefined;
  isPrimaryKey?: boolean | undefined;
  isUnique?: boolean | undefined;
  isGenerated?: boolean | undefined;
  /** EnumDef id; validated at finalize. */
  enumRef?: string | null | undefined;
  maxLength?: number | null | undefined;
  numericPrecision?: number | null | undefined;
  numericScale?: number | null | undefined;
  isArray?: boolean | undefined;
  comment?: string | null | undefined;
  references?: ReferenceDraft | null | undefined;
}

export interface IndexDraft {
  name: string;
  columns?: string[] | undefined;
  expression?: string | null | undefined;
  unique?: boolean | undefined;
  primary?: boolean | undefined;
  method?: string | null | undefined;
  partial?: boolean | undefined;
}

export interface TableDraft {
  name: string;
  schema?: string | undefined;
  kind?: 'table' | 'view' | 'materialized-view' | undefined;
  comment?: string | null | undefined;
  columns: ColumnDraft[];
  primaryKey: string[];
  uniques: { name: string | null; columns: string[] }[];
  checks: { name: string | null; expression: string }[];
  indexes: IndexDraft[];
}

export interface RelationDraft {
  kind: 'declared-fk' | 'inferred-join-table';
  cardinality: Cardinality;
  from: { table: string; columns: string[] };
  to: { table: string; columns: string[] };
  through?: { table: string; fromColumns: string[]; toColumns: string[] } | undefined;
  onDelete?: FkAction | null | undefined;
  onUpdate?: FkAction | null | undefined;
  confidence?: number | undefined;
}

export interface FinalizeOptions {
  format: Format;
  dialect: Dialect;
  name: string;
  capabilities?: Partial<AdapterCapabilities> | undefined;
}

export class ModelBuilder {
  private readonly tables: TableDraft[] = [];
  private readonly enums = new Map<string, EnumDef>();
  private readonly relationDrafts: RelationDraft[] = [];

  constructor(private readonly warnings: WarningList) {}

  addTable(draft: Partial<TableDraft> & { name: string }): TableDraft {
    const table: TableDraft = {
      name: draft.name,
      schema: draft.schema,
      kind: draft.kind,
      comment: draft.comment ?? null,
      columns: draft.columns ?? [],
      primaryKey: draft.primaryKey ?? [],
      uniques: draft.uniques ?? [],
      checks: draft.checks ?? [],
      indexes: draft.indexes ?? [],
    };
    this.tables.push(table);
    return table;
  }

  /** Look a draft table up by (possibly qualified) name. */
  getTable(name: string): TableDraft | undefined {
    const dot = name.lastIndexOf('.');
    const schema = dot === -1 ? null : name.slice(0, dot);
    const bare = dot === -1 ? name : name.slice(dot + 1);
    return this.tables.find(
      (t) =>
        (t.name === bare || t.name.toLowerCase() === bare.toLowerCase()) &&
        (schema === null || (t.schema ?? 'public') === schema),
    );
  }

  /** All table drafts registered so far (late passes over parsed content). */
  allTables(): readonly TableDraft[] {
    return this.tables;
  }

  addEnum(def: EnumDef): void {
    if (!this.enums.has(def.id)) this.enums.set(def.id, def);
  }

  getEnum(id: string): EnumDef | undefined {
    return this.enums.get(id);
  }

  /** Explicit relation (composite FK, many-to-many). Column-level FKs are synthesized from `references` drafts instead. */
  addRelation(draft: RelationDraft): void {
    this.relationDrafts.push(draft);
  }

  finalize(opts: FinalizeOptions): DatabaseModel {
    const tableId = (t: TableDraft): string => `${t.schema ?? 'public'}.${t.name}`;

    // Drop duplicate table declarations (dumps sometimes re-CREATE) and
    // column-less drafts (the IR requires at least one column per table).
    const seen = new Set<string>();
    const tables = this.tables.filter((t) => {
      const id = tableId(t);
      if (seen.has(id)) {
        this.warnings.add('duplicate-table', `duplicate definition of table "${id}" ignored`, id);
        return false;
      }
      if (t.columns.length === 0) {
        this.warnings.add('empty-table', `table "${id}" has no parseable columns and was dropped`, id);
        return false;
      }
      seen.add(id);
      return true;
    });
    // Keep the lookup index consistent with the surviving set so dropped
    // tables can no longer be resolved as FK/relation targets.
    this.tables.length = 0;
    this.tables.push(...tables);

    for (const table of tables) {
      const id = tableId(table);
      const colNames = new Set(table.columns.map((c) => c.name));

      // Reconcile primaryKey list <-> per-column flags.
      table.primaryKey = table.primaryKey.filter((c) => {
        if (!colNames.has(c)) {
          this.warnings.add('unknown-pk-column', `primary key column "${c}" not found on "${id}"`, id);
          return false;
        }
        return true;
      });
      for (const col of table.columns) {
        if (col.isPrimaryKey === true && !table.primaryKey.includes(col.name)) {
          table.primaryKey.push(col.name);
        }
      }
      for (const col of table.columns) {
        if (table.primaryKey.includes(col.name)) {
          col.isPrimaryKey = true;
          col.nullable = false;
        }
      }

      table.uniques = table.uniques.filter((u) => u.columns.every((c) => colNames.has(c)));
      for (const u of table.uniques) {
        if (u.columns.length === 1) {
          const col = table.columns.find((c) => c.name === u.columns[0]);
          if (col) col.isUnique = true;
        }
      }
      table.indexes = table.indexes.filter(
        (ix) => (ix.columns ?? []).every((c) => colNames.has(c)) || ix.expression != null,
      );

      // Enum refs must resolve.
      for (const col of table.columns) {
        if (col.enumRef != null && !this.enums.has(col.enumRef)) {
          this.warnings.add('unknown-enum', `enum "${col.enumRef}" for ${id}.${col.name} not found`, id);
          col.enumRef = null;
        }
      }
    }

    // Resolve column-level references → FK relations + IR mirror.
    const relations: Record<string, unknown>[] = [];
    const relationIds = new Set<string>();
    const pushRelation = (rel: {
      id: string;
      kind: string;
      cardinality: Cardinality;
      from: { tableId: string; columns: string[] };
      to: { tableId: string; columns: string[] };
      through?: { tableId: string; fromColumns: string[]; toColumns: string[] } | null;
      onDelete?: FkAction | null;
      onUpdate?: FkAction | null;
      confidence?: number;
    }): void => {
      if (relationIds.has(rel.id)) return;
      relationIds.add(rel.id);
      relations.push({
        id: rel.id,
        kind: rel.kind,
        cardinality: rel.cardinality,
        from: rel.from,
        to: rel.to,
        through: rel.through ?? null,
        onDelete: rel.onDelete ?? null,
        onUpdate: rel.onUpdate ?? null,
        selfReferential: rel.from.tableId === rel.to.tableId,
        confidence: rel.confidence ?? 1,
      });
    };

    const resolveEndpoint = (
      table: string,
      columns: string[],
      context: string,
    ): { table: TableDraft; id: string } | null => {
      const target = this.getTable(table);
      if (!target) {
        this.warnings.add('unresolved-reference', `${context}: table "${table}" is not part of the import`);
        return null;
      }
      const known = new Set(target.columns.map((c) => c.name));
      for (const col of columns) {
        if (!known.has(col)) {
          this.warnings.add(
            'unresolved-reference',
            `${context}: column "${col}" not found on "${tableId(target)}"`,
          );
          return null;
        }
      }
      return { table: target, id: tableId(target) };
    };

    for (const table of tables) {
      const fromId = tableId(table);
      for (const col of table.columns) {
        const ref = col.references;
        if (ref == null) continue;
        const target = this.getTable(ref.table);
        if (!target) {
          this.warnings.add(
            'unresolved-reference',
            `foreign key ${fromId}.${col.name}: table "${ref.table}" is not part of the import`,
            fromId,
          );
          col.references = null;
          continue;
        }
        const toColumn = ref.column ?? target.primaryKey[0] ?? 'id';
        if (!target.columns.some((c) => c.name === toColumn)) {
          this.warnings.add(
            'unresolved-reference',
            `foreign key ${fromId}.${col.name}: column "${toColumn}" not found on "${tableId(target)}"`,
            fromId,
          );
          col.references = null;
          continue;
        }
        const toId = tableId(target);
        const soleKey =
          col.isUnique === true || (table.primaryKey.length === 1 && table.primaryKey[0] === col.name);
        pushRelation({
          id: `fk:${fromId}.${col.name}->${toId}.${toColumn}`,
          kind: 'declared-fk',
          cardinality: ref.cardinality ?? (soleKey ? 'one-to-one' : 'one-to-many'),
          from: { tableId: fromId, columns: [col.name] },
          to: { tableId: toId, columns: [toColumn] },
          onDelete: ref.onDelete ?? null,
          onUpdate: ref.onUpdate ?? null,
        });
        // Rewrite the draft into the resolved IR mirror shape via a marker.
        col.references = { table: toId, column: toColumn };
      }
    }

    for (const draft of this.relationDrafts) {
      const from = resolveEndpoint(draft.from.table, draft.from.columns, `relation from "${draft.from.table}"`);
      const to = resolveEndpoint(draft.to.table, draft.to.columns, `relation to "${draft.to.table}"`);
      if (!from || !to) continue;
      let through: { tableId: string; fromColumns: string[]; toColumns: string[] } | null = null;
      if (draft.through) {
        const t = resolveEndpoint(
          draft.through.table,
          [...draft.through.fromColumns, ...draft.through.toColumns],
          `relation through "${draft.through.table}"`,
        );
        if (!t) continue;
        through = {
          tableId: t.id,
          fromColumns: draft.through.fromColumns,
          toColumns: draft.through.toColumns,
        };
      }
      const label = draft.kind === 'inferred-join-table' ? 'm2m' : 'fk';
      pushRelation({
        id: `${label}:${from.id}(${draft.from.columns.join('+')})->${to.id}(${draft.to.columns.join('+')})`,
        kind: draft.kind,
        cardinality: draft.cardinality,
        from: { tableId: from.id, columns: draft.from.columns },
        to: { tableId: to.id, columns: draft.to.columns },
        through,
        onDelete: draft.onDelete ?? null,
        onUpdate: draft.onUpdate ?? null,
        confidence: draft.confidence ?? 1,
      });
      // Mirror single-column declared FKs onto the column when not already set.
      if (draft.kind === 'declared-fk' && draft.from.columns.length === 1) {
        const col = from.table.columns.find((c) => c.name === draft.from.columns[0]);
        if (col && col.references == null) {
          col.references = { table: to.id, column: draft.to.columns[0] as string };
        }
      }
    }

    const tableInputs = tables.map((table) => {
      const id = tableId(table);
      return {
        id,
        schema: table.schema ?? 'public',
        name: table.name,
        kind: table.kind ?? 'table',
        comment: table.comment ?? null,
        columns: table.columns.map((col, i) => {
          return {
            name: col.name,
            ordinal: i + 1,
            dbType: col.dbType ?? 'text',
            logicalType: col.logicalType ?? 'text',
            nullable: col.nullable ?? true,
            default: col.default ?? null,
            isPrimaryKey: col.isPrimaryKey ?? false,
            isUnique: col.isUnique ?? false,
            isGenerated: col.isGenerated ?? false,
            enumRef: col.enumRef ?? null,
            maxLength: col.maxLength ?? null,
            numericPrecision: col.numericPrecision ?? null,
            numericScale: col.numericScale ?? null,
            isArray: col.isArray ?? false,
            comment: col.comment ?? null,
            references:
              col.references == null
                ? null
                : { tableId: col.references.table, column: col.references.column as string },
            semantics: null,
          };
        }),
        primaryKey: table.primaryKey,
        uniques: table.uniques,
        checks: table.checks,
        indexes: table.indexes.map((ix) => ({
          name: ix.name,
          columns: ix.columns ?? [],
          expression: ix.expression ?? null,
          unique: ix.unique ?? false,
          primary: ix.primary ?? false,
          method: ix.method ?? null,
          partial: ix.partial ?? false,
        })),
      };
    });

    const enums = [...this.enums.values()];
    const columnCount = tables.reduce((n, t) => n + t.columns.length, 0);

    return parseDatabaseModel({
      irVersion: 1,
      dialect: opts.dialect,
      source: { kind: 'import', format: FORMAT_TO_IR[opts.format] },
      name: opts.name,
      defaultSchema: 'public',
      schemas:
        tables.length === 0 ? ['public'] : [...new Set(tables.map((t) => t.schema ?? 'public'))].sort(),
      tables: tableInputs,
      enums,
      relations,
      capabilities: { ...(opts.capabilities ?? {}) },
      stats: {
        tableCount: tables.length,
        columnCount,
        relationCount: relations.length,
        durationMs: 0,
      },
      warnings: this.warnings.toModelWarnings(),
    });
  }
}

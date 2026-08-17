// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Snapshot-backed identifier allowlisting (08-server-api.md §2.7 / §7 item 1):
 * every `:table` and column name in a data request resolves against the
 * active schema snapshot — the strings that reach SQL are the snapshot's
 * own, never the client's. Unknown identifiers → 422 `UNKNOWN_IDENTIFIER`;
 * masked/secret columns → 403 `COLUMN_FORBIDDEN` (§5.3).
 */

import type { LogicalType } from '@adminium/engine';

import { AppError, ForbiddenError } from '../errors.js';
import type { EffectiveModel, EffectiveTable } from '../connections/effective-schema.js';
import { columnPolicyFor } from '../connections/effective-schema.js';

/**
 * Text-ish logical types the `q=` quick search matches over (§2.7.1).
 * `enum`/`uuid` are excluded — PG has no ILIKE operator for them without a
 * cast, and casting is a widget-data concern (04 §5), not quick search.
 */
const TEXTISH: ReadonlySet<LogicalType> = new Set(['text', 'varchar']);

export class UnknownIdentifierError extends AppError {
  override readonly name = 'UnknownIdentifierError';

  constructor(message: string, details?: unknown) {
    super(422, 'UNKNOWN_IDENTIFIER', message, details);
  }
}

export interface ResolvedColumn {
  /** The snapshot's own column name — safe to pass to dynamic Kysely. */
  name: string;
  logicalType: LogicalType;
  nullable: boolean;
  isPrimaryKey: boolean;
  masked: boolean;
  secret: boolean;
  textish: boolean;
}

export interface ResolvedTable {
  /** Qualified snapshot id, e.g. `public.customers` — safe for SQL. */
  id: string;
  schema: string;
  name: string;
  /** Ordered PK column names; empty ⇒ read-only (no mutations, no undo). */
  primaryKey: string[];
  columns: Map<string, ResolvedColumn>;
  /** Views / PK-less tables are read-only variants (05 §8.2). */
  readOnly: boolean;
  table: EffectiveTable;
}

export class SnapshotView {
  readonly connectionId: string;
  readonly model: EffectiveModel;
  readonly #tables = new Map<string, ResolvedTable>();

  constructor(connectionId: string, model: EffectiveModel) {
    this.connectionId = connectionId;
    this.model = model;
    for (const table of model.tables) {
      const policy = columnPolicyFor(table);
      const columns = new Map<string, ResolvedColumn>();
      for (const column of table.columns) {
        columns.set(column.name, {
          name: column.name,
          logicalType: column.logicalType,
          nullable: column.nullable,
          isPrimaryKey: column.isPrimaryKey,
          masked: policy.masked.has(column.name),
          secret: policy.secret.has(column.name),
          textish: TEXTISH.has(column.logicalType),
        });
      }
      const resolved: ResolvedTable = {
        id: table.id,
        schema: table.schema,
        name: table.name,
        primaryKey: [...table.primaryKey],
        columns,
        readOnly: table.kind !== 'table' || table.primaryKey.length === 0,
        table,
      };
      this.#tables.set(table.id, resolved);
      if (table.schema === model.defaultSchema) this.#tables.set(table.name, resolved);
    }
  }

  /** Resolve the client's `:table` segment to snapshot identifiers (422 otherwise). */
  table(clientName: string): ResolvedTable {
    const resolved = this.#tables.get(clientName);
    if (resolved === undefined) {
      throw new UnknownIdentifierError(`Unknown table ${JSON.stringify(clientName)}.`, {
        table: clientName,
      });
    }
    return resolved;
  }

  /** Resolve a column; secret columns are invisible (422, §7.1 rule 1). */
  column(table: ResolvedTable, clientName: string): ResolvedColumn {
    const column = table.columns.get(clientName);
    if (column === undefined || column.secret) {
      throw new UnknownIdentifierError(
        `Unknown column ${JSON.stringify(clientName)} on ${table.id}.`,
        { table: table.id, column: clientName },
      );
    }
    return column;
  }

  /** Resolve a column that the caller intends to read/filter/sort (403 when masked). */
  readableColumn(table: ResolvedTable, clientName: string, canReadPii: boolean): ResolvedColumn {
    const column = this.column(table, clientName);
    if (column.masked && !canReadPii) {
      throw new ForbiddenError(
        `Column ${JSON.stringify(clientName)} is masked for your role.`,
        'COLUMN_FORBIDDEN',
        { table: table.id, column: clientName },
      );
    }
    return column;
  }

  /** Non-secret columns, for the default SELECT list. */
  selectableColumns(table: ResolvedTable): ResolvedColumn[] {
    return [...table.columns.values()].filter((column) => !column.secret);
  }

  /** Inbound relations (other tables' FKs pointing here) for reference counts. */
  inboundRelations(table: ResolvedTable): { relationId: string; fromTable: string; fromColumns: string[]; toColumns: string[] }[] {
    return this.model.relations
      .filter((relation) => relation.to.tableId === table.id && relation.through === null)
      .map((relation) => ({
        relationId: relation.id,
        fromTable: relation.from.tableId,
        fromColumns: [...relation.from.columns],
        toColumns: [...relation.to.columns],
      }));
  }
}

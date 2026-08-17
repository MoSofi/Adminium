// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test fixture: a small effective model (northwind-ish customers / orders /
 * order_notes) in the exact shape `GET /connections/:id/schema` replies with
 * — engine `DatabaseModel` output + the server's applied display fields.
 * Used by the remap editor tests only.
 */
import type { AdapterCapabilities, ColumnModel, TableModel } from '@adminium/engine';

import type { EffectiveColumn, EffectiveModel, EffectiveTable, SchemaReply } from './model.js';
import type { GenerateReply } from './model.js';
import type { OverrideDto } from './overrides.js';

const capabilities: AdapterCapabilities = {
  hasEnums: true,
  hasFKs: true,
  hasSchemas: true,
  hasComments: true,
  hasChecks: true,
  hasRLS: true,
  hasMaterializedViews: true,
  hasRowEstimates: true,
  supportsStatementTimeout: true,
  supportsReturning: true,
  maxIdentifierLength: 63,
};

export function makeColumn(partial: Partial<ColumnModel> & { name: string }): EffectiveColumn {
  return {
    ordinal: 0,
    dbType: 'text',
    logicalType: 'text',
    nullable: true,
    default: null,
    isPrimaryKey: false,
    isUnique: false,
    isGenerated: false,
    enumRef: null,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    isArray: false,
    comment: null,
    references: null,
    semantics: null,
    ...partial,
  };
}

export function makeTable(
  partial: Partial<Omit<TableModel, 'columns'>> & { name: string; columns: EffectiveColumn[] },
): EffectiveTable {
  const schema = partial.schema ?? 'public';
  return {
    id: `${schema}.${partial.name}`,
    schema,
    kind: 'table',
    comment: null,
    primaryKey: ['id'],
    uniques: [],
    checks: [],
    indexes: [],
    rowCountEstimate: 100,
    rowCountExact: false,
    sizeBytes: null,
    activity: null,
    rls: null,
    system: false,
    semantics: null,
    ...partial,
  };
}

export function makeModel(): EffectiveModel {
  const customers = makeTable({
    name: 'customers',
    semantics: { role: 'people', hierarchy: null, polymorphic: [] },
    columns: [
      makeColumn({
        name: 'id',
        ordinal: 1,
        dbType: 'uuid',
        logicalType: 'uuid',
        nullable: false,
        isPrimaryKey: true,
        semantics: {
          primary: 'pk-id',
          flags: { secret: false, pii: null, maskedByDefault: false },
          format: 'mono',
          pair: null,
          confidence: 1,
          source: 'heuristic',
        },
      }),
      makeColumn({
        name: 'name',
        ordinal: 2,
        dbType: 'character varying(120)',
        logicalType: 'varchar',
        nullable: false,
        semantics: {
          primary: 'person-name',
          flags: { secret: false, pii: 'person-name', maskedByDefault: false },
          format: null,
          pair: null,
          confidence: 0.85,
          source: 'heuristic',
        },
      }),
      makeColumn({
        name: 'email',
        ordinal: 3,
        dbType: 'character varying(200)',
        logicalType: 'varchar',
        nullable: false,
        isUnique: true,
        semantics: {
          primary: 'email',
          flags: { secret: false, pii: 'email', maskedByDefault: true },
          format: null,
          pair: null,
          confidence: 0.97,
          source: 'heuristic',
        },
      }),
    ],
  });

  const orders = makeTable({
    name: 'orders',
    semantics: { role: 'entity', hierarchy: null, polymorphic: [] },
    columns: [
      makeColumn({ name: 'id', ordinal: 1, dbType: 'bigint', logicalType: 'bigint', nullable: false, isPrimaryKey: true }),
      makeColumn({
        name: 'customer_id',
        ordinal: 2,
        dbType: 'uuid',
        logicalType: 'uuid',
        nullable: false,
        references: { tableId: 'public.customers', column: 'id' },
        semantics: {
          primary: 'fk',
          flags: { secret: false, pii: null, maskedByDefault: false },
          format: null,
          pair: null,
          confidence: 1,
          source: 'heuristic',
        },
      }),
      makeColumn({
        name: 'status',
        ordinal: 3,
        dbType: 'order_status',
        logicalType: 'enum',
        nullable: false,
        enumRef: 'public.order_status',
        semantics: {
          primary: 'status-workflow',
          flags: { secret: false, pii: null, maskedByDefault: false },
          format: null,
          pair: null,
          confidence: 0.9,
          source: 'heuristic',
        },
      }),
      makeColumn({
        name: 'total',
        ordinal: 4,
        dbType: 'numeric(12,2)',
        logicalType: 'decimal',
        nullable: false,
        numericPrecision: 12,
        numericScale: 2,
        semantics: {
          primary: 'money',
          flags: { secret: false, pii: null, maskedByDefault: false },
          format: 'currency',
          pair: null,
          confidence: 0.8,
          source: 'heuristic',
        },
      }),
    ],
  });

  const orderNotes = makeTable({
    name: 'order_notes',
    semantics: { role: 'log', hierarchy: null, polymorphic: [] },
    columns: [
      makeColumn({ name: 'id', ordinal: 1, dbType: 'bigint', logicalType: 'bigint', nullable: false, isPrimaryKey: true }),
      makeColumn({ name: 'order_ref', ordinal: 2, dbType: 'bigint', logicalType: 'bigint', nullable: false }),
      makeColumn({ name: 'body', ordinal: 3, dbType: 'text', logicalType: 'text' }),
    ],
  });

  return {
    irVersion: 1,
    dialect: 'postgres',
    source: { kind: 'live', connectionId: 'conn_1' },
    name: 'northwind',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [customers, orders, orderNotes],
    enums: [
      {
        id: 'public.order_status',
        name: 'order_status',
        values: ['pending', 'paid', 'cancelled'],
        source: 'native',
      },
    ],
    relations: [
      {
        id: 'fk:public.orders.customer_id',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'public.orders', columns: ['customer_id'] },
        to: { tableId: 'public.customers', columns: ['id'] },
        through: null,
        onDelete: 'cascade',
        onUpdate: null,
        selfReferential: false,
        confidence: 1,
      },
      {
        id: 'inferred:public.order_notes.order_ref',
        kind: 'inferred-name',
        cardinality: 'one-to-many',
        from: { tableId: 'public.order_notes', columns: ['order_ref'] },
        to: { tableId: 'public.orders', columns: ['id'] },
        through: null,
        onDelete: null,
        onUpdate: null,
        selfReferential: false,
        confidence: 0.72,
      },
    ],
    capabilities,
    introspectedAt: '2026-07-14T00:00:00.000Z',
    stats: { tableCount: 3, columnCount: 10, relationCount: 2, durationMs: 12 },
    warnings: [],
  };
}

export function makeSchemaReply(model: EffectiveModel = makeModel(), appliedOverrides = 0): SchemaReply {
  return {
    connectionId: 'conn_1',
    snapshotId: 'snap_1',
    checksum: 'sha256:fixture',
    createdAt: 1,
    source: 'introspection',
    model,
    appliedOverrides,
  };
}

export function makeOverrideRow(partial: Partial<OverrideDto> & Pick<OverrideDto, 'op' | 'tableName' | 'value'>): OverrideDto {
  return {
    id: `ovr_${partial.op}_${partial.tableName}`,
    columnName: null,
    origin: 'user',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

export function makeGenerateReply(): GenerateReply {
  return {
    pages: 5,
    navGroups: ['workspace'],
    snapshotId: 'snap_1',
    introspected: false,
    intent: 'full-admin',
    result: { created: 1, updated: 2, unchanged: 2, pruned: 0 },
    warnings: [],
    durationMs: 40,
  };
}

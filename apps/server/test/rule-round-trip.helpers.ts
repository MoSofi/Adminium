// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the stored-form round trips share: a manifest's rules as its install
 * stores them, and the database its tables make.
 */
import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { validateManifest, type ColumnRules, type Manifest } from '@adminium/manifest';
import { validateOverrideInput, type SchemaOverride } from '@adminium/meta';
import type { expect as Expect } from 'vitest';

import { opsForRules, realRuleRefs, tableOpsFor, type RuleOp } from '../src/apps/manifest-rules.js';

type Tables = NonNullable<Manifest['requiredSchema']>['tables'];

export const manifestOf = (doc: unknown): Manifest => {
  const result = validateManifest(doc);
  if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  return result.manifest;
};


const LOGICAL: Record<string, string> = { int: 'integer', bigint: 'bigint', text: 'text', decimal: 'decimal', money: 'decimal', bool: 'boolean', enum: 'text', fk: 'integer', timestamptz: 'timestamptz', date: 'date' };

/** The database a manifest's tables make, under a prefix, as introspection reads it. */
export function modelOf(tables: Tables, prefix: string): DatabaseModel {
  const real = (ref: string) => `${prefix}${ref}`;
  return applyClassification(
    parseDatabaseModel({
      dialect: 'postgres',
      name: 'shop',
      defaultSchema: 'public',
      schemas: ['public'],
      tables: tables.map((table) => ({
        schema: 'public',
        name: real(table.ref),
        primaryKey: ['id'],
        columns: table.columns.map((column) => ({
          name: column.ref,
          logicalType: LOGICAL[column.type] ?? 'text',
          nullable: column.role === 'pk' ? false : column.nullable === true,
          ...(column.role === 'pk' ? { isPrimaryKey: true, default: { kind: 'autoincrement' } } : {}),
        })),
      })),
      relations: tables.flatMap((table) =>
        table.columns.flatMap((column) =>
          column.type === 'fk' && column.references !== undefined
            ? [{ id: `fk:${table.ref}-${column.ref}`, kind: 'declared-fk', cardinality: 'one-to-many', from: { tableId: `public.${real(table.ref)}`, columns: [column.ref] }, to: { tableId: `public.${real(column.references)}`, columns: ['id'] }, onDelete: 'no-action' }]
            : [],
        ),
      ),
    }),
  ) as DatabaseModel;
}

export interface Stored {
  rows: SchemaOverride[];
  /** Per `<op>|<table>|<column>`: the value the rule had before it was stored. */
  sent: Map<string, Record<string, unknown>>;
}

/** Every rule of a manifest, as its install stores it: mapped to the real tables, then through the stored payload's schema. */
export function store(manifest: Manifest, prefix: string, expect: typeof Expect): Stored {
  const tables = manifest.requiredSchema?.tables ?? [];
  const realId = (ref: string) => (tables.some((table) => table.ref === ref) ? `public.${prefix}${ref}` : '');
  const rows: SchemaOverride[] = [];
  const sent = new Map<string, Record<string, unknown>>();
  const add = (op: RuleOp, tableRef: string, column: string | null, value: Record<string, unknown>) => {
    const mapped = realRuleRefs(op, value, realId, manifest.key);
    expect(mapped.missing, `${op} ${tableRef}.${String(column)}`).toEqual([]);
    const tableName = realId(tableRef);
    const patch = validateOverrideInput({ connectionId: 'cnx', op, tableName, columnName: column, value: mapped.value });
    sent.set(`${op}|${tableRef}|${column ?? ''}`, mapped.value);
    rows.push({ id: `ovr_${String(rows.length)}`, connectionId: 'cnx', op: patch.op, tableName, columnName: column, value: patch.value as Record<string, unknown>, origin: 'app', llmRunId: null, status: 'active', createdBy: null, createdAt: 0, updatedAt: 0 });
  };
  for (const table of tables) {
    for (const column of table.columns) {
      for (const rule of opsForRules(manifest.key, (column.rules ?? {}) as ColumnRules)) add(rule.op, table.ref, column.ref, rule.value);
    }
    for (const rule of tableOpsFor(table)) add(rule.op, table.ref, null, rule.value);
  }
  return { rows, sent };
}


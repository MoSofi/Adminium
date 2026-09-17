// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `schema/<database>.json`: one database's schema customizations as a file.
 *
 * The file lists the connection's override rows (labels, hidden and excluded
 * tables and columns, masks, relations, and what AI assist added), each with
 * who set it. What it leaves out:
 *
 * - `auto` rows, the engine's own guesses (automatic PII masks), because every
 *   install derives them again from its own database;
 * - superseded rows: of several rows for the same target and origin, only the
 *   one that applies is kept (the last active one, or the last one when none
 *   is active);
 * - ids, run ids and creators, which only mean something on one install.
 *
 * Rows are sorted by table, column, op and origin, so an edit changes only its
 * own lines.
 */

import {
  llmOverrideField,
  overrideStatusSchema,
  validateLlmOverride,
  validateOverrideInput,
  type ProjectOverrideInput,
  type SchemaOverride,
} from '@adminium/meta';

import { findInstanceIds } from './instance-ids.js';

/** Where the published JSON Schema sits, seen from `schema/`. */
export const SCHEMA_FILE_SCHEMA_REF = '../node_modules/@adminiumjs/adminium/schemas/schema.json';

const ROW_KEYS = ['table', 'column', 'op', 'value', 'origin', 'status', 'confidence'] as const;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Joins the parts of a sort key; no table or column name contains it. */
const SEPARATOR = String.fromCharCode(0);

function sortKey(row: { tableName: string; columnName?: string | null | undefined; op: string; origin: string }): string {
  return [row.tableName, row.columnName ?? '', row.op, row.origin].join(SEPARATOR);
}

/** The file for a connection's override rows, in application order. */
export function toSchemaFile(rows: readonly SchemaOverride[]): Record<string, unknown> {
  // Later rows win, and an active row outranks a disabled one for the same target.
  const kept = new Map<string, SchemaOverride>();
  for (const row of rows) {
    if (row.origin === 'auto') continue;
    const key = sortKey(row);
    const current = kept.get(key);
    if (current === undefined || row.status === 'active' || current.status !== 'active') kept.set(key, row);
  }
  const overrides = [...kept.values()]
    .sort((a, b) => compare(sortKey(a), sortKey(b)))
    .map((row) => {
      const out: Record<string, unknown> = { table: row.tableName };
      if (row.columnName !== null) out['column'] = row.columnName;
      out['op'] = row.op;
      out['value'] = row.value;
      if (row.origin !== 'user') out['origin'] = row.origin;
      if (row.status !== 'active') out['status'] = row.status;
      if (row.confidence !== undefined && row.confidence !== null) out['confidence'] = row.confidence;
      return out;
    });
  return { $schema: SCHEMA_FILE_SCHEMA_REF, overrides };
}

export type ReadSchemaFileResult =
  | { ok: true; rows: ProjectOverrideInput[] }
  | { ok: false; problems: string[] };

function describeError(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    const issues = error.issues as { path?: PropertyKey[]; message?: string }[];
    const first = issues[0];
    if (first !== undefined) {
      const where = (first.path ?? []).map(String).join('.');
      return where === '' ? String(first.message) : `${where}: ${String(first.message)}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** Check a parsed schema file and turn it into rows to store. */
export function readSchemaFile(value: unknown): ReadSchemaFileResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: ['(the file): must be a JSON object'] };
  }
  const file = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(file)) {
    if (key !== '$schema' && key !== 'overrides') problems.push(`${key}: is not a known key`);
  }
  if (file['$schema'] !== undefined && typeof file['$schema'] !== 'string') problems.push('$schema: must be a string');
  const list = file['overrides'];
  if (!Array.isArray(list)) return { ok: false, problems: [...problems, 'overrides: must be a list'] };
  for (const finding of findInstanceIds(list)) problems.push(`overrides${finding.path.startsWith('[') ? '' : '.'}${finding.path}: ${finding.message}`);

  const rows: ProjectOverrideInput[] = [];
  const seen = new Set<string>();
  list.forEach((item: unknown, index) => {
    const where = `overrides[${String(index)}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      problems.push(`${where}: must be an object`);
      return;
    }
    const row = item as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (!(ROW_KEYS as readonly string[]).includes(key)) problems.push(`${where}.${key}: is not a known key`);
    }
    const { table, column, op, origin = 'user', status = 'active', confidence } = row;
    if (typeof table !== 'string' || table.length === 0) {
      problems.push(`${where}.table: must name a table, like "public.customers"`);
      return;
    }
    if (column !== undefined && (typeof column !== 'string' || column.length === 0)) {
      problems.push(`${where}.column: must name a column`);
      return;
    }
    if (typeof op !== 'string') {
      problems.push(`${where}.op: must be a string`);
      return;
    }
    if (origin !== 'user' && origin !== 'llm') {
      problems.push(`${where}.origin: must be user or llm`);
      return;
    }
    if (!overrideStatusSchema.safeParse(status).success) {
      problems.push(`${where}.status: must be active or disabled`);
      return;
    }
    if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) {
      problems.push(`${where}.confidence: must be a number from 0 to 1`);
      return;
    }
    const columnName = typeof column === 'string' ? column : null;
    try {
      if (llmOverrideField(op) !== null) {
        if (origin !== 'llm') throw new Error(`op ${op} is written by AI assist; set "origin": "llm"`);
        validateLlmOverride(op, columnName, row['value']);
      } else {
        const parsed = validateOverrideInput({ connectionId: 'file', op, tableName: table, columnName, value: row['value'] });
        // The stored value is the parsed one, so a key the op does not use
        // would vanish on the way in and the file would never match again.
        const known = new Set(Object.keys(parsed.value));
        const unknown = Object.keys(row['value'] as Record<string, unknown>).filter((key) => !known.has(key));
        if (unknown.length > 0) {
          throw new Error(`value.${unknown[0] ?? ''}: is not part of ${op}`);
        }
      }
    } catch (error) {
      problems.push(`${where}: ${describeError(error)}`);
      return;
    }
    const key = sortKey({ tableName: table, columnName, op, origin });
    if (seen.has(key)) {
      problems.push(`${where}: another row already sets ${op} on ${columnName === null ? table : `${table}.${columnName}`}`);
      return;
    }
    seen.add(key);
    rows.push({
      op,
      tableName: table,
      columnName,
      value: row['value'],
      origin,
      status: status as 'active' | 'disabled',
      confidence: typeof confidence === 'number' ? confidence : null,
    });
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, rows };
}

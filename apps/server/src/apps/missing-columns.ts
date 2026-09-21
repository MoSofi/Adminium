// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The columns an app update needs on a table that already exists — as an edit
 * the operator can review and run, rather than a refusal they cannot act on.
 *
 * ─── Why this exists ──────────────────────────────────────────────────────
 *
 * An update that needs a column on an existing table used to throw
 * `COLUMNS_REQUIRED` and stop. The rule behind that — the installer must not
 * alter a table the operator owns — is right, and it stays: the installer
 * still never alters one. What changed is that stopping was the only outcome,
 * and a non-expert had no path forward at all. The alteration is
 * now OFFERED, as plan 35's `addColumns` edit, and runs only through the
 * schema doors — plan, the exact statement in `PlanReview`, the operator's
 * click, `schema.ddl`. The installer asks; it still does not do.
 *
 * ─── What cannot be offered ───────────────────────────────────────────────
 *
 * Three column kinds are listed as `blocked` instead of being guessed at:
 *
 *   - `fk` — a foreign key's type is its TARGET key's native type (the
 *     installer's own `keyTarget` resolves it at create time from a `dbType`),
 *     and `addColumns` carries a logical type and no constraint. Adding a
 *     look-alike integer that points nowhere would be a repair that runs and
 *     links nothing.
 *   - `id` — a primary key cannot be added to a table that already has rows
 *     and already has one;
 *   - `blob` — not in plan 35's authorable vocabulary.
 *
 * Every added column is NULLABLE whatever the manifest says: a NOT NULL column
 * cannot be added to a populated table without a default, and the planner
 * refuses exactly that.
 */

import type { InstallPlan, Manifest, RequiredColumn } from '@adminium/manifest';

import { enumWidthFor } from '../add-ons/install-ddl.js';

/** A column in the Design mode's `DesiredColumn` vocabulary (the wire shape). */
export interface OfferedColumn {
  name: string;
  logicalType: string;
  nullable: true;
  default: null;
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  comment: null;
}

export interface MissingColumnsEdit {
  /** Plan 35's `addColumns` — `table` is the manifest's table ref (a bare name). */
  addColumns: { table: string; column: OfferedColumn }[];
  /**
   * An enum column's allowed values. They ride the `column.options` override
   * after the columns exist — `addColumns` has no channel for them, and the
   * installer's own CHECK constraint is a CREATE-time device.
   */
  values: { table: string; column: string; values: string[] }[];
  /** Columns this cannot add, and why. A non-empty list means the update still refuses. */
  blocked: {
    table: string;
    column: string;
    reason: 'foreign-key' | 'primary-key' | 'unsupported-type';
  }[];
}

function offered(column: RequiredColumn): Omit<OfferedColumn, 'name'> | null {
  const base = {
    nullable: true as const,
    default: null,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    comment: null,
  };
  switch (column.type) {
    case 'text':
      return { ...base, logicalType: 'text' };
    case 'int':
      return { ...base, logicalType: 'integer' };
    case 'bigint':
      return { ...base, logicalType: 'bigint' };
    case 'decimal':
    case 'money':
      // The installer's own choice for both: four places is what accounting
      // systems settled on, and a float cannot hold a tenth of a cent.
      return { ...base, logicalType: 'decimal', numericPrecision: 19, numericScale: 4 };
    case 'float':
      return { ...base, logicalType: 'float' };
    case 'bool':
      return { ...base, logicalType: 'boolean' };
    case 'enum':
      // The installer's own width (`enumWidthFor`): 32 when every value fits.
      // It is what the workflow-status rule reads — at 64, a status enum an
      // UPDATE added would never make a board, exactly the failure a fresh
      // install used to have. The values ride an override.
      return {
        ...base,
        logicalType: 'varchar',
        maxLength: enumWidthFor(column.enum ?? []),
      };
    case 'json':
      return { ...base, logicalType: 'json' };
    case 'date':
      return { ...base, logicalType: 'date' };
    case 'timestamptz':
      return { ...base, logicalType: 'timestamptz' };
    case 'uuid':
      return { ...base, logicalType: 'uuid' };
    case 'blob':
      // Not in plan 35's authorable vocabulary; nothing in the manifests
      // declares one on a reused table today. Blocked rather than faked.
      return null;
    case 'id':
    case 'fk':
      return null;
    default: {
      const unreachable: never = column.type;
      return unreachable;
    }
  }
}

/** The edit that would give every reused table the columns the manifest needs. */
export function missingColumnsEdit(plan: InstallPlan, manifest: Manifest): MissingColumnsEdit {
  const declared = new Map((manifest.requiredSchema?.tables ?? []).map((t) => [t.ref, t]));
  const out: MissingColumnsEdit = { addColumns: [], values: [], blocked: [] };
  for (const table of plan.reuse) {
    const spec = declared.get(table.ref);
    for (const name of table.missingColumns) {
      const column = spec?.columns.find((c) => c.ref === name);
      if (column === undefined) continue;
      const shape = offered(column);
      if (shape === null) {
        out.blocked.push({
          table: table.ref,
          column: name,
          reason:
            column.type === 'id'
              ? 'primary-key'
              : column.type === 'fk'
                ? 'foreign-key'
                : 'unsupported-type',
        });
        continue;
      }
      out.addColumns.push({ table: table.ref, column: { name, ...shape } });
      if (column.type === 'enum' && column.enum !== undefined) {
        out.values.push({ table: table.ref, column: name, values: [...column.enum] });
      }
    }
  }
  return out;
}

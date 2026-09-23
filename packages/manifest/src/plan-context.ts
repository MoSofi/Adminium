// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Planning an APP install with what the server knows about this connection:
 * the app's prefix, the tables it already recorded here, what other apps
 * record here, and the operator's answers for the tables whose names are taken.
 *
 * ─── Why a context at all ───────────────────────────────────────────────────
 *
 * Without one, a table either exists (reuse) or does not (create), and that
 * was the whole plan. It could not tell the app's own table from an earlier
 * install apart from another app's table of the same name, could not offer
 * to rename a stranger's table out of the way, and could not give an app its
 * own prefix. Each table is now CLASSIFIED first, then given an ACTION:
 *
 *   new           the real name is free                     → create
 *   own-leftover  this app recorded it (an earlier install) → reuse (default)
 *   shared        another app recorded it under the SAME shape (`menu@1`)
 *                                                            → share (default)
 *   taken         it exists and nothing records it as this app's
 *                                                            → the operator chooses
 *
 * For a taken table the operator chooses: REUSE it (offered only when it is
 * not another app's in disguise and every change it needs is safe), RENAME the
 * existing table out of the way (only when no other install records it), or
 * give the whole app a DIFFERENT PREFIX (always offered, and it applies to
 * every table at once). Until each taken table has an answer, the plan is not
 * installable and says which table is waiting.
 *
 * ─── Edits ─────────────────────────────────────────────────────────────────
 *
 * A reused table may need changes before the app can write to it. Only changes
 * that cannot lose data are ever offered: adding a missing column (nullable),
 * widening a type along a fixed list (a longer varchar, varchar to text, int
 * to bigint, a wider enum column), giving an int key the identity it lacks, and
 * adding enum values. Anything else is refused on this screen, by name.
 *
 * Pure, like the planner it extends: no I/O. The server gathers the context.
 */

import type {
  ExistingColumnView,
  InstallPlan,
  InstallTablePlan,
  PlanContext,
  PlanProblem,
  SchemaModelView,
  TableClass,
} from './plan-model.js';
import { typeConflict } from './plan-types.js';
import type { Manifest, RequiredColumn, RequiredTable } from './schema.js';

export type {
  ContextTableAction as TableAction,
  InstallTablePlan,
  PlanContext,
  PlanEdit,
  TableChoice,
  TableClass,
  TableOffer,
} from './plan-model.js';


/** The longest identifier each engine accepts, in bytes. SQLite has none; the portable 63 holds. */
export const IDENTIFIER_LIMIT: Readonly<Record<PlanContext['dialect'], number>> = {
  postgres: 63,
  mysql: 64,
  sqlite: 63,
};

/** `adminium_roles.slug` is 40 characters. */
export const ROLE_SLUG_LIMIT = 40;

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The type a declared column is created with, for an edit's `to` — the installer's own vocabulary. */
function declaredShape(column: RequiredColumn): string {
  if (column.type === 'text' && column.maxLength !== undefined) return `varchar(${String(column.maxLength)})`;
  if (column.type === 'enum') {
    const width = (column.enum ?? []).every((value) => value.length <= 32) ? 32 : 64;
    return `varchar(${String(width)})`;
  }
  return column.type;
}

/**
 * The widening that would let an existing column hold what the manifest
 * stores, or null when there is no such safe change.
 */
function wideningFor(
  declared: RequiredColumn,
  have: ExistingColumnView,
  dialect: PlanContext['dialect'],
): { from: string; to: string } | null {
  const type = have.logicalType;
  const width = typeof have.maxLength === 'number' ? have.maxLength : null;
  if (declared.type === 'text' && type === 'varchar' && width !== null) {
    return { from: `varchar(${String(width)})`, to: declaredShape(declared) };
  }
  if (declared.type === 'enum' && type === 'varchar' && width !== null) {
    return { from: `varchar(${String(width)})`, to: declaredShape(declared) };
  }
  if (declared.type === 'bigint' && type === 'integer') {
    // MySQL cannot change the type of a key another table's foreign key points
    // at; a primary key is where that is all but certain.
    if (dialect === 'mysql' && have.isPrimaryKey === true) return null;
    return { from: 'integer', to: 'bigint' };
  }
  return null;
}

/**
 * A column an update can add to a table that exists. A link (`fk`) can, when
 * it is nullable: every existing row starts unlinked, and the schema editor
 * adds the foreign key beside it. A required link cannot — the rows already
 * there would have nothing to point at.
 */
function isOfferable(column: RequiredColumn): boolean {
  if (column.type === 'fk') return column.nullable === true;
  return column.type !== 'id' && column.type !== 'blob';
}

/**
 * The context half of `planInstall`. Called by it when a context is given;
 * the returned plan keeps every field older callers read (`create`, `reuse`,
 * `references`, `problems`) and adds `tables` and `names`.
 */
export function planWithContext(
  manifest: Manifest,
  model: SchemaModelView,
  context: PlanContext,
): InstallPlan {
  const noun = manifest.kind === 'app' ? 'app' : 'add-on';
  const required: readonly RequiredTable[] = manifest.requiredSchema?.tables ?? [];
  const live = new Map(model.tables.map((t) => [t.ref, t]));
  const limit = IDENTIFIER_LIMIT[context.dialect];
  const problems: PlanProblem[] = [];
  const prefix = context.prefix === null ? null : (context.altPrefix ?? context.prefix);

  if (context.altPrefix !== undefined && !/^[a-z][a-z0-9_]*_$/.test(context.altPrefix)) {
    problems.push({
      code: 'IDENTIFIER_TOO_LONG',
      table: context.altPrefix,
      message: `"${context.altPrefix}" is not a usable prefix: lower-case letters, digits and "_", ending in "_".`,
    });
  }

  // 1. Real names. A record wins (it is what this app already uses here); an
  //    alternative prefix re-names everything that is not recorded.
  const names: Record<string, string> = {};
  for (const table of required) {
    const record = context.records[table.ref];
    const usable = record !== undefined && record.state !== 'dropped';
    names[table.ref] = usable && context.altPrefix === undefined ? record.table : prefix === null ? table.ref : `${prefix}${table.ref}`;
  }
  const realNames = new Set(Object.values(names));

  const tables: InstallTablePlan[] = [];
  for (const table of required) {
    const real = names[table.ref]!;
    const record = context.records[table.ref];
    const existing = live.get(real);
    const holders = context.others.filter((o) => o.table === real && o.state !== 'dropped');
    const choice = context.choices?.[table.ref];

    if (byteLength(real) > limit) {
      problems.push({
        code: 'IDENTIFIER_TOO_LONG',
        table: table.ref,
        message: `"${real}" is longer than this database allows (${String(limit)} bytes). Choose a shorter prefix.`,
      });
    }
    for (const column of table.columns) {
      if (column.type !== 'fk') continue;
      const fk = `fk_${real}_${column.ref}`;
      if (byteLength(fk) > limit) {
        problems.push({
          code: 'IDENTIFIER_TOO_LONG',
          table: table.ref,
          column: column.ref,
          message: `The foreign key "${fk}" would be longer than this database allows (${String(limit)} bytes). Choose a shorter prefix.`,
        });
      }
    }

    // 2. Classify.
    const ownRecord = record !== undefined && record.state !== 'dropped' && context.altPrefix === undefined;
    const sharer =
      table.shape === undefined ? undefined : holders.find((o) => o.shape === table.shape && o.state !== 'released');
    const klass: TableClass =
      existing === undefined ? 'new' : ownRecord ? 'own-leftover' : sharer !== undefined ? 'shared' : 'taken';

    // Two apps whose prefixed names meet. A declared shape both share is the
    // one way two apps may use one table.
    if (holders.length > 0 && sharer === undefined && !ownRecord) {
      problems.push({
        code: 'PREFIX_COLLISION',
        table: table.ref,
        message:
          `"${real}" is already "${holders[0]!.appKey}"'s table, so this ${noun} cannot use that name. ` +
          `Give this ${noun} a different prefix.`,
      });
    }

    // Why reuse is not safe for a stranger's table.
    const declaredColumns = new Set(table.columns.map((c) => c.ref));
    const foreign =
      existing === undefined
        ? []
        : existing.columns.filter(
            (c) =>
              !declaredColumns.has(c.ref) &&
              c.nullable === false &&
              c.hasDefault !== true &&
              c.isPrimaryKey !== true &&
              c.isGenerated !== true,
          );

    const plan: InstallTablePlan = {
      ref: table.ref,
      table: real,
      class: klass,
      action: 'create',
      offers: [],
      edits: [],
      blocked: [],
    };

    if (klass === 'new') {
      plan.action = 'create';
    } else if (klass === 'own-leftover') {
      plan.offers = ['reuse', 'rename-existing', 'alt-prefix'];
      if (record?.owned === false) plan.adopted = true;
      plan.action = choice?.action === 'rename-existing' ? 'rename-existing' : 'reuse';
    } else if (klass === 'shared') {
      plan.offers = ['share', 'alt-prefix'];
      plan.sharedWith = sharer!.appKey;
      plan.action = 'share';
    } else {
      plan.offers = ['alt-prefix'];
      if (foreign.length === 0) plan.offers.unshift('reuse');
      else {
        plan.reuseRefusal =
          `It requires ${foreign.map((c) => `"${c.ref}"`).join(', ')}, which this ${noun} never fills, ` +
          `so every row the ${noun} saves there would be refused.`;
      }
      if (holders.length === 0) plan.offers.splice(plan.offers.length - 1, 0, 'rename-existing');
      if (choice === undefined) plan.action = 'undecided';
      else if (choice.action === 'reuse' && plan.offers.includes('reuse')) plan.action = 'reuse';
      else if (choice.action === 'rename-existing' && plan.offers.includes('rename-existing')) plan.action = 'rename-existing';
      else plan.action = 'undecided';
    }

    if (plan.action === 'rename-existing') {
      const to = choice?.action === 'rename-existing' ? choice.to : `${real}_old`;
      plan.renameExistingTo = to;
      if (!IDENTIFIER.test(to) || byteLength(to) > limit || live.has(to) || realNames.has(to)) {
        problems.push({
          code: 'TABLE_TAKEN',
          table: table.ref,
          message: `"${to}" cannot be the existing table's new name: it must be a free, lower-case name of at most ${String(limit)} bytes.`,
        });
      }
    }

    if (plan.action === 'undecided') {
      problems.push({
        code: 'TABLE_TAKEN',
        table: table.ref,
        message: `"${real}" already exists and was made by hand. Pick what to do with it before you install.`,
      });
    }

    // 3. Edits, for a table the app will use as it is.
    if ((plan.action === 'reuse' || plan.action === 'share') && existing !== undefined) {
      for (const column of table.columns) {
        const have = existing.columns.find((c) => c.ref === column.ref);
        if (have === undefined) {
          if (isOfferable(column)) plan.edits.push({ kind: 'add-column', column: column.ref });
          else {
            plan.blocked.push({
              column: column.ref,
              reason: column.type === 'id' ? 'primary-key' : column.type === 'fk' ? 'foreign-key' : 'unsupported-type',
            });
          }
          continue;
        }
        const conflict = typeConflict(column, have, context.dialect);
        if (conflict !== null) {
          const widen = wideningFor(column, have, context.dialect);
          if (widen !== null) plan.edits.push({ kind: 'widen', column: column.ref, ...widen });
          else {
            problems.push({
              code: 'COLUMN_TYPE_CONFLICT',
              table: table.ref,
              column: column.ref,
              message: `"${real}.${column.ref}" already exists as ${conflict}, which cannot hold the ${column.type} values this ${noun} stores in it.`,
            });
          }
          continue;
        }
        if (column.role === 'pk' && (column.type === 'int' || column.type === 'bigint') && have.isIdentity === false) {
          plan.edits.push({ kind: 'set-identity', column: column.ref });
        }
        if (column.type === 'enum' && have.enumValues !== undefined) {
          const missing = (column.enum ?? []).filter((value) => !have.enumValues!.includes(value));
          if (missing.length > 0) plan.edits.push({ kind: 'enum-values', column: column.ref, values: missing });
        }
      }
      if (plan.blocked.length > 0) {
        problems.push({
          code: 'COLUMNS_REQUIRED',
          table: table.ref,
          column: plan.blocked[0]!.column,
          message:
            `"${real}" is missing ${plan.blocked.map((b) => `"${b.column}"`).join(', ')}, which cannot be added ` +
            `to a table that already exists. Rename that table out of the way, or use a different prefix.`,
        });
      }
    }
    tables.push(plan);
  }

  // 4. References, against real names.
  const references: InstallPlan['references'] = [];
  const declared = new Set(required.map((t) => t.ref));
  for (const table of required) {
    for (const column of table.columns) {
      if (column.type !== 'fk' || column.references === undefined) continue;
      const target = column.references;
      const resolution = declared.has(target) ? 'internal' : live.has(target) ? 'host' : 'unresolved';
      references.push({ fromTable: table.ref, fromColumn: column.ref, to: target, resolution });
      if (resolution === 'unresolved') {
        problems.push({
          code: 'UNRESOLVED_REFERENCE',
          table: table.ref,
          column: column.ref,
          message:
            `"${table.ref}.${column.ref}" points at a table called "${target}", which this ` +
            `${noun} does not create and this database does not have. Connect a database that ` +
            `already has it, or create it first.`,
        });
      }
    }
  }

  // 5. Role slugs fit their column.
  if (manifest.kind === 'app') {
    for (const role of manifest.roles ?? []) {
      const slug = `${manifest.key}-${role.key}`;
      if (slug.length > ROLE_SLUG_LIMIT) {
        problems.push({
          code: 'IDENTIFIER_TOO_LONG',
          table: role.key,
          message: `The role "${slug}" is longer than ${String(ROLE_SLUG_LIMIT)} characters.`,
        });
      }
    }
  }

  for (const table of required) {
    if (table.ref.startsWith('adminium_') || names[table.ref]!.startsWith('adminium_')) {
      problems.push({
        code: 'RESERVED_TABLE',
        table: table.ref,
        message: `"${names[table.ref]!}" is in Adminium's own namespace.`,
      });
    }
  }

  const planned = (plan: InstallTablePlan) => {
    const spec = required.find((t) => t.ref === plan.ref)!;
    const have = live.get(plan.table);
    const missing = plan.action === 'reuse' || plan.action === 'share'
      ? spec.columns.filter((c) => have !== undefined && !have.columns.some((x) => x.ref === c.ref)).map((c) => c.ref)
      : [];
    return {
      ref: plan.ref,
      table: plan.table,
      action: plan.action === 'reuse' || plan.action === 'share' ? ('reuse' as const) : ('create' as const),
      columns: spec.columns.map((c) => ({ ref: c.ref, type: c.type, missing: missing.includes(c.ref) })),
      missingColumns: missing,
    };
  };

  return {
    addOnKey: manifest.key,
    version: manifest.version,
    create: tables.filter((t) => t.action === 'create' || t.action === 'rename-existing').map(planned),
    reuse: tables.filter((t) => t.action === 'reuse' || t.action === 'share').map(planned),
    references,
    problems,
    installable: problems.length === 0,
    touchesData: required.length > 0,
    tables,
    names,
  };
}

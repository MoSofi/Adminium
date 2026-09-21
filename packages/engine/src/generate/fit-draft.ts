// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `templateTableDraft` — remedy 4: a whole new table shaped for a template.
 *
 * The last offer and the guarantee behind all the others. Tagging a column,
 * picking another table and adding columns each depend on what the operator
 * already has; this one depends on nothing, so the worst case of the create
 * screen is always a working page. It is also the only answer for someone who
 * has no table yet and simply wants a calendar.
 *
 * ─── The draft is proved, not assumed ─────────────────────────────────────
 *
 * The draft is built from the same `wants` the add-columns remedy uses, and
 * then COMPOSED: the proposed table is added to the model and `templateFit` is
 * asked about it, under the name the operator actually typed.
 *
 * Measured, so the reason is not overstated: TODAY no name defeats these
 * drafts. The classifier does read table names (`LOG_TABLE_RE` claims `events`
 * and `history`), but its log rule also needs a created-at + actor-FK shape
 * these columns never have — `generate-fit-draft.test.ts` pins a sweep of the
 * obvious suspects. The check stays because the classifier is heuristic and
 * name-driven, and a table rule added later that did claim one of these names
 * would otherwise turn remedy 4 into a repair the operator watches succeed
 * while the page still refuses — the failure this whole plan exists to avoid.
 *
 * ─── The one role a column cannot satisfy on its own ──────────────────────
 *
 * A scheduler needs a link to a table of PEOPLE, and `personFk` tests the
 * target table's name as well as the reference. So the draft carries a target:
 * an existing table the rule's own predicate accepts (probed, never matched
 * against a copied regex), or — when there is none, or the operator asks — a
 * small people table created in the same edit. Nobody is left needing to know
 * what a foreign key is.
 *
 * ─── What it is not ───────────────────────────────────────────────────────
 *
 * Not a table designer (35 owns that surface). One table with the columns the
 * template wants, a generated key, and — for a scheduler — a people table.
 * Everything is nullable except the key, so rows can be added from the page
 * without a form that demands a value for a column nobody explained.
 */

import { buildCandidateView, personFk } from '@adminium/widgets/generate';

import { applyClassification } from '../classify/index.js';
import { isTableBoundTemplate } from '../config-schema/table-bound.js';
import { parseDatabaseModel, type DatabaseModel, type SemanticTag } from '../schema-model.js';
import { TITLE_WANTS, bindableSet, fitRolesFor, templateFit, type FitRole } from './fit.js';

/** Mirrors the DDL layer's `IDENTIFIER_RE` (`ddl/edit.ts`). */
const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;
/** Postgres truncates identifiers at 63 bytes; MySQL allows 64. The lower wins. */
const MAX_IDENTIFIER = 63;

/**
 * Suggested table names, best first — the first FREE one wins.
 *
 * `events` is avoided although it would compose (see the header): it is the
 * one name `LOG_TABLE_RE` claims, and a default should not lean on the rest of
 * the log rule happening not to fire.
 */
const TABLE_NAMES: Readonly<Record<string, readonly string[]>> = {
  'page-calendar': ['appointments', 'bookings', 'calendar_entries'],
  'page-board': ['tasks', 'work_items', 'cards'],
  'page-scheduler': ['shifts', 'staff_shifts', 'rota'],
};

/** The people table a scheduler draft creates when it cannot reuse one. */
const PEOPLE_TABLE_NAMES: readonly string[] = ['staff', 'team_members', 'people'];

/** Key types a new foreign-key column can mirror on every dialect. */
const REFERENCEABLE_KEY_TYPES = new Set(['integer', 'bigint', 'uuid', 'varchar']);

export interface DraftColumn {
  name: string;
  logicalType: string;
  maxLength: number | null;
  /** The generated `id` key. Exactly one per table. */
  primaryKey: boolean;
  /**
   * The semantic to stamp as an override once the table exists (D3), or null
   * for the key. Stamped even where the name already earns it, so the page
   * survives the column being renamed later.
   */
  semantic: SemanticTag | null;
  /** Values the column may hold, when the requirement reaches into them. */
  enumValues: string[] | null;
  /** A foreign key — `table` is a table id, or the NAME of a table in this draft. */
  references: { table: string; column: string } | null;
  /** The role this column plays, for the review list; null for the key. */
  role: FitRole | null;
}

export interface DraftTable {
  name: string;
  columns: DraftColumn[];
}

/** A table a scheduler's person link could point at. */
export interface PeopleTarget {
  tableId: string;
  label: string | null;
}

export type DraftNameProblem = 'invalid' | 'taken';

export interface TableDraft {
  template: string;
  /** The schema the tables are created in — the connection's default. */
  schema: string;
  /** In dependency order: a people table, when one is created, comes first. */
  tables: DraftTable[];
  /** The id the page binds to once the table exists. */
  bindTableId: string;
  /** What is wrong with the requested name, or null. */
  nameProblem: DraftNameProblem | null;
  /**
   * The gate: the draft, added to this model, composes the template. The UI
   * does not offer a draft that does not — whether the cause is the name or a
   * rule that changed under this module.
   */
  composes: boolean;
  /**
   * Scheduler only: existing tables the person link can point at, best first.
   * Empty for the other templates, and when nothing qualifies — the draft then
   * creates its own people table.
   */
  peopleTargets: PeopleTarget[];
  /** The person link's target: an existing table id, or null for a new people table. */
  peopleTarget: string | null;
}

export interface TableDraftOptions {
  /** The operator's table name; defaults to the first free suggestion. */
  name?: string | undefined;
  /**
   * Scheduler only. An existing table id to link people to, or `'new'` for a
   * people table created in the same edit. Defaults to the best existing
   * target, or `'new'` when there is none.
   */
  people?: string | undefined;
}

/* ------------------------------------------------------------------ names */

function takenNames(model: DatabaseModel, schema: string): Set<string> {
  return new Set(
    model.tables.filter((t) => t.schema === schema).map((t) => t.name.toLowerCase()),
  );
}

function firstFree(names: readonly string[], taken: ReadonlySet<string>): string {
  const free = names.find((name) => !taken.has(name));
  if (free !== undefined) return free;
  // Every suggestion is taken. A numbered suffix does not change what the
  // TABLE rules see (they match whole `_`-separated words), so unlike a column
  // name this cannot build a name the classifier reads differently.
  const stem = names[0] ?? 'records';
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}_${String(n)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function nameProblemOf(name: string, taken: ReadonlySet<string>): DraftNameProblem | null {
  if (!IDENTIFIER_RE.test(name) || name.length > MAX_IDENTIFIER) return 'invalid';
  return taken.has(name) ? 'taken' : null;
}

/* ------------------------------------------------------------------ columns */

function keyColumn(): DraftColumn {
  return {
    name: 'id',
    logicalType: 'integer',
    maxLength: null,
    primaryKey: true,
    semantic: null,
    enumValues: null,
    references: null,
    role: null,
  };
}

function titleColumn(): DraftColumn {
  return {
    name: TITLE_WANTS.suggestedNames[0] ?? 'title',
    // `varchar`, bounded: a title is short, and an unbounded `text` column
    // cannot be indexed on MySQL without a prefix length.
    logicalType: 'varchar',
    maxLength: 200,
    primaryKey: false,
    semantic: null,
    enumValues: null,
    references: null,
    role: 'title',
  };
}

/* ------------------------------------------------------------ people links */

/**
 * Existing tables `personFk` accepts as a people target, best first.
 *
 * PROBED through the rule's own predicate: a draft column is pointed at each
 * candidate and `personFk` is asked. A copy of its name regex here would be the
 * second description of the requirement this module exists not to write.
 *
 * Ranked by the classifier's own verdict — a table it calls `people` (a
 * people-ish name AND a person-name or email column) above one that merely has
 * a people-ish name — so `employees` outranks `customers` whenever the schema
 * says which of the two is staff.
 */
function peopleTargetsFor(model: DatabaseModel): PeopleTarget[] {
  const set = bindableSet(model);
  const ranked: { target: PeopleTarget; people: boolean }[] = [];
  for (const entry of set.candidateModel) {
    const pk = entry.table.primaryKey ?? [];
    if (pk.length !== 1) continue;
    const keyType = entry.table.columns.find((c) => c.name === pk[0])?.logicalType;
    if (keyType === undefined || !REFERENCEABLE_KEY_TYPES.has(keyType)) continue;
    // A throwaway single-column table pointing at the candidate. `personFk`
    // reads only the reference and the target's name, so nothing else about
    // the probe can change its answer.
    const probe = buildCandidateView(
      {
        id: '__fit_probe.__fit_probe',
        name: '__fit_probe',
        primaryKey: [],
        columns: [
          {
            name: 'person_id',
            logicalType: keyType,
            references: { tableId: entry.table.id, column: pk[0] as string },
          },
        ],
      },
      {
        tableId: '__fit_probe.__fit_probe',
        shape: 'entity',
        role: 'entity',
        columns: [{ column: 'person_id', semantic: 'fk' }],
      },
    );
    if (personFk(probe) === null) continue;
    ranked.push({
      target: { tableId: entry.table.id, label: entry.table.label ?? null },
      people: set.classified.get(entry.table.id)?.semantics.role === 'people',
    });
  }
  ranked.sort(
    (a, b) =>
      Number(b.people) - Number(a.people) || a.target.tableId.localeCompare(b.target.tableId),
  );
  return ranked.map((r) => r.target);
}

/* ------------------------------------------------------------ the proof */

/**
 * Add the draft to the model the way the server will see it after the apply
 * and the override write, and ask `templateFit`.
 *
 * The values ride as an enum (the projection `applyColumnOptionValues`
 * performs on the server), and the semantics are left to the classifier —
 * every suggested column name earns its semantic unaided, which is what the
 * descriptor gate pins. A draft that composes only because an override was
 * simulated would be a draft that fails the day someone clears the override.
 */
function draftComposes(
  model: DatabaseModel,
  schema: string,
  tables: readonly DraftTable[],
  template: string,
): boolean {
  const byName = new Map(tables.map((t) => [t.name, `${schema}.${t.name}`]));
  const enums: Record<string, unknown>[] = [];
  const added = tables.map((table) => ({
    schema,
    name: table.name,
    primaryKey: table.columns.filter((c) => c.primaryKey).map((c) => c.name),
    columns: table.columns.map((column, index) => {
      const out: Record<string, unknown> = {
        name: column.name,
        ordinal: index + 1,
        logicalType: column.logicalType,
        nullable: !column.primaryKey,
        isPrimaryKey: column.primaryKey,
        maxLength: column.maxLength,
        ...(column.primaryKey ? { default: { kind: 'autoincrement' } } : {}),
      };
      if (column.references !== null) {
        out['references'] = {
          tableId: byName.get(column.references.table) ?? column.references.table,
          column: column.references.column,
        };
      }
      if (column.enumValues !== null) {
        const id = `${schema}.${table.name}.${column.name}`;
        enums.push({ id, name: column.name, values: column.enumValues, source: 'check' });
        out['enumRef'] = id;
      }
      return out;
    }),
  }));

  let probe: DatabaseModel;
  try {
    probe = applyClassification(
      parseDatabaseModel({
        ...model,
        tables: [...model.tables, ...added],
        enums: [...model.enums, ...enums],
      }),
    );
  } catch {
    return false;
  }
  const bound = tables[tables.length - 1];
  if (bound === undefined) return false;
  return templateFit(probe, `${schema}.${bound.name}`, template).satisfied;
}

/* --------------------------------------------------------------- the draft */

/**
 * Propose a new table that can back `template`, or null when the template has
 * no repair descriptors (D4: the DDL remedies are scoped to the three templates
 * that render blank; the other seven are offered other tables, not new ones).
 *
 * Pure. The caller hands in the model it composes from, overrides included, so
 * the name check and the proof answer about the same schema the create route
 * will use.
 */
export function templateTableDraft(
  model: DatabaseModel,
  template: string,
  opts: TableDraftOptions = {},
): TableDraft | null {
  if (!isTableBoundTemplate(template)) return null;
  const roles = fitRolesFor(template);
  const names = TABLE_NAMES[template];
  if (roles.length === 0 || names === undefined) return null;

  const schema = model.defaultSchema;
  const taken = takenNames(model, schema);
  const requested = opts.name?.trim();
  const name = requested === undefined || requested === '' ? firstFree(names, taken) : requested;
  const nameProblem = nameProblemOf(name, taken);

  const needsPeople = roles.some((r) => r.wants.needsReference === true);
  const peopleTargets = needsPeople ? peopleTargetsFor(model) : [];
  const wantedTarget =
    opts.people === undefined
      ? (peopleTargets[0]?.tableId ?? null)
      : opts.people === 'new'
        ? null
        : (peopleTargets.find((t) => t.tableId === opts.people)?.tableId ?? null);

  const tables: DraftTable[] = [];
  let peopleRef: { table: string; column: string; keyType: string; maxLength: number | null } | null =
    null;
  /** The existing table the person link reuses; null when the draft creates one. */
  let reusedPeople: string | null = null;
  if (needsPeople) {
    if (wantedTarget !== null) {
      const target = model.tables.find((t) => t.id === wantedTarget);
      const key = target?.columns.find((c) => c.name === target.primaryKey[0]);
      if (target !== undefined && key !== undefined) {
        peopleRef = {
          table: target.id,
          column: key.name,
          keyType: key.logicalType,
          maxLength: key.maxLength,
        };
        reusedPeople = target.id;
      }
    }
    if (peopleRef === null) {
      // No existing table qualifies, or the operator asked for a new one: a
      // people table in the same edit. The edit layer orders the two creates
      // by the reference, and the draft lists it first to match.
      const peopleName = firstFree(PEOPLE_TABLE_NAMES, new Set([...taken, name]));
      tables.push({ name: peopleName, columns: [keyColumn(), { ...titleColumn(), name: 'name' }] });
      peopleRef = { table: peopleName, column: 'id', keyType: 'integer', maxLength: null };
    }
  }

  const columns: DraftColumn[] = [keyColumn()];
  const used = new Set<string>(['id']);
  // The title goes first after the key: `selectDisplayColumn` prefers an exact
  // `title`, and a board card or a calendar event with only an id on it is a
  // page nobody can read.
  if (!roles.some((r) => r.role === 'title')) {
    columns.push(titleColumn());
    used.add(titleColumn().name);
  }
  // Title-first ordering for templates that declare it too (a calendar does).
  const ordered = [...roles].sort((a, b) => Number(b.role === 'title') - Number(a.role === 'title'));
  for (const { role, wants } of ordered) {
    const columnName = wants.suggestedNames.find((n) => !used.has(n)) ?? wants.suggestedNames[0];
    if (columnName === undefined) continue;
    used.add(columnName);
    if (role === 'title') {
      columns.push({ ...titleColumn(), name: columnName });
      continue;
    }
    if (wants.needsReference === true && peopleRef !== null) {
      columns.push({
        name: columnName,
        logicalType: peopleRef.keyType,
        maxLength: peopleRef.maxLength,
        primaryKey: false,
        semantic: null,
        enumValues: null,
        references: { table: peopleRef.table, column: peopleRef.column },
        role,
      });
      continue;
    }
    columns.push({
      name: columnName,
      logicalType: wants.logicalTypes[0] ?? 'text',
      maxLength: wants.maxLength ?? null,
      primaryKey: false,
      semantic: wants.semantic,
      enumValues: wants.enumValues === undefined ? null : [...wants.enumValues],
      references: null,
      role,
    });
  }
  tables.push({ name, columns });

  return {
    template,
    schema,
    tables,
    bindTableId: `${schema}.${name}`,
    nameProblem,
    composes: nameProblem === null && draftComposes(model, schema, tables, template),
    peopleTargets,
    peopleTarget: reusedPeople,
  };
}

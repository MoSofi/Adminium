/**
 * Relation inference — 05-introspection-engine.md §6 rules 1 (name
 * convention) and 2 (join table).
 *
 * `RELATION_KINDS` has always declared `inferred-name` and
 * `inferred-join-table`, and five consumers branch on them, but nothing ever
 * WROTE one: `model.relations` came exclusively from declared foreign keys.
 * On a schema that declares none — MyISAM, legacy SQLite, most
 * ORM-generated MySQL — that emptiness cascades: `detectDomains` shatters
 * into singletons so every table lands in "General", dashboards are skipped
 * for want of a time axis, and every `*_id` column falls through §7.1 to
 * `external-id` (a mono string) instead of an FK entity chip.
 *
 * Pure and deterministic like the rest of the engine: same model in, same
 * relations out, no mutation of the input.
 *
 * **Ordering is load-bearing.** Rule 2 reads `semantics.primary === 'fk'`,
 * which `classifyColumn` derives from `model.relations` — so rule 1 must run
 * first and seed the graph before rule 2 can see a join table at all.
 * {@link applyInference} enforces that order and is deliberately NOT folded
 * into `classifyModel`: `applyClassification` spreads `...model` and rebuilds
 * only `tables`, so relations added inside it would vanish on the next call.
 *
 * **Confidence banding.** 05 §6 accepts an inferred relation at ≥ 0.8;
 * everything a rule here is less than sure of is emitted in the 0.5–0.79
 * band instead of being dropped. All four 0.8 gates exclude that band, so
 * such a relation is visible to the Studio remap editor as "suggested,
 * unchecked" without acting on anything — which is how a suggestion ships
 * without a schema change. Nothing here ever emits 1.0: that value belongs
 * to declared FKs and accepted overrides.
 */
import { classifyColumn, buildColumnClassifyContext, type ClassifiedColumn } from '../classify/columns.js';
import { normalizeName } from '../classify/names.js';
import { detectJoinTable, joinDetectionColumns } from '../classify/tables.js';
import type { ColumnModel, DatabaseModel, Relation, TableModel } from '../schema-model.js';

/**
 * Accepted-relation threshold (§6). The SAME number lives in
 * classify/columns.ts (`ACCEPTED_RELATION_CONFIDENCE`), classify/tables.ts
 * (`detectHierarchy`) and generate/domains.ts (`EDGE_CONFIDENCE`); all four
 * move together or the model means different things to different readers.
 */
const ACCEPTED_RELATION_CONFIDENCE = 0.8;

/**
 * Evidence is scored in integer hundredths (as `detectJoinTable` does) so
 * 0.7 + 0.1 lands on 0.8 exactly rather than 0.7999999999999999. Below the
 * floor a name match is noise, not a suggestion, and nothing is emitted; the
 * ceiling keeps inference short of the 1.0 that means declared or accepted.
 */
const MIN_SUGGESTION_HUNDREDTHS = 50;
const MAX_INFERRED_HUNDREDTHS = 95;

/** Types an id column can plausibly have. */
const ID_TYPES = new Set(['integer', 'bigint', 'uuid', 'varchar', 'text']);
const INTEGER_FAMILY = new Set(['integer', 'bigint']);
const TEXTISH = new Set(['text', 'varchar']);

/**
 * §6 rule 3 self-FK vocabulary — the same list classify/tables.ts matches in
 * `detectHierarchy`. `parent_id` names no table, so the name rule can only
 * resolve it by falling back to the column's own table; without this the
 * tree/org-chart trigger never fires on an FK-less schema.
 */
const HIERARCHY_COLUMN_RE = /^(parent|manager|supervisor|reports_to|superior)(_id)?$/;

/** An inferred relation plus the evidence that produced it. */
export interface InferredRelation {
  relation: Relation;
  /** Human-readable evidence, for tests and the Studio remap editor. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Name shapes
// ---------------------------------------------------------------------------

/** Crude inverse of generate/util.ts's `pluralizeWord` — 'categories' → 'category'. */
function singularizeWord(word: string): string {
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(x|z|ch|sh|s)es$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * The table name a column claims to reference: `customer_id` → 'customer',
 * `billing_customer_uuid` → 'billing_customer', `customerid` → 'customer'.
 * Null for bare keys (`id`/`uuid`/`guid`) and anything not id-suffixed.
 */
function referenceBase(name: string): string | null {
  if (/^(id|uuid|guid)$/.test(name)) return null;
  const suffixed = /^(?<base>.+?)_(id|uuid)$/.exec(name);
  if (suffixed?.groups !== undefined) return suffixed.groups['base'] as string;
  const glued = /^(?<base>.{3,}?)id$/.exec(name);
  if (glued?.groups !== undefined) return glued.groups['base'] as string;
  return null;
}

/**
 * Role-prefixed FKs (`shipping_address_id`, `created_by_user_id`) are the
 * common case in real schemas, so the full base is tried first and then
 * progressively shorter tails. The index of the winning candidate is the
 * number of tokens dropped, which costs confidence.
 */
function baseCandidates(base: string): string[] {
  const tokens = base.split('_').filter(Boolean);
  return tokens.map((_, i) => tokens.slice(i).join('_'));
}

/**
 * Legacy schemas often carry one prefix across every table (`wp_posts`,
 * `wp_users`) while their FK columns do not (`post_id`). A prefix shared by
 * at least three tables and covering 80% of them is decoration, and its
 * stripped form is registered as a second (non-exact) lookup key.
 */
function commonTablePrefix(tables: readonly TableModel[]): string | null {
  if (tables.length < 3) return null;
  const counts = new Map<string, number>();
  for (const table of tables) {
    const tokens = normalizeName(table.name).split('_').filter(Boolean);
    const head = tokens[0];
    if (head === undefined || tokens.length < 2 || head.length < 2) continue;
    counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  // Two prefixes cannot both reach 80%, so the first hit is the only hit.
  for (const [prefix, count] of counts) {
    if (count >= 3 && count / tables.length >= 0.8) return prefix;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Target index
// ---------------------------------------------------------------------------

/** The single column an inferred FK can point at, and how sure we are of it. */
interface KeyColumn {
  column: ColumnModel;
  /** True when it is the table's declared single-column primary key. */
  declaredPk: boolean;
}

interface Target {
  table: TableModel;
  key: KeyColumn;
  /** The key came from the table's own name, not a de-prefixed form. */
  exact: boolean;
}

/**
 * What a `<table>_id` column would land on. A composite primary key has no
 * single-column target, so those tables are simply not referenceable by
 * name. A table with NO declared key (routine on MyISAM/legacy SQLite) falls
 * back to an id-shaped column, which scores lower for it.
 */
function keyColumnOf(table: TableModel): KeyColumn | null {
  if (table.primaryKey.length > 1) return null;
  if (table.primaryKey.length === 1) {
    const column = table.columns.find((c) => c.name === table.primaryKey[0]);
    return column === undefined ? null : { column, declaredPk: true };
  }
  const singular = singularizeWord(normalizeName(table.name));
  const column = table.columns.find((c) => {
    const name = normalizeName(c.name);
    return /^(id|uuid|guid)$/.test(name) || name === `${singular}_id`;
  });
  return column === undefined ? null : { column, declaredPk: false };
}

function buildTargetIndex(model: DatabaseModel): Map<string, Target[]> {
  const index = new Map<string, Target[]>();
  const prefix = commonTablePrefix(model.tables);

  const register = (key: string, target: Target): void => {
    if (key.length < 3) return;
    const bucket = index.get(key) ?? [];
    // A table registers under several spellings; keep one entry per table so
    // "matched two tables" always means genuine ambiguity.
    if (!bucket.some((t) => t.table.id === target.table.id)) bucket.push(target);
    index.set(key, bucket);
  };

  for (const table of [...model.tables].sort((a, b) => a.id.localeCompare(b.id))) {
    if (table.system) continue;
    const key = keyColumnOf(table);
    if (key === null) continue;
    const name = normalizeName(table.name);
    register(name, { table, key, exact: true });
    register(singularizeWord(name), { table, key, exact: true });
    if (prefix !== null && name.startsWith(`${prefix}_`)) {
      const stripped = name.slice(prefix.length + 1);
      register(stripped, { table, key, exact: false });
      register(singularizeWord(stripped), { table, key, exact: false });
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Rule 1 — name-convention inference
// ---------------------------------------------------------------------------

interface NameMatch {
  target: Target;
  /** Leading tokens dropped to reach the match (`shipping_address_id` → 1). */
  droppedTokens: number;
  /** More than one table answered to the same name. */
  ambiguous: boolean;
  /** No table in the source's own schema answered; a sibling schema did. */
  crossSchema: boolean;
}

function resolveByName(
  index: ReadonlyMap<string, Target[]>,
  base: string,
  source: TableModel,
): NameMatch | null {
  const candidates = baseCandidates(base);
  for (const [droppedTokens, key] of candidates.entries()) {
    const hits = index.get(key);
    if (hits === undefined || hits.length === 0) continue;
    // Schema qualification: a same-schema table always beats a sibling's.
    const sameSchema = hits.filter((t) => t.table.schema === source.schema);
    const pool = sameSchema.length > 0 ? sameSchema : hits;
    const target = [...pool].sort((a, b) => a.table.id.localeCompare(b.table.id))[0] as Target;
    return {
      target,
      droppedTokens,
      ambiguous: pool.length > 1,
      crossSchema: sameSchema.length === 0,
    };
  }
  return null;
}

/** FK column sets already spoken for — a second relation would just duplicate. */
function claimedColumns(model: DatabaseModel, table: TableModel): Set<string> {
  const claimed = new Set<string>();
  for (const relation of model.relations) {
    if (relation.from.tableId !== table.id) continue;
    // An M2M relation's `from.columns` are the TARGET's key columns, not FKs.
    if (relation.through !== null) continue;
    for (const column of relation.from.columns) claimed.add(column);
  }
  return claimed;
}

/**
 * §6 rule 4 — a `<base>_type` / `<base>_id` pair is polymorphic, and no
 * relation is ever fabricated for one. `detectPolymorphic` flags it on the
 * table; this is the same test at the point where a relation would be born.
 */
function isPolymorphicPartner(table: TableModel, base: string): boolean {
  return table.columns.some((c) => {
    if (normalizeName(c.name) !== `${base}_type`) return false;
    return TEXTISH.has(c.logicalType) || c.logicalType === 'enum';
  });
}

/** 'one-to-one' when the FK column is itself unique on the referencing side. */
function cardinalityOf(table: TableModel, column: ColumnModel): 'one-to-one' | 'one-to-many' {
  const soleUnique =
    column.isUnique ||
    (table.primaryKey.length === 1 && table.primaryKey[0] === column.name) ||
    table.uniques.some((u) => u.columns.length === 1 && u.columns[0] === column.name);
  return soleUnique ? 'one-to-one' : 'one-to-many';
}

/**
 * Rule 1: `customer_id` → `customers.id`.
 *
 * The canonical case — exact singular/plural name match, agreeing types, a
 * declared single-column PK on the far side — reaches 0.90 and behaves like
 * a declared FK everywhere. Every weakening (a role prefix dropped, a
 * cross-schema hop, an ambiguous name, a non-unique target column, types
 * that merely rhyme) costs enough to fall into the 0.5–0.79 suggestion band.
 */
export function inferNameRelations(model: DatabaseModel): InferredRelation[] {
  const index = buildTargetIndex(model);
  const existingIds = new Set(model.relations.map((r) => r.id));
  const inferred: InferredRelation[] = [];

  for (const table of [...model.tables].sort((a, b) => a.id.localeCompare(b.id))) {
    if (table.system) continue;
    const claimed = claimedColumns(model, table);
    const solePk = table.primaryKey.length === 1 ? table.primaryKey[0] : null;

    for (const column of table.columns) {
      // A declared FK is the truth this rule is guessing at — never restate it.
      if (column.references !== null) continue;
      if (claimed.has(column.name)) continue;
      if (column.name === solePk) continue;
      if (!ID_TYPES.has(column.logicalType)) continue;

      const name = normalizeName(column.name);
      const base = referenceBase(name);
      if (base !== null && isPolymorphicPartner(table, base)) continue;

      let match = base === null ? null : resolveByName(index, base, table);
      let hierarchy = false;
      if (match === null && HIERARCHY_COLUMN_RE.test(name)) {
        // `parent_id` / `reports_to` name no table; they mean "this one".
        const key = keyColumnOf(table);
        if (key === null) continue;
        match = {
          target: { table, key, exact: true },
          droppedTokens: 0,
          ambiguous: false,
          crossSchema: false,
        };
        hierarchy = true;
      }
      if (match === null) continue;

      const { target } = match;
      const selfReferential = target.table.id === table.id;
      const reasons: string[] = [];
      let hundredths = 60;
      reasons.push(
        hierarchy
          ? `"${name}" is §6 rule 3 hierarchy vocabulary — resolved to its own table`
          : `name matches table "${target.table.name}" (§6 rule 1)`,
      );

      if (target.exact) hundredths += 5;
      else reasons.push('matched only after stripping the shared table-name prefix (+0)');
      if (match.droppedTokens > 0) {
        hundredths -= 10;
        reasons.push(`role-prefixed name — ${match.droppedTokens} leading token(s) ignored (-0.1)`);
      }
      if (match.crossSchema) {
        hundredths -= 5;
        reasons.push(`target lives in schema "${target.table.schema}", not "${table.schema}" (-0.05)`);
      }
      if (match.ambiguous) {
        hundredths -= 15;
        reasons.push('more than one table answers to this name (-0.15)');
      }
      if (target.key.declaredPk) {
        hundredths += 15;
        reasons.push(`target "${target.key.column.name}" is the declared primary key (+0.15)`);
      } else if (target.key.column.isUnique) {
        hundredths += 5;
        reasons.push(`target "${target.key.column.name}" is unique but not a declared key (+0.05)`);
      } else {
        reasons.push(`target "${target.key.column.name}" is neither a key nor unique (+0)`);
      }

      const targetType = target.key.column.logicalType;
      if (targetType === column.logicalType) {
        hundredths += 10;
        reasons.push(`both sides are ${column.logicalType} (+0.1)`);
      } else if (INTEGER_FAMILY.has(targetType) && INTEGER_FAMILY.has(column.logicalType)) {
        hundredths += 5;
        reasons.push(`${column.logicalType} vs ${targetType} — same integer family (+0.05)`);
      } else {
        hundredths -= 15;
        reasons.push(`${column.logicalType} does not agree with ${targetType} (-0.15)`);
      }
      if (selfReferential && !hierarchy) {
        // `products.product_id` on a table whose PK is `id` is far more often
        // a legacy/external key than a self-join — suggested, never accepted.
        hundredths -= 20;
        reasons.push('self-reference on non-hierarchy vocabulary (-0.2)');
      }

      if (hundredths < MIN_SUGGESTION_HUNDREDTHS) continue;
      const confidence = Math.min(MAX_INFERRED_HUNDREDTHS, hundredths) / 100;

      const id = `inferred-name:${table.id}(${column.name})->${target.table.id}(${target.key.column.name})`;
      if (existingIds.has(id)) continue;
      existingIds.add(id);
      inferred.push({
        relation: {
          id,
          kind: 'inferred-name',
          cardinality: cardinalityOf(table, column),
          from: { tableId: table.id, columns: [column.name] },
          to: { tableId: target.table.id, columns: [target.key.column.name] },
          through: null,
          onDelete: null,
          onUpdate: null,
          selfReferential,
          confidence,
        },
        reasons,
      });
    }
  }
  return inferred;
}

// ---------------------------------------------------------------------------
// Rule 2 — join-table inference (M2M)
// ---------------------------------------------------------------------------

/** Where one of a join table's two FK columns points, and how sure we are. */
interface JoinSide {
  column: string;
  tableId: string;
  toColumn: string;
  confidence: number;
}

function resolveJoinSide(
  model: DatabaseModel,
  table: TableModel,
  columnName: string,
): JoinSide | null {
  const declared = table.columns.find((c) => c.name === columnName)?.references ?? null;
  if (declared !== null) {
    return { column: columnName, tableId: declared.tableId, toColumn: declared.column, confidence: 1 };
  }
  for (const relation of model.relations) {
    if (relation.through !== null) continue;
    if (relation.from.tableId !== table.id) continue;
    if (relation.from.columns.length !== 1 || relation.from.columns[0] !== columnName) continue;
    if (relation.confidence < ACCEPTED_RELATION_CONFIDENCE) continue;
    return {
      column: columnName,
      tableId: relation.to.tableId,
      toColumn: relation.to.columns[0] as string,
      confidence: relation.confidence,
    };
  }
  return null;
}

/**
 * The join detector needs classified columns, and `classifyColumn` is the
 * only thing that produces them. `joinDetectionColumns` (classify/tables.ts)
 * then applies the accepted-relation → `fk` restatement, which is shared
 * verbatim with `classifyTable` — the two MUST agree, or rule 2 emits an M2M
 * for a table the table classifier still calls an `entity`.
 */
function detectionColumnsFor(model: DatabaseModel, table: TableModel): ClassifiedColumn[] {
  const ctx = buildColumnClassifyContext(model, table);
  return joinDetectionColumns(
    model,
    table,
    table.columns.map((column) => classifyColumn(column, ctx)),
  );
}

/**
 * Rule 2: a table that is nothing but two FKs is an M2M edge, not an entity.
 *
 * Idempotence matters here beyond re-runs: `@adminium/schema-import`'s Django
 * parser already emits `inferred-join-table` relations for every
 * `ManyToManyField`, so an imported model arrives with M2M relations a live
 * introspection of the same database does not have. A through table already
 * covered by ANY relation is left alone, which keeps the two paths from
 * disagreeing and keeps `databaseModelSchema.superRefine` (which throws on a
 * duplicate relation id) satisfied.
 */
export function inferJoinTableRelations(model: DatabaseModel): InferredRelation[] {
  const covered = new Set(
    model.relations
      .map((r) => r.through?.tableId)
      .filter((id): id is string => id !== undefined && id !== null),
  );
  const existingIds = new Set(model.relations.map((r) => r.id));
  const inferred: InferredRelation[] = [];

  for (const table of [...model.tables].sort((a, b) => a.id.localeCompare(b.id))) {
    if (table.system) continue;
    if (covered.has(table.id)) continue;

    const join = detectJoinTable(table, detectionColumnsFor(model, table));
    if (!join.isJoin) continue;

    const sides = join.fkColumns.map((name) => resolveJoinSide(model, table, name));
    const [from, to] = sides;
    if (from === undefined || from === null || to === undefined || to === null) continue;

    // Column order fixes the direction: deterministic, and it mirrors the
    // order the schema itself declares the pair in.
    const id = `inferred-m2m:${table.id}(${from.column}+${to.column})`;
    if (existingIds.has(id)) continue;
    existingIds.add(id);
    inferred.push({
      relation: {
        id,
        kind: 'inferred-join-table',
        cardinality: 'many-to-many',
        from: { tableId: from.tableId, columns: [from.toColumn] },
        to: { tableId: to.tableId, columns: [to.toColumn] },
        through: {
          tableId: table.id,
          fromColumns: [from.column],
          toColumns: [to.column],
        },
        onDelete: null,
        onUpdate: null,
        selfReferential: from.tableId === to.tableId,
        // A join is never surer than the weaker of the two FKs holding it up.
        confidence: Math.min(join.confidence, from.confidence, to.confidence),
      },
      reasons: [...join.reasons, `join-table confidence ${join.confidence.toFixed(2)}`],
    });
  }
  return inferred;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Both rules, in the only order that works. Rule 2 sees rule 1's output. */
export function inferRelations(model: DatabaseModel): InferredRelation[] {
  const named = inferNameRelations(model);
  const seeded =
    named.length === 0
      ? model
      : { ...model, relations: [...model.relations, ...named.map((i) => i.relation)] };
  return [...named, ...inferJoinTableRelations(seeded)];
}

/**
 * Return a NEW model with §6 rules 1–2 relations appended. Call it BEFORE
 * `applyClassification` — the column and table classifiers both read
 * `model.relations`, and that is the entire point of inferring them.
 *
 * Idempotent: a second pass finds every column already claimed and every
 * join table already covered, so it returns the model untouched.
 */
export function applyInference(model: DatabaseModel): DatabaseModel {
  const inferred = inferRelations(model);
  if (inferred.length === 0) return model;
  const relations = [...model.relations, ...inferred.map((i) => i.relation)];
  return { ...model, relations, stats: { ...model.stats, relationCount: relations.length } };
}

// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { WORKING_SCALE } from './decimal.js';

/**
 * The `config.derived` vocabulary of a `page-crud` body — page-level named
 * MEASURES (folds over a child table) and DERIVED FIELDS (arithmetic and
 * conditionals over those folds, this row's own columns, and literals).
 *
 * WHY PAGE-LEVEL AND NAMED, rather than a block per column: the numbers an
 * operator actually wants form a chain — subtotal → discount → tax → total →
 * shipping — and four display columns share it. No dialect permits a sibling
 * SELECT alias inside one SELECT list, so per-column definitions would each
 * re-derive the whole chain: four identical correlated subqueries for one row.
 * A `columns[]` entry therefore carries only `derived: { ref }` and points
 * here (D2). It is the relationship `lookup`/`reverse` already have to their
 * projections, lifted one level.
 *
 * WHY THE SHAPES ARE THIS NARROW. Every restriction below is a measurement,
 * not a taste:
 *
 * - **A measure body is a precedence-flat sum of signed products** — no
 *   parentheses to get wrong, and `×` binds tighter than `+` on all three
 *   dialects, so the emitted fragment cannot be mis-parenthesized (D5).
 * - **Division is banned inside a fold.** `sum(qty*rate*d/100)` returns `6`
 *   against a truth of `6.90` on SQLite integer storage and `select 7/100` is
 *   `0` on Postgres. A constant divisor rides as `of.factor` and is applied
 *   after the fold in exact BigInt, which is licensed by `k·Σx = Σ(k·x)` and
 *   is exact everywhere (D6).
 * - **`min`/`max` take one term of one column and no factor**, because
 *   `k·min(x) = min(k·x)` holds only for `k > 0` — a negative factor turns a
 *   minimum into a maximum (D17).
 * - **A field's `div` denominator must be a non-zero decimal literal**, which
 *   removes Postgres's hard `ERROR: division by zero` (a 500 on the whole list
 *   read) as a class rather than as a guarded case (D6).
 * - **Field references point BACKWARD only**, which makes cycle detection one
 *   left-to-right pass instead of a graph walk.
 *
 * WHAT IS NOT HERE, deliberately: no expression string and no formula field
 * (there is no evaluator in the lockfile and both written precedents in this
 * tree refuse one), no filter inside a fold, no multi-hop measure, no
 * date/text `min`/`max`. Each is in the plan's refusal catalogue with the
 * reason and the price.
 *
 * SCHEMA VS PARSER. {@link crudDerivedConfigSchema} validates SHAPE — keys,
 * types, enums, array widths, the alias and literal grammars. Everything that
 * needs to see more than one item at a time — the shared alias namespace,
 * reference direction, the node/depth budget, the divisor rule, the per-`fn`
 * body rules — lives in {@link parseCrudDerived}, which answers a NAMED
 * refusal. Callers must go through the parser; the bare schema is for typing
 * and for editors that build a spec incrementally.
 *
 * Objects here are STRICT. A stored block written by a newer build and read by
 * an older one refuses whole rather than silently dropping a key: a stripped
 * key in an arithmetic spec is a wrong number on screen, and a blank cell is
 * the honest failure. Cross-release skew is handled a level up — an old server
 * strips the unknown `compute=` param entirely (D1).
 *
 * Pure-Zod leaf: the server reads this through `@adminium/engine/config`, the
 * dashboard binding through `@adminium/widgets/page-config`, and the Studio
 * live preview runs the identical evaluator — one definition, no drift (D4).
 */

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/**
 * The v1 fold vocabulary. `count` is the one that already ships (as `agg=`);
 * the other four are the ask. Closed, because each one has to be answered by a
 * `fn` dispatch, a canonical-decimal normalizer and an empty-fold policy.
 */
export const MEASURE_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export const measureFnSchema = z.enum(MEASURE_FNS);
export type MeasureFn = (typeof MEASURE_FNS)[number];

/** Field arithmetic. Binary only — the AST carries its own precedence. */
export const FIELD_OPS = ['add', 'sub', 'mul', 'div'] as const;
export const fieldOpSchema = z.enum(FIELD_OPS);
export type FieldOp = (typeof FIELD_OPS)[number];

/** Comparisons a conditional field may branch on. */
export const FIELD_CMPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const;
export const fieldCmpSchema = z.enum(FIELD_CMPS);
export type FieldCmp = (typeof FIELD_CMPS)[number];

/** Term polarity — `Σ(+a·b) + Σ(−c)` without an operator alphabet. */
export const measureTermSignSchema = z.enum(['plus', 'minus']);
export type MeasureTermSign = z.infer<typeof measureTermSignSchema>;

/**
 * What an empty fold reads as. Default per `fn` (D18): `zero` for `sum`,
 * `null` for `avg`/`min`/`max`. An invoice with no line items should read
 * `$0.00`, not an em-dash — but the average of nothing is not zero. Authorable
 * per measure so "no child rows" stays a state distinct from "you may not read
 * that table", which a blanket `coalesce` would erase.
 */
export const measureEmptySchema = z.enum(['null', 'zero']);
export type MeasureEmpty = z.infer<typeof measureEmptySchema>;

// ---------------------------------------------------------------------------
// Grammars and caps
// ---------------------------------------------------------------------------

/**
 * Measure and field ids: row keys, and — for measures — SQL aliases via
 * `.as(id)`. The same pattern `lookup=` and `agg=` already enforce, restated
 * here because the browser bundle cannot import the server's copy.
 */
export const DERIVED_ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Author-written numbers: a plain decimal string, never a float and never an
 * exponent. Bounded at {@link WORKING_SCALE} decimals because that is the
 * width the arithmetic carries — a literal with a seventh decimal would be
 * silently rounded, and refusing it says so.
 */
export const DECIMAL_LITERAL_PATTERN = /^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/;

/** Shared with `agg=`: 12 correlated subqueries per request, total (D13). */
export const MAX_MEASURES = 12;
/** Fields are in-process arithmetic, but a page with 9 of them is a report. */
export const MAX_DERIVED_FIELDS = 8;
/** `Σ(a·b) − Σ(c) + Σ(d)` is three terms; nobody has asked for a fourth. */
export const MAX_MEASURE_TERMS = 3;
/** `qty × rate × discount_pct` is three factors; four is headroom. */
export const MAX_TERM_FACTORS = 4;
/** Branches in one conditional field. */
export const MAX_FIELD_CASES = 4;
/** Expression depth: `mul(measure, div(col, lit))` — the tax ask — is 3. */
export const MAX_FIELD_DEPTH = 3;
/** Nodes in one field's AST, leaves included. */
export const MAX_FIELD_NODES = 24;
/** Output rounding cannot ask for more digits than the arithmetic carries. */
export const MAX_FIELD_SCALE = WORKING_SCALE;
/**
 * A conditional field's TEXT outcome — the word a rule answers with:
 * "Waived", "Standard". Bounded because it becomes a cell and a file value,
 * never a paragraph.
 */
export const MAX_TEXT_OUTCOME_LENGTH = 64;

const aliasSchema = z.string().regex(DERIVED_ALIAS_PATTERN);
const identifierSchema = z.string().min(1).max(255);
const decimalLiteralSchema = z.string().regex(DECIMAL_LITERAL_PATTERN);

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

export const measureTermSchema = z.strictObject({
  sign: measureTermSignSchema,
  /** Columns of the REFERENCING table, multiplied together. */
  factors: z.array(identifierSchema).min(1).max(MAX_TERM_FACTORS),
});
export type MeasureTerm = z.infer<typeof measureTermSchema>;

export const measureBodySchema = z.strictObject({
  terms: z.array(measureTermSchema).min(1).max(MAX_MEASURE_TERMS),
  /**
   * A constant applied to the fold's RESULT, in BigInt, after the fetch —
   * never emitted into the SQL. This is the whole of D6: `× 0.01` here is
   * exact on every dialect, `/100` inside the fold is not.
   */
  factor: decimalLiteralSchema.optional(),
});
export type MeasureBody = z.infer<typeof measureBodySchema>;

export const measureSchema = z.strictObject({
  id: aliasSchema,
  /** The REFERENCING table, qualified ("public.invoice_items"). */
  table: identifierSchema,
  /** Its single-column FK onto this page's table. */
  fkColumn: identifierSchema,
  fn: measureFnSchema,
  of: measureBodySchema.optional(),
  emptyAs: measureEmptySchema.optional(),
});
export type Measure = z.infer<typeof measureSchema>;

/**
 * The empty-fold policy actually in force for a measure (D18).
 *
 * `count` never observes it — SQL answers an empty `COUNT` with `0`, not
 * `NULL` — so it is pinned to `zero` rather than left to a default that could
 * make a count render an em-dash.
 */
export function emptyPolicyOf(measure: Measure): MeasureEmpty {
  if (measure.fn === 'count') return 'zero';
  return measure.emptyAs ?? (measure.fn === 'sum' ? 'zero' : 'null');
}

// ---------------------------------------------------------------------------
// Derived fields
// ---------------------------------------------------------------------------

/** One `when → then` branch of a conditional field. */
export interface FieldCase {
  when: { left: FieldExpr; cmp: FieldCmp; right: FieldExpr };
  then: FieldExpr;
}

/**
 * A field expression. Six leaves and two combinators — small enough that the
 * evaluator is a `switch` and the Studio can offer every node as a control.
 *
 * `{ measure }` and `{ col }` are both row reads at evaluation time; they stay
 * distinct in the AST so validation can say which namespace an author meant,
 * and so the Studio can offer two different pickers.
 *
 * `{ text }` is the one non-numeric leaf: a word a conditional answers with.
 * It is legal ONLY as a `cases[].then` / `else` outcome of a field declared
 * `result: 'text'` — never an operand of `op` or of a comparison, so the
 * arithmetic stays closed over decimals at parse time and the evaluator's
 * decimal path never meets one.
 */
export type FieldExpr =
  | { measure: string }
  | { field: string }
  | { col: string }
  | { lit: string }
  | { text: string }
  | { op: FieldOp; args: [FieldExpr, FieldExpr] }
  | { cases: FieldCase[]; else: FieldExpr };

export const fieldExprSchema: z.ZodType<FieldExpr> = z.lazy(() =>
  z.union([
    z.strictObject({ measure: aliasSchema }),
    z.strictObject({ field: aliasSchema }),
    z.strictObject({ col: identifierSchema }),
    z.strictObject({ lit: decimalLiteralSchema }),
    z.strictObject({ text: z.string().min(1).max(MAX_TEXT_OUTCOME_LENGTH) }),
    z.strictObject({ op: fieldOpSchema, args: z.tuple([fieldExprSchema, fieldExprSchema]) }),
    z.strictObject({
      cases: z
        .array(
          z.strictObject({
            when: z.strictObject({
              left: fieldExprSchema,
              cmp: fieldCmpSchema,
              right: fieldExprSchema,
            }),
            then: fieldExprSchema,
          }),
        )
        .min(1)
        .max(MAX_FIELD_CASES),
      else: fieldExprSchema,
    }),
  ]),
);

export const derivedFieldSchema = z.strictObject({
  id: aliasSchema,
  expr: fieldExprSchema,
  /**
   * Decimals on OUTPUT only. A `{ field }` reference reads the referenced
   * field's unrounded working value — rounding at every hop is how
   * `1.0049 × 3` becomes `3.00` instead of `3.01` (D7).
   */
  scale: z.number().int().min(0).max(MAX_FIELD_SCALE),
  /**
   * What the field answers with. `decimal` (the default) is the arithmetic
   * everything above describes; `text` is a conditional whose outcomes are
   * `{ text }` leaves. Declared rather than inferred so a reader of the
   * stored block knows the column's type without walking the tree, and so
   * the parser can refuse a text leaf in a decimal field by name.
   */
  result: z.enum(['decimal', 'text']).optional(),
});
export type DerivedField = z.infer<typeof derivedFieldSchema>;

export const crudDerivedConfigSchema = z.strictObject({
  measures: z.array(measureSchema).default([]),
  fields: z.array(derivedFieldSchema).default([]),
});
export type CrudDerivedConfig = z.infer<typeof crudDerivedConfigSchema>;
export type CrudDerivedConfigInput = z.input<typeof crudDerivedConfigSchema>;

// ---------------------------------------------------------------------------
// Named refusals
// ---------------------------------------------------------------------------

/**
 * Why a block was refused, by name.
 *
 * These are page-AUTHOR mistakes, and the house split makes them hard 422s
 * that fail the read rather than silent degradations (D10) — the opposite
 * polarity from a per-caller permission refusal, which nulls one value and
 * marks it. Naming each one is what lets the 422 body say which measure and
 * which rule, instead of "invalid compute".
 */
export const DERIVED_REFUSAL_CODES = [
  'DERIVED_MALFORMED',
  'DERIVED_MEASURE_LIMIT',
  'DERIVED_FIELD_LIMIT',
  'DERIVED_ALIAS_COLLISION',
  'DERIVED_ALIAS_RESERVED',
  'DERIVED_MEASURE_BODY_REQUIRED',
  'DERIVED_MEASURE_BODY_FORBIDDEN',
  'DERIVED_MEASURE_FACTOR_FORBIDDEN',
  'DERIVED_MEASURE_SHAPE_FORBIDDEN',
  'DERIVED_UNKNOWN_MEASURE',
  'DERIVED_UNKNOWN_FIELD',
  'DERIVED_SELF_REFERENCE',
  'DERIVED_FORWARD_REFERENCE',
  'DERIVED_FIELD_TOO_DEEP',
  'DERIVED_FIELD_TOO_LARGE',
  'DERIVED_DIVISOR_NOT_LITERAL',
  'DERIVED_DIVISOR_ZERO',
  'DERIVED_TEXT_PLACEMENT',
  'DERIVED_TEXT_RESULT',
  'DERIVED_TEXT_FIELD_READ',
] as const;
export type DerivedRefusalCode = (typeof DERIVED_REFUSAL_CODES)[number];

export interface DerivedRefusal {
  code: DerivedRefusalCode;
  /** The offending measure or field id, or the colliding alias. */
  id?: string;
  /** English, safe for a 422 body: what was refused and by which rule. */
  message: string;
}

export type ParsedCrudDerived =
  | { ok: true; value: CrudDerivedConfig }
  | { ok: false; refusal: DerivedRefusal };

/**
 * Names this block's ids must not collide with (D26).
 *
 * Measure and field ids become ROW KEYS. A field called `total` on a table
 * that has a `total` column overwrites real data after masking — silently, and
 * the page author gets no error. So the four projection families (lookups,
 * aggregates, measures, fields) share one namespace with the base table's own
 * columns, and every one of them checks against the same set.
 */
export interface CrudDerivedNamespace {
  /** The page table's real column names. */
  columns?: readonly string[];
  /** Aliases already claimed by `lookup=` / `agg=` on the same request. */
  takenAliases?: readonly string[];
}

/**
 * Row keys the read path writes itself, which an id must never take.
 *
 * `_masked` is the refusal marker every masked column, lookup, measure and
 * field joins. A definition that claimed it would overwrite the list — and
 * the visible effect is that refused cells stop rendering the masked
 * treatment and start rendering as merely empty, which is the one failure
 * mode this vocabulary must not have. The alias grammar admits a leading
 * underscore (it mirrors the server's, which has admitted one since `agg=`
 * shipped), so the exclusion has to be stated rather than derived.
 */
export const RESERVED_ROW_KEYS: readonly string[] = ['_masked'];

const EMPTY: CrudDerivedConfig = { measures: [], fields: [] };

function refuse(code: DerivedRefusalCode, message: string, id?: string): ParsedCrudDerived {
  return { ok: false, refusal: id === undefined ? { code, message } : { code, message, id } };
}

/**
 * Validate a `config.derived` block (or the identically-shaped `compute=`
 * payload) into a spec every consumer can trust, or a named refusal.
 *
 * An absent block is an empty vocabulary, not a refusal: pages without derived
 * columns are the overwhelming majority and must cost nothing.
 *
 * `{ col }` and measure `table`/`fkColumn`/`factors` name database
 * identifiers, which this leaf cannot see. They are resolved against the
 * snapshot server-side, where an unknown or secret name is its own 422 — this
 * pass checks everything that is knowable from the block itself.
 */
export function parseCrudDerived(
  raw: unknown,
  namespace: CrudDerivedNamespace = {},
): ParsedCrudDerived {
  if (raw === undefined || raw === null) return { ok: true, value: EMPTY };

  const parsed = crudDerivedConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` at \`${issue.path.join('.')}\`` : '';
    return refuse(
      'DERIVED_MALFORMED',
      `\`derived\` is not a valid computed-column block${where}: ${issue?.message ?? 'invalid'}.`,
    );
  }
  const { measures, fields } = parsed.data;

  if (measures.length > MAX_MEASURES) {
    return refuse(
      'DERIVED_MEASURE_LIMIT',
      `At most ${String(MAX_MEASURES)} measures per request, shared with \`agg\`; got ${String(measures.length)}.`,
    );
  }
  if (fields.length > MAX_DERIVED_FIELDS) {
    return refuse(
      'DERIVED_FIELD_LIMIT',
      `At most ${String(MAX_DERIVED_FIELDS)} derived fields per page; got ${String(fields.length)}.`,
    );
  }

  for (const id of [...measures.map((m) => m.id), ...fields.map((f) => f.id)]) {
    if (RESERVED_ROW_KEYS.includes(id)) {
      return refuse(
        'DERIVED_ALIAS_RESERVED',
        `\`${id}\` is a reserved row key and cannot name a measure or field.`,
        id,
      );
    }
  }

  const taken = new Set<string>([...(namespace.columns ?? []), ...(namespace.takenAliases ?? [])]);
  const measureIds = new Set<string>();

  for (const measure of measures) {
    if (taken.has(measure.id)) {
      return refuse(
        'DERIVED_ALIAS_COLLISION',
        `Measure \`${measure.id}\` collides with a column or projection alias already in this request.`,
        measure.id,
      );
    }
    const bodyRefusal = checkMeasureBody(measure);
    if (bodyRefusal) return { ok: false, refusal: bodyRefusal };
    taken.add(measure.id);
    measureIds.add(measure.id);
  }

  const fieldIds = new Set<string>();
  for (const field of fields) {
    if (taken.has(field.id)) {
      return refuse(
        'DERIVED_ALIAS_COLLISION',
        `Derived field \`${field.id}\` collides with a column, a measure, or a projection alias already in this request.`,
        field.id,
      );
    }
    taken.add(field.id);
    fieldIds.add(field.id);
  }

  const earlier = new Set<string>();
  const textFields = new Set<string>();
  for (const field of fields) {
    const refusal = inspectField(field, { measureIds, earlier, fieldIds, textFields });
    if (refusal) return { ok: false, refusal };
    earlier.add(field.id);
    if (field.result === 'text') textFields.add(field.id);
  }

  return { ok: true, value: { measures, fields } };
}

function checkMeasureBody(measure: Measure): DerivedRefusal | null {
  const { id, fn, of } = measure;
  if (fn === 'count') {
    if (of !== undefined) {
      return {
        code: 'DERIVED_MEASURE_BODY_FORBIDDEN',
        id,
        message: `Measure \`${id}\`: \`count\` counts rows and takes no \`of\` body.`,
      };
    }
    return null;
  }
  if (of === undefined) {
    return {
      code: 'DERIVED_MEASURE_BODY_REQUIRED',
      id,
      message: `Measure \`${id}\`: \`${fn}\` needs an \`of\` body naming what to fold.`,
    };
  }
  if (fn === 'min' || fn === 'max') {
    if (of.factor !== undefined) {
      return {
        code: 'DERIVED_MEASURE_FACTOR_FORBIDDEN',
        id,
        // k·min(x) = min(k·x) only for k > 0; a negative factor turns a
        // minimum into a maximum, and carrying a sign rule for a case nobody
        // asked for is dearer than refusing it (D17).
        message: `Measure \`${id}\`: \`of.factor\` is not allowed on \`${fn}\` — factoring a constant out of a minimum or maximum flips it for a negative constant.`,
      };
    }
    const firstTerm = of.terms[0];
    if (of.terms.length !== 1 || firstTerm === undefined || firstTerm.factors.length !== 1) {
      return {
        code: 'DERIVED_MEASURE_SHAPE_FORBIDDEN',
        id,
        message: `Measure \`${id}\`: \`${fn}\` takes exactly one term of exactly one column.`,
      };
    }
    if (firstTerm.sign === 'minus') {
      return {
        code: 'DERIVED_MEASURE_SHAPE_FORBIDDEN',
        id,
        message: `Measure \`${id}\`: \`${fn}\` takes a plain column, not a negated one.`,
      };
    }
  }
  return null;
}

interface FieldRefs {
  measureIds: ReadonlySet<string>;
  /** Fields declared BEFORE this one — the only ones it may read. */
  earlier: ReadonlySet<string>;
  /** Every field id, so a forward reference is named as such. */
  fieldIds: ReadonlySet<string>;
  /** Earlier fields declared `result: 'text'` — arithmetic may not read one. */
  textFields: ReadonlySet<string>;
}

function inspectField(field: DerivedField, refs: FieldRefs): DerivedRefusal | null {
  const budget = { nodes: 0, text: false };
  const refusal = inspectExpr(field.expr, 1, field, refs, budget, true);
  if (refusal) return refusal;
  // `result: 'text'` and "a text leaf exists" are one fact stated twice, and
  // the parser holds them together: a decimal field with a word in it would
  // render a word into a money column, and a text field without one is a
  // declaration nothing honours.
  if (budget.text && field.result !== 'text') {
    return {
      code: 'DERIVED_TEXT_RESULT',
      id: field.id,
      message: `Derived field \`${field.id}\` answers with text, so it must declare \`result: 'text'\`.`,
    };
  }
  if (!budget.text && field.result === 'text') {
    return {
      code: 'DERIVED_TEXT_RESULT',
      id: field.id,
      message: `Derived field \`${field.id}\` declares \`result: 'text'\` but has no text outcome.`,
    };
  }
  return null;
}

/**
 * One recursive pass that answers everything about a node at once: the node
 * budget, the depth budget, the divisor rule, and reference direction.
 *
 * Depth counts the node itself: a leaf is 1, so the tax ask
 * `mul(measure, div(col, lit))` is exactly {@link MAX_FIELD_DEPTH}.
 */
function inspectExpr(
  expr: FieldExpr,
  depth: number,
  field: DerivedField,
  refs: FieldRefs,
  budget: { nodes: number; text: boolean },
  /** Whether a `{ text }` leaf may stand here: at the root and as a `cases` outcome only. */
  textAllowed: boolean,
): DerivedRefusal | null {
  budget.nodes += 1;
  if (budget.nodes > MAX_FIELD_NODES) {
    return {
      code: 'DERIVED_FIELD_TOO_LARGE',
      id: field.id,
      message: `Derived field \`${field.id}\`: at most ${String(MAX_FIELD_NODES)} expression nodes.`,
    };
  }
  if (depth > MAX_FIELD_DEPTH) {
    return {
      code: 'DERIVED_FIELD_TOO_DEEP',
      id: field.id,
      message: `Derived field \`${field.id}\`: expressions nest at most ${String(MAX_FIELD_DEPTH)} deep.`,
    };
  }

  if ('measure' in expr) {
    if (!refs.measureIds.has(expr.measure)) {
      return {
        code: 'DERIVED_UNKNOWN_MEASURE',
        id: field.id,
        message: `Derived field \`${field.id}\` reads measure \`${expr.measure}\`, which this page does not define.`,
      };
    }
    return null;
  }
  if ('field' in expr) {
    if (expr.field === field.id) {
      return {
        code: 'DERIVED_SELF_REFERENCE',
        id: field.id,
        message: `Derived field \`${field.id}\` reads itself.`,
      };
    }
    if (refs.earlier.has(expr.field)) {
      if (refs.textFields.has(expr.field)) {
        return {
          code: 'DERIVED_TEXT_FIELD_READ',
          id: field.id,
          // A word has no arithmetic and no ordering; the only thing reading
          // one could mean is a mistake, so it is named rather than absorbed.
          message: `Derived field \`${field.id}\` reads \`${expr.field}\`, which answers with text and cannot be computed with.`,
        };
      }
      return null;
    }
    if (refs.fieldIds.has(expr.field)) {
      return {
        code: 'DERIVED_FORWARD_REFERENCE',
        id: field.id,
        // Backward-only references make cycle detection one left-to-right
        // pass; reordering the two fields is the whole fix.
        message: `Derived field \`${field.id}\` reads \`${expr.field}\`, which is declared after it — fields may only read earlier fields.`,
      };
    }
    return {
      code: 'DERIVED_UNKNOWN_FIELD',
      id: field.id,
      message: `Derived field \`${field.id}\` reads \`${expr.field}\`, which this page does not define.`,
    };
  }
  if ('col' in expr || 'lit' in expr) return null;
  if ('text' in expr) {
    budget.text = true;
    if (!textAllowed) {
      return {
        code: 'DERIVED_TEXT_PLACEMENT',
        id: field.id,
        message: `Derived field \`${field.id}\`: a text outcome can only be what a rule answers with, not a number it computes or compares.`,
      };
    }
    return null;
  }

  if ('op' in expr) {
    if (expr.op === 'div') {
      const denominator = expr.args[1];
      if (!('lit' in denominator)) {
        return {
          code: 'DERIVED_DIVISOR_NOT_LITERAL',
          id: field.id,
          // A per-row divisor reintroduces division by zero, which is a hard
          // Postgres ERROR and would 500 the whole list read (D6).
          message: `Derived field \`${field.id}\`: division needs a literal divisor.`,
        };
      }
      if (isZeroLiteral(denominator.lit)) {
        return {
          code: 'DERIVED_DIVISOR_ZERO',
          id: field.id,
          message: `Derived field \`${field.id}\`: division by zero.`,
        };
      }
    }
    for (const arg of expr.args) {
      const refusal = inspectExpr(arg, depth + 1, field, refs, budget, false);
      if (refusal) return refusal;
    }
    return null;
  }

  for (const branch of expr.cases) {
    for (const node of [branch.when.left, branch.when.right]) {
      const refusal = inspectExpr(node, depth + 1, field, refs, budget, false);
      if (refusal) return refusal;
    }
    // An outcome inherits its parent's licence: a rule nested inside an `op`
    // is a number the op will consume, so its outcomes may not be words.
    const outcome = inspectExpr(branch.then, depth + 1, field, refs, budget, textAllowed);
    if (outcome) return outcome;
  }
  return inspectExpr(expr.else, depth + 1, field, refs, budget, textAllowed);
}

/**
 * Every base-table column the given fields read, deduplicated, in first-seen
 * order.
 *
 * The read path needs this to widen its projection: a field naming
 * `tax_rate` cannot be evaluated if the SELECT list does not carry it, and a
 * page whose columns do not display `tax_rate` would otherwise never fetch it.
 * Deliberately answers only `{ col }` nodes — measures arrive under their own
 * aliases and fields under theirs.
 */
export function collectFieldColumns(fields: readonly DerivedField[]): string[] {
  const names = new Set<string>();
  const walk = (expr: FieldExpr): void => {
    if ('col' in expr) {
      names.add(expr.col);
      return;
    }
    if ('op' in expr) {
      walk(expr.args[0]);
      walk(expr.args[1]);
      return;
    }
    if ('cases' in expr) {
      for (const branch of expr.cases) {
        walk(branch.when.left);
        walk(branch.when.right);
        walk(branch.then);
      }
      walk(expr.else);
    }
  };
  for (const field of fields) walk(field.expr);
  return [...names];
}

function isZeroLiteral(literal: string): boolean {
  return /^-?0(?:\.0+)?$/.test(literal);
}

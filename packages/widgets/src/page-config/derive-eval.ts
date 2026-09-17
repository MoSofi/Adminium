// SPDX-License-Identifier: AGPL-3.0-only
import {
  addDecimal,
  compareDecimal,
  divDecimal,
  formatDecimal,
  mulDecimal,
  parseDecimal,
  subDecimal,
  type Decimal,
} from './decimal.js';
import type { DerivedField, FieldExpr } from './crud-derived.js';

/**
 * The derived-field evaluator — one ordered pass over a row, in exact BigInt.
 *
 * WHERE IT RUNS. On the SERVER, after masking, at both list return sites and
 * as a fourth stage on the single-record GET — and, identically, in the Studio
 * live preview so the preview cannot drift from the value the grid shows (D3,
 * D4). It is deliberately not SQL (no dialect permits a sibling SELECT alias,
 * so every consumer of a measure would re-inline its whole correlated
 * subquery) and deliberately not the browser (that would foreclose exports,
 * scheduled reports and every non-dashboard API consumer permanently, and give
 * the money law two implementations to drift apart).
 *
 * WHY POST-MASK. `maskRow` has already nulled masked values and dropped secret
 * ones, so this pass physically cannot read what did not survive masking. A
 * refusal bug here can only fail to null arithmetic — never to derived
 * plaintext. A SQL-side evaluator cannot have that property.
 *
 * THE THREE-STATE LATTICE, which is the whole of the security argument (D11):
 *
 * - **refused** — an operand the caller may not read. It POISONS: every node
 *   above it is refused, *including a comparison*, so a conditional cannot
 *   launder a refused input into a number and leak one bit per row. The field
 *   renders masked dots and its id joins the row's `_masked` marker.
 * - **absent** — an unmarked null. Routine, not a refusal: `emptyAs: 'null'`
 *   on an `avg` of nothing, or a `{ col }` naming a nullable column. It
 *   ABSORBS through arithmetic, makes a predicate not-true, and renders as an
 *   em-dash.
 * - **value** — a number, `0` included.
 *
 * Keeping absent and refused apart is what makes the three states legible on
 * screen: masked dots, em-dash, `$0.00` — never one wearing another's clothes.
 */

/**
 * A field's outcome for one row.
 *
 * `text` is the fourth state: the word a `result: 'text'` rule answered with.
 * It never enters arithmetic — the parser refuses a text leaf as an operand
 * and a reference to a text field — so the decimal branches below treat one as
 * absent purely defensively.
 */
export type DerivedValue =
  | { state: 'value'; value: Decimal }
  | { state: 'text'; text: string }
  | { state: 'absent' }
  | { state: 'refused' };

const ABSENT: DerivedValue = { state: 'absent' };
const REFUSED: DerivedValue = { state: 'refused' };

export interface DerivedRowInput {
  /**
   * The row AFTER masking — base columns, lookup aliases and measure aliases
   * alike. Measures and columns share one key namespace by construction
   * (D26), so `{ measure }` and `{ col }` are the same read here; they stay
   * distinct in the AST so validation and the Studio can tell them apart.
   */
  row: Readonly<Record<string, unknown>>;
  /** Keys the mask pass nulled and listed in the row's `_masked` marker. */
  masked?: readonly string[];
}

export interface DerivedRowOutput {
  /**
   * Field id → canonical decimal string at the field's declared scale (or the
   * text a `result: 'text'` rule answered with), or `null` for absent AND
   * refused alike. The two are distinguished by
   * {@link DerivedRowOutput.masked}, exactly as a masked base column is.
   */
  values: Record<string, string | null>;
  /** Field ids to append to the row's `_masked` marker. */
  masked: string[];
}

/**
 * Evaluate a page's derived fields for one row, in declaration order.
 *
 * Order is the contract: a field may only read fields declared before it
 * (enforced at parse time), so by the time one is evaluated every field it
 * reads is already computed. References read the **unrounded working value**,
 * never the rounded string — a field's `scale` is an output rounding only, and
 * rounding at every hop is how `1.0049 × 3` becomes `3.00` instead of `3.01`
 * (D7).
 */
export function evaluateDerivedFields(
  fields: readonly DerivedField[],
  input: DerivedRowInput,
): DerivedRowOutput {
  const masked = new Set(input.masked ?? []);
  const computed = new Map<string, DerivedValue>();
  const values: Record<string, string | null> = {};
  const refusedIds: string[] = [];

  for (const field of fields) {
    const result = evaluateExpr(field.expr, input.row, masked, computed);
    computed.set(field.id, result);
    values[field.id] =
      result.state === 'value'
        ? formatDecimal(result.value, field.scale)
        : result.state === 'text'
          ? result.text
          : null;
    if (result.state === 'refused') refusedIds.push(field.id);
  }

  return { values, masked: refusedIds };
}

/**
 * Read one row key into the lattice.
 *
 * A value the decimal parser cannot read answers `absent` rather than
 * throwing: this runs once per field per row on a live read path, and a driver
 * handing back something unexpected must blank one cell, not fail the page.
 */
function readKey(
  key: string,
  row: Readonly<Record<string, unknown>>,
  masked: ReadonlySet<string>,
): DerivedValue {
  if (masked.has(key)) return REFUSED;
  const parsed = parseDecimal(row[key]);
  return parsed === null ? ABSENT : { state: 'value', value: parsed };
}

function evaluateExpr(
  expr: FieldExpr,
  row: Readonly<Record<string, unknown>>,
  masked: ReadonlySet<string>,
  computed: ReadonlyMap<string, DerivedValue>,
): DerivedValue {
  if ('measure' in expr) return readKey(expr.measure, row, masked);
  if ('col' in expr) return readKey(expr.col, row, masked);
  if ('field' in expr) return computed.get(expr.field) ?? ABSENT;
  if ('lit' in expr) {
    const parsed = parseDecimal(expr.lit);
    return parsed === null ? ABSENT : { state: 'value', value: parsed };
  }
  if ('text' in expr) return { state: 'text', text: expr.text };

  if ('op' in expr) {
    const left = evaluateExpr(expr.args[0], row, masked, computed);
    const right = evaluateExpr(expr.args[1], row, masked, computed);
    if (left.state === 'refused' || right.state === 'refused') return REFUSED;
    if (left.state !== 'value' || right.state !== 'value') return ABSENT;
    return applyOp(expr.op, left.value, right.value);
  }

  for (const branch of expr.cases) {
    const left = evaluateExpr(branch.when.left, row, masked, computed);
    const right = evaluateExpr(branch.when.right, row, masked, computed);
    // The predicate is where a refusal would otherwise leak one bit per row:
    // whichever branch it selected would be a readable answer computed from an
    // unreadable input. So a refused operand refuses the whole field, never a
    // branch.
    if (left.state === 'refused' || right.state === 'refused') return REFUSED;
    // An absent operand is not a refusal and not a match: the predicate is
    // simply not true, and the chain moves on — falling through to `else` when
    // this is the only branch.
    if (left.state !== 'value' || right.state !== 'value') continue;
    if (matches(branch.when.cmp, compareDecimal(left.value, right.value))) {
      return evaluateExpr(branch.then, row, masked, computed);
    }
  }
  return evaluateExpr(expr.else, row, masked, computed);
}

function applyOp(op: 'add' | 'sub' | 'mul' | 'div', left: Decimal, right: Decimal): DerivedValue {
  switch (op) {
    case 'add':
      return { state: 'value', value: addDecimal(left, right) };
    case 'sub':
      return { state: 'value', value: subDecimal(left, right) };
    case 'mul':
      return { state: 'value', value: mulDecimal(left, right) };
    default: {
      // Unreachable from a parsed spec — a divisor must be a non-zero literal
      // (D6) — so this is the belt on that brace, not a policy.
      const quotient = divDecimal(left, right);
      return quotient === null ? ABSENT : { state: 'value', value: quotient };
    }
  }
}

function matches(cmp: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq', ordering: -1 | 0 | 1): boolean {
  switch (cmp) {
    case 'gt':
      return ordering > 0;
    case 'gte':
      return ordering >= 0;
    case 'lt':
      return ordering < 0;
    case 'lte':
      return ordering <= 0;
    case 'eq':
      return ordering === 0;
    default:
      return ordering !== 0;
  }
}

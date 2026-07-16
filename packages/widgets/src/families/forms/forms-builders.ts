/**
 * The closed vocabularies + pure logic behind the §10 BUILDER widgets —
 * `rule-builder`, `flow-builder`, `question-builder`, `column-mapping-table` and
 * `export-builder`. PURE module (React-free, JSX-free, copy-free), so
 * `forms-config.ts` can reach it without dragging component code into the eager
 * registry chunk (04 §2.3).
 *
 * WHY EVERY VOCABULARY HERE IS CLOSED: each of these widgets stores its output
 * in a page manifest and the rule-builder's output is compiled to a SQL WHERE
 * clause. A manifest that could name an arbitrary operator, node kind or
 * question type would be naming a renderer — or a predicate — that does not
 * exist. Config picks FROM these lists; it never extends them.
 */

// ── rule-builder (annex §10) ────────────────────────────────────────────────

/** The column types the field catalog classifies against (annex `operatorsByType`). */
export const RULE_FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum'] as const;
export type RuleFieldType = (typeof RULE_FIELD_TYPES)[number];

/** Every operator a condition may name — compiled to SQL WHERE by the host. */
export const RULE_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not-contains',
  'starts-with',
  'in',
  'before',
  'after',
  'is-null',
  'is-not-null',
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/** ALL/ANY — the pill dividers between condition chips (annex §10). */
export const RULE_MATCH_MODES = ['all', 'any'] as const;
export type RuleMatchMode = (typeof RULE_MATCH_MODES)[number];

/**
 * The operators offered per column type. The annex's `operatorsByType` config
 * overrides this map; this is what a generated rule-builder starts from.
 */
export const DEFAULT_OPERATORS_BY_TYPE: Record<RuleFieldType, readonly RuleOperator[]> = {
  string: ['eq', 'neq', 'contains', 'not-contains', 'starts-with', 'is-null', 'is-not-null'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is-null', 'is-not-null'],
  boolean: ['eq', 'neq'],
  date: ['before', 'after', 'eq', 'is-null', 'is-not-null'],
  enum: ['eq', 'neq', 'in', 'is-null', 'is-not-null'],
};

/**
 * Whether an operator needs a value input. `is-null`/`is-not-null` are complete
 * on their own — rendering a value box beside them would invite the user to type
 * something the compiled WHERE clause then silently ignores.
 */
export function operatorTakesValue(operator: RuleOperator): boolean {
  return operator !== 'is-null' && operator !== 'is-not-null';
}

/** The operators valid for a field type, honouring a config override. */
export function operatorsForType(
  type: RuleFieldType,
  overrides: Record<string, readonly RuleOperator[]> | undefined,
): readonly RuleOperator[] {
  const override = overrides?.[type];
  return override !== undefined && override.length > 0 ? override : DEFAULT_OPERATORS_BY_TYPE[type];
}

/**
 * A condition whose operator its field type does not support is REPAIRED to the
 * type's first operator rather than dropped: a stored segment that survives a
 * column's type change should keep the user's field and value and lose only the
 * part that stopped making sense.
 */
export function repairOperator(
  operator: RuleOperator,
  type: RuleFieldType,
  overrides: Record<string, readonly RuleOperator[]> | undefined,
): RuleOperator {
  const allowed = operatorsForType(type, overrides);
  if (allowed.includes(operator)) return operator;
  return allowed[0] ?? 'eq';
}

// ── flow-builder (annex §10) ────────────────────────────────────────────────

/** Typed workflow nodes — the annex fixes both the kinds and their tones. */
export const FLOW_NODE_KINDS = ['trigger', 'condition', 'action'] as const;
export type FlowNodeKind = (typeof FLOW_NODE_KINDS)[number];

/** annex §10: "trigger=accent, condition=warn, action=pos". */
export const FLOW_NODE_TONE: Record<FlowNodeKind, 'accent' | 'warn' | 'pos'> = {
  trigger: 'accent',
  condition: 'warn',
  action: 'pos',
};

/**
 * Where a new node may be inserted. A flow reads top-down from ONE trigger, so a
 * palette node of kind `trigger` may only replace/lead the flow — appending a
 * second trigger halfway down would describe a workflow the engine cannot run.
 */
export function canAppendNode(kind: FlowNodeKind, existing: readonly { kind: FlowNodeKind }[]): boolean {
  if (kind !== 'trigger') return true;
  return !existing.some((node) => node.kind === 'trigger');
}

// ── question-builder (annex §10) ────────────────────────────────────────────

/** The 8 addable question types (annex §10: "palette of 8 addable question types"). */
export const QUESTION_KINDS = [
  'single-choice',
  'multi-choice',
  'dropdown',
  'short-text',
  'long-text',
  'rating',
  'nps',
  'date',
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** Which kinds carry an editable option list (the rest preview a fixed stub). */
export function questionTakesOptions(kind: QuestionKind): boolean {
  return kind === 'single-choice' || kind === 'multi-choice' || kind === 'dropdown';
}

/** The NPS chip row is 0–10 by definition (annex §10). */
export const NPS_SCORES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** A star rating previews 5 stars (annex §10 "star rating"). */
export const RATING_STARS = 5;

/**
 * Move an item within an ordered list, returning a NEW array. Out-of-range
 * moves are no-ops rather than errors — the first card's "up" button is a
 * legitimate click, not a bug to throw on.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(to, 0, moved);
  return next;
}

// ── column-mapping-table (annex §10) ────────────────────────────────────────

/**
 * The target that means "Don't import" (annex §10). A reserved sentinel rather
 * than `undefined`, because "the user explicitly skipped this column" and "the
 * user has not decided yet" must not collapse into the same stored value.
 */
export const SKIP_TARGET = '__skip__';

/** Strip case and separators so `created_at`, `createdAt` and `Created At` match. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Dice coefficient over character bigrams — 0…1, symmetric, allocation-light. */
function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = bigrams.get(gram) ?? 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      hits += 1;
    }
  }
  return (2 * hits) / (a.length - 1 + (b.length - 1));
}

/** Name similarity, 0…1. Exact/prefix/substring short-circuit the bigram score. */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (left === '' || right === '') return 0;
  if (left === right) return 1;
  if (left.startsWith(right) || right.startsWith(left)) return 0.85;
  if (left.includes(right) || right.includes(left)) return 0.75;
  return diceCoefficient(left, right);
}

/** Below this, a suggestion is a guess the user would have to undo. */
export const AUTO_MATCH_THRESHOLD = 0.6;

/**
 * The best target for a source column by name similarity (annex §10 `autoMatch`),
 * or `null` when nothing clears the threshold — leaving the picker unset, which
 * is honest, rather than pre-filling a wrong mapping the user must notice to fix.
 *
 * Ties keep the FIRST target in catalog order (strict `>`), so the same schema
 * always auto-matches the same way (04 §7.7).
 */
export function autoMatchTarget(
  source: string,
  targets: readonly { key: string; label?: string | undefined }[],
): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const target of targets) {
    if (target.key === SKIP_TARGET) continue;
    const score = Math.max(nameSimilarity(source, target.key), nameSimilarity(source, target.label ?? ''));
    if (score > bestScore) {
      bestScore = score;
      best = target.key;
    }
  }
  return bestScore >= AUTO_MATCH_THRESHOLD ? best : null;
}

// ── export-builder (annex §10) ──────────────────────────────────────────────

/** The formats the annex's segmented picker offers. */
export const EXPORT_FORMATS = ['pdf', 'csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The annex's `idle → running(%) → done(Download)` machine, plus failure. */
export const EXPORT_PHASES = ['idle', 'running', 'done', 'failed'] as const;
export type ExportPhase = (typeof EXPORT_PHASES)[number];

/**
 * The phase to render. The PAYLOAD wins whenever it has moved off `idle`: the
 * host owns the export job, so its status is the truth, and a widget that kept
 * showing its own optimistic `running` after the host reported `failed` would be
 * lying about a job the user is waiting on.
 */
export function exportPhaseOf(payloadPhase: ExportPhase, submitted: boolean): ExportPhase {
  if (payloadPhase !== 'idle') return payloadPhase;
  return submitted ? 'running' : 'idle';
}

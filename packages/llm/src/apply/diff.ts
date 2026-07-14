/**
 * Diff of the LLM `EnrichmentSet` against the heuristic baseline (06-llm-assist.md
 * §8.2). Produces one {@link SuggestionDiff} per atomic suggestion, each carrying
 * the stable §8.1 suggestion-id, a diff status, a confidence, and the compared
 * values — so the Wave-2 review UI can group by category, show side-by-side
 * heuristic → LLM values, and bulk-accept by confidence.
 *
 * Statuses (§8.2), plus the user-lock overlay:
 *  - `agree`            LLM equals heuristic (labels: case/whitespace-insensitive,
 *                       en_US only, per §8.2). Pre-accepted in review.
 *  - `conflict`         both have a value and they differ.
 *  - `llm-new`          LLM suggests where the heuristic offered nothing.
 *  - `heuristic-only`   the LLM offered nothing — informational, nothing to accept.
 *  - `rejects-heuristic` the LLM explicitly rejects a heuristic flag (e.g.
 *                       `pii: null` on a heuristically-flagged column). Never
 *                       pre-checked — a human must confirm.
 *  - `user-locked`      the target already has a `source: 'user'` override
 *                       (§8.2): rendered locked, excluded from bulk accept.
 *
 * `selectBulkAccept` implements "Accept all ≥ 0.8": it selects ONLY `conflict`
 * and `llm-new` rows above the threshold, so `rejects-heuristic` and
 * `user-locked` rows can never be bulk-selected (acceptance criterion 12).
 *
 * Pure and deterministic (no Date.now / Math.random); rows come out in a stable
 * (category, id) order so golden fixtures are reproducible.
 */
import type { EnrichmentSet, EnrichmentTable } from '../types.js';
import { HEURISTIC_CONFIDENCE } from './normalize.js';
import {
  columnLabelId,
  copyId,
  dashboardId,
  enumId,
  groupId,
  keyId,
  piiId,
  relationId,
  tableLabelId,
  templateId,
  widgetId,
  type SuggestionIdPrefix,
} from './suggestion-id.js';

// ─── Public types ────────────────────────────────────────────────────────────

export type SuggestionStatus =
  | 'agree'
  | 'conflict'
  | 'llm-new'
  | 'heuristic-only'
  | 'rejects-heuristic'
  | 'user-locked';

/** Diff category = the leading token of the suggestion-id (§8.1). */
export type SuggestionCategory = SuggestionIdPrefix;

export interface SuggestionDiff {
  /** Stable §8.1 suggestion-id. */
  id: string;
  category: SuggestionCategory;
  /** Qualified `"schema.table"` when the suggestion is table-scoped. */
  table?: string;
  status: SuggestionStatus;
  /** The LLM value for this suggestion; `undefined` when the LLM offered none. */
  llmValue: unknown;
  /** The heuristic baseline value; `undefined` when the heuristic offered none. */
  heuristicValue: unknown;
  /** An existing `source: 'user'` override value, for `user-locked` rows. */
  currentValue?: unknown;
  /** 0..1; the LLM suggestion's confidence, or the heuristic 0.5 fallback. */
  confidence: number;
  /** One-sentence evidence from the LLM suggestion, when it carries one. */
  reason?: string;
}

export interface DiffOptions {
  /**
   * Suggestion-ids whose apply target already carries a `source: 'user'`
   * override (§8.2). These render locked and are excluded from bulk accept —
   * their status becomes `user-locked` regardless of the diff category.
   */
  userLockedIds?: Iterable<string>;
  /** User-override values keyed by suggestion-id, surfaced as `currentValue`. */
  currentValues?: Readonly<Record<string, unknown>>;
}

// ─── Bulk-accept semantics (acceptance criterion 12) ─────────────────────────

/**
 * The only statuses "Accept all ≥ 0.8" may pre-check (§8.2 "Review default").
 * `rejects-heuristic` and `user-locked` are deliberately absent, so they can
 * never enter a confidence-gated bulk set; `agree` is pre-accepted separately
 * and `heuristic-only` has nothing to accept.
 */
export const CONFIDENCE_SELECTABLE_STATUSES = [
  'conflict',
  'llm-new',
] as const satisfies readonly SuggestionStatus[];

const SELECTABLE = new Set<SuggestionStatus>(CONFIDENCE_SELECTABLE_STATUSES);

/** Whether `diff` would be pre-checked by "Accept all ≥ threshold". */
export function isBulkAcceptable(diff: SuggestionDiff, threshold = 0.8): boolean {
  return SELECTABLE.has(diff.status) && diff.confidence >= threshold;
}

/**
 * The suggestion-ids "Accept all ≥ threshold" selects. Never includes
 * `rejects-heuristic` or `user-locked` rows (acceptance criterion 12).
 */
export function selectBulkAccept(diffs: readonly SuggestionDiff[], threshold = 0.8): string[] {
  return diffs.filter((d) => isBulkAcceptable(d, threshold)).map((d) => d.id);
}

// ─── The diff ────────────────────────────────────────────────────────────────

const CATEGORY_ORDER: readonly SuggestionCategory[] = [
  'label',
  'key',
  'enum',
  'relation',
  'pii',
  'template',
  'group',
  'dashboard',
  'widget',
  'copy',
];

/**
 * Diff the LLM `EnrichmentSet` against the heuristic baseline (§8.2).
 * Implements the doc's `diff(llm, heuristic)`.
 */
export function diffEnrichment(
  llm: EnrichmentSet,
  heuristic: EnrichmentSet,
  opts: DiffOptions = {},
): SuggestionDiff[] {
  const locked = new Set(opts.userLockedIds ?? []);
  const currentValues = opts.currentValues ?? {};
  const raw: SuggestionDiff[] = [];

  diffLabels(llm, heuristic, raw);
  diffKeys(llm, heuristic, raw);
  diffEnums(llm, heuristic, raw);
  diffRelations(llm, heuristic, raw);
  diffPii(llm, heuristic, raw);
  diffTemplates(llm, heuristic, raw);
  diffGroups(llm, heuristic, raw);
  diffDashboards(llm, heuristic, raw);
  diffCopy(llm, heuristic, raw);

  const rows = raw.map((r) => applyLock(r, locked, currentValues));
  rows.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return rows;
}

function applyLock(
  row: SuggestionDiff,
  locked: ReadonlySet<string>,
  currentValues: Readonly<Record<string, unknown>>,
): SuggestionDiff {
  if (!locked.has(row.id)) return row;
  const overlaid: SuggestionDiff = { ...row, status: 'user-locked' };
  const current = currentValues[row.id];
  if (current !== undefined) overlaid.currentValue = current;
  return overlaid;
}

// ─── Row factory (exactOptionalPropertyTypes-friendly) ───────────────────────

interface RowArgs {
  id: string;
  category: SuggestionCategory;
  table: string | undefined;
  status: SuggestionStatus;
  llmValue: unknown;
  heuristicValue: unknown;
  confidence: number;
  reason: string | undefined;
}

function row(args: RowArgs): SuggestionDiff {
  const built: SuggestionDiff = {
    id: args.id,
    category: args.category,
    status: args.status,
    llmValue: args.llmValue,
    heuristicValue: args.heuristicValue,
    confidence: args.confidence,
  };
  if (args.table !== undefined) built.table = args.table;
  if (args.reason !== undefined) built.reason = args.reason;
  return built;
}

// ─── Category builders ───────────────────────────────────────────────────────

function tableKeys(llm: EnrichmentSet, heuristic: EnrichmentSet): string[] {
  return [...new Set([...Object.keys(llm.tables), ...Object.keys(heuristic.tables)])];
}

function diffLabels(llm: EnrichmentSet, heuristic: EnrichmentSet, out: SuggestionDiff[]): void {
  for (const table of tableKeys(llm, heuristic)) {
    const l = llm.tables[table];
    const h = heuristic.tables[table];

    out.push(
      row({
        id: tableLabelId(table),
        category: 'label',
        table,
        status: presenceOrLabel(l?.label, h?.label),
        llmValue: l ? labelBundle(l) : undefined,
        heuristicValue: h ? labelBundle(h) : undefined,
        confidence: l ? l.confidence : HEURISTIC_CONFIDENCE,
        reason: undefined,
      }),
    );

    const columns = new Set([
      ...(l ? Object.keys(l.columns) : []),
      ...(h ? Object.keys(h.columns) : []),
    ]);
    for (const column of columns) {
      const lc = l?.columns[column];
      const hc = h?.columns[column];
      out.push(
        row({
          id: columnLabelId(table, column),
          category: 'label',
          table,
          status: presenceOrLabel(lc?.label, hc?.label),
          llmValue: lc ? columnLabelBundle(lc) : undefined,
          heuristicValue: hc ? columnLabelBundle(hc) : undefined,
          confidence: l ? l.confidence : HEURISTIC_CONFIDENCE,
          reason: undefined,
        }),
      );
    }
  }
}

function diffKeys(llm: EnrichmentSet, heuristic: EnrichmentSet, out: SuggestionDiff[]): void {
  for (const table of tableKeys(llm, heuristic)) {
    const l = llm.tables[table];
    const h = heuristic.tables[table];
    const lv = l ? keyBundle(l) : undefined;
    const hv = h ? keyBundle(h) : undefined;
    out.push(
      row({
        id: keyId(table),
        category: 'key',
        table,
        status: presenceOrEqual(lv, hv),
        llmValue: lv,
        heuristicValue: hv,
        confidence: l ? l.confidence : HEURISTIC_CONFIDENCE,
        reason: undefined,
      }),
    );
  }
}

function diffEnums(llm: EnrichmentSet, heuristic: EnrichmentSet, out: SuggestionDiff[]): void {
  const keys = new Set([...Object.keys(llm.enums), ...Object.keys(heuristic.enums)]);
  for (const key of keys) {
    const le = llm.enums[key];
    const he = heuristic.enums[key];
    const dot = key.lastIndexOf('.');
    const table = key.slice(0, dot);
    const column = key.slice(dot + 1);
    out.push(
      row({
        id: enumId(table, column),
        category: 'enum',
        table,
        status: presenceOrEqual(le && enumProjection(le), he && enumProjection(he)),
        llmValue: le,
        heuristicValue: he,
        confidence: le ? le.confidence : HEURISTIC_CONFIDENCE,
        reason: le?.reason,
      }),
    );
  }
}

function diffRelations(llm: EnrichmentSet, heuristic: EnrichmentSet, out: SuggestionDiff[]): void {
  const key = (r: EnrichmentSet['inferredRelations'][number]): string =>
    relationId(r.fromTable, r.fromColumns, r.toTable, r.toColumns);
  const llmRels = new Map(llm.inferredRelations.map((r) => [key(r), r] as const));
  const heurRels = new Map(heuristic.inferredRelations.map((r) => [key(r), r] as const));

  for (const id of new Set([...llmRels.keys(), ...heurRels.keys()])) {
    const lr = llmRels.get(id);
    const hr = heurRels.get(id);
    const status: SuggestionStatus =
      lr && !hr ? 'llm-new' : !lr && hr ? 'heuristic-only' : lr!.kind === hr!.kind ? 'agree' : 'conflict';
    const anchor = lr ?? hr!;
    out.push(
      row({
        id,
        category: 'relation',
        table: anchor.fromTable,
        status,
        llmValue: lr,
        heuristicValue: hr,
        confidence: lr ? lr.confidence : hr!.confidence,
        reason: lr?.evidence ?? hr?.evidence,
      }),
    );
  }

  // Suppressed declared FKs (`correct: false`): the heuristic accepts every
  // declared relation implicitly, so a suppression rejects that heuristic and is
  // a `rejects-heuristic` row a human must confirm (§8.2 / criterion 12). Never
  // pre-checked by "Accept all ≥ 0.8".
  for (const rel of llm.suppressedRelations) {
    out.push(
      row({
        id: relationId(rel.fromTable, rel.fromColumns, rel.toTable, rel.toColumns),
        category: 'relation',
        table: rel.fromTable,
        status: 'rejects-heuristic',
        llmValue: rel,
        heuristicValue: undefined,
        confidence: rel.confidence,
        reason: rel.semantics
          ? `LLM rejects the declared relation (correct: false): ${rel.semantics}`
          : 'LLM rejects the declared relation (correct: false).',
      }),
    );
  }
}

function diffPii(llm: EnrichmentSet, heuristic: EnrichmentSet, out: SuggestionDiff[]): void {
  for (const table of tableKeys(llm, heuristic)) {
    const l = llm.tables[table];
    const h = heuristic.tables[table];
    const columns = new Set([
      ...(l ? Object.keys(l.columns) : []),
      ...(h ? Object.keys(h.columns) : []),
    ]);
    for (const column of columns) {
      const lc = l?.columns[column];
      const hc = h?.columns[column];
      const lMentioned = lc !== undefined;
      const lp = lc?.pii; // undefined iff the LLM omitted the column entirely
      const hp = hc?.pii;

      let status: SuggestionStatus;
      let confidence: number;
      let reason: string | undefined;
      let llmValue: unknown;
      let heuristicValue: unknown;

      if (hp != null && lp != null) {
        // Both consider the column PII. `agree` (§8.2) means "LLM equals heuristic
        // after normalization" — so it only holds when kind AND masking match.
        // A different masking (e.g. heuristic mask-email → LLM none, which unmasks
        // a PII column) is a reviewable `conflict`, never a collapsed agree row.
        status = hp.kind === lp.kind && hp.masking === lp.masking ? 'agree' : 'conflict';
        confidence = lp.confidence;
        reason = lp.reason;
        llmValue = lp;
        heuristicValue = hp;
      } else if (hp != null && lMentioned && lp === null) {
        // The LLM saw the heuristic-flagged column and explicitly cleared it.
        status = 'rejects-heuristic';
        confidence = hp.confidence;
        reason = 'LLM explicitly rejects the heuristic PII flag (pii: null).';
        llmValue = null;
        heuristicValue = hp;
      } else if (hp != null && !lMentioned) {
        // Heuristic flagged it; the LLM offered no opinion.
        status = 'heuristic-only';
        confidence = hp.confidence;
        reason = hp.reason;
        llmValue = undefined;
        heuristicValue = hp;
      } else if (hp == null && lp != null) {
        // New PII the heuristic missed.
        status = 'llm-new';
        confidence = lp.confidence;
        reason = lp.reason;
        llmValue = lp;
        heuristicValue = null;
      } else {
        continue; // neither side flags this column
      }

      out.push(
        row({
          id: piiId(table, column),
          category: 'pii',
          table,
          status,
          llmValue,
          heuristicValue,
          confidence,
          reason,
        }),
      );
    }
  }
}

function diffTemplates(llm: EnrichmentSet, heuristic: EnrichmentSet, out: SuggestionDiff[]): void {
  for (const table of tableKeys(llm, heuristic)) {
    const l = llm.tables[table];
    const h = heuristic.tables[table];
    const llmTemplates = l?.templates ?? [];
    const heuristicTemplates = h?.templates ?? [];

    for (const t of llmTemplates) {
      const match = heuristicTemplates.find((x) => x.template === t.template);
      out.push(
        row({
          id: templateId(table, t.template),
          category: 'template',
          table,
          status: match ? 'agree' : 'llm-new',
          llmValue: t,
          heuristicValue: match,
          confidence: t.confidence,
          reason: t.reason,
        }),
      );
    }
    for (const t of heuristicTemplates) {
      if (llmTemplates.some((x) => x.template === t.template)) continue;
      out.push(
        row({
          id: templateId(table, t.template),
          category: 'template',
          table,
          status: 'heuristic-only',
          llmValue: undefined,
          heuristicValue: t,
          confidence: t.confidence,
          reason: t.reason,
        }),
      );
    }
  }
}

function diffGroups(llm: EnrichmentSet, heuristic: EnrichmentSet, out: SuggestionDiff[]): void {
  const llmGroups = new Map(llm.navGroups.map((g) => [g.id, g] as const));
  const heurGroups = new Map(heuristic.navGroups.map((g) => [g.id, g] as const));
  for (const gid of new Set([...llmGroups.keys(), ...heurGroups.keys()])) {
    const lg = llmGroups.get(gid);
    const hg = heurGroups.get(gid);
    out.push(
      row({
        id: groupId(gid),
        category: 'group',
        table: undefined,
        status: presenceOrEqual(lg && groupProjection(lg), hg && groupProjection(hg)),
        llmValue: lg,
        heuristicValue: hg,
        confidence: lg ? lg.confidence : HEURISTIC_CONFIDENCE,
        reason: undefined,
      }),
    );
  }
}

function diffDashboards(llm: EnrichmentSet, heuristic: EnrichmentSet, out: SuggestionDiff[]): void {
  const llmDash = new Map(llm.dashboards.map((d) => [d.id, d] as const));
  const heurDash = new Map(heuristic.dashboards.map((d) => [d.id, d] as const));
  for (const did of new Set([...llmDash.keys(), ...heurDash.keys()])) {
    const ld = llmDash.get(did);
    const hd = heurDash.get(did);
    out.push(
      row({
        id: dashboardId(did),
        category: 'dashboard',
        table: undefined,
        status: presenceOrEqual(ld && dashboardProjection(ld), hd && dashboardProjection(hd)),
        llmValue: ld,
        heuristicValue: hd,
        confidence: ld ? dashboardConfidence(ld) : dashboardConfidence(hd!),
        reason: undefined,
      }),
    );

    const llmWidgets = new Map((ld?.widgets ?? []).map((w) => [widgetId(did, w.widget, w.rank), w] as const));
    const heurWidgets = new Map((hd?.widgets ?? []).map((w) => [widgetId(did, w.widget, w.rank), w] as const));
    for (const wid of new Set([...llmWidgets.keys(), ...heurWidgets.keys()])) {
      const lw = llmWidgets.get(wid);
      const hw = heurWidgets.get(wid);
      const anchor = lw ?? hw!;
      out.push(
        row({
          id: wid,
          category: 'widget',
          table: anchor.table,
          status: presenceOrEqual(lw && widgetProjection(lw), hw && widgetProjection(hw)),
          llmValue: lw,
          heuristicValue: hw,
          confidence: lw ? lw.confidence : hw!.confidence,
          reason: lw?.reason ?? hw?.reason,
        }),
      );
    }
  }
}

function diffCopy(llm: EnrichmentSet, heuristic: EnrichmentSet, out: SuggestionDiff[]): void {
  for (const table of tableKeys(llm, heuristic)) {
    const lm = llm.tables[table]?.microcopy;
    const hm = heuristic.tables[table]?.microcopy;
    if (lm === undefined && hm === undefined) continue;
    out.push(
      row({
        id: copyId(table),
        category: 'copy',
        table,
        status: presenceOrEqual(lm, hm),
        llmValue: lm,
        heuristicValue: hm,
        confidence: llm.tables[table]?.confidence ?? HEURISTIC_CONFIDENCE,
        reason: undefined,
      }),
    );
  }
}

// ─── Comparators & value projections ─────────────────────────────────────────

/** §8.2: label comparison is case/whitespace-insensitive, en_US only. */
function presenceOrLabel(
  llm: EnrichmentTable['label'] | undefined,
  heuristic: EnrichmentTable['label'] | undefined,
): SuggestionStatus {
  if (llm && !heuristic) return 'llm-new';
  if (!llm && heuristic) return 'heuristic-only';
  return normalizeLabel(llm?.en_US) === normalizeLabel(heuristic?.en_US) ? 'agree' : 'conflict';
}

/** Presence check + deep structural equality for non-label suggestions. */
function presenceOrEqual(llm: unknown, heuristic: unknown): SuggestionStatus {
  const hasLlm = llm !== undefined;
  const hasHeuristic = heuristic !== undefined;
  if (hasLlm && !hasHeuristic) return 'llm-new';
  if (!hasLlm && hasHeuristic) return 'heuristic-only';
  return canonical(llm) === canonical(heuristic) ? 'agree' : 'conflict';
}

function normalizeLabel(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function labelBundle(t: EnrichmentTable): Record<string, unknown> {
  const bundle: Record<string, unknown> = { label: t.label };
  if (t.description !== undefined) bundle['description'] = t.description;
  if (t.icon !== undefined) bundle['icon'] = t.icon;
  return bundle;
}

function columnLabelBundle(c: EnrichmentTable['columns'][string]): Record<string, unknown> {
  const bundle: Record<string, unknown> = { label: c.label };
  if (c.description !== undefined) bundle['description'] = c.description;
  return bundle;
}

function keyBundle(t: EnrichmentTable): { displayColumn: string | null; naturalKey: string[] | null } {
  return { displayColumn: t.displayColumn ?? null, naturalKey: t.naturalKey ?? null };
}

function enumProjection(e: EnrichmentSet['enums'][string]): unknown {
  return { kind: e.kind, order: e.order, terminal: e.terminal ?? null, tones: e.tones };
}

function groupProjection(g: EnrichmentSet['navGroups'][number]): unknown {
  return { label: g.label.en_US ?? null, icon: g.icon, tables: g.tables };
}

function dashboardProjection(d: EnrichmentSet['dashboards'][number]): unknown {
  return { domain: d.domain, label: d.label.en_US ?? null, tables: d.tables };
}

type Widget = EnrichmentSet['dashboards'][number]['widgets'][number];

function widgetProjection(w: Widget): unknown {
  const projection: Record<string, unknown> = { widget: w.widget, span: w.span, table: w.table, title: w.titleEn };
  if (w.metricColumn !== undefined) projection['metricColumn'] = w.metricColumn;
  if (w.dimensionColumn !== undefined) projection['dimensionColumn'] = w.dimensionColumn;
  if (w.timeColumn !== undefined) projection['timeColumn'] = w.timeColumn;
  if (w.agg !== undefined) projection['agg'] = w.agg;
  return projection;
}

/** Dashboards carry no intrinsic confidence (§6.1); use their strongest widget. */
function dashboardConfidence(d: EnrichmentSet['dashboards'][number]): number {
  let max = HEURISTIC_CONFIDENCE;
  for (const w of d.widgets) max = Math.max(max, w.confidence);
  return max;
}

/** Deterministic JSON with recursively sorted object keys — order-independent equality. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(record).sort()) sorted[k] = sortKeys(record[k]);
    return sorted;
  }
  return value;
}

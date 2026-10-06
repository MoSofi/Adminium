// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHEN A POSTING FIRES — pure: no database, no add-on, no clock.
 *
 * A table may hand its rows to an add-on's ledger (`table.postings`): a sale
 * line takes stock, a payment spends a gift card. Each rule has up to three
 * phases — `reserve`, `post`, `reverse` — and each phase a POINT: the moment
 * it fires. This file answers one question for one write: which rules reach
 * which phase, judged on the row as it was (`before`) and as it is (`after`).
 *
 * A rule with `via` makes its table's rows LINES of the row the `via` column
 * names. A line's own create, and a point that says `own`, are judged on the
 * line; every other point is judged on that parent row — an order that is
 * picked up posts all its lines at once.
 *
 * Whether a rule is LIVE (its add-on installed, connected, switched on) is
 * not asked here: that changes with no change of the model, and is asked of
 * the ledger registry on every write.
 */
import type { TablePosting } from '../connections/effective-schema.js';
import type { Row } from './mask.js';
import { sameValue } from './write-values.js';

export type DeclaredPosting = TablePosting;
export type PostingPhaseName = 'reserve' | 'post' | 'reverse';
type Point = NonNullable<DeclaredPosting['post']>['on'];

/** A rule on ANOTHER table whose lines hang under this table's rows. */
export interface LinePosting {
  /** The table whose rows are the lines (its id). */
  child: string;
  /** The child's column that names the parent row. */
  via: string;
  /** The parent's column it names (its key). */
  parentKey: string;
  posting: DeclaredPosting;
}

/** Everything about postings one table's rules hold. */
export interface PostingScope {
  /** Its own rules with no `via`: a row of the table is the source. */
  postings: readonly DeclaredPosting[];
  /** Its own rules with `via`: its rows are lines. */
  asLine: readonly DeclaredPosting[];
  /** Rules of other tables whose lines hang under its rows: a row of the table is their source. */
  linePostings: readonly LinePosting[];
}

/** One phase of one rule reached by a write. */
export interface FiredPoint {
  posting: DeclaredPosting;
  phase: PostingPhaseName;
  /**
   * What the written row is to the rule: its `source`; one `line`, handed
   * alone with its parent as the source; or the `parent` whose lines of
   * `child` are all handed.
   */
  role: 'source' | 'line' | 'parent';
  /** With `parent`: where the lines are. */
  lines?: { child: string; via: string; parentKey: string };
}

/** The scope of a table's rules, or null when it hands nothing to any ledger: the write then runs as it always did. */
export function postingScope(rules: { postings?: readonly DeclaredPosting[]; asLine?: readonly DeclaredPosting[]; linePostings?: readonly LinePosting[] } | null | undefined): PostingScope | null {
  const postings = rules?.postings ?? [];
  const asLine = rules?.asLine ?? [];
  const linePostings = rules?.linePostings ?? [];
  return postings.length + asLine.length + linePostings.length === 0 ? null : { postings, asLine, linePostings };
}

const filled = (value: unknown): boolean => value !== null && value !== undefined && value !== '';
const among = (value: unknown, list: readonly unknown[]): boolean => list.some((candidate) => sameValue(value, candidate));

/** Whether a point is one a line answers for itself: its own create, or a point marked `own`. */
export function ownPoint(point: Point): boolean {
  return 'create' in point || ('own' in point && point.own === true);
}

/**
 * Whether a point is reached by this write. `before` is null for a create.
 * A point is CROSSED, never merely held: a row already in the state it names
 * fires nothing when another of its columns changes.
 */
export function pointReached(point: Point, before: Row | null, after: Row, stateColumn: string | undefined): boolean {
  if ('create' in point) return before === null;
  if ('set' in point) return filled(after[point.column]) && (before === null || !filled(before[point.column]));
  const column = 'to' in point ? stateColumn : point.column;
  if (column === undefined) return false;
  const values = 'to' in point ? point.to : point.in;
  if (!among(after[column], values)) return false;
  if (before !== null && among(before[column], values)) return false;
  // With `from`: only out of one of those — a row made in the state has come from nowhere.
  if (point.from !== undefined) return before !== null && among(before[column], point.from);
  return true;
}

const PHASES: readonly PostingPhaseName[] = ['reverse', 'reserve', 'post'];
const byRule = (a: FiredPoint, b: FiredPoint): number =>
  PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) ||
  a.posting.into.addOn.localeCompare(b.posting.into.addOn) ||
  a.posting.into.ledger.localeCompare(b.posting.into.ledger) ||
  a.posting.id.localeCompare(b.posting.id);

/**
 * Every phase this write reaches, in the order the calls run: what is given
 * back before what is taken (`reverse`, `reserve`, `post`), then by add-on,
 * ledger and rule. A delete reaches none: a row that still has an open
 * receipt is not deleted at all, which the guard says.
 */
export function firedPoints(scope: PostingScope, before: Row | null, after: Row | null, action: 'create' | 'update' | 'delete', stateColumn?: string): FiredPoint[] {
  if (action === 'delete' || after === null) return [];
  const out: FiredPoint[] = [];
  const phasesOf = (posting: DeclaredPosting, judged: (point: Point) => boolean, role: FiredPoint['role'], lines?: FiredPoint['lines']): void => {
    for (const phase of PHASES) {
      const point = posting[phase]?.on;
      if (point === undefined || !judged(point) || !pointReached(point, before, after, stateColumn)) continue;
      out.push({ posting, phase, role, ...(lines === undefined ? {} : { lines }) });
    }
  };
  for (const posting of scope.postings) phasesOf(posting, () => true, 'source');
  // A line answers for its own create and its `own` points; its parent for the rest.
  for (const posting of scope.asLine) phasesOf(posting, ownPoint, 'line');
  for (const line of scope.linePostings) phasesOf(line.posting, (point) => !ownPoint(point), 'parent', { child: line.child, via: line.via, parentKey: line.parentKey });
  return out.sort(byRule);
}

/**
 * Whether a row STANDS at a point now, whatever it came from: in one of the
 * states it names, holding one of its values, its column filled. (A create is
 * a moment, not a place: nothing stands at one.) What a row made later under
 * a parent is judged by — the parent crossed its point before the row was
 * there to be handed over.
 */
export function standsAt(point: Point, row: Row, stateColumn?: string): boolean {
  if ('create' in point) return false;
  const { from: _from, ...plain } = point as Point & { from?: unknown };
  return pointReached(plain as Point, null, row, stateColumn);
}

/** Whether a line is handed to a rule at all: not one its `unlessSet` column marks (a voided line), and one its `only` takes. */
export function lineTaken(posting: DeclaredPosting, line: Row): boolean {
  if (posting.unlessSet !== undefined && filled(line[posting.unlessSet])) return false;
  const only = posting.only;
  if (only === undefined) return true;
  if ('eq' in only) return sameValue(line[only.column], only.eq);
  if ('in' in only) return among(line[only.column], only.in);
  return filled(line[only.column]);
}

/**
 * The columns a rule reads of its row (and, under `via`, of the parent): once
 * a receipt is open, a change of one of them is refused — what was posted
 * would no longer be what the row says. The columns a point watches are not
 * among them (a point is how the row moves on), and the caller takes out the
 * inputs the add-on itself decides.
 */
export function frozenColumns(posting: DeclaredPosting): { row: string[]; parent: string[] } {
  const row = new Set<string>();
  const parent = new Set<string>();
  const take = (mapping: DeclaredPosting['map'][string] | undefined): void => {
    if (mapping === undefined) return;
    if (typeof mapping === 'string') row.add(mapping);
    else if ('parent' in mapping) parent.add(mapping.parent);
  };
  for (const mapping of Object.values(posting.map)) take(mapping);
  for (const mapping of Object.values(posting.multipliers ?? {})) take(mapping);
  take(posting.heldUntil);
  if (posting.unlessSet !== undefined) row.add(posting.unlessSet);
  if (posting.only !== undefined) row.add(posting.only.column);
  if (posting.via !== undefined) row.add(posting.via);
  // A point's own column is how the row moves on, never frozen.
  for (const phase of PHASES) {
    const point = posting[phase]?.on;
    if (point !== undefined && 'column' in point) (posting.via !== undefined && !ownPoint(point) ? parent : row).delete(point.column);
  }
  return { row: [...row].sort(), parent: [...parent].sort() };
}

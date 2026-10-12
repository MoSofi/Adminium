// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Row-limit coverage: every route, and every job, says how it treats a
 * person who is held to some rows of a table — or says, in writing, that it
 * reads and writes no row of a source table at all.
 *
 * A role can be held to the rows a person owns, their team's, the ones
 * nobody owns yet (`crud/row-limit.ts`). That limit is worth exactly as much
 * as the least careful door: one route that reads a table without asking
 * whose its rows are shows a rep every colleague's deal. So the list of doors
 * is not left to memory. This file names each one with the rule it follows,
 * and `row-coverage.test.ts` composes the real server and fails when a route
 * or a job kind is registered that is not named here. A new door cannot be
 * added without somebody deciding, in this file, what a limited person gets
 * from it.
 *
 * The mark is a claim, not a proof: what each door really does is proved by
 * the suites beside it (`row-limit-*.test.ts`, `row-reach-routes.test.ts`).
 * What this file proves is that no door was forgotten.
 *
 * THE RULES a mark names:
 *
 *  - `list`    the row test is ANDed into the list, its count and every page;
 *  - `visible` the row the caller names is read through `fetchVisible`: one
 *              they do not reach answers exactly as one that is not there;
 *  - `sub`     the row test of each table read sits inside the subquery that
 *              reads it (a lookup, a measure, a widget's join, a search);
 *  - `link`    a write that names a row of a limited table must name one the
 *              writer reaches, and a staff column follows its `set` rule;
 *  - `all`     needs every row: a person held to some gets a refusal, or the
 *              item is left out;
 *  - `whole`   answered over every row or refused, never in part (a figure
 *              that would be wrong if it counted only some rows);
 *  - `own`     a stored thing made from a limited table (a file out, a kept
 *              document): its requester's, and anybody else's only with
 *              every row;
 *  - `system`  runs as the system by design, and the docs say so;
 *  - `safe`    cannot show a limited row, for the reason given.
 */
export type RowRule = 'list' | 'visible' | 'sub' | 'link' | 'all' | 'whole' | 'own' | 'system' | 'safe';

export type RowMark = { kind: 'rows'; rules: readonly RowRule[]; note: string } | { kind: 'none'; why: string };

const MIN_REASON = 12;

/** This door reads or writes rows of a source table, and holds a limited person to theirs by these rules. */
export function rows(rules: RowRule | readonly RowRule[], note: string): RowMark {
  return { kind: 'rows', rules: Array.isArray(rules) ? (rules as readonly RowRule[]) : [rules as RowRule], note };
}

/** This door touches no row of a source table; `why` says what it does touch. */
export function noRows(why: string): RowMark {
  return { kind: 'none', why };
}

export function rowRouteKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

export interface RowCoverageRow {
  method: string;
  url: string;
  mark: RowMark | null;
}

export interface RowCoverageRegistry {
  record(route: { method: string | string[]; url: string }): void;
  rows(): readonly RowCoverageRow[];
  unmarked(): readonly RowCoverageRow[];
}

const NOT_DOORS: ReadonlySet<string> = new Set(['HEAD', 'OPTIONS']);

export function createRowCoverageRegistry(table: Readonly<Record<string, RowMark>>): RowCoverageRegistry {
  const collected: RowCoverageRow[] = [];
  return {
    record(route) {
      if (!route.url.startsWith('/api/')) return;
      for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
        if (NOT_DOORS.has(method)) continue;
        collected.push({ method, url: route.url, mark: table[rowRouteKey(method, route.url)] ?? null });
      }
    },
    rows: () => collected,
    unmarked: () => collected.filter((row) => row.mark === null),
  };
}

/** Everything wrong with a table of marks against what is registered: a door with no mark, a mark with no reason, a mark for a door that is gone. */
export function rowCoverageProblems(registered: readonly string[], table: Readonly<Record<string, RowMark>>, what: 'route' | 'job'): string[] {
  const out: string[] = [];
  const known = new Set(registered);
  for (const key of registered) {
    const mark = table[key];
    if (mark === undefined) {
      out.push(`${what} "${key}" has no row-limit mark: say how it treats a person held to some rows (rows(…)), or that it touches no source row (noRows(…))`);
      continue;
    }
    const reason = mark.kind === 'rows' ? mark.note : mark.why;
    if (reason.trim().length < MIN_REASON) out.push(`${what} "${key}": the mark says too little ("${reason}")`);
    if (mark.kind === 'rows' && mark.rules.length === 0) out.push(`${what} "${key}": a door that reads rows names at least one rule`);
  }
  for (const key of Object.keys(table)) if (!known.has(key)) out.push(`${what} "${key}" is marked and no longer registered: take the mark out`);
  return out;
}

declare module 'fastify' {
  interface FastifyInstance {
    rowCoverage: RowCoverageRegistry;
  }
}


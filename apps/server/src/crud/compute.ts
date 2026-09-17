// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `compute=` query parameter — derived columns on the CRUD read
 * endpoints.
 *
 * Wire shape: ONE optional param carrying URL-encoded JSON that mirrors the
 * page's stored `config.derived` block byte for byte:
 *
 *     compute={"measures":[…],"fields":[…]}
 *
 * `agg=` and `lookup=` are untouched — same grammar, same positional parsers,
 * same pinned tests. A new param rather than a widened one is also what buys
 * cross-release forward compatibility for free: `recordListQuery` is a
 * non-strict `z.object`, so a server one release behind STRIPS an unknown
 * `compute=` key and the column renders empty instead of erroring (D1).
 *
 * This module is the gate, not the compiler. It bounds the raw string, parses
 * it, hands the structure to the ONE shared validator in the page-config leaf
 * (`parseCrudDerived`, reached through `@adminium/engine/config` — the server
 * may not import `@adminium/widgets` at all), enforces the two limits that
 * need request context (the shared subquery budget and the shared alias
 * namespace), and works out which base columns the read has to project.
 * Resolution against the snapshot and SQL compilation live in `measures.ts`.
 *
 * ERROR POLARITY, which is the opposite of the intuition and deliberate (D10):
 * everything here is a page-AUTHOR mistake — malformed JSON, an unknown
 * identifier, a cycle, an over-cap block — and every one is a hard 422 that
 * fails the whole list read. Per-CALLER conditions (a missing read grant, a
 * masked column) are not errors at all: they degrade to `null` plus a
 * `_masked` marker, decided in `measures.ts` and `derive.ts`.
 */

import {
  MAX_MEASURES,
  collectFieldColumns,
  parseCrudDerived,
  type DerivedField,
  type Measure,
} from '@adminium/engine/config';

import { ValidationFailedError } from '../errors.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';

/*
 * ── THE ENVELOPE, AND WHY THIS ONE IS NOT THE STRUCTURAL MAXIMUM ───────────
 *
 * `crud/filters.ts` derives `MAX_WHERE_BYTES` from its own grammar: the
 * largest filter the DSL can express, so the cap refuses nothing the parser
 * would have accepted. That derivation cannot be copied here, because it does
 * not fit. Measured against this grammar at the widest identifiers any
 * dialect allows (64 bytes): one maximal measure is 1,250 bytes, one maximal
 * 24-node field is 1,749, and the full structural maximum — 12 measures and 8
 * fields — is 29,037 bytes, which URL-encodes to 37,163. Node's default
 * `maxHeaderSize` is 16,384 with no override anywhere in this tree, so a cap
 * at the structural maximum would bound nothing that could ever arrive: the
 * HTTP parser answers 431 first.
 *
 * So this cap is chosen for the two things that ARE reachable.
 *
 *   bytes — 8,192 is close to the largest `compute=` a default Node server
 *     can actually receive. URL-encoding expands a punctuation-dense payload
 *     by ~1.87x (measured on the real invoices block: 808 bytes becomes
 *     1,508), which puts 8 KB of JSON at roughly 15.3 KB on the request line,
 *     just inside the 16,384-byte budget. It is generous in practice — the
 *     five numbers the feature was built for cost 808 bytes — and it is the
 *     only bound on a WIDE payload, which the depth scan cannot see.
 *
 *   depth — 12, read off the grammar and asserted against the deepest legal
 *     payload rather than guessed. A `cases` node costs four levels of JSON
 *     nesting on the `when.left` path (`{`, `"cases":[`, the case `{`,
 *     `"when":{`), so a MAX_FIELD_DEPTH chain costs 4x2+1 = 9, and the
 *     `{"fields":[{"expr":` envelope adds 3. The measure path costs 7.
 *     Nothing the grammar accepts nests deeper.
 *
 * The depth scan exists because the byte cap does NOT bound CPU. Zod's
 * recursive union re-descends on failure, so a rejecting chain is quadratic
 * in depth: an 800-level `{"else": …}` chain of 7,242 bytes sits comfortably
 * under the byte cap and burns roughly 460 ms of event loop before returning
 * a clean 422. On a path whose only other backstop is the 300/min rate
 * bucket, that is an amplification primitive. The scan turns it into a
 * character walk.
 */

/** The largest `compute=` a default Node request line can carry, decoded. */
export const MAX_COMPUTE_BYTES = 8192;

/** Deepest JSON nesting the grammar can produce — the `when.left` chain. */
export const MAX_COMPUTE_DEPTH = 12;

/**
 * Size and nesting gate for the RAW `compute=` string — the half of the
 * limits that has to run before {@link JSON.parse} and the zod schema to mean
 * anything. One left-to-right character scan, string-literal aware so a
 * literal like `"[[[["` is text and not structure.
 *
 * Refuses as the same 422 the rest of the parser throws: every shape it turns
 * away is one the grammar would have turned away anyway, just for a price the
 * caller no longer gets to charge us.
 */
export function assertComputeEnvelope(raw: string): void {
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > MAX_COMPUTE_BYTES) {
    throw new ValidationFailedError(
      `\`compute\` is limited to ${String(MAX_COMPUTE_BYTES)} bytes.`,
      { maxBytes: MAX_COMPUTE_BYTES, bytes },
    );
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === 0x5c) escaped = true; // backslash
      else if (ch === 0x22) inString = false; // closing quote
      continue;
    }
    if (ch === 0x22) {
      inString = true;
    } else if (ch === 0x7b || ch === 0x5b) {
      // { or [
      depth += 1;
      if (depth > MAX_COMPUTE_DEPTH) {
        throw new ValidationFailedError(
          `\`compute\` may nest at most ${String(MAX_COMPUTE_DEPTH)} levels deep.`,
          { maxDepth: MAX_COMPUTE_DEPTH },
        );
      }
    } else if (ch === 0x7d || ch === 0x5d) {
      // } or ]
      depth -= 1;
    }
  }
}

export interface ParseComputeOptions {
  view: SnapshotView;
  table: ResolvedTable;
  /** Aliases already claimed by this request's `lookup=` and `agg=` params. */
  takenAliases?: ReadonlySet<string> | undefined;
  /** Correlated subqueries `agg=` already bought — the budget is SHARED (D13). */
  usedSubqueries?: number | undefined;
}

export interface ParsedCompute {
  measures: readonly Measure[];
  fields: readonly DerivedField[];
  /**
   * Base columns the fields read, resolved to the snapshot's own strings.
   *
   * Merged into `runList`'s selected set — NOT pushed through `select=`. The
   * distinction is load-bearing: `select=` resolves through
   * `view.readableColumn`, which answers 403 `COLUMN_FORBIDDEN` for a masked
   * column, so routing this set through it would turn a field naming a masked
   * column into a whole-page 403 for a low-privilege reader — the exact
   * opposite of the degrade D11 specifies. Merging into the projection keeps
   * the column in the SELECT list, lets `maskRow` null it and mark it, and
   * lets the evaluator poison the field that reads it.
   */
  requiredColumns: readonly string[];
}

const EMPTY: ParsedCompute = { measures: [], fields: [], requiredColumns: [] };

/**
 * Parse and validate one `compute=` param against the request's table.
 *
 * Order matters and is not an accident: envelope, then parse, then the shared
 * validator, then the two request-scoped limits, then identifier resolution.
 * Each step is cheaper than the next and refuses more.
 */
export function parseComputeParam(raw: string, opts: ParseComputeOptions): ParsedCompute {
  if (raw.length === 0) return EMPTY;
  assertComputeEnvelope(raw);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ValidationFailedError('`compute` must be URL-encoded JSON.', {});
  }

  const { view, table } = opts;
  const parsed = parseCrudDerived(json, {
    // Every real column of the page's table, secret ones included: a measure
    // aliased onto one would shadow a row key even where the value is dropped.
    columns: [...table.columns.keys()],
    takenAliases: [...(opts.takenAliases ?? [])],
  });
  if (!parsed.ok) {
    throw new ValidationFailedError(parsed.refusal.message, {
      code: parsed.refusal.code,
      ...(parsed.refusal.id === undefined ? {} : { id: parsed.refusal.id }),
    });
  }
  const { measures, fields } = parsed.value;
  if (measures.length === 0 && fields.length === 0) return EMPTY;

  // One budget across both param families, or a page buys 24 correlated
  // subqueries by splitting them across `agg=` and `compute=` (D13).
  const used = opts.usedSubqueries ?? 0;
  if (used + measures.length > MAX_MEASURES) {
    throw new ValidationFailedError(
      `At most ${String(MAX_MEASURES)} aggregates and measures per request, combined.`,
      { max: MAX_MEASURES, aggregates: used, measures: measures.length },
    );
  }

  // 422 for an unknown or secret column — an author mistake, named. Resolved
  // to the snapshot's own string, which is what reaches SQL.
  const requiredColumns = collectFieldColumns(fields).map(
    (name) => view.column(table, name).name,
  );

  return { measures, fields, requiredColumns };
}

/** Fastify hands a repeated query key over as an array; `compute` takes one. */
export function singleComputeParam(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return raw;
  if (raw.length > 1) {
    throw new ValidationFailedError('`compute` may be given at most once.', { count: raw.length });
  }
  return raw[0];
}

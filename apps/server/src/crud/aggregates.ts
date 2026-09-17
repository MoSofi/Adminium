// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `agg=` WIRE GRAMMAR — reverse-link aggregate columns on the CRUD read
 * endpoints: count the rows of a table whose FK points AT the source table,
 * aliased into each row, e.g. `item_count:invoice_items.invoice_id:count` on
 * an invoices list.
 *
 *     agg=<alias>:<table>.<fkColumn>:<aggregate>
 *
 * `<table>` is the REFERENCING table (qualified or default-schema bare name),
 * `<fkColumn>` its single-column FK onto the source table, and `<aggregate>`
 * is `count` — the token stays a closed set of ONE.
 *
 * THIS FILE IS NOW ONLY THE PARSER. Everything downstream of the parse —
 * relation resolution, masking, SQL, normalization — moved to `measures.ts`,
 * and a parsed `agg=` spec is up-converted into a `count` measure and
 * resolved by the same code that resolves `compute=`. One resolver, one
 * compiler, one masking policy: a parallel legacy path would drift, and what
 * it would drift on is a permission check.
 *
 * The GRAMMAR itself is byte-frozen (D1). It has exactly one free token and
 * an operand tree does not fit under any encoding, so richer aggregates
 * arrive on the new `compute=` param instead — which also means a server one
 * release behind simply STRIPS the unknown key and renders an empty column,
 * rather than needing a new refusal channel. Freezing it keeps all nine
 * pinned `crud-aggregates.test.ts` cases green, including the `sum` → 422:
 * `sum` is not a widening of this grammar, it is a different param.
 */

import { ValidationFailedError } from '../errors.js';
import { assertNotReservedAlias } from './reserved-aliases.js';
import type { Measure } from '@adminium/engine/config';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import { resolveMeasures, type MeasureRefusal, type ResolvedMeasure } from './measures.js';

/**
 * Most correlated subqueries one request may carry — mirrors lookups'
 * MAX_LOOKUPS, and SHARED with `compute=`'s measures so a page cannot buy 24
 * of them by splitting across the two params (D13).
 */
export const MAX_AGGREGATES = 12;

/** The closed aggregate vocabulary of the `agg=` WIRE; `count` only, forever. */
export const AGGREGATE_KINDS = ['count'] as const;
export type AggregateKind = (typeof AGGREGATE_KINDS)[number];

/** Aliases are row keys AND SQL aliases — keep them boring (lookups.ts). */
const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

interface ParsedAggregate {
  alias: string;
  table: string;
  fkColumn: string;
  agg: string;
}

function malformed(raw: string): never {
  throw new ValidationFailedError('`agg` must be `alias:table.fkColumn:aggregate`.', {
    agg: raw,
  });
}

function parseAggregateSpec(raw: string): ParsedAggregate {
  const firstColon = raw.indexOf(':');
  if (firstColon <= 0) malformed(raw);
  const alias = raw.slice(0, firstColon);
  if (!ALIAS_PATTERN.test(alias)) malformed(raw);
  const rest = raw.slice(firstColon + 1);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0 || lastColon === rest.length - 1) malformed(raw);
  const target = rest.slice(0, lastColon);
  const agg = rest.slice(lastColon + 1);
  // Qualified table names carry dots ("public.invoice_items") — the LAST dot
  // separates the FK column from the table name.
  const lastDot = target.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === target.length - 1) malformed(raw);
  return {
    alias,
    table: target.slice(0, lastDot),
    fkColumn: target.slice(lastDot + 1),
    agg,
  };
}

/**
 * A parsed `agg=` spec as a measure — the up-conversion that gives the two
 * param families one resolver (D15).
 *
 * `count` carries no `of` body by construction, which is exactly what the
 * shared vocabulary requires of it, so the conversion is total: there is no
 * `agg=` spec this cannot express.
 */
export function aggSpecToDerive(parsed: { alias: string; table: string; fkColumn: string }): Measure {
  return { id: parsed.alias, table: parsed.table, fkColumn: parsed.fkColumn, fn: 'count' };
}

export interface ResolveAggregatesOptions {
  view: SnapshotView;
  table: ResolvedTable;
  /** Raw `agg=` values, in request order. */
  raw: readonly string[];
  canReadPii: boolean;
  /** Per-table read check (`table:<conn>:<id>:read`) for the referencing table. */
  canReadTable: (tableId: string) => Promise<boolean>;
  /** Aliases already claimed by this request's `lookup=` params. */
  takenAliases?: ReadonlySet<string> | undefined;
  /** Called once per refusal, for the audit trail (D16). */
  onRefusal?: ((refusal: MeasureRefusal) => void) | undefined;
}

/**
 * Parse + resolve every `agg=` param against the snapshot. Throws 422 for
 * malformed specs, unsupported aggregates, unknown/secret identifiers,
 * non-inbound-FK columns, alias collisions (base columns, lookup aliases,
 * other aggregates); marks caller-specific refusals (permissions, masking)
 * as `refused` instead.
 */
export async function resolveAggregates(
  opts: ResolveAggregatesOptions,
): Promise<ResolvedMeasure[]> {
  const { view, table, raw } = opts;
  if (raw.length === 0) return [];
  if (raw.length > MAX_AGGREGATES) {
    throw new ValidationFailedError(`At most ${String(MAX_AGGREGATES)} aggregates per request.`, {
      max: MAX_AGGREGATES,
    });
  }
  const specs: Measure[] = [];
  const seen = new Set<string>(opts.takenAliases ?? []);
  for (const entry of raw) {
    const parsed = parseAggregateSpec(entry);
    if (!(AGGREGATE_KINDS as readonly string[]).includes(parsed.agg)) {
      throw new ValidationFailedError(
        `Unsupported aggregate ${JSON.stringify(parsed.agg)} — supported: ${AGGREGATE_KINDS.join(', ')}.`,
        { agg: parsed.agg },
      );
    }
    if (seen.has(parsed.alias)) {
      throw new ValidationFailedError(`Duplicate alias ${JSON.stringify(parsed.alias)}.`, {
        alias: parsed.alias,
      });
    }
    seen.add(parsed.alias);
    assertNotReservedAlias(parsed.alias, 'Aggregate');
    if (table.columns.has(parsed.alias)) {
      // The alias would shadow a real row key — refuse rather than corrupt.
      throw new ValidationFailedError(
        `Aggregate alias ${JSON.stringify(parsed.alias)} collides with a column of ${table.id}.`,
        { alias: parsed.alias, table: table.id },
      );
    }
    specs.push(aggSpecToDerive(parsed));
  }
  return resolveMeasures({
    view,
    table,
    specs,
    canReadPii: opts.canReadPii,
    canReadTable: opts.canReadTable,
    onRefusal: opts.onRefusal,
  });
}

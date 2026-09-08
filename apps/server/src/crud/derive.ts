// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Derived fields on the CRUD read endpoints — the `compute=` param's
 * arithmetic half (36-derived-columns.md §3.5).
 *
 * One ordered pass per row, run AFTER the whole masking chain
 * (`maskRows → applyLookupMask → applyMeasureMask`) at both list return sites
 * and as a fourth stage on the single-record GET. The evaluator itself lives
 * in the page-config leaf and is reached through `@adminium/engine/config`,
 * so the Studio's live preview runs the identical code and cannot drift from
 * the number the grid shows (D3/D4). This file is only the placement and the
 * marker bookkeeping.
 *
 * WHY AFTER MASKING, AND NOT IN SQL. A field reads measures, this row's own
 * columns and literals; no dialect permits a sibling SELECT alias inside one
 * SELECT list, so a SQL-side evaluator would re-inline each measure's whole
 * correlated subquery into every consumer. Running it here also means
 * `maskRow` has already nulled masked values and dropped secret ones, so the
 * evaluator physically cannot read what did not survive masking: a refusal
 * bug can only fail to null arithmetic, never to derived plaintext.
 *
 * THE MARKER IS THE CONTRACT. A refused operand poisons its whole field —
 * including through a `cases` predicate, because a conditional evaluated over
 * an unreadable input leaks one bit per row (D11) — and the field's id joins
 * the row's `_masked` array, exactly as a masked base column does. An
 * unmarked null is a different state and keeps a different rule: it absorbs,
 * and the cell renders an em-dash rather than masked dots.
 */

import { evaluateDerivedFields, type DerivedField } from '@adminium/engine/config';

import type { Row } from './mask.js';

/** The row key `maskRow` writes its refusal list under. */
const MASK_MARKER = '_masked';

/**
 * Evaluate `fields` onto every row, in place, merging refusals into each
 * row's `_masked` marker.
 *
 * Returns the same array so it can wrap the masking chain at a return site
 * the way `applyMeasureMask` and `applyLookupMask` already do.
 */
export function applyDerivedFields(rows: Row[], fields: readonly DerivedField[]): Row[] {
  if (fields.length === 0) return rows;
  for (const row of rows) {
    const marker = row[MASK_MARKER];
    const masked = Array.isArray(marker) ? (marker as string[]) : [];
    const result = evaluateDerivedFields(fields, { row, masked });
    for (const [id, value] of Object.entries(result.values)) row[id] = value;
    if (result.masked.length > 0) row[MASK_MARKER] = [...masked, ...result.masked];
  }
  return rows;
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A choice column's words for its values, from the server, laid onto the
 * columns a page or a card stores.
 *
 * A stored column spec is written once, in one language, and page generation
 * never writes a choice column's labels into it — so a list drawn from the
 * stored spec alone shows `checked_in` where the form on the same page offers
 * "Eingecheckt". The server reads each value's word (and tone) in the reader's
 * language on every answer; a column that sets none of its own takes those.
 * A column that does set its own keeps them: what a person wrote on this page
 * wins over what the table says.
 */
import { gridToneSchema, type GridColumnSpec, type GridTone } from '../../page-config/grid-column-spec.js';

/** What the server says a choice column's values are called, and drawn in. */
export interface ChoiceWords {
  enumLabels?: Readonly<Record<string, string>> | undefined;
  enumTones?: Readonly<Record<string, string>> | undefined;
}

/** The tones a cell can draw; anything else is left to the column's default. */
function cellTones(tones: Readonly<Record<string, string>> | undefined): Record<string, GridTone> | undefined {
  if (tones === undefined) return undefined;
  const out: Record<string, GridTone> = {};
  for (const [value, tone] of Object.entries(tones)) {
    const parsed = gridToneSchema.safeParse(tone);
    if (parsed.success) out[value] = parsed.data;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Each column with the server's words and tones for its values, where it sets
 * none of its own. The same array back when nothing is added, so a render keeps
 * the same columns.
 */
export function withChoices(
  columns: readonly GridColumnSpec[],
  choicesOf: (name: string) => ChoiceWords | undefined,
): readonly GridColumnSpec[] {
  let changed = false;
  const merged = columns.map((column) => {
    const served = choicesOf(column.name);
    if (served === undefined) return column;
    const enumLabels = column.enumLabels === undefined && served.enumLabels !== undefined ? { ...served.enumLabels } : undefined;
    const enumTones = column.enumTones === undefined ? cellTones(served.enumTones) : undefined;
    if (enumLabels === undefined && enumTones === undefined) return column;
    changed = true;
    return { ...column, ...(enumLabels === undefined ? {} : { enumLabels }), ...(enumTones === undefined ? {} : { enumTones }) };
  });
  return changed ? merged : columns;
}

/** The words a server answer's `columns` carry, by column name (a `record-list`, a `record`). */
export function servedChoicesOf(data: unknown): ReadonlyMap<string, ChoiceWords> {
  const out = new Map<string, ChoiceWords>();
  const columns = typeof data === 'object' && data !== null ? (data as { columns?: unknown }).columns : undefined;
  if (!Array.isArray(columns)) return out;
  for (const column of columns as { name?: unknown; enumLabels?: unknown; enumTones?: unknown }[]) {
    if (typeof column?.name !== 'string') continue;
    const labels = isWords(column.enumLabels) ? column.enumLabels : undefined;
    const tones = isWords(column.enumTones) ? column.enumTones : undefined;
    if (labels === undefined && tones === undefined) continue;
    out.set(column.name, { ...(labels === undefined ? {} : { enumLabels: labels }), ...(tones === undefined ? {} : { enumTones: tones }) });
  }
  return out;
}

function isWords(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// SPDX-License-Identifier: AGPL-3.0-only
/** The tones a cell may draw a choice in; anything else is left to the default. */
const CELL_TONES: ReadonlySet<string> = new Set(['neutral', 'accent', 'pos', 'warn', 'danger', 'info', 'muted']);

/**
 * A choice column's words for its values, and their tones: its value labels,
 * with the words and tones of its inline allowed values over them — the ones
 * a form offers, so a card and a form say the same thing. Both are already
 * read in the reader's language (`applyOverrides`).
 */
export function choiceWordsOf(column: unknown): { labels: Record<string, string> | undefined; tones: Record<string, string> } {
  const { enumLabels, enumTones, options } = (column ?? {}) as {
    enumLabels?: Record<string, string>;
    enumTones?: Record<string, string>;
    options?: { values?: { value: string; label?: string; tone?: string }[] };
  };
  const labels: Record<string, string> = { ...enumLabels };
  const tones: Record<string, string> = { ...enumTones };
  for (const item of options?.values ?? []) {
    if (item.label !== undefined) labels[item.value] = item.label;
    if (item.tone !== undefined) tones[item.value] = item.tone;
  }
  return {
    labels: enumLabels === undefined && Object.keys(labels).length === 0 ? undefined : labels,
    tones: Object.fromEntries(Object.entries(tones).filter(([, tone]) => CELL_TONES.has(tone))),
  };
}

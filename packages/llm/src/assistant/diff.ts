// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A line diff between two short summaries of a document.
 *
 * The assistant's result card shows what a draft changes against the document
 * it was based on. The model never writes that diff — a model's account of its
 * own changes is a claim, and this is a fact — so the server projects both
 * documents to a list of summary lines and diffs the lists here.
 *
 * Plain longest-common-subsequence over whole lines: the inputs are tens of
 * lines, capped, so the quadratic table is small and the output is the stable,
 * minimal diff a reader expects (removals before additions inside a changed
 * run, as every diff tool prints them).
 *
 * Pure and deterministic. Browser-safe.
 */

/** Lines a side may carry. Longer input is cut and the cut is reported, never silently dropped. */
export const ASSISTANT_DIFF_MAX_LINES = 400;

export type AssistantDiffSign = '+' | '-' | ' ';

export interface AssistantDiffLine {
  sign: AssistantDiffSign;
  text: string;
}

export interface AssistantLineDiff {
  adds: number;
  dels: number;
  lines: AssistantDiffLine[];
  /** True when either side was longer than {@link ASSISTANT_DIFF_MAX_LINES} and was cut. */
  truncated: boolean;
}

/**
 * Diff `base` against `draft`. With no base (`null`) the draft is new and every
 * line is an addition.
 */
export function assistantLineDiff(base: readonly string[] | null, draft: readonly string[]): AssistantLineDiff {
  const right = draft.slice(0, ASSISTANT_DIFF_MAX_LINES);
  if (base === null) {
    return {
      adds: right.length,
      dels: 0,
      lines: right.map((text) => ({ sign: '+', text })),
      truncated: draft.length > ASSISTANT_DIFF_MAX_LINES,
    };
  }
  const left = base.slice(0, ASSISTANT_DIFF_MAX_LINES);
  const truncated = base.length > ASSISTANT_DIFF_MAX_LINES || draft.length > ASSISTANT_DIFF_MAX_LINES;

  // lcs[i][j] = length of the LCS of left[i..] and right[j..]. One flat array:
  // the table is at most 401 × 401 numbers.
  const width = right.length + 1;
  const lcs = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        left[i] === right[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }

  const lines: AssistantDiffLine[] = [];
  let adds = 0;
  let dels = 0;
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const a = left[i] as string;
    const b = right[j] as string;
    if (a === b) {
      lines.push({ sign: ' ', text: a });
      i += 1;
      j += 1;
    } else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      // Ties go to the removal, which is what puts `-` above `+` in a replaced line.
      lines.push({ sign: '-', text: a });
      dels += 1;
      i += 1;
    } else {
      lines.push({ sign: '+', text: b });
      adds += 1;
      j += 1;
    }
  }
  for (; i < left.length; i += 1) {
    lines.push({ sign: '-', text: left[i] as string });
    dels += 1;
  }
  for (; j < right.length; j += 1) {
    lines.push({ sign: '+', text: right[j] as string });
    adds += 1;
  }
  return { adds, dels, lines, truncated };
}

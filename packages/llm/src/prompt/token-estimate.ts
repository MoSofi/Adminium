// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `chars / 3.6` heuristic token estimator (06-llm-assist.md §2, §4.5).
 *
 * Deliberately provider-agnostic and conservative: it slightly over-counts for
 * typical English + JSON so a prompt that "fits" the budget fits every supported
 * provider's real tokenizer with headroom. Pure and deterministic — no model
 * download, no network, no `Date.now`/`Math.random`.
 */

/** Characters-per-token divisor (§4.5: `tokens ≈ ceil(chars / 3.6)`). */
export const CHARS_PER_TOKEN = 3.6;

/**
 * Estimate the input-token count of `text` as `ceil(text.length / 3.6)`.
 * Empty input is 0 tokens.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

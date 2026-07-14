/**
 * `@adminium/llm` — headless LLM-assist: provider clients, prompt builder,
 * response contract + validation, EnrichmentSet normalization/diff, and the
 * BYO round-trip. Browser-safe (pure Zod / pure TS + global `fetch`); consumed
 * by both `@adminium/server` and `@adminium/dashboard`. See 06-llm-assist.md.
 *
 * This is the single top-level barrel: it re-exports every subdir barrel. The
 * tracks own their own subdir barrels; this file stitches them together.
 */
export const PACKAGE_NAME = '@adminium/llm';

// Shared contract types (§2, §7.1) + the encrypted-key crypto contract (§3.2).
export * from './types.js';
export * from './crypto.js';

// Response contract + validation pipeline (§6, §7).
export * from './response/index.js';

// Prompt builder + chunker (§4, §5).
export * from './prompt/index.js';

// Direct-API provider clients (§3).
export * from './providers/index.js';

// Apply: EnrichmentSet normalization + field-by-field diff (§8).
export * from './apply/index.js';

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminium/llm` — headless LLM-assist: provider clients, prompt builder,
 * response contract + validation, EnrichmentSet normalization/diff, and the
 * BYO round-trip. Browser-safe (pure Zod / pure TS + global `fetch`); consumed
 * by both `@adminium/server` and `@adminium/dashboard`.
 *
 * This is the single top-level barrel: it re-exports every subdir barrel. The
 * tracks own their own subdir barrels; this file stitches them together.
 */
export const PACKAGE_NAME = '@adminium/llm';

// Shared contract types + the encrypted-key crypto contract.
export * from './types.js';
export * from './crypto.js';

// Response contract + validation pipeline.
export * from './response/index.js';

// Prompt builder + chunker.
export * from './prompt/index.js';

// Direct-API provider clients.
export * from './providers/index.js';

// Apply: EnrichmentSet normalization + field-by-field diff.
export * from './apply/index.js';
export { NAV_GROUP_MAX } from './nav-group.js';

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminium/llm` prompt-builder barrel — 06-llm-assist.md §4, §5.
 *
 * `buildPrompt` is the single producer of prompt text shared by the direct-API
 * and BYO paths. `PROMPT_VERSION` / `SCHEMA_VERSION` are intentionally NOT
 * re-exported here — the `response/` barrel owns them.
 */
export * from './types.js';
export * from './token-estimate.js';
export * from './serializer.js';
export * from './templates/v1.js';
export * from './builder.js';
export * from './chunker.js';

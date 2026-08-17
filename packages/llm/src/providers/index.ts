// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminium/llm` provider clients barrel (06-llm-assist.md §3). The direct-API
 * wire layer: fetch-based clients for Anthropic / OpenAI / OpenAI-compatible /
 * Ollama, their model catalogs, and the shared `ProviderClient` contract +
 * typed `ProviderError`. Browser-safe (global `fetch` only, no SDKs).
 */
export * from './types.js';
export * from './http.js';
export * from './model-catalog.js';
export * from './anthropic.js';
export * from './openai.js';
export * from './openai-compatible.js';
export * from './ollama.js';
export * from './factory.js';

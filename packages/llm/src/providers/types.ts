/**
 * Provider client contracts (06-llm-assist.md §3.1). The `ProviderClient`
 * interface below is reproduced VERBATIM from the doc — it is the wire-layer
 * boundary every direct-API path speaks through. Everything here is browser-safe
 * (pure TS + global `fetch`/`AbortController`); no provider SDKs, no `node:*`.
 */
import type { ProviderId } from '../types.js';

export type { ProviderId } from '../types.js';

// ─── ProviderClient (§3.1 — reproduced verbatim) ─────────────────────────────

export interface ProviderClient {
  readonly id: ProviderId;
  listModels(): Promise<{ id: string; label: string }[]>; // throws ProviderError
  complete(req: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    model: string;
    maxTokens: number; // response budget, default 16_000
    temperature: number; // always 0 for enrichment runs
  }): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }>;
  test(): Promise<{ ok: true; model: string; latencyMs: number }>; // 1-token ping
}

// ─── Config + convenience aliases ────────────────────────────────────────────

/**
 * Resolved provider configuration a client is constructed from (§3.2). The
 * `apiKey` is the DECRYPTED value: the server decrypts `llm.apiKey` (AES-256-GCM,
 * see `crypto.ts`) before building a client, and the client keeps it only in the
 * request header — never in a log, error, or thrown value (acceptance §10).
 */
export interface ProviderConfig {
  provider: ProviderId;
  /** Required for `anthropic`/`openai`; optional for `openai-compatible`; unused for `ollama`. */
  apiKey?: string;
  /** Required for `openai-compatible`; defaults to `http://localhost:11434` for `ollama`. */
  baseUrl?: string;
  /** Selected model id — required to `complete()` / `test()`. */
  model?: string;
  /** Response budget passed as `maxTokens`; default `16_000`. */
  maxOutputTokens?: number;
  /** Per-request timeout in ms; default `60_000`. */
  timeoutMs?: number;
}

/** Structural alias for `ProviderClient.complete`'s argument (not part of the verbatim interface). */
export interface CompleteRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  model: string;
  maxTokens: number;
  temperature: number;
}

/** Structural alias for `ProviderClient.complete`'s result. */
export interface CompleteResult {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** One entry in a model list (structural alias for `ProviderClient.listModels`'s element). */
export interface ModelInfo {
  id: string;
  label: string;
}

export const DEFAULT_MAX_OUTPUT_TOKENS = 16_000 as const;
export const DEFAULT_TIMEOUT_MS = 60_000 as const;

// ─── Typed provider error (§3, acceptance §10) ───────────────────────────────

/**
 * Every non-2xx response and network/timeout failure is mapped to this. It is
 * deliberately narrow and NEVER carries the API key: constructors scrub the
 * secret out of any provider-supplied error body before it reaches a `message`.
 */
export type ProviderErrorCode =
  | 'config' // misconfiguration before any request (missing key/model/baseUrl, temperature ≠ 0)
  | 'network' // fetch rejected (DNS, connection refused, offline)
  | 'timeout' // aborted by our own timeout
  | 'auth' // 401 / 403
  | 'rate_limit' // 429
  | 'not_found' // 404 (e.g. absent model-list endpoint)
  | 'server' // 5xx
  | 'http' // other non-2xx with no more specific mapping
  | 'bad_response'; // 2xx but unparseable / missing expected fields

export interface ProviderErrorInit {
  provider: ProviderId;
  code: ProviderErrorCode;
  message: string;
  status?: number;
  cause?: unknown;
}

export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly provider: ProviderId;
  readonly code: ProviderErrorCode;
  readonly status?: number;

  constructor(init: ProviderErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.provider = init.provider;
    this.code = init.code;
    if (init.status !== undefined) this.status = init.status;
  }
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/**
 * Enrichment runs are deterministic: temperature is fixed at 0, non-negotiable
 * (§3.1). This asserts it at the client boundary so a misconfigured caller fails
 * loudly rather than producing non-reproducible diffs.
 */
export function assertEnrichmentTemperature(temperature: number, provider: ProviderId): void {
  if (temperature !== 0) {
    throw new ProviderError({
      provider,
      code: 'config',
      message: `enrichment runs require temperature 0 (received ${String(temperature)})`,
    });
  }
}

export function requireApiKey(config: ProviderConfig, provider: ProviderId): string {
  const raw = config.apiKey;
  if (raw === undefined || raw.trim() === '') {
    throw new ProviderError({ provider, code: 'config', message: `${provider} requires an API key` });
  }
  return raw;
}

export function requireBaseUrl(config: ProviderConfig, provider: ProviderId): string {
  const raw = config.baseUrl;
  if (raw === undefined || raw.trim() === '') {
    throw new ProviderError({ provider, code: 'config', message: `${provider} requires a baseUrl` });
  }
  return stripTrailingSlash(raw);
}

export function requireModel(config: ProviderConfig, provider: ProviderId): string {
  const raw = config.model;
  if (raw === undefined || raw.trim() === '') {
    throw new ProviderError({ provider, code: 'config', message: `${provider} requires a model` });
  }
  return raw;
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Provider client contracts. The `ProviderClient` interface below is reproduced
 * VERBATIM from the doc — it is the wire-layer boundary every direct-API path
 * speaks through. Everything here is browser-safe (pure TS + global
 * `fetch`/`AbortController`); no provider SDKs, no `node:*`.
 */
import type { ProviderId } from '../types.js';

export type { ProviderId } from '../types.js';

// ─── ProviderClient (reproduced verbatim) ────────────────────────────────────

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
  /**
   * NOT in the doc's interface: added for speaking to the assistant. Turns
   * one short recording into text. Present only on a client whose service
   * transcribes (OpenAI, and OpenAI-compatible servers that offer the same
   * route); absent on the others, which is how a caller knows.
   */
  transcribe?(req: TranscribeRequest): Promise<{ text: string; seconds?: number }>;
}

/** One recording to turn into text. */
export interface TranscribeRequest {
  audio: Uint8Array;
  /** The recording's type as the browser made it: `audio/webm` or `audio/mp4`. */
  mime: string;
  /** The language spoken, as two letters (`de`), when known: it makes short recordings far more accurate. */
  language?: string;
  /** The provider's transcription model; each client has its own default. */
  model?: string;
  /** Stops the call when the person's own request has gone away. */
  signal?: AbortSignal;
}

// ─── Config + convenience aliases ────────────────────────────────────────────

/**
 * Resolved provider configuration a client is constructed from. The `apiKey` is
 * the DECRYPTED value: the server decrypts `llm.apiKey` (AES-256-GCM, see
 * `crypto.ts`) before building a client, and the client keeps it only in the
 * request header — never in a log, error, or thrown value (acceptance).
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
/**
 * The context window every Ollama request asks for (`options.num_ctx`). Ollama's
 * own default is a few thousand tokens and it drops the START of an oversized
 * prompt without an error — the system prompt — so the window is stated rather
 * than inherited. The assistant's input limit for `ollama` must stay below it.
 */
export const OLLAMA_NUM_CTX = 32_768 as const;
/**
 * How long one Ollama chat request may take. A local model reads a long prompt
 * and writes its whole reply before the first byte comes back (`stream: false`),
 * which on laptop hardware outlasts `DEFAULT_TIMEOUT_MS`. Kept under the five
 * minutes Node's fetch waits for response headers, so the failure is still our
 * own `timeout` and not a bare `network` error.
 */
export const OLLAMA_TIMEOUT_MS = 240_000 as const;

// ─── Typed provider error (acceptance) ───────────────────────────────────────

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
  | 'bad_response' // 2xx but unparseable / missing expected fields
  | 'aborted' // the caller's own signal stopped a streamed run
  | 'empty_response'; // 2xx, well-formed, but carried no assistant text

export interface ProviderErrorInit {
  provider: ProviderId;
  code: ProviderErrorCode;
  message: string;
  status?: number;
  cause?: unknown;
  /**
   * With `empty_response` only: the names of the tool calls the reply made in
   * the provider's OWN calling format instead of writing any text. A model
   * that does this has not failed to answer; it answered in a format nobody
   * asked for, and a caller that can say so (the assistant) asks again.
   */
  toolCalls?: readonly string[];
}

export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly provider: ProviderId;
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly toolCalls?: readonly string[];

  constructor(init: ProviderErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.provider = init.provider;
    this.code = init.code;
    if (init.status !== undefined) this.status = init.status;
    if (init.toolCalls !== undefined && init.toolCalls.length > 0) this.toolCalls = [...init.toolCalls];
  }
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/**
 * Enrichment runs are deterministic: temperature is fixed at 0, non-negotiable.
 * This asserts it at the client boundary so a misconfigured caller fails loudly
 * rather than producing non-reproducible diffs.
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

/**
 * Drops every trailing `/` from a base URL so the callers can concatenate
 * `${baseUrl}/v1/...` without doubling the separator. Empty-string in,
 * empty-string out; a URL that is nothing but slashes collapses to ''.
 *
 * Scanned rather than matched. `/\/+$/` is unanchored at the left, so the
 * engine restarted at every index, and at each one re-walked the whole run of
 * slashes before `$` failed — quadratic (CodeQL js/polynomial-redos #10, "many
 * repetitions of '/'"). `baseUrl` is operator-supplied config for the
 * `openai-compatible` and `ollama` providers and reaches here unbounded.
 */
export function stripTrailingSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 0x2f /* '/' */) end -= 1;
  return end === url.length ? url : url.slice(0, end);
}

/**
 * The names of a reply's tool calls made in the provider's own calling format
 * (`[{ function: { name } }]`, the shape OpenAI and Ollama share). Bounded: a
 * model's text is never trusted to be short or well-formed.
 */
export function nativeToolCallNames(calls: unknown): string[] {
  if (!Array.isArray(calls)) return [];
  const names: string[] = [];
  for (const call of calls.slice(0, 5)) {
    const name = (call as { function?: { name?: unknown } } | null)?.function?.name;
    if (typeof name === 'string' && name !== '') names.push(name.slice(0, 60));
  }
  return names;
}

/**
 * Model catalog (06-llm-assist.md §3.1 matrix): static fallback lists plus the
 * live `listModels()` fetchers each client delegates to. Fetchers hit the
 * provider's model-list endpoint and fall back per the matrix:
 *   - anthropic / openai → live, else the static list below
 *   - openai-compatible  → live, tolerate 404 → `[]` (user free-texts the model)
 *   - ollama             → live only (local models vary; no static fallback)
 *
 * The static ids are a conservative snapshot for offline/first-run UX; the live
 * fetch is always attempted first, so a stale entry here never blocks a real model.
 */
import { requestJson } from './http.js';
import { ProviderError, type ModelInfo } from './types.js';

// ─── Static fallback lists ───────────────────────────────────────────────────

export const ANTHROPIC_STATIC_MODELS: readonly ModelInfo[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

export const OPENAI_STATIC_MODELS: readonly ModelInfo[] = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
];

const ANTHROPIC_VERSION = '2023-06-01';

export interface CatalogFetchOptions {
  apiKey?: string;
  baseUrl: string; // already trimmed of trailing slashes by the caller
  timeoutMs?: number;
}

// ─── Live fetchers ───────────────────────────────────────────────────────────

interface AnthropicModelsResponse {
  data?: { id?: string; display_name?: string }[];
}

/** `GET {baseUrl}/v1/models`; on any failure returns the static Anthropic list. */
export async function listAnthropicModels(opts: CatalogFetchOptions): Promise<ModelInfo[]> {
  const apiKey = opts.apiKey ?? '';
  try {
    const json = await requestJson<AnthropicModelsResponse>({
      provider: 'anthropic',
      url: `${opts.baseUrl}/v1/models`,
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      apiKey,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    const models = (json.data ?? [])
      .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
      .map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
    return models.length > 0 ? models : [...ANTHROPIC_STATIC_MODELS];
  } catch {
    return [...ANTHROPIC_STATIC_MODELS];
  }
}

interface OpenAiModelsResponse {
  data?: { id?: string }[];
}

/**
 * True for ids that name a chat/completions-capable OpenAI model usable for
 * enrichment. The o-series reasoning models (`o1`/`o3`/`o4-*`) are deliberately
 * EXCLUDED: the Chat Completions contract this client speaks (`max_tokens` +
 * `temperature: 0`, both fixed by §3.1) is rejected by those models — they
 * require `max_completion_tokens` and forbid `temperature ≠ 1`, so every
 * enrichment call on them 400s. Since temperature 0 is a non-negotiable
 * determinism mandate (`assertEnrichmentTemperature`), offering them would be a
 * guaranteed dead end; we filter them out of the catalog entirely.
 */
function isOpenAiChatModel(id: string): boolean {
  return /gpt|chatgpt/i.test(id);
}

/** `GET {baseUrl}/models` filtered to chat models; on any failure returns the static OpenAI list. */
export async function listOpenAiModels(opts: CatalogFetchOptions): Promise<ModelInfo[]> {
  const apiKey = opts.apiKey ?? '';
  try {
    const json = await requestJson<OpenAiModelsResponse>({
      provider: 'openai',
      url: `${opts.baseUrl}/models`,
      headers: { authorization: `Bearer ${apiKey}` },
      apiKey,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    const models = (json.data ?? [])
      .filter((m): m is { id: string } => typeof m.id === 'string' && isOpenAiChatModel(m.id))
      .map((m) => ({ id: m.id, label: m.id }));
    return models.length > 0 ? models : [...OPENAI_STATIC_MODELS];
  } catch {
    return [...OPENAI_STATIC_MODELS];
  }
}

/**
 * `GET {baseUrl}/models` for an OpenAI-compatible endpoint. A 404 (endpoint not
 * implemented) is tolerated → `[]`, signalling the UI to offer a free-text model
 * field. Other failures (auth, network, 5xx) propagate as `ProviderError`.
 */
export async function listOpenAiCompatibleModels(opts: CatalogFetchOptions): Promise<ModelInfo[]> {
  const apiKey = opts.apiKey;
  const headers: Record<string, string> = {};
  if (apiKey !== undefined && apiKey.trim() !== '') headers['authorization'] = `Bearer ${apiKey}`;
  try {
    const json = await requestJson<OpenAiModelsResponse>({
      provider: 'openai-compatible',
      url: `${opts.baseUrl}/models`,
      headers,
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    return (json.data ?? [])
      .filter((m): m is { id: string } => typeof m.id === 'string')
      .map((m) => ({ id: m.id, label: m.id }));
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'not_found') return [];
    throw err;
  }
}

interface OllamaTagsResponse {
  models?: { name?: string }[];
}

/** `GET {baseUrl}/api/tags`; no static fallback — propagates `ProviderError` on failure. */
export async function listOllamaModels(opts: CatalogFetchOptions): Promise<ModelInfo[]> {
  const json = await requestJson<OllamaTagsResponse>({
    provider: 'ollama',
    url: `${opts.baseUrl}/api/tags`,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  return (json.models ?? [])
    .filter((m): m is { name: string } => typeof m.name === 'string')
    .map((m) => ({ id: m.name, label: m.name }));
}

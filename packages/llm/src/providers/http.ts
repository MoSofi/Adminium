/**
 * Shared fetch plumbing for the provider clients (06-llm-assist.md §3): one
 * JSON request helper with a timeout, deterministic error mapping to
 * `ProviderError`, and — the security-critical part (acceptance §10) — a secret
 * scrubber that guarantees the API key never survives into a thrown/logged
 * surface. Global `fetch` only; no SDKs, browser-safe.
 */
import {
  DEFAULT_TIMEOUT_MS,
  ProviderError,
  type CompleteResult,
  type ProviderClient,
  type ProviderErrorCode,
  type ProviderId,
} from './types.js';

/**
 * Removes every occurrence of `secret` from `text`. Applied to any
 * provider-supplied error body before it is placed in a `ProviderError.message`,
 * so an echoed Authorization header or key fragment can never leak. A no-op when
 * there is no secret to protect.
 */
export function scrubSecret(text: string, secret: string | undefined): string {
  if (secret === undefined || secret.length === 0) return text;
  return text.split(secret).join('[REDACTED]');
}

/**
 * Return an error safe to attach as a `ProviderError.cause` (acceptance §10): the
 * key must not survive into ANY logged/inspected surface, and consumers walk the
 * `[cause]` chain (`console.error`, `util.inspect`, pino/winston serializers).
 * The original error's `message` — and its `stack`, which embeds the message —
 * can echo an outgoing Authorization header, so when the secret appears anywhere
 * in it we replace it with a fresh scrubbed `Error` (no key in message or stack).
 * When there is no secret, or it does not appear, the original error is returned
 * unchanged so genuine network diagnostics (DNS, ECONNREFUSED) are preserved.
 */
export function scrubCause(err: unknown, secret: string | undefined): unknown {
  if (secret === undefined || secret.length === 0) return err;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? '') : '';
  if (!message.includes(secret) && !stack.includes(secret)) return err;
  const scrubbed = new Error(scrubSecret(message, secret));
  if (err instanceof Error) scrubbed.name = err.name;
  return scrubbed;
}

function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'http';
}

export interface RequestJsonOptions {
  provider: ProviderId;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  /** The secret to scrub from any error text (never sent anywhere else). */
  apiKey?: string;
  /** Abort after this many ms; defaults to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Performs a JSON request and parses the response, or throws a `ProviderError`.
 * Non-2xx → status-mapped error (body scrubbed + snippeted); fetch rejection →
 * `network`; our own abort → `timeout`; unparseable 2xx body → `bad_response`.
 */
export async function requestJson<T>(opts: RequestJsonOptions): Promise<T> {
  const { provider, url, method = 'GET', headers, body, apiKey } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const init: RequestInit = { method, signal: controller.signal };
  if (headers !== undefined) init.headers = headers;
  if (body !== undefined) init.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ProviderError({
        provider,
        code: 'timeout',
        message: `${provider}: request timed out after ${String(timeoutMs)}ms`,
      });
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new ProviderError({
      provider,
      code: 'network',
      message: `${provider}: network request failed (${scrubSecret(detail, apiKey)})`,
      cause: scrubCause(err, apiKey),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const raw = await safeText(res);
    const snippet = scrubSecret(raw, apiKey).slice(0, 500);
    throw new ProviderError({
      provider,
      code: codeForStatus(res.status),
      status: res.status,
      message: `${provider}: HTTP ${String(res.status)}${snippet ? ` — ${snippet}` : ''}`,
    });
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new ProviderError({
      provider,
      code: 'bad_response',
      status: res.status,
      message: `${provider}: response body was not valid JSON`,
      cause: scrubCause(err, apiKey),
    });
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Shared `ProviderClient.test()` implementation: a 1-token, temperature-0 ping
 * through the client's own `complete()`, timing the round-trip. `performance.now`
 * is intentionally not a determinism hazard — latency never feeds a prompt or diff.
 */
export async function pingComplete(
  client: ProviderClient,
  model: string,
): Promise<{ ok: true; model: string; latencyMs: number }> {
  const start = performance.now();
  await client.complete({
    system: '',
    messages: [{ role: 'user', content: 'ping' }],
    model,
    maxTokens: 1,
    temperature: 0,
  });
  return { ok: true, model, latencyMs: Math.round(performance.now() - start) };
}

/** Builds a `CompleteResult`, attaching `usage` only when both token counts are known. */
export function toCompleteResult(
  text: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): CompleteResult {
  const result: CompleteResult = { text };
  if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
    result.usage = { inputTokens, outputTokens };
  }
  return result;
}

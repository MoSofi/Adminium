// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The §3.1 model-catalog matrix, at the fetcher level.
 *
 * Each provider's client test already covers its happy path. What is pinned
 * here is the per-provider FALLBACK rule, which is the part that differs
 * between them and the part a user only ever meets on a bad day:
 *
 *   anthropic / openai   live list, else the static snapshot
 *   openai-compatible    live list, 404 tolerated → `[]`, other failures throw
 *   ollama               live only — no static fallback exists to hide behind
 *
 * The failure mode these guard against is a silently EMPTY model picker: a
 * provider that answers `200 {}` is not the same as a provider that has no
 * models, and a dropdown with nothing in it is indistinguishable from a broken
 * integration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ANTHROPIC_STATIC_MODELS,
  OPENAI_STATIC_MODELS,
  listAnthropicModels,
  listOllamaModels,
  listOpenAiCompatibleModels,
  listOpenAiModels,
} from './model-catalog.js';
import { ProviderError } from './types.js';

interface Captured {
  url: string;
  init: RequestInit;
}

function stubFetch(body: unknown, status = 200): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

function headerOf(call: Captured | undefined, name: string): string | undefined {
  const headers = call?.init.headers as Record<string, string> | undefined;
  return headers?.[name];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const BASE = 'https://api.example.test';

describe('listAnthropicModels', () => {
  it('maps display_name to the label and falls back to the id when it is absent', async () => {
    const calls = stubFetch({
      data: [
        { id: 'claude-sonnet-9', display_name: 'Claude Sonnet 9' },
        { id: 'claude-haiku-9' },
        { display_name: 'no id at all' },
      ],
    });

    expect(await listAnthropicModels({ apiKey: 'sk-ant-secret', baseUrl: BASE })).toEqual([
      { id: 'claude-sonnet-9', label: 'Claude Sonnet 9' },
      // A model with no display_name is still selectable — labelled by its id.
      { id: 'claude-haiku-9', label: 'claude-haiku-9' },
    ]);
    expect(calls[0]?.url).toBe(`${BASE}/v1/models`);
    expect(headerOf(calls[0], 'x-api-key')).toBe('sk-ant-secret');
    expect(headerOf(calls[0], 'anthropic-version')).toBe('2023-06-01');
  });

  it('falls back to the static snapshot when the response carries no models', async () => {
    // Two shapes of "answered, said nothing": no `data` key at all, and a
    // `data` array whose every entry the filter rejects. Both must produce a
    // usable picker rather than an empty one.
    stubFetch({});
    expect(await listAnthropicModels({ apiKey: 'k', baseUrl: BASE })).toEqual([
      ...ANTHROPIC_STATIC_MODELS,
    ]);

    stubFetch({ data: [{ display_name: 'nameless' }, {}] });
    expect(await listAnthropicModels({ apiKey: 'k', baseUrl: BASE })).toEqual([
      ...ANTHROPIC_STATIC_MODELS,
    ]);
  });

  it('sends an empty key rather than the string "undefined" when none is configured', async () => {
    // The first-run settings screen lists models before a key is saved. The
    // request is expected to 401 — what matters is that the header carries an
    // empty value, not `undefined` stringified into the wire.
    const calls = stubFetch({ error: 'unauthorized' }, 401);
    expect(await listAnthropicModels({ baseUrl: BASE })).toEqual([...ANTHROPIC_STATIC_MODELS]);
    expect(headerOf(calls[0], 'x-api-key')).toBe('');
  });
});

describe('listOpenAiModels', () => {
  it('keeps only chat-capable ids and labels them by id', async () => {
    const calls = stubFetch({
      data: [
        { id: 'gpt-4o' },
        { id: 'o3-mini' },
        { id: 'text-embedding-3-small' },
        { id: 'chatgpt-4o-latest' },
        { nope: true },
      ],
    });

    expect(await listOpenAiModels({ apiKey: 'sk-openai', baseUrl: BASE })).toEqual([
      { id: 'gpt-4o', label: 'gpt-4o' },
      { id: 'chatgpt-4o-latest', label: 'chatgpt-4o-latest' },
    ]);
    expect(calls[0]?.url).toBe(`${BASE}/models`);
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer sk-openai');
  });

  it('falls back to the static list when filtering leaves nothing', async () => {
    // An account whose only models are the o-series reasoning ones: the filter
    // is right to exclude them (they reject `temperature: 0`, which enrichment
    // mandates), but offering an empty picker would read as a broken key.
    stubFetch({ data: [{ id: 'o1' }, { id: 'o3-mini' }, { id: 'text-embedding-3-small' }] });
    expect(await listOpenAiModels({ apiKey: 'k', baseUrl: BASE })).toEqual([
      ...OPENAI_STATIC_MODELS,
    ]);

    stubFetch({});
    expect(await listOpenAiModels({ apiKey: 'k', baseUrl: BASE })).toEqual([
      ...OPENAI_STATIC_MODELS,
    ]);
  });
});

describe('listOpenAiCompatibleModels', () => {
  it('omits the authorization header when there is no usable key', async () => {
    // Local gateways (llama.cpp, LM Studio, vLLM) commonly run keyless, and
    // several reject a `Bearer ` header with an empty credential outright. A
    // key that is only whitespace is the same as no key.
    const none = stubFetch({ data: [{ id: 'local-model' }] });
    await listOpenAiCompatibleModels({ baseUrl: BASE });
    expect(headerOf(none[0], 'authorization')).toBeUndefined();

    const blank = stubFetch({ data: [{ id: 'local-model' }] });
    await listOpenAiCompatibleModels({ apiKey: '   ', baseUrl: BASE });
    expect(headerOf(blank[0], 'authorization')).toBeUndefined();

    const keyed = stubFetch({ data: [{ id: 'local-model' }] });
    const models = await listOpenAiCompatibleModels({ apiKey: 'sk-gw', baseUrl: BASE });
    expect(headerOf(keyed[0], 'authorization')).toBe('Bearer sk-gw');
    expect(models).toEqual([{ id: 'local-model', label: 'local-model' }]);
  });

  it('treats a missing /models endpoint as "no catalog", not as an error', async () => {
    // `[]` is the signal the settings UI uses to offer a free-text model field.
    // It must be reachable both from a 404 and from a 200 with no `data`.
    stubFetch({ error: 'not found' }, 404);
    expect(await listOpenAiCompatibleModels({ baseUrl: BASE })).toEqual([]);

    stubFetch({});
    expect(await listOpenAiCompatibleModels({ baseUrl: BASE })).toEqual([]);
  });

  it('propagates every other failure instead of hiding it behind an empty list', async () => {
    // An empty list means "this gateway has no catalog"; a bad key or a dead
    // gateway means "fix your settings", and the two must not look alike.
    stubFetch({ error: 'bad key' }, 401);
    await expect(listOpenAiCompatibleModels({ apiKey: 'k', baseUrl: BASE })).rejects.toMatchObject({
      code: 'auth',
      status: 401,
    });

    stubFetch({ error: 'boom' }, 500);
    await expect(listOpenAiCompatibleModels({ baseUrl: BASE })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('listOllamaModels', () => {
  it('reads the tags endpoint and skips entries with no name', async () => {
    const calls = stubFetch({
      models: [{ name: 'llama3.2:3b' }, { size: 12 }, { name: 'qwen2.5-coder:7b' }],
    });
    expect(await listOllamaModels({ baseUrl: BASE })).toEqual([
      { id: 'llama3.2:3b', label: 'llama3.2:3b' },
      { id: 'qwen2.5-coder:7b', label: 'qwen2.5-coder:7b' },
    ]);
    expect(calls[0]?.url).toBe(`${BASE}/api/tags`);
    // No API key is sent to a local daemon.
    expect(headerOf(calls[0], 'authorization')).toBeUndefined();
  });

  it('returns an empty list for a daemon with no models pulled yet', async () => {
    stubFetch({});
    expect(await listOllamaModels({ baseUrl: BASE })).toEqual([]);
  });

  it('has no static fallback — a dead daemon is an error, not a fake catalog', async () => {
    // Local model ids are whatever the user pulled; inventing a list would
    // offer models that provably are not installed.
    stubFetch({ error: 'boom' }, 500);
    await expect(listOllamaModels({ baseUrl: BASE })).rejects.toMatchObject({
      code: 'server',
      provider: 'ollama',
    });
  });
});

describe('timeoutMs is forwarded, not silently replaced by the 60s default', () => {
  /**
   * Proven by the clock: the request is aborted 25 fake milliseconds in. A
   * fetcher that dropped `timeoutMs` would arm `DEFAULT_TIMEOUT_MS` (60_000)
   * instead, the abort would never fire inside the window advanced here, and
   * the awaited promise would never settle.
   */
  function hangingFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted.');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      ),
    );
  }

  it('times the ollama fetcher out at the caller-supplied deadline', async () => {
    vi.useFakeTimers();
    hangingFetch();
    const pending = listOllamaModels({ baseUrl: BASE, timeoutMs: 25 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(25);
    const err = await pending;
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe('timeout');
    expect((err as ProviderError).message).toContain('25ms');
  });

  it('lets the anthropic and openai fetchers fall back on that timeout', async () => {
    vi.useFakeTimers();
    hangingFetch();
    const anthropic = listAnthropicModels({ apiKey: 'k', baseUrl: BASE, timeoutMs: 25 });
    const openai = listOpenAiModels({ apiKey: 'k', baseUrl: BASE, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await anthropic).toEqual([...ANTHROPIC_STATIC_MODELS]);
    expect(await openai).toEqual([...OPENAI_STATIC_MODELS]);
  });

  it('lets the openai-compatible fetcher surface that timeout', async () => {
    vi.useFakeTimers();
    hangingFetch();
    const pending = listOpenAiCompatibleModels({ baseUrl: BASE, timeoutMs: 25 }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(25);
    expect(((await pending) as ProviderError).code).toBe('timeout');
  });
});
